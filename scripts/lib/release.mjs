import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function validateProject(project, emulator = false) {
  if (typeof project !== 'string' || !/^[a-z][a-z0-9-]{5,29}$/.test(project) || /payroll/i.test(project)) {
    throw new Error('必須明示獨立 EasyOrder project ID；拒絕 payroll target');
  }
  if (project.startsWith('demo-') !== emulator) throw new Error('demo- project 與 --emulator 必須同時使用');
  return project;
}

const WEB_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId', 'storageBucket'];
export function validateWebConfig(web, project, emulator = false) {
  validateProject(project, emulator);
  if (!web || typeof web !== 'object' || Array.isArray(web)
    || Object.keys(web).some(key => !WEB_FIELDS.includes(key))
    || WEB_FIELDS.some(key => typeof web[key] !== 'string' || !web[key].trim() || /[\s<>]/.test(web[key]))) {
    throw new Error('Web config 只能包含六個公開 Firebase Web config 欄位，不接受管理憑證或 placeholder');
  }
  if (web.projectId !== project) throw new Error('Web config 與 --project 不一致');
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(web.authDomain) || /payroll/i.test(web.authDomain)) throw new Error('authDomain 必須是 EasyOrder 主機名稱，不含 scheme 或 path');
  for (const domain of ['firebaseapp.com', 'web.app']) {
    if (web.authDomain.endsWith(`.${domain}`) && web.authDomain !== `${project}.${domain}`) throw new Error('authDomain 指向其他 Firebase project');
  }
  return web;
}

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function releaseFiles(root, relative = '') {
  const files = {};
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('release 不接受 symlink');
    if (!relative && ['release.json', 'deploy-receipt.json'].includes(entry.name)) continue;
    if (!relative && (entry.name === '.firebase' || /^firebase-debug.*\.log$/.test(entry.name))) continue;
    if (entry.isDirectory()) Object.assign(files, await releaseFiles(root, name));
    else if (entry.isFile()) {
      if (name.startsWith('public/') && (/(^|\/)\.|\.(map|eobak|pem|key|p12)$|credentials|service.?account/i.test(name))) throw new Error(`公開產物含禁止檔案：${name}`);
      files[name] = digest(await readFile(path.join(root, name)));
    } else throw new Error('release 含非一般檔案');
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export async function checkRelease(root) {
  if (!(await lstat(root)).isDirectory()) throw new Error('--release 必須是目錄');
  const manifest = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'));
  if (manifest.format !== 'easyorder-release' || manifest.version !== 1 || typeof manifest.emulator !== 'boolean') throw new Error('release manifest 不合法');
  validateProject(manifest.project, manifest.emulator);
  if (JSON.stringify(await releaseFiles(root)) !== JSON.stringify(manifest.files)) throw new Error('release 完整性不符；請重建，不能混用 Rules/index/前端');
  const config = JSON.parse(await readFile(path.join(root, 'firebase.json'), 'utf8'));
  if (config.hosting?.site !== manifest.project || config.hosting.public !== 'public'
    || config.firestore?.rules !== 'firestore.rules' || config.firestore.indexes !== 'firestore.indexes.json'
    || Object.keys(config).some(key => !['hosting', 'firestore', 'emulators'].includes(key))) throw new Error('release target/config 不一致');
  return manifest;
}

export function deploymentArgs(manifest, project, step, account) {
  validateProject(project, false);
  if (manifest.emulator || manifest.project !== project) throw new Error('禁止部署 Emulator release 或不同 project');
  if (!['indexes', 'rules', 'hosting'].includes(step)) throw new Error('--step 必須是 indexes、rules 或 hosting');
  if (account !== undefined && !/^[^\s@-][^\s@]*@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error('--account 必須是 Firebase CLI 已登入的 email');
  return ['deploy', '--config', 'firebase.json', '--project', project, '--only', step === 'hosting' ? 'hosting' : `firestore:${step}`,
    ...(account ? ['--account', account] : [])];
}

export function validateProviderState(manifest, billing, database) {
  if (billing?.billingEnabled !== false || billing.billingAccountName) throw new Error('必須確認 billing disabled 且沒有連結 billing account');
  if (database?.name !== `projects/${manifest.project}/databases/(default)` || database.locationId !== manifest.region
    || database.type !== 'FIRESTORE_NATIVE' || database.databaseEdition !== 'STANDARD' || database.freeTier !== true) {
    throw new Error('Firestore 必須是此 project 的 Standard Native、free-tier (default)，且 region 與 release 相同');
  }
}

export function ciDeploymentArgs(manifest, project, step) {
  return [...deploymentArgs(manifest, project, step), '--non-interactive'];
}

// Firebase Rules API 編譯大型 rules 時會偶發 5xx；CLI 不重試，且 release PATCH 失敗後改 create 會得 409 already exists。
// indexes／rules 部署可重複執行，只對這些 provider 暫時性錯誤重試；hosting 不重試，避免重複建立 Hosting release。
const ANSI = /\u001b\[[0-9;]*m/g;
export function isTransientCiFailure(step, output) {
  if (step !== 'indexes' && step !== 'rules') return false;
  const text = String(output ?? '').replace(ANSI, '');
  return /HTTP Error: (429|5\d\d)\b/.test(text) || /HTTP Error: 409, Release \S+\/releases\/cloud\.firestore\S* already exists/.test(text);
}

export async function runCiStepWithRetry({ step, run, sleep, log, maxAttempts = 10, delaysMs = [30_000, 60_000] }) {
  for (let attempt = 1; ; attempt += 1) {
    const result = run();
    if (!result.error && result.status === 0) return attempt;
    if (result.error || !isTransientCiFailure(step, result.output)) throw new Error(`Firebase deploy ${step} 失敗（exit ${result.status}）；後續步驟未執行`);
    if (attempt >= maxAttempts) throw new Error(`Firebase deploy ${step} 遇到暫時性錯誤，重試 ${maxAttempts} 次仍失敗；後續步驟未執行`);
    const wait = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)];
    log(`Firebase deploy ${step} 遇到暫時性錯誤（第 ${attempt} 次），${wait / 1000} 秒後重試\n`);
    await sleep(wait);
  }
}

// GitHub Actions 部署：取代本機 TTY 確認的是 GitHub Environment 核准；環境變數 EASYORDER_DEPLOY_PROJECT
// 只在核准後的 environment job 內存在，且必須與 release 及 --project 三者一致。
export function validateCiDeployment(env, manifest, project) {
  validateProject(project, false);
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('deploy-ci 只能在 GitHub Actions 的手動 workflow_dispatch 執行');
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('deploy-ci 只能從 main 部署');
  if (env.EASYORDER_DEPLOY_PROJECT !== project) throw new Error('GitHub Environment 的 EASYORDER_DEPLOY_PROJECT 與 --project 不一致');
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('正式部署前須移除 Emulator 環境變數');
  if (manifest.emulator !== false || manifest.project !== project) throw new Error('禁止部署 Emulator release 或不同 project');
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceSha ?? '') || manifest.sourceSha !== env.GITHUB_SHA) throw new Error('release 來源 SHA 與這次 workflow 的 commit 不一致');
  if (manifest.sourceDirty !== false) throw new Error('release 來源工作目錄有未提交變更');
}

const indexFields = fields => {
  const list = fields.map(field => `${field.fieldPath}:${field.order ?? field.arrayConfig ?? field.vectorConfig ?? ''}`);
  while (list.length && list.at(-1).startsWith('__name__:')) list.pop();
  return list.join(',');
};
const indexKey = (group, scope, fields) => `${group}|${scope ?? 'COLLECTION'}|${indexFields(fields)}`;

// 比對 firestore.indexes.json 的 composite indexes 與 `gcloud firestore indexes composite list --format=json`。
// 遠端多出的 index 不影響（部署不帶 --force，不刪除）；本機設定的每個 index 都必須存在且 READY。
export function compositeIndexStatus(config, listed) {
  if (!Array.isArray(listed)) throw new Error('index 清單格式不合法');
  const remote = new Map();
  for (const index of listed) {
    const group = /\/collectionGroups\/([^/]+)\/indexes\//.exec(index.name ?? '')?.[1];
    if (group && Array.isArray(index.fields)) remote.set(indexKey(group, index.queryScope, index.fields), index.state);
  }
  const missing = [];
  const notReady = [];
  for (const index of config.indexes ?? []) {
    const key = indexKey(index.collectionGroup, index.queryScope, index.fields);
    if (!remote.has(key)) missing.push(key);
    else if (remote.get(key) !== 'READY') notReady.push(`${key}=${remote.get(key)}`);
  }
  return { ready: missing.length === 0 && notReady.length === 0, missing, notReady };
}

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultFirebase = path.join(defaultRoot, 'frontend/node_modules/.bin/firebase');

export function providerPreflight(manifest, project, account, out, options = {}) {
  const gcloudAccount = options.gcloudAccount ?? options.account;
  const exec = options.execFileSync ?? options.exec ?? execFileSync;
  const firebaseBin = options.firebaseBin ?? defaultFirebase;
  const gcloudArgs = ['billing', 'projects', 'describe', project, '--format=json', ...(gcloudAccount ? ['--account', gcloudAccount] : [])];
  const billingRaw = exec('gcloud', gcloudArgs, { encoding: 'utf8' });
  const billing = JSON.parse(typeof billingRaw === 'string' ? billingRaw : billingRaw.stdout ?? billingRaw.output);
  const fbArgs = ['firestore:databases:get', '(default)', '--project', project, '--json', ...(account ? ['--account', account] : [])];
  const databaseRaw = exec(firebaseBin, fbArgs, { cwd: out, encoding: 'utf8' });
  const database = JSON.parse(typeof databaseRaw === 'string' ? databaseRaw : databaseRaw.stdout ?? databaseRaw.output);
  if (database.status !== 'success') throw new Error('無法讀取 Firestore metadata');
  validateProviderState(manifest, billing, database.result);
}

export async function waitForIndexes(out, project, timeoutMinutes, options = {}) {
  const gcloudAccount = options.gcloudAccount;
  const exec = options.execFileSync ?? options.exec ?? execFileSync;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const log = options.log ?? (text => process.stdout.write(text));
  const readConfig = options.readConfig ?? options.readConfigFn ?? (async file => JSON.parse(await readFile(file, 'utf8')));
  const config = await readConfig(path.join(out, 'firestore.indexes.json'));
  const deadline = Date.now() + timeoutMinutes * 60_000;
  for (;;) {
    const listArgs = ['firestore', 'indexes', 'composite', 'list', '--project', project, '--database', '(default)', '--format=json', ...(gcloudAccount ? ['--account', gcloudAccount] : [])];
    const raw = exec('gcloud', listArgs, { encoding: 'utf8' });
    const listed = JSON.parse(typeof raw === 'string' ? raw : raw.stdout ?? raw.output);
    const status = compositeIndexStatus(config, listed);
    if (status.ready) { log(`composite indexes 全部 READY（${(config.indexes ?? []).length} 個）\n`); return status; }
    if (Date.now() >= deadline) throw new Error(`index 未在 ${timeoutMinutes} 分鐘內 READY；不部署 rules／hosting。缺少：${status.missing.join('; ') || '無'}；未完成：${status.notReady.join('; ') || '無'}`);
    log(`等待 index READY：缺少 ${status.missing.length}、未完成 ${status.notReady.length}\n`);
    await sleep(30_000);
  }
}

export function parseDeployTestEnv(content) {
  if (typeof content !== 'string') throw new Error('deploy-test.env 內容必須為字串');
  const lines = content.split(/\r?\n/);
  const vars = {};
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) throw new Error(`deploy-test.env 第 ${i + 1} 行格式不合法：缺少 '='`);
    const key = raw.slice(0, eqIdx).trim();
    const value = raw.slice(eqIdx + 1).trim();
    if (key !== 'EASYORDER_TEST_ACCOUNT') throw new Error(`deploy-test.env 包含未知 key：${key}`);
    vars[key] = value;
  }
  const account = vars.EASYORDER_TEST_ACCOUNT;
  if (!account) throw new Error('deploy-test.env 缺少 EASYORDER_TEST_ACCOUNT');
  if (!/^[^\s@-][^\s@]*@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error('EASYORDER_TEST_ACCOUNT 格式必須為有效 email');
  return { account };
}

export function resolveTestTarget({ testVars, productionVars }) {
  if (!testVars || typeof testVars !== 'object') throw new Error('缺少 testVars 設定');
  const project = testVars.EASYORDER_DEPLOY_PROJECT ?? testVars.project;
  const region = testVars.EASYORDER_REGION ?? testVars.region;
  const rawWeb = testVars.EASYORDER_WEB_CONFIG ?? testVars.webConfig ?? testVars.web;

  if (!project || typeof project !== 'string' || !project.trim()) throw new Error('缺少 EASYORDER_DEPLOY_PROJECT');
  if (!region || typeof region !== 'string' || !region.trim()) throw new Error('缺少 EASYORDER_REGION');
  if (!rawWeb) throw new Error('缺少 EASYORDER_WEB_CONFIG');

  if (productionVars && typeof productionVars === 'object') {
    const prodProject = productionVars.EASYORDER_DEPLOY_PROJECT ?? productionVars.project;
    if (prodProject && prodProject === project) {
      throw new Error(`production 與 test 的 project 相同（${project}），拒絕部署`);
    }
  }

  let web = rawWeb;
  if (typeof rawWeb === 'string') {
    try {
      web = JSON.parse(rawWeb);
    } catch {
      throw new Error('EASYORDER_WEB_CONFIG 必須為合法的 JSON 字串');
    }
  }

  validateProject(project, false);
  validateWebConfig(web, project, false);
  return { project, region, web };
}

export function validateTestSource({ head, originMain, dirty, ciSuccessCount }) {
  if (dirty) throw new Error('工作目錄有未提交變更（dirty），不能執行 deploy-test');
  if (!head || !originMain || head !== originMain) throw new Error(`HEAD (${head}) 與 origin/main (${originMain}) 不一致`);
  if (typeof ciSuccessCount !== 'number' || ciSuccessCount < 1) throw new Error('來源 commit 缺少成功的 push CI run，不能執行 deploy-test');
}

export async function runTestDeployment({
  manifest,
  project,
  account,
  out,
  timeoutMinutes = 30,
  exec,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = text => process.stdout.write(text),
  checkReleaseFn,
  readConfigFn,
  saveReceiptFn,
  firebaseBin = defaultFirebase,
}) {
  const execFn = exec ?? ((cmd, args, opts) => {
    const res = spawnSync(cmd, args, opts);
    return { status: res.status, error: res.error, output: `${res.stdout ?? ''}\n${res.stderr ?? ''}`, stdout: res.stdout, stderr: res.stderr };
  });

  const check = checkReleaseFn ?? (() => checkRelease(out));

  // Step 6: preflight
  providerPreflight(manifest, project, account, out, { gcloudAccount: account, exec: execFn, firebaseBin });

  let releaseDigest = '';
  try {
    const content = await readFile(path.join(out, 'release.json'));
    releaseDigest = digest(content);
  } catch {}

  const receipt = {
    project,
    releaseDigest,
    sourceSha: manifest.sourceSha,
    runId: null,
    actor: account,
    steps: [],
  };

  const saveReceipt = async () => {
    if (saveReceiptFn) {
      await saveReceiptFn(path.join(out, 'deploy-receipt.json'), receipt);
    } else {
      await writeFile(path.join(out, 'deploy-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    }
  };

  for (const step of ['indexes', 'rules', 'hosting']) {
    await check(out);
    log(`部署 ${project} ${step}，source=${manifest.sourceSha}\n`);
    const args = [...deploymentArgs(manifest, project, step, account), '--non-interactive'];

    await runCiStepWithRetry({
      step,
      run: () => {
        const raw = execFn(firebaseBin, args, { cwd: out, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
        if (typeof raw === 'string') {
          return { status: 0, output: raw };
        }
        return {
          status: raw.status ?? (raw.error ? 1 : 0),
          error: raw.error,
          output: raw.output ?? `${raw.stdout ?? ''}\n${raw.stderr ?? ''}`,
        };
      },
      sleep,
      log,
    });

    receipt.steps.push({ step, at: new Date().toISOString() });
    await saveReceipt();

    if (step === 'indexes') {
      await waitForIndexes(out, project, timeoutMinutes, {
        gcloudAccount: account,
        exec: execFn,
        readConfig: readConfigFn,
        sleep,
        log,
      });
    }
  }

  log('indexes、rules、hosting 已部署；正式 smoke 仍由本人驗證。\n');
  return receipt;
}
