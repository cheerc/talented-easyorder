import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
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
