import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateProject, validateWebConfig, deploymentArgs, ciDeploymentArgs, releaseFiles, checkRelease, validateProviderState, validateCiDeployment, compositeIndexStatus, isTransientCiFailure, runCiStepWithRetry } from '../lib/release.mjs';

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

const ciSha = 'a'.repeat(40);
const ciManifest = { project: 'easyorder-test-123', emulator: false, sourceSha: ciSha, sourceDirty: false };
const ciEnv = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: ciSha, EASYORDER_DEPLOY_PROJECT: 'easyorder-test-123' };

test('CI deployment runs only from an approved main workflow_dispatch for the exact clean release and environment project', () => {
  assert.doesNotThrow(() => validateCiDeployment(ciEnv, ciManifest, 'easyorder-test-123'));
  for (const delta of [
    { GITHUB_ACTIONS: undefined }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_SHA: 'b'.repeat(40) },
    { EASYORDER_DEPLOY_PROJECT: undefined }, { EASYORDER_DEPLOY_PROJECT: 'easyorder-prod-456' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
  ]) assert.throws(() => validateCiDeployment({ ...ciEnv, ...delta }, ciManifest, 'easyorder-test-123'), undefined, JSON.stringify(delta));
  for (const delta of [{ sourceDirty: true }, { emulator: true }, { project: 'easyorder-prod-456' }, { sourceSha: 'not-a-sha' }]) {
    assert.throws(() => validateCiDeployment(ciEnv, { ...ciManifest, ...delta }, 'easyorder-test-123'), undefined, JSON.stringify(delta));
  }
  assert.throws(() => validateCiDeployment({ ...ciEnv, EASYORDER_DEPLOY_PROJECT: 'talented-payroll' }, { ...ciManifest, project: 'talented-payroll' }, 'talented-payroll'));
});

test('CI deployment commands are the local commands plus --non-interactive and never --force', () => {
  for (const step of ['indexes', 'rules', 'hosting']) {
    const args = ciDeploymentArgs(ciManifest, ciManifest.project, step);
    assert.deepEqual(args, [...deploymentArgs(ciManifest, ciManifest.project, step), '--non-interactive']);
    assert.ok(!args.includes('--force'));
  }
  assert.throws(() => ciDeploymentArgs({ ...ciManifest, emulator: true }, ciManifest.project, 'hosting'));
});

test('only Firebase Rules／Firestore provider 5xx、429 and the release-already-exists fallback count as transient, and never for hosting', () => {
  const unavailable = '\u001b[1m\u001b[31mError:\u001b[39m\u001b[22m Request to https://firebaserules.googleapis.com/v1/projects/p:test had HTTP Error: 503, The service is currently unavailable.';
  const releaseExists = 'Error: Request to https://firebaserules.googleapis.com/v1/projects/p/releases had HTTP Error: 409, Release projects/p/releases/cloud.firestore already exists.';
  for (const step of ['indexes', 'rules']) {
    assert.equal(isTransientCiFailure(step, unavailable), true, step);
    for (const code of [429, 500, 502, 504]) assert.equal(isTransientCiFailure(step, `had HTTP Error: ${code}, x`), true, `${step} ${code}`);
  }
  assert.equal(isTransientCiFailure('rules', releaseExists), true);
  assert.equal(isTransientCiFailure('hosting', unavailable), false);
  assert.equal(isTransientCiFailure('rules', 'Error: Compilation errors in firestore.rules'), false);
  assert.equal(isTransientCiFailure('rules', 'had HTTP Error: 403, The caller does not have permission'), false);
  assert.equal(isTransientCiFailure('indexes', 'had HTTP Error: 409, index already exists'), false);
  assert.equal(isTransientCiFailure('rules', ''), false);
});

test('deploy-ci retries a transient step failure with backoff, stops on success, and gives up after three attempts', async () => {
  const run = outcomes => { const calls = []; return { calls, fn: () => { const next = outcomes[calls.length]; calls.push(next); return next; } }; };
  const sleeps = [];
  const sleep = ms => { sleeps.push(ms); return Promise.resolve(); };
  const transient = { status: 2, output: 'had HTTP Error: 503, The service is currently unavailable.' };
  const ok = { status: 0, output: '' };

  let r = run([transient, ok]);
  assert.equal(await runCiStepWithRetry({ step: 'rules', run: r.fn, sleep, log: () => {} }), 2);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(sleeps, [30_000]);

  sleeps.length = 0; r = run([transient, transient, transient, ok]);
  await assert.rejects(runCiStepWithRetry({ step: 'indexes', run: r.fn, sleep, log: () => {} }), /indexes.*3 次/);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(sleeps, [30_000, 60_000]);

  sleeps.length = 0; r = run([{ status: 1, output: 'Error: Compilation errors' }, ok]);
  await assert.rejects(runCiStepWithRetry({ step: 'rules', run: r.fn, sleep, log: () => {} }), /rules 失敗（exit 1）/);
  assert.equal(r.calls.length, 1);

  r = run([transient, ok]);
  await assert.rejects(runCiStepWithRetry({ step: 'hosting', run: r.fn, sleep, log: () => {} }), /hosting 失敗/);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('composite index check requires every configured index READY, ignoring implicit __name__ and extra remote indexes', () => {
  const config = { indexes: [
    { collectionGroup: 'transactions', queryScope: 'COLLECTION', fields: [{ fieldPath: 'businessDate', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }] },
    { collectionGroup: 'commands', queryScope: 'COLLECTION', fields: [{ fieldPath: 'studentId', order: 'ASCENDING' }, { fieldPath: 'seq', order: 'DESCENDING' }] },
  ] };
  const remote = (group, fields, state) => ({ name: `projects/easyorder-test-123/databases/(default)/collectionGroups/${group}/indexes/synthetic-${group}`, queryScope: 'COLLECTION', state, fields });
  const tx = remote('transactions', [{ fieldPath: 'businessDate', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }], 'READY');
  const cmd = remote('commands', [{ fieldPath: 'studentId', order: 'ASCENDING' }, { fieldPath: 'seq', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' }], 'READY');
  const extra = remote('days', [{ fieldPath: 'closedAt', order: 'ASCENDING' }], 'READY');
  assert.deepEqual(compositeIndexStatus(config, [tx, cmd, extra]), { ready: true, missing: [], notReady: [] });
  const building = compositeIndexStatus(config, [tx, { ...cmd, state: 'CREATING' }]);
  assert.equal(building.ready, false);
  assert.equal(building.notReady.length, 1);
  const missing = compositeIndexStatus(config, [tx]);
  assert.equal(missing.ready, false);
  assert.equal(missing.missing.length, 1);
  const wrongOrder = compositeIndexStatus(config, [tx, remote('commands', [{ fieldPath: 'studentId', order: 'ASCENDING' }, { fieldPath: 'seq', order: 'ASCENDING' }], 'READY')]);
  assert.equal(wrongOrder.ready, false);
  assert.equal(compositeIndexStatus({ indexes: [] }, []).ready, true);
  assert.throws(() => compositeIndexStatus(config, 'not-a-list'));
});

test('the real deploy-ci entry refuses to run outside an approved GitHub Actions dispatch before any provider action', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'easyorder-ci-release-test-'));
  try {
    await mkdir(path.join(dir, 'public'));
    await writeFile(path.join(dir, 'public/index.html'), '<html>synthetic</html>');
    await writeFile(path.join(dir, 'firestore.rules'), 'rules');
    await writeFile(path.join(dir, 'firestore.indexes.json'), '{"indexes":[]}');
    await writeFile(path.join(dir, 'firebase.json'), JSON.stringify({ hosting: { site: ciManifest.project, public: 'public' }, firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' } }));
    await writeFile(path.join(dir, 'release.json'), JSON.stringify({ format: 'easyorder-release', version: 1, ...ciManifest, region: 'asia-east1', files: await releaseFiles(dir) }));
    const entry = new URL('../easyorder-release.mjs', import.meta.url);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_') && key !== 'EASYORDER_DEPLOY_PROJECT'));
    const result = spawnSync(process.execPath, [entry.pathname, 'deploy-ci', '--project', ciManifest.project, '--release', dir], { encoding: 'utf8', env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GitHub Actions/);
    for (const args of [['deploy-ci'], ['deploy-ci', '--project', ciManifest.project]]) {
      assert.equal(spawnSync(process.execPath, [entry.pathname, ...args], { encoding: 'utf8', env }).status, 1);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function installScriptConfigErrors(npmrc) {
  const config = new Map();
  for (const line of npmrc.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed)) continue;
    const separator = trimmed.indexOf('=');
    if (separator !== -1) config.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return [['strict-allow-scripts', 'true'], ['allow-scripts-pin', 'false']]
    .filter(([key, value]) => config.get(key) !== value)
    .map(([key, value]) => `.npmrc: 有效設定必須為 ${key}=${value}`);
}

test('install-script config uses the last value and ignores comment lines', () => {
  const valid = 'strict-allow-scripts=true\nallow-scripts-pin=false\n';
  assert.deepEqual(installScriptConfigErrors(valid), []);
  assert.deepEqual(installScriptConfigErrors(`${valid}strict-allow-scripts=false\n`), [
    '.npmrc: 有效設定必須為 strict-allow-scripts=true',
  ]);
  assert.deepEqual(installScriptConfigErrors(`${valid}allow-scripts-pin=true\n`), [
    '.npmrc: 有效設定必須為 allow-scripts-pin=false',
  ]);
  assert.deepEqual(installScriptConfigErrors(`strict-allow-scripts=false\nallow-scripts-pin=true\n${valid}  # strict-allow-scripts=false\n ; allow-scripts-pin=true\n`), []);
});

test('frontend install scripts have explicit current decisions and strict enforcement', () => {
  const frontend = new URL('../../frontend/', import.meta.url);
  const { packages } = JSON.parse(readFileSync(new URL('package-lock.json', frontend)));
  const { allowScripts = {} } = JSON.parse(readFileSync(new URL('package.json', frontend)));
  const scriptedPackages = new Set(Object.entries(packages)
    .filter(([, metadata]) => metadata.hasInstallScript)
    .map(([packagePath]) => packagePath.split('node_modules/').at(-1)));
  const errors = [];
  for (const name of [...scriptedPackages].sort()) {
    if (!Object.hasOwn(allowScripts, name) || typeof allowScripts[name] !== 'boolean') {
      errors.push(`${name}: 缺少 boolean allowScripts entry`);
    }
  }
  for (const name of Object.keys(allowScripts)) {
    if (!scriptedPackages.has(name)) errors.push(`${name}: 過期 allowScripts entry`);
  }
  let npmrc = '';
  try { npmrc = readFileSync(new URL('.npmrc', frontend), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  errors.push(...installScriptConfigErrors(npmrc));
  assert.deepEqual(errors, []);
});

test('deploy workflow is manual-only from main, uses an approval environment, keyless auth and pinned actions', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const on = /^on:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? '';
  assert.match(on, /^ {2}workflow_dispatch:/m);
  assert.doesNotMatch(on, /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
  assert.match(workflow, /- firebase-test\n/);
  assert.match(workflow, /- firebase-production\n/);
  assert.match(workflow, /environment: \$\{\{ inputs\.target \}\}/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /credentials_json|GOOGLE_APPLICATION_CREDENTIALS_JSON|--force/);
  const uses = [...workflow.matchAll(/uses: (\S+)/g)].map(match => match[1]);
  assert.ok(uses.length >= 4);
  for (const action of uses) assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${action} must be pinned to a full commit SHA`);
  assert.match(workflow, /\.\/deploy\.sh deploy-ci /);
  // job 有 id-token 權限時不執行依賴的 install script；public repo 不上傳部署 artifact。
  for (const install of workflow.matchAll(/npm (ci|install)\b[^\n]*/g)) assert.match(install[0], /--ignore-scripts/);
  assert.doesNotMatch(workflow, /upload-artifact/);
});
