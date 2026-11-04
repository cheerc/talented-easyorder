import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as release from '../lib/release.mjs';
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

test('deploy-ci retries a transient step failure with backoff, stops on success, and gives up after 10 attempts', async () => {
  const run = outcomes => { const calls = []; return { calls, fn: () => { const next = outcomes[calls.length]; calls.push(next); return next; } }; };
  const sleeps = [];
  const sleep = ms => { sleeps.push(ms); return Promise.resolve(); };
  const transient = { status: 2, output: 'had HTTP Error: 503, The service is currently unavailable.' };
  const ok = { status: 0, output: '' };

  let r = run([transient, ok]);
  assert.equal(await runCiStepWithRetry({ step: 'rules', run: r.fn, sleep, log: () => {} }), 2);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(sleeps, [30_000]);

  sleeps.length = 0;
  r = run([...Array(9).fill(transient), ok]);
  assert.equal(await runCiStepWithRetry({ step: 'rules', run: r.fn, sleep, log: () => {} }), 10);
  assert.equal(r.calls.length, 10);
  assert.deepEqual(sleeps, [30_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000]);

  sleeps.length = 0;
  r = run(Array(10).fill(transient));
  await assert.rejects(runCiStepWithRetry({ step: 'indexes', run: r.fn, sleep, log: () => {} }), /indexes.*10 次/);
  assert.equal(r.calls.length, 10);
  assert.deepEqual(sleeps, [30_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000]);

  sleeps.length = 0;
  r = run([{ status: 1, output: 'Error: Compilation errors' }, ok]);
  await assert.rejects(runCiStepWithRetry({ step: 'rules', run: r.fn, sleep, log: () => {} }), /rules 失敗（exit 1）/);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(sleeps, []);

  sleeps.length = 0;
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

test('deploy-test CLI entry refuses invalid flags, missing or invalid private config, or emulator env before external calls', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'easyorder-deploy-test-cli-'));
  try {
    const binDir = path.join(dir, 'bin');
    await mkdir(binDir, { recursive: true });
    const marker = path.join(dir, 'marker.txt');
    for (const cmd of ['gh', 'gcloud', 'git']) {
      await writeFile(path.join(binDir, cmd), `#!/bin/sh\necho "${cmd}" > "${marker}"\nexit 1\n`, { mode: 0o755 });
    }
    const fakeHome = path.join(dir, 'home');
    await mkdir(fakeHome, { recursive: true });

    const entry = new URL('../easyorder-release.mjs', import.meta.url).pathname;
    const run = (args, extraEnv = {}) => {
      const env = { ...process.env, HOME: fakeHome, PATH: `${binDir}:${process.env.PATH}`, ...extraEnv };
      delete env.FIRESTORE_EMULATOR_HOST;
      delete env.FIREBASE_AUTH_EMULATOR_HOST;
      if (extraEnv.FIRESTORE_EMULATOR_HOST) env.FIRESTORE_EMULATOR_HOST = extraEnv.FIRESTORE_EMULATOR_HOST;
      return spawnSync(process.execPath, [entry, 'deploy-test', ...args], { encoding: 'utf8', env });
    };

    // 1. Unknown or extra flags (e.g. --project)
    const res1 = run(['--project', 'easyorder-test-123']);
    assert.equal(res1.status, 1);
    assert.match(res1.stderr, /未知或重複參數/);
    assert.equal(existsSync(marker), false, 'no external command may be called');

    // 2. Missing private config
    const res2 = run([]);
    assert.equal(res2.status, 1);
    assert.match(res2.stderr, /deploy-test\.env/);
    assert.equal(existsSync(marker), false, 'no external command may be called');

    // 3. Unknown key in private config
    const privateDir = path.join(fakeHome, '.easyorder-private');
    await mkdir(privateDir, { recursive: true });
    const envFile = path.join(privateDir, 'deploy-test.env');
    await writeFile(envFile, 'UNKNOWN_KEY=foo\n');
    const res3 = run([]);
    assert.equal(res3.status, 1);
    assert.match(res3.stderr, /未知|deploy-test\.env/);
    assert.equal(existsSync(marker), false, 'no external command may be called');

    // 4. Emulator env set
    await writeFile(envFile, 'EASYORDER_TEST_ACCOUNT=tester@example.com\n');
    const res4 = run([], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
    assert.equal(res4.status, 1);
    assert.match(res4.stderr, /Emulator/);
    assert.equal(existsSync(marker), false, 'no external command may be called');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveTestTarget validates required test vars, distinct production project, and valid web config', () => {
  assert.equal(typeof release.resolveTestTarget, 'function');
  const validWeb = {
    apiKey: 'test-api-key',
    projectId: 'easyorder-test-123',
    authDomain: 'easyorder-test-123.firebaseapp.com',
    appId: '1:123456789012:web:abcdef',
    messagingSenderId: '123456789012',
    storageBucket: 'easyorder-test-123.firebasestorage.app',
  };
  const testVars = {
    EASYORDER_DEPLOY_PROJECT: 'easyorder-test-123',
    EASYORDER_REGION: 'asia-east1',
    EASYORDER_WEB_CONFIG: JSON.stringify(validWeb),
  };
  const prodVars = {
    EASYORDER_DEPLOY_PROJECT: 'easyorder-prod-456',
  };

  // Missing required test var (each should throw)
  assert.throws(() => release.resolveTestTarget({ testVars: { ...testVars, EASYORDER_DEPLOY_PROJECT: '' }, productionVars: prodVars }));
  assert.throws(() => release.resolveTestTarget({ testVars: { ...testVars, EASYORDER_REGION: '' }, productionVars: prodVars }));
  assert.throws(() => release.resolveTestTarget({ testVars: { ...testVars, EASYORDER_WEB_CONFIG: '' }, productionVars: prodVars }));
  assert.throws(() => release.resolveTestTarget({ testVars: null, productionVars: prodVars }));

  // Production project is identical to test project -> reject
  assert.throws(() => release.resolveTestTarget({
    testVars,
    productionVars: { EASYORDER_DEPLOY_PROJECT: 'easyorder-test-123' },
  }), /production.*test.*相同/);

  // Production environment does not exist (null) -> allow
  const resNullProd = release.resolveTestTarget({ testVars, productionVars: null });
  assert.equal(resNullProd.project, 'easyorder-test-123');
  assert.equal(resNullProd.region, 'asia-east1');
  assert.deepEqual(resNullProd.web, validWeb);

  // Normal case with distinct production vars -> allow
  const resNormal = release.resolveTestTarget({ testVars, productionVars: prodVars });
  assert.equal(resNormal.project, 'easyorder-test-123');
  assert.equal(resNormal.region, 'asia-east1');
  assert.deepEqual(resNormal.web, validWeb);
  assert.deepEqual(validateWebConfig(resNormal.web, resNormal.project, false), validWeb);
});

test('validateTestSource requires clean working tree, HEAD matching origin/main, and green push CI', () => {
  assert.equal(typeof release.validateTestSource, 'function');
  const valid = {
    head: '535cf3d2f10c4763d0076f8c57f19597a2220e7b',
    originMain: '535cf3d2f10c4763d0076f8c57f19597a2220e7b',
    dirty: false,
    ciSuccessCount: 1,
  };

  // dirty working tree -> reject
  assert.throws(() => release.validateTestSource({ ...valid, dirty: true }), /未提交|dirty/);

  // HEAD not equal to origin/main -> reject
  assert.throws(() => release.validateTestSource({ ...valid, originMain: '0000000000000000000000000000000000000000' }), /origin\/main/);

  // CI success count is 0 -> reject
  assert.throws(() => release.validateTestSource({ ...valid, ciSuccessCount: 0 }), /CI/);

  // all valid -> pass
  assert.doesNotThrow(() => release.validateTestSource(valid));
});

test('runTestDeployment orchestrates test deployment steps with account, non-interactive, retries and receipt', async () => {
  assert.equal(typeof release.runTestDeployment, 'function');

  const manifest = {
    format: 'easyorder-release',
    version: 1,
    project: 'easyorder-test-123',
    region: 'asia-east1',
    authDomain: 'easyorder-test-123.firebaseapp.com',
    emulator: false,
    sourceSha: '535cf3d2f10c4763d0076f8c57f19597a2220e7b',
    sourceDirty: false,
    files: {},
  };
  const project = 'easyorder-test-123';
  const account = 'deployer@example.com';
  const out = '/tmp/fake-release-out';

  const defaultBilling = JSON.stringify({ billingEnabled: false });
  const defaultDb = JSON.stringify({
    status: 'success',
    result: {
      name: `projects/${project}/databases/(default)`,
      locationId: 'asia-east1',
      type: 'FIRESTORE_NATIVE',
      databaseEdition: 'STANDARD',
      freeTier: true,
    },
  });
  const defaultIndexes = JSON.stringify([]);

  // Helper to record calls
  const createMockExec = (overrides = {}) => {
    const calls = [];
    const exec = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const normalizedCmd = cmd.includes('firebase') ? 'firebase' : cmd;
      const target = args.indexOf('--only') !== -1 ? args[args.indexOf('--only') + 1] : (args[1] ?? '');
      const key = `${normalizedCmd} ${args[0]} ${target}`.trim();
      if (overrides[key]) return overrides[key](calls.length, args, opts);
      if (cmd === 'gcloud' && args[0] === 'billing') return defaultBilling;
      if (cmd.includes('firebase') && args[0] === 'firestore:databases:get') return defaultDb;
      if (cmd === 'gcloud' && args[0] === 'firestore') return defaultIndexes;
      if (cmd.includes('firebase') && args[0] === 'deploy') return { status: 0, output: '' };
      return { status: 0, output: '' };
    };
    return { calls, exec };
  };

  const sleeps = [];
  const sleep = ms => { sleeps.push(ms); return Promise.resolve(); };

  // Case 1: Happy path
  const { calls: calls1, exec: exec1 } = createMockExec();
  const receipt1 = await release.runTestDeployment({
    manifest,
    project,
    account,
    out,
    timeoutMinutes: 30,
    exec: exec1,
    sleep,
    log: () => {},
    checkReleaseFn: () => Promise.resolve(manifest),
    readConfigFn: () => Promise.resolve({ indexes: [] }),
    saveReceiptFn: () => Promise.resolve(),
  });

  // Verify call sequence: preflight -> indexes -> wait -> rules -> hosting
  assert.equal(calls1[0].cmd, 'gcloud');
  assert.equal(calls1[0].args[0], 'billing');
  assert.ok(calls1[1].cmd.includes('firebase'));
  assert.equal(calls1[1].args[0], 'firestore:databases:get');
  assert.ok(calls1[2].cmd.includes('firebase'));
  assert.equal(calls1[2].args[0], 'deploy');
  assert.ok(calls1[2].args.includes('firestore:indexes'));
  assert.equal(calls1[3].cmd, 'gcloud');
  assert.equal(calls1[3].args[0], 'firestore');
  assert.ok(calls1[4].cmd.includes('firebase'));
  assert.equal(calls1[4].args[0], 'deploy');
  assert.ok(calls1[4].args.includes('firestore:rules'));
  assert.ok(calls1[5].cmd.includes('firebase'));
  assert.equal(calls1[5].args[0], 'deploy');
  assert.ok(calls1[5].args.includes('hosting'));

  // Every firebase call includes --project, --account, --non-interactive, and NO --force
  const firebaseCalls = calls1.filter(c => c.cmd.includes('firebase'));
  for (const call of firebaseCalls) {
    assert.ok(call.args.includes('--project'), `${call.cmd} ${call.args.join(' ')} must include --project`);
    assert.equal(call.args[call.args.indexOf('--project') + 1], project);
    assert.ok(call.args.includes('--account'), `${call.cmd} ${call.args.join(' ')} must include --account`);
    assert.equal(call.args[call.args.indexOf('--account') + 1], account);
    if (call.args[0] === 'deploy') {
      assert.ok(call.args.includes('--non-interactive'), 'deploy must include --non-interactive');
      assert.ok(!call.args.includes('--force'), 'deploy must not include --force');
    }
  }

  // Every gcloud call includes --account
  const gcloudCalls = calls1.filter(c => c.cmd === 'gcloud');
  for (const call of gcloudCalls) {
    assert.ok(call.args.includes('--account'), `${call.cmd} ${call.args.join(' ')} must include --account`);
    assert.equal(call.args[call.args.indexOf('--account') + 1], account);
  }

  // Verify receipt step sequence
  assert.deepEqual(receipt1.steps.map(s => s.step), ['indexes', 'rules', 'hosting']);

  // Case 2: rules encounters transient 503 and retries with deploy-ci default retry policy
  let rulesAttempts = 0;
  const transientOut = { status: 2, output: 'had HTTP Error: 503, The service is currently unavailable.' };
  const { calls: calls2, exec: exec2 } = createMockExec({
    'firebase deploy firestore:rules': () => {
      rulesAttempts += 1;
      return rulesAttempts === 1 ? transientOut : { status: 0, output: '' };
    },
  });
  sleeps.length = 0;
  const receipt2 = await release.runTestDeployment({
    manifest,
    project,
    account,
    out,
    timeoutMinutes: 30,
    exec: exec2,
    sleep,
    log: () => {},
    checkReleaseFn: () => Promise.resolve(manifest),
    readConfigFn: () => Promise.resolve({ indexes: [] }),
    saveReceiptFn: () => Promise.resolve(),
  });
  assert.equal(rulesAttempts, 2);
  assert.deepEqual(sleeps, [30_000]);
  assert.deepEqual(receipt2.steps.map(s => s.step), ['indexes', 'rules', 'hosting']);

  // Case 3: hosting failure does NOT retry
  let hostingAttempts = 0;
  const { calls: calls3, exec: exec3 } = createMockExec({
    'firebase deploy hosting': () => {
      hostingAttempts += 1;
      return transientOut;
    },
  });
  sleeps.length = 0;
  await assert.rejects(
    release.runTestDeployment({
      manifest,
      project,
      account,
      out,
      timeoutMinutes: 30,
      exec: exec3,
      sleep,
      log: () => {},
      checkReleaseFn: () => Promise.resolve(manifest),
      readConfigFn: () => Promise.resolve({ indexes: [] }),
      saveReceiptFn: () => Promise.resolve(),
    }),
    /hosting 失敗/
  );
  assert.equal(hostingAttempts, 1, 'hosting must fail immediately without retry');
  assert.deepEqual(sleeps, []);

  // Case 4: Step failure halts further steps (e.g. indexes fails -> rules/hosting not executed)
  const { calls: calls4, exec: exec4 } = createMockExec({
    'firebase deploy firestore:indexes': () => ({ status: 1, output: 'indexes error' }),
  });
  await assert.rejects(
    release.runTestDeployment({
      manifest,
      project,
      account,
      out,
      timeoutMinutes: 30,
      exec: exec4,
      sleep,
      log: () => {},
      checkReleaseFn: () => Promise.resolve(manifest),
      readConfigFn: () => Promise.resolve({ indexes: [] }),
      saveReceiptFn: () => Promise.resolve(),
    }),
    /indexes 失敗/
  );
  const rulesCalled = calls4.some(c => c.args.includes('firestore:rules'));
  const hostingCalled = calls4.some(c => c.args.includes('hosting'));
  assert.equal(rulesCalled, false, 'rules must not be called after indexes failure');
  assert.equal(hostingCalled, false, 'hosting must not be called after indexes failure');
});

test('providerPreflight includes CLI stderr upon failure and runTestDeployment forwards CLI stdout/stderr', async () => {
  const manifest = { format: 'easyorder-release', version: 1, project: 'easyorder-test-123', region: 'asia-east1', files: {} };
  const project = 'easyorder-test-123';
  const account = 'deployer@example.com';
  const out = '/tmp/fake-release-out';

  // 1. gcloud billing failure includes CLI stderr
  const gcloudErrExec = (cmd, args) => {
    if (cmd === 'gcloud' && args[0] === 'billing') {
      return { status: 1, stderr: 'ERROR: (gcloud.billing.projects.describe) User not authorized to view billing', output: '' };
    }
    return { status: 0, output: '' };
  };
  assert.throws(
    () => release.providerPreflight(manifest, project, account, out, { exec: gcloudErrExec }),
    /User not authorized to view billing/
  );

  // 2. Firebase databases:get failure includes CLI stderr
  const fbErrExec = (cmd, args) => {
    if (cmd === 'gcloud' && args[0] === 'billing') return JSON.stringify({ billingEnabled: false });
    if (cmd.includes('firebase') && args[0] === 'firestore:databases:get') {
      return { status: 1, stderr: 'Error: Failed to get database (default). Permission denied.', output: '' };
    }
    return { status: 0, output: '' };
  };
  assert.throws(
    () => release.providerPreflight(manifest, project, account, out, { exec: fbErrExec }),
    /Permission denied/
  );

  // 3. runTestDeployment forwards CLI stdout and stderr
  const stdouts = [];
  const stderrs = [];
  const forwardingExec = (cmd, args) => {
    if (cmd === 'gcloud' && args[0] === 'billing') return JSON.stringify({ billingEnabled: false });
    if (cmd.includes('firebase') && args[0] === 'firestore:databases:get') {
      return JSON.stringify({ status: 'success', result: { name: `projects/${project}/databases/(default)`, locationId: 'asia-east1', type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD', freeTier: true } });
    }
    if (cmd === 'gcloud' && args[0] === 'firestore') return JSON.stringify([]);
    if (cmd.includes('firebase') && args[0] === 'deploy') {
      return { status: 0, stdout: `[deploy-out:${args.join(' ')}]`, stderr: `[deploy-err:${args.join(' ')}]` };
    }
    return { status: 0, output: '' };
  };

  await release.runTestDeployment({
    manifest,
    project,
    account,
    out,
    exec: forwardingExec,
    sleep: () => Promise.resolve(),
    checkReleaseFn: () => Promise.resolve(manifest),
    readConfigFn: () => Promise.resolve({ indexes: [] }),
    saveReceiptFn: () => Promise.resolve(),
    stdout: { write: text => stdouts.push(text) },
    stderr: { write: text => stderrs.push(text) },
  });

  const allStdout = stdouts.join('');
  const allStderr = stderrs.join('');
  assert.match(allStdout, /\[deploy-out:.*firestore:indexes/);
  assert.match(allStderr, /\[deploy-err:.*firestore:indexes/);
  assert.match(allStdout, /\[deploy-out:.*firestore:rules/);
  assert.match(allStderr, /\[deploy-err:.*firestore:rules/);
  assert.match(allStdout, /\[deploy-out:.*hosting/);
  assert.match(allStderr, /\[deploy-err:.*hosting/);
});

test('deploy-test CLI wires target from GitHub Environment and queries only test and production environments', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'easyorder-deploy-test-target-'));
  try {
    const binDir = path.join(dir, 'bin');
    await mkdir(binDir, { recursive: true });

    const ghLog = path.join(dir, 'gh-calls.log');
    const gcloudLog = path.join(dir, 'gcloud-calls.log');
    const firebaseLog = path.join(dir, 'firebase-calls.log');
    const gitLog = path.join(dir, 'git-calls.log');

    const syntheticTarget = 'synthetic-test-target-proj';
    const syntheticWeb = {
      apiKey: 'k',
      authDomain: `${syntheticTarget}.firebaseapp.com`,
      projectId: syntheticTarget,
      appId: '1:1:web:1',
      messagingSenderId: '1',
      storageBucket: `${syntheticTarget}.firebasestorage.app`,
    };

    // Stub gh
    const ghScript = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, args.join(' ') + '\\n');
const joined = args.join(' ');
if (joined.includes('repo view')) {
  process.stdout.write('cheerc/talented-easyorder\\n');
} else if (joined.includes('actions/workflows/ci.yml/runs')) {
  process.stdout.write(JSON.stringify({ total_count: 1 }) + '\\n');
} else if (joined.includes('environments/firebase-test/variables')) {
  process.stdout.write(JSON.stringify({
    variables: [
      { name: 'EASYORDER_DEPLOY_PROJECT', value: ${JSON.stringify(syntheticTarget)} },
      { name: 'EASYORDER_REGION', value: 'asia-east1' },
      { name: 'EASYORDER_WEB_CONFIG', value: ${JSON.stringify(JSON.stringify(syntheticWeb))} },
    ],
  }) + '\\n');
} else if (joined.includes('environments/firebase-production/variables')) {
  process.stdout.write(JSON.stringify({
    variables: [
      { name: 'EASYORDER_DEPLOY_PROJECT', value: 'synthetic-prod-proj' },
    ],
  }) + '\\n');
} else {
  process.exit(1);
}
`;
    await writeFile(path.join(binDir, 'gh'), ghScript, { mode: 0o755 });

    // Stub gcloud
    const indexesConfig = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
    const readyIndexes = (indexesConfig.indexes ?? []).map((idx, i) => ({
      name: `projects/${syntheticTarget}/databases/(default)/collectionGroups/${idx.collectionGroup}/indexes/idx_${i}`,
      queryScope: idx.queryScope ?? 'COLLECTION',
      fields: idx.fields,
      state: 'READY',
    }));
    const gcloudScript = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(gcloudLog)}, args.join(' ') + '\\n');
const joined = args.join(' ');
if (joined.includes('auth print-access-token')) {
  process.stdout.write('ya29.synthetic-token\\n');
} else if (joined.includes('billing projects describe')) {
  process.stdout.write(JSON.stringify({ billingEnabled: false }) + '\\n');
} else if (joined.includes('firestore indexes composite list')) {
  process.stdout.write(JSON.stringify(${JSON.stringify(readyIndexes)}) + '\\n');
} else {
  process.stdout.write('{}\\n');
}
`;
    await writeFile(path.join(binDir, 'gcloud'), gcloudScript, { mode: 0o755 });

    // Stub firebase
    const firebaseScript = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(firebaseLog)}, args.join(' ') + '\\n');
const joined = args.join(' ');
if (joined.includes('login:list')) {
  process.stdout.write(JSON.stringify({ status: 'success', result: [{ user: { email: 'tester@example.com' } }] }) + '\\n');
} else if (joined.includes('firestore:databases:get')) {
  process.stdout.write(JSON.stringify({
    status: 'success',
    result: {
      name: 'projects/' + ${JSON.stringify(syntheticTarget)} + '/databases/(default)',
      locationId: 'asia-east1',
      type: 'FIRESTORE_NATIVE',
      databaseEdition: 'STANDARD',
      freeTier: true,
    },
  }) + '\\n');
} else if (joined.includes('deploy')) {
  process.stdout.write('Deploy complete\\n');
} else {
  process.stdout.write('{}\\n');
}
`;
    await writeFile(path.join(binDir, 'firebase'), firebaseScript, { mode: 0o755 });

    // Stub git: delegate everything to real git except fetch and rev-parse origin/main
    const gitScript = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(gitLog)}, args.join(' ') + '\\n');
if (args[0] === 'fetch') {
  process.exit(0);
}
if (args[0] === 'status' && args.includes('--porcelain')) {
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === 'origin/main') {
  const headRes = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  process.stdout.write(headRes.stdout);
  process.exit(headRes.status);
}
const res = spawnSync('/usr/bin/git', args, { encoding: 'utf8' });
process.stdout.write(res.stdout ?? '');
process.stderr.write(res.stderr ?? '');
process.exit(res.status ?? 0);
`;
    await writeFile(path.join(binDir, 'git'), gitScript, { mode: 0o755 });

    const fakeHome = path.join(dir, 'home');
    const privateDir = path.join(fakeHome, '.easyorder-private');
    await mkdir(privateDir, { recursive: true });
    await writeFile(path.join(privateDir, 'deploy-test.env'), 'EASYORDER_TEST_ACCOUNT=tester@example.com\n');

    const entry = new URL('../easyorder-release.mjs', import.meta.url).pathname;
    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${binDir}:${process.env.PATH}`,
      EASYORDER_FIREBASE_BIN: path.join(binDir, 'firebase'),
    };
    delete env.FIRESTORE_EMULATOR_HOST;
    delete env.FIREBASE_AUTH_EMULATOR_HOST;

    const res = spawnSync(process.execPath, [entry, 'deploy-test'], { encoding: 'utf8', env });
    assert.equal(res.status, 0, `deploy-test failed: stderr=${res.stderr}, stdout=${res.stdout}`);

    // 1. Assert gh was only queried for firebase-test and firebase-production
    const ghLines = readFileSync(ghLog, 'utf8').trim().split('\n');
    const envQueries = ghLines.filter(line => line.includes('environments/'));
    assert.ok(envQueries.length >= 2, 'gh must query environments');
    for (const q of envQueries) {
      const match = /environments\/([^/]+)/.exec(q);
      assert.ok(match, `Must match environment query: ${q}`);
      assert.ok(
        ['firebase-test', 'firebase-production'].includes(match[1]),
        `gh should only be queried for firebase-test or firebase-production, got ${match[1]}`
      );
    }

    // 2. Assert gcloud and firebase were called with the synthetic target
    const gcloudLines = readFileSync(gcloudLog, 'utf8').trim().split('\n');
    const billingCall = gcloudLines.find(l => l.includes('billing'));
    assert.ok(billingCall && billingCall.includes(syntheticTarget), `gcloud billing must use synthetic target: ${billingCall}`);
    const indexCall = gcloudLines.find(l => l.includes('firestore indexes'));
    assert.ok(indexCall && indexCall.includes(`--project ${syntheticTarget}`), `gcloud indexes must use synthetic target: ${indexCall}`);

    const firebaseLines = readFileSync(firebaseLog, 'utf8').trim().split('\n');
    const dbCall = firebaseLines.find(l => l.includes('firestore:databases:get'));
    assert.ok(dbCall && dbCall.includes(`--project ${syntheticTarget}`), `firebase databases:get must use synthetic target: ${dbCall}`);
    const deployCalls = firebaseLines.filter(l => l.includes('deploy'));
    assert.equal(deployCalls.length, 3, 'Must deploy indexes, rules, hosting');
    for (const d of deployCalls) {
      assert.ok(d.includes(`--project ${syntheticTarget}`), `firebase deploy must use synthetic target: ${d}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
