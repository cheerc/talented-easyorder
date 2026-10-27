import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateProject, validateWebConfig, deploymentArgs, releaseFiles, checkRelease, validateProviderState } from '../lib/release.mjs';

const web = { apiKey: 'synthetic-api-key', projectId: 'demo-easyorder', authDomain: 'demo-easyorder.firebaseapp.com', appId: '1:000000000000:web:synthetic', messagingSenderId: '000000000000', storageBucket: 'demo-easyorder.firebasestorage.app' };

test('accepts only an explicit matching EasyOrder project and public Web config', () => {
  assert.equal(validateProject('demo-easyorder', true), 'demo-easyorder');
  assert.equal(validateProject('easyorder-test-123', false), 'easyorder-test-123');
  assert.deepEqual(validateWebConfig(web, 'demo-easyorder', true), web);
});
test('refuses demo/production confusion, payroll targets, missing, extra or mismatched config', () => {
  for (const [id, emulator] of [['demo-easyorder', false], ['easyorder-test-123', true], ['talented-payroll', false], ['', false]]) {
    assert.throws(() => validateProject(id, emulator));
  }
  for (const config of [{ ...web, projectId: 'another-project' }, { ...web, apiKey: '' }, { ...web, private_key: 'never-accept' }, { ...web, authDomain: 'https://wrong.example' }]) {
    assert.throws(() => validateWebConfig(config, 'demo-easyorder', true));
  }
});
test('Hosting provides SPA fallback, security headers, revalidation and immutable hashed assets', () => {
  const { hosting } = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url)));
  assert.equal(hosting.public, 'frontend/dist');
  assert.deepEqual(hosting.rewrites, [{ source: '**', destination: '/index.html' }]);
  const all = hosting.headers.find(item => item.source === '**').headers;
  const csp = all.find(item => item.key === 'Content-Security-Policy').value;
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(all.find(item => item.key === 'Cache-Control').value, 'no-cache, max-age=0, must-revalidate');
  assert.match(hosting.headers.find(item => item.source === '/assets/**').headers[0].value, /immutable/);
  assert.ok(hosting.ignore.includes('**/*.map'));
});

test('both enforced CSP policies allow the Google script required by Firebase popup login', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url)));
  const header = config.hosting.headers.find(item => item.source === '**').headers.find(item => item.key === 'Content-Security-Policy').value;
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(meta);
  for (const policy of [header, meta]) {
    const scripts = policy.split(';').map(value => value.trim()).find(value => value.startsWith('script-src '));
    assert.ok(scripts?.split(/\s+/).includes('https://apis.google.com'), 'Firebase popup loader must be permitted');
    assert.ok(scripts.split(/\s+/).includes("'self'"));
    assert.ok(!scripts.split(/\s+/).includes("'unsafe-inline'"));
  }
});

test('deployment always specifies project and only one target, rejecting demo or mixed release', () => {
  const manifest = { project: 'easyorder-test-123', emulator: false };
  assert.deepEqual(deploymentArgs(manifest, manifest.project, 'indexes'), ['deploy', '--config', 'firebase.json', '--project', manifest.project, '--only', 'firestore:indexes']);
  assert.deepEqual(deploymentArgs(manifest, manifest.project, 'hosting', 'operator@example.test'), ['deploy', '--config', 'firebase.json', '--project', manifest.project, '--only', 'hosting', '--account', 'operator@example.test']);
  assert.throws(() => deploymentArgs(manifest, manifest.project, 'rules', '--bad-account'));
  for (const [m, p, step] of [[{ ...manifest, emulator: true }, manifest.project, 'hosting'], [manifest, 'other-project', 'rules'], [manifest, manifest.project, 'all']]) assert.throws(() => deploymentArgs(m, p, step));
});

test('provider preflight requires no billing link and the same Standard Native free-tier database/region', () => {
  const manifest = { project: 'easyorder-test-123', region: 'asia-east1' };
  const database = { name: `projects/${manifest.project}/databases/(default)`, locationId: manifest.region, type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD', freeTier: true };
  assert.doesNotThrow(() => validateProviderState(manifest, { billingEnabled: false }, database));
  for (const billing of [{}, { billingEnabled: true }, { billingEnabled: false, billingAccountName: 'billingAccounts/synthetic' }]) assert.throws(() => validateProviderState(manifest, billing, database));
  for (const delta of [{ locationId: 'us-central1' }, { type: 'DATASTORE_MODE' }, { databaseEdition: 'ENTERPRISE' }, { freeTier: false }, { name: 'projects/other-project/databases/(default)' }]) assert.throws(() => validateProviderState(manifest, { billingEnabled: false }, { ...database, ...delta }));
});

test('release checker detects changed, added and removed files; rejects public private files and symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'easyorder-release-test-'));
  try {
    await mkdir(path.join(dir, 'public'));
    await writeFile(path.join(dir, 'public/index.html'), '<html>synthetic</html>');
    await writeFile(path.join(dir, 'firestore.rules'), 'rules');
    await writeFile(path.join(dir, 'firestore.indexes.json'), '{}');
    await writeFile(path.join(dir, 'firebase.json'), JSON.stringify({ hosting: { site: 'demo-easyorder', public: 'public' }, firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' } }));
    await writeFile(path.join(dir, 'release.json'), JSON.stringify({ format: 'easyorder-release', version: 1, project: 'demo-easyorder', emulator: true, files: await releaseFiles(dir) }));
    assert.equal((await checkRelease(dir)).project, 'demo-easyorder');
    await writeFile(path.join(dir, 'public/index.html'), 'changed');
    await assert.rejects(checkRelease(dir), /完整性/);
    await writeFile(path.join(dir, 'public/index.html'), '<html>synthetic</html>');
    await writeFile(path.join(dir, 'public/extra.js'), 'extra');
    await assert.rejects(checkRelease(dir), /完整性/);
    await rm(path.join(dir, 'public/extra.js'));
    await writeFile(path.join(dir, 'public/.env'), 'synthetic');
    await assert.rejects(releaseFiles(dir), /禁止檔案/);
    await rm(path.join(dir, 'public/.env'));
    await symlink('/tmp', path.join(dir, 'public/link'));
    await assert.rejects(releaseFiles(dir), /symlink/);
    await rm(path.join(dir, 'public/link'));
    await rm(path.join(dir, 'firestore.rules'));
    await assert.rejects(checkRelease(dir), /完整性/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the real deployment entry refuses legacy and missing arguments before any provider action', () => {
  const entry = new URL('../easyorder-release.mjs', import.meta.url);
  for (const args of [['p4'], ['deploy'], ['prepare']]) {
    const result = spawnSync(process.execPath, [entry.pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
  }
});
