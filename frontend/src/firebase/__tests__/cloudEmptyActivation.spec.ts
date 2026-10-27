// @ts-expect-error Node-only file access exercises the actual operator CLI.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
// @ts-expect-error Node-only child process access exercises the actual operator CLI.
import { spawnSync } from 'node:child_process';
// @ts-expect-error Node-only path access.
import path from 'node:path';
// @ts-expect-error Node-only temporary files.
import { tmpdir } from 'node:os';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

declare const process: { env: Record<string, string | undefined>; execPath: string };

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!enabled && process.env.EASYORDER_REQUIRE_EMPTY_ACTIVATION === 'true') throw new Error('P17 requires demo Firestore Emulator');
const suite = enabled ? describe : describe.skip;
const project = 'demo-easyorder';
let env: RulesTestEnvironment;
let scratch: string;
const launcher = path.resolve('../scripts/easyorder-data-maintenance.mjs');
const dataset = 'anonymous-p17';
const operators = [{ uid: 'p17-synthetic', email: 'p17@example.test' }];
function run(args: string[]) {
  return spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } });
}
function activate(extra: string[] = []) {
  return run(['activate-empty', '--project', project, '--dataset', dataset, '--operators', path.join(scratch, 'operators.json'), ...extra]);
}
suite('P17 real launcher empty-project activation', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('../firestore.rules', 'utf8') } });
    scratch = mkdtempSync(path.join(tmpdir(), 'easyorder-p17-'));
    writeFileSync(path.join(scratch, 'operators.json'), JSON.stringify(operators));
  }, 30_000);
  beforeEach(async () => {
    await env.clearFirestore();
    const result = run(['init', '--project', project, '--dataset', dataset, '--go-live-date', '2026-10-25', '--execute']);
    expect(result.status, result.stderr).toBe(0);
  });
  afterAll(async () => { await env?.cleanup(); if (scratch) rmSync(scratch, { recursive: true, force: true }); });

  it('dry run creates nothing; execute atomically enables only operator, empty lease and head, then refuses a second activation', async () => {
    const dry = activate();
    expect(dry.status, dry.stderr).toBe(0);
    await env.withSecurityRulesDisabled(async context => {
      expect((await getDoc(doc(context.firestore(), 'system/dataHead'))).data()?.maintenance).toBe(true);
      expect((await getDocs(collection(context.firestore(), 'operators'))).empty).toBe(true);
    });
    const result = activate(['--execute']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(operators[0]!.email);
    expect(result.stdout).not.toContain(operators[0]!.uid);
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'system/dataHead'))).data()).toMatchObject({ seq: 0, lastCommandId: null, maintenance: false, datasetId: dataset });
      expect((await getDoc(doc(db, 'system/accessLease'))).data()).toMatchObject({ holderUid: null, epoch: 0 });
      expect((await getDoc(doc(db, `operators/${operators[0]!.uid}`))).data()).toMatchObject({ active: true, email: operators[0]!.email });
      for (const name of ['students', 'transactions', 'commands', 'days']) expect((await getDocs(collection(db, name))).empty).toBe(true);
    });
    expect(activate(['--execute']).status).toBe(2);
  });
  it('refuses existing business and leaves maintenance on', async () => {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'students/synthetic'), { synthetic: true }));
    expect(activate(['--execute']).status).toBe(2);
    await env.withSecurityRulesDisabled(async context => expect((await getDoc(doc(context.firestore(), 'system/dataHead'))).data()?.maintenance).toBe(true));
  });
  it('refuses existing lease even when it is empty, and refuses a mismatched dataset', async () => {
    const mismatch = run(['activate-empty', '--project', project, '--dataset', 'other-dataset', '--operators', path.join(scratch, 'operators.json'), '--execute']);
    expect(mismatch.status).toBe(2);
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'system/accessLease'), { holderUid: null, epoch: 0, updatedAt: Timestamp.now() }));
    expect(activate(['--execute']).status).toBe(2);
  });
  it('requires a terminal for a real target before network access', () => {
    const result = spawnSync(process.execPath, [launcher, 'activate-empty', '--project', 'easyorder-private-test', '--dataset', dataset,
      '--operators', path.join(scratch, 'operators.json'), '--execute'], { encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '', EASYORDER_ACCESS_TOKEN: 'synthetic-never-used' } });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('終端機');
    expect(result.stderr).not.toContain('synthetic-never-used');
  });

});
