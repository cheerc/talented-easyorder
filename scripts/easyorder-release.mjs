#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateWebConfig, releaseFiles, checkRelease, deploymentArgs, ciDeploymentArgs, digest, validateProviderState, validateCiDeployment, compositeIndexStatus } from './lib/release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const firebase = path.join(frontend, 'node_modules/.bin/firebase');
const usage = `EasyOrder P17 本機 release 工具（Node 24）
  ./deploy.sh prepare --project <id> --web-config <本機 JSON> --out <新目錄> [--region asia-east1] [--emulator]
  ./deploy.sh check --release <目錄>
  ./deploy.sh deploy --project <id> --release <目錄> --step indexes|rules|hosting [--account <Firebase CLI email>]
  ./deploy.sh deploy-ci --project <id> --release <目錄> [--index-timeout-minutes 30]   （只限 GitHub Actions 核准後的 deploy workflow）
正式部署由本人操作：本機互動終端，或本人在 GitHub 核准的 deploy workflow。先 indexes 並確認 READY，再 rules，最後 hosting；詳見 docs/ops/DEPLOYMENT-GUIDE.md。
舊 d1-d3/p1-p5 已移除；練習用 frontend/npm run dev:prototype，Emulator 明示 demo-easyorder。
`;

function flags(args, allowed, booleans = []) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if ((!allowed.includes(key) && !booleans.includes(key)) || key in options) throw new Error(`未知或重複參數：${key}`);
    if (booleans.includes(key)) options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${key} 缺值`);
      options[key] = args[++i];
    }
  }
  return options;
}
const required = (options, key) => { if (!options[key]) throw new Error(`缺少 ${key}`); return options[key]; };
const json = async name => JSON.parse(await readFile(name, 'utf8'));
const save = (name, value) => writeFile(name, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

async function prepare(args) {
  const options = flags(args, ['--project', '--web-config', '--out', '--region'], ['--emulator']);
  const project = required(options, '--project');
  const emulator = options['--emulator'] === true;
  const web = validateWebConfig(await json(required(options, '--web-config')), project, emulator);
  const out = path.resolve(required(options, '--out'));
  const region = options['--region'] ?? 'asia-east1';
  if (!/^[a-z]+-[a-z]+[0-9]$/.test(region)) throw new Error('--region 格式不合法');
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out);
  const config = await json(path.join(root, 'firebase.json'));
  config.hosting.public = 'public';
  config.hosting.site = project;
  const header = config.hosting.headers.find(item => item.source === '**').headers.find(item => item.key === 'Content-Security-Policy');
  let releaseCsp = header.value.replace("frame-src 'self'", `frame-src 'self' https://${web.authDomain}`);
  if (emulator) {
    releaseCsp = releaseCsp.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099")
      .replace("frame-src 'self'", "frame-src 'self' http://127.0.0.1:9099").replace('; upgrade-insecure-requests', '');
  }
  header.value = releaseCsp;
  await save(path.join(out, 'firebase.json'), config);
  await copyFile(path.join(root, 'firestore.rules'), path.join(out, 'firestore.rules'));
  await copyFile(path.join(root, 'firestore.indexes.json'), path.join(out, 'firestore.indexes.json'));
  // No .env files or inherited VITE_* settings may choose a different backend.
  for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
  const env = Object.fromEntries(Object.entries(web).map(([key, value]) => [`VITE_FIREBASE_${key.replace(/[A-Z]/g, char => `_${char}`).toUpperCase()}`, value]));
  Object.assign(env, {
    VITE_FIREBASE_USE_EMULATOR: String(emulator), VITE_FIRESTORE_ENDPOINT: 'https://firestore.googleapis.com',
    VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1', VITE_FIRESTORE_EMULATOR_PORT: '8080', VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  });
  Object.assign(process.env, env);
  const require = createRequire(path.join(frontend, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  await build({ root: frontend, configFile: path.join(frontend, 'vite.config.ts'), mode: 'production', envDir: false,
    plugins: [{ name: 'p17-release-csp', transformIndexHtml: { order: 'post', handler: html => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
      `<meta http-equiv="Content-Security-Policy" content="${releaseCsp.replace("; frame-ancestors 'none'", '')}" />`) } }],
    define: Object.fromEntries(Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    build: { outDir: path.join(out, 'public'), sourcemap: false, emptyOutDir: true } });
  const manifest = { format: 'easyorder-release', version: 1, project, region, authDomain: web.authDomain, emulator,
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    trackedDiffSha256: digest(execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: root })),
    createdAt: new Date().toISOString(), files: await releaseFiles(out) };
  await save(path.join(out, 'release.json'), manifest);
  await checkRelease(out);
  process.stdout.write(`release 已建立並核對：${out}\nproject=${project}, region=${region}, emulator=${emulator}, source=${manifest.sourceSha}, dirty=${manifest.sourceDirty}\n`);
}

function providerPreflight(manifest, project, account, out) {
  const billing = JSON.parse(execFileSync('gcloud', ['billing', 'projects', 'describe', project, '--format=json'], { encoding: 'utf8' }));
  const database = JSON.parse(execFileSync(firebase, ['firestore:databases:get', '(default)', '--project', project, '--json', ...(account ? ['--account', account] : [])], { cwd: out, encoding: 'utf8' }));
  if (database.status !== 'success') throw new Error('無法讀取 Firestore metadata');
  validateProviderState(manifest, billing, database.result);
}

async function waitForIndexes(out, project, timeoutMinutes) {
  const config = await json(path.join(out, 'firestore.indexes.json'));
  const deadline = Date.now() + timeoutMinutes * 60_000;
  for (;;) {
    const listed = JSON.parse(execFileSync('gcloud', ['firestore', 'indexes', 'composite', 'list', '--project', project, '--database', '(default)', '--format=json'], { encoding: 'utf8' }));
    const status = compositeIndexStatus(config, listed);
    if (status.ready) { process.stdout.write(`composite indexes 全部 READY（${(config.indexes ?? []).length} 個）\n`); return; }
    if (Date.now() >= deadline) throw new Error(`index 未在 ${timeoutMinutes} 分鐘內 READY；不部署 rules／hosting。缺少：${status.missing.join('; ') || '無'}；未完成：${status.notReady.join('; ') || '無'}`);
    process.stdout.write(`等待 index READY：缺少 ${status.missing.length}、未完成 ${status.notReady.length}\n`);
    await new Promise(resolve => { setTimeout(resolve, 30_000); });
  }
}

async function deployCi(args) {
  const options = flags(args, ['--project', '--release', '--index-timeout-minutes']);
  const out = path.resolve(required(options, '--release'));
  const project = required(options, '--project');
  const manifest = await checkRelease(out);
  validateCiDeployment(process.env, manifest, project);
  const timeoutMinutes = Number(options['--index-timeout-minutes'] ?? 30);
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 120) throw new Error('--index-timeout-minutes 必須是 1–120 的整數');
  providerPreflight(manifest, project, undefined, out);
  const receipt = { project, releaseDigest: digest(await readFile(path.join(out, 'release.json'))), sourceSha: manifest.sourceSha,
    runId: process.env.GITHUB_RUN_ID ?? null, actor: process.env.GITHUB_ACTOR ?? null, steps: [] };
  for (const step of ['indexes', 'rules', 'hosting']) {
    await checkRelease(out);
    process.stdout.write(`部署 ${project} ${step}，source=${manifest.sourceSha}\n`);
    const result = spawnSync(firebase, ciDeploymentArgs(manifest, project, step), { cwd: out, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`Firebase deploy ${step} 失敗（exit ${result.status}）；後續步驟未執行`);
    receipt.steps.push({ step, at: new Date().toISOString() });
    await save(path.join(out, 'deploy-receipt.json'), receipt);
    if (step === 'indexes') await waitForIndexes(out, project, timeoutMinutes);
  }
  process.stdout.write('indexes、rules、hosting 已部署；正式 smoke 仍由本人驗證。\n');
}

async function deploy(args) {
  const options = flags(args, ['--project', '--release', '--step', '--account']);
  const out = path.resolve(required(options, '--release'));
  const manifest = await checkRelease(out);
  const project = required(options, '--project');
  const step = required(options, '--step');
  const account = options['--account'];
  const command = deploymentArgs(manifest, project, step, account);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('正式部署必須由本人在互動終端執行');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('正式部署前須移除 Emulator 環境變數');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const phrase = `DEPLOY ${project} ${step}`;
    if (await rl.question(`目標 ${project}／${manifest.region}，source=${manifest.sourceSha}，dirty=${manifest.sourceDirty}\n請先核對 Console Spark、專案歸屬及 index READY；輸入 ${phrase}：`) !== phrase) throw new Error('確認不符，未部署');
  } finally { rl.close(); }
  providerPreflight(manifest, project, account, out);
  let receipt = { project, releaseDigest: digest(await readFile(path.join(out, 'release.json'))), steps: [] };
  try { receipt = await json(path.join(out, 'deploy-receipt.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt.project !== project || receipt.releaseDigest !== digest(await readFile(path.join(out, 'release.json')))) throw new Error('部署紀錄與 release 不符');
  const prerequisite = step === 'rules' ? 'indexes' : step === 'hosting' ? 'rules' : null;
  if (prerequisite && !receipt.steps.some(item => item.step === prerequisite)) throw new Error(`此 release 尚未部署 ${prerequisite}`);
  await checkRelease(out);
  const result = spawnSync(firebase, command, { cwd: out, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Firebase deploy 失敗（exit ${result.status}）；不要進下一步`);
  receipt.steps.push({ step, at: new Date().toISOString() });
  await save(path.join(out, 'deploy-receipt.json'), receipt);
  process.stdout.write('部署命令成功；index READY／正式 smoke 仍由本人驗證。\n');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (['--help', '-h', undefined].includes(command)) process.stdout.write(usage);
  else if (command === 'prepare') await prepare(args);
  else if (command === 'check') {
    const options = flags(args, ['--release']);
    const manifest = await checkRelease(path.resolve(required(options, '--release')));
    process.stdout.write(`release 完整性通過：${manifest.project}，${Object.keys(manifest.files).length} 個檔案，emulator=${manifest.emulator}\n`);
  } else if (command === 'deploy') await deploy(args);
  else if (command === 'deploy-ci') await deployCi(args);
  else throw new Error(`舊部署選項已停用或未知命令：${command}\n${usage}`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
