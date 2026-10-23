// @ts-expect-error Node-only child process access is used to run the real launcher, as an operator would.
import { spawnSync } from 'node:child_process';
// @ts-expect-error Node-only file access is used to load the real Firestore Rules and to read the CLI output.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node-only OS access is used to place the generated fixture in a temporary directory.
import { tmpdir } from 'node:os';
// @ts-expect-error Node-only path access is used to locate the real Firestore Rules and the launcher.
import path from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, collection, collectionGroup, doc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { decryptBackup, recalculateBackupTotals, replayBackupProjections, stableJson, type BackupCommandRecord } from '../cloudBackup';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import {
  R02_LEASE_EPOCH, R02_OPERATOR, generateOtherDatasetPackage, generateR02Fixture, operatorDb, operatorUser, taipeiToday,
  type R02Fixture, type R02Package,
} from './helpers/r02Scenario';

declare const process: { env: Record<string, string | undefined>; cwd: () => string; execPath: string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_RESTORE === 'true';
if (required && !emulatorHost) throw new Error('P15 cloud restore Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? path.resolve(process.cwd(), '../firestore.rules'));
const launcher = path.resolve(process.cwd(), '../scripts/easyorder-data-maintenance.mjs');
const PASSWORD = 'p15-fixture-password';

const TARGET_PROJECT = 'demo-easyorder-restore';

let env: RulesTestEnvironment;
let targetEnv: RulesTestEnvironment;
let fixture: R02Fixture;
let otherPackage: R02Package;
let scratch: string;

// Loading the Rules into a cold Emulator and writing the whole R02 scenario takes a while.
beforeAll(async () => {
  const firestore = { host: '127.0.0.1', port: 8080, rules: readFileSync(rulesPath, 'utf8') };
  env = await initializeTestEnvironment({ projectId: 'demo-easyorder', firestore });
  targetEnv = await initializeTestEnvironment({ projectId: TARGET_PROJECT, firestore });
  scratch = mkdtempSync(path.join(tmpdir(), 'p15-restore-'));
  // The other-dataset package reseeds the source, so it goes first: the R02 source must stay in the Emulator for the restore comparisons.
  otherPackage = await generateOtherDatasetPackage({ env, dir: path.join(scratch, 'source'), password: PASSWORD, datasetId: 'anonymous-p15-other' });
  fixture = await generateR02Fixture({ env, dir: path.join(scratch, 'source'), password: PASSWORD });
}, 180_000);
afterAll(async () => { await env.cleanup(); await targetEnv.cleanup(); });

interface CliRun { status: number | null; stdout: string; stderr: string }

/** Runs the real launcher in a child process with the password on stdin, the way an operator does. */
function runCli(args: string[], password: string | null = PASSWORD, extraEnv: Record<string, string> = {}): CliRun {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    input: password === null ? '' : `${password}\n`, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: emulatorHost, ...extraEnv },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function writeChain(name: string, packages: Array<{ file: string; sha256?: string }>, datasetId = fixture.datasetId): string {
  const chainPath = path.join(fixture.dir, name);
  writeFileSync(chainPath, JSON.stringify({ format: 'easyorder-restore-chain', version: 1, datasetId, packages }));
  return chainPath;
}

interface ReportJson {
  datasetId: string;
  toSeq: number;
  commandSeq: { first: number | null; last: number; contiguous: boolean };
  packageBoundary: { atPackage: number | null; matchesPackageProjection: boolean | null };
  collections: Record<string, number>;
  days: Record<string, { totals: Record<string, number> }>;
  students: { count: number; balanceSum: number };
  timing: { totalMs: number };
  writes: { documents: number };
}
const report = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as ReportJson;
const reportPath = (name: string) => path.join(scratch, name);

async function sourceRecords(): Promise<BackupCommandRecord[]> {
  const records: BackupCommandRecord[] = [];
  for (const item of fixture.packages) {
    records.push(...(await decryptBackup(readFileSync(path.join(fixture.dir, item.file)), PASSWORD)).records);
  }
  return records;
}

/** A 64-hex SHA-256 can contain any short digit run by chance, so digests are removed first; the fixture's codes are six digits, which no count or timing reaches. */
function expectAnonymous(text: string): void {
  const everything = text.replace(/[a-f0-9]{64}/g, '');
  for (const value of fixture.known) expect(everything, value).not.toContain(value);
  expect(everything).not.toContain(PASSWORD);
}

describeWithEmulator('P15a offline validate of a real P14 chain', () => {
  it('A1: validates the R02 chain and reports the source H, every day total, the student count and the balance sum', () => {
    const out = reportPath('a1.json');
    const run = runCli(['validate', '--manifest', fixture.chainPath, '--report', out]);
    expect(run.status, run.stderr).toBe(0);
    const result = report(out);
    expect(result.datasetId).toBe(fixture.datasetId);
    expect(result.toSeq).toBe(fixture.source.headSeq);
    expect(result.commandSeq).toMatchObject({ first: 1, last: fixture.source.headSeq, contiguous: true });
    for (const [dayId, totals] of Object.entries(fixture.source.dayTotals)) expect(result.days[dayId].totals, dayId).toEqual(totals);
    expect(result.students).toEqual({ count: fixture.source.studentCount, balanceSum: fixture.source.balanceSum });
    expect(result.collections.commands).toBe(fixture.source.headSeq);
    expect(result.writes.documents).toBeGreaterThan(fixture.source.headSeq);
    expect(result.timing.totalMs).toBeGreaterThan(0);
  });

  it('A2: replays to any H, equal to an independent replay of the first H records, and matches the package projection at a package boundary', async () => {
    const records = await sourceRecords();
    const boundaries = fixture.packages.map(item => item.toSeq);
    for (const toSeq of [0, 12, 20, boundaries[0]!, boundaries[1]!, boundaries[2]!]) {
      const out = reportPath(`a2-${toSeq}.json`);
      const run = runCli(['validate', '--manifest', fixture.chainPath, '--to-seq', String(toSeq), '--report', out]);
      expect(run.status, `H=${toSeq}: ${run.stderr}`).toBe(0);
      const result = report(out);
      const expected = replayBackupProjections(records.slice(0, toSeq), {});
      const expectedTotals = recalculateBackupTotals(expected);
      expect(result.toSeq).toBe(toSeq);
      expect(Object.fromEntries(Object.entries(result.days).map(([dayId, value]) => [dayId, value.totals]))).toEqual(expectedTotals);
      expect(result.collections.students).toBe(Object.keys(expected).filter(key => key.startsWith('students/')).length);
      expect(result.collections.transactions).toBe(Object.keys(expected).filter(key => key.startsWith('transactions/')).length);
      expect(result.packageBoundary.matchesPackageProjection, `H=${toSeq}`).toBe(boundaries.includes(toSeq) && toSeq > 0 ? true : null);
    }
  }, 60_000);

  it('A3: a wrong password exits 2 with the fixed message and writes no report', () => {
    const out = reportPath('a3.json');
    const run = runCli(['validate', '--manifest', fixture.chainPath, '--report', out], 'not-the-password');
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('密碼錯誤或備份內容已損毀');
    expect(existsSync(out)).toBe(false);
  });

  it('A4: one flipped byte in a package exits 2', () => {
    const dir = mkdtempSync(path.join(scratch, 'a4-'));
    const bytes = new Uint8Array(readFileSync(path.join(fixture.dir, fixture.packages[1]!.file)));
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    writeFileSync(path.join(dir, fixture.packages[1]!.file), bytes);
    for (const index of [0, 2]) copyFileSync(path.join(fixture.dir, fixture.packages[index]!.file), path.join(dir, fixture.packages[index]!.file));
    const chain = path.join(dir, 'chain.json');
    writeFileSync(chain, JSON.stringify({ format: 'easyorder-restore-chain', version: 1, datasetId: fixture.datasetId,
      packages: fixture.packages.map(item => ({ file: item.file })) }));
    expect(runCli(['validate', '--manifest', chain]).status).toBe(2);
  });

  it('A5: a chain with the middle package missing exits 2 and names the gap', () => {
    const chain = writeChain('a5.json', [fixture.packages[0]!, fixture.packages[2]!].map(item => ({ file: item.file })));
    const run = runCli(['validate', '--manifest', chain]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('fromSeq');
  });

  it('A6: a last package whose previousPackageSha256 is not the previous package exits 2', () => {
    const chain = writeChain('a6.json', [fixture.packages[0]!.file, fixture.packages[1]!.file, fixture.wrongPreviousFile].map(file => ({ file })));
    const run = runCli(['validate', '--manifest', chain]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('previousPackageSha256');
  });

  it('A7: a package of another dataset in the chain exits 2', () => {
    const chain = writeChain('a7.json', [fixture.packages[0]!.file, otherPackage.file].map(file => ({ file })));
    const run = runCli(['validate', '--manifest', chain]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('datasetId');
  });

  it('A8: a chain file SHA-256 that is not the package file exits 2', () => {
    const chain = writeChain('a8.json', fixture.packages.map((item, index) => ({ file: item.file, sha256: index === 1 ? '0'.repeat(64) : item.sha256 })));
    const run = runCli(['validate', '--manifest', chain]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('SHA-256');
  });

  it('A9: an H beyond the last package exits 2 and says so', () => {
    const run = runCli(['validate', '--manifest', fixture.chainPath, '--to-seq', String(fixture.source.headSeq + 1)]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('to-seq');
  });

  it('A10: a chain that starts from an incremental package exits 2', () => {
    const chain = writeChain('a10.json', fixture.packages.slice(1).map(item => ({ file: item.file })));
    const run = runCli(['validate', '--manifest', chain]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('第一包');
  });

  it('A11: neither the report nor the console output carries a name, code, UID, e-mail or remark of the source', () => {
    const out = reportPath('a11.json');
    const run = runCli(['validate', '--manifest', fixture.chainPath, '--report', out]);
    expect(run.status, run.stderr).toBe(0);
    expectAnonymous(`${readFileSync(out, 'utf8')}\n${run.stdout}\n${run.stderr}`);
  });

  it('A12: a password on the command line is refused with exit 64, before any package is read', () => {
    for (const args of [['--password', 'x'], ['--password=x']]) {
      const run = runCli(['validate', '--manifest', fixture.chainPath, ...args]);
      expect(run.status).toBe(64);
      expect(run.stderr).toContain('密碼');
    }
  });

  it('the launcher lists its subcommands, and later subcommands are not provided yet', () => {
    const help = runCli(['--help'], null);
    expect(help.status).toBe(0);
    for (const name of ['validate', 'init', 'restore', 'resume', 'verify', 'finalize']) expect(help.stdout).toContain(name);
    const later = runCli(['verify', '--project', 'demo-easyorder-restore'], null);
    expect(later.status).toBe(64);
    expect(later.stderr).toContain('尚未提供');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// P15b: init, restore and resume into a second Emulator project.

const BUSINESS_COLLECTIONS = ['commands', 'days', 'students', 'studentCodes', 'transactions', 'vendors', 'backfillDays', 'postCloseEntries'] as const;

function plain(value: unknown): unknown {
  if (value instanceof Timestamp) return { _type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, plain(nested)]));
  return value;
}

/** Every business document of a project as `path -> plain data`, read with the Rules off, and `system/dataHead` separately. */
async function snapshot(project: RulesTestEnvironment): Promise<{ docs: Record<string, unknown>; head: Record<string, unknown> | null }> {
  const docs: Record<string, unknown> = {};
  let head: Record<string, unknown> | null = null;
  await project.withSecurityRulesDisabled(async context => {
    const db = context.firestore() as unknown as Firestore;
    for (const name of BUSINESS_COLLECTIONS) {
      for (const item of (await getDocs(collection(db, name))).docs) docs[item.ref.path] = plain(item.data());
    }
    for (const item of (await getDocs(collectionGroup(db, 'settlements'))).docs) docs[item.ref.path] = plain(item.data());
    const headSnap = await getDocs(collection(db, 'system'));
    for (const item of headSnap.docs) if (item.id === 'dataHead') head = plain(item.data()) as Record<string, unknown>;
  });
  return { docs, head };
}

const sourceHeadSeq = () => fixture.source.headSeq;
const progressFile = (toSeq: number, project = TARGET_PROJECT) => path.join(fixture.dir, `.easyorder-restore-${project}-${fixture.datasetId}-${toSeq}.json`);
const initArgs = (extra: string[] = [], dataset = fixture.datasetId) =>
  ['init', '--project', TARGET_PROJECT, '--dataset', dataset, '--go-live-date', '2026-10-01', ...extra];
const restoreArgs = (mode: string[], extra: string[] = []) =>
  ['restore', '--project', TARGET_PROJECT, '--manifest', fixture.chainPath, ...mode, ...extra];
const resumeArgs = (extra: string[] = []) => ['resume', '--project', TARGET_PROJECT, '--manifest', fixture.chainPath, '--execute', ...extra];

interface ProgressJson { planDigest: string; project: string; datasetId: string; toSeq: number; completedBatches: number; totalBatches: number; writes: number }
const readProgress = (toSeq = sourceHeadSeq()) => JSON.parse(readFileSync(progressFile(toSeq), 'utf8')) as ProgressJson;
const writtenThisRun = (run: CliRun) => Number(/本次寫入 (\d+) 筆/.exec(run.stdout)?.[1] ?? Number.NaN);

function totalDocuments(): number {
  const out = reportPath(`total-${Date.now()}.json`);
  const run = runCli(['validate', '--manifest', fixture.chainPath, '--report', out]);
  expect(run.status, run.stderr).toBe(0);
  return report(out).writes.documents;
}

function initTarget(): void {
  const run = runCli(initArgs(['--execute']));
  expect(run.status, run.stderr).toBe(0);
}

async function expectRestoredLikeSource(): Promise<void> {
  const [source, target] = [await snapshot(env), await snapshot(targetEnv)];
  expect(Object.keys(source.docs).length).toBeGreaterThan(60);
  expect(Object.keys(target.docs).sort()).toEqual(Object.keys(source.docs).sort());
  for (const [docPath, value] of Object.entries(source.docs)) expect(stableJson(target.docs[docPath]), docPath).toBe(stableJson(value));
  expect(Object.keys(source.docs).some(key => key.startsWith('studentCodes/'))).toBe(true);
  expect(Object.keys(source.docs).some(key => key.includes('/settlements/'))).toBe(true);
  expect(target.head).toMatchObject({ maintenance: true, seq: sourceHeadSeq() });
  expect(stableJson({ ...target.head, maintenance: false })).toBe(stableJson(source.head));
}

// Every case starts several child processes, each decrypting the chain (600,000 PBKDF2 rounds a package).
describeWithEmulator('P15b init, restore and resume into a second project', { timeout: 120_000 }, () => {
  beforeEach(async () => {
    await targetEnv.clearFirestore();
    rmSync(progressFile(sourceHeadSeq()), { force: true });
    rmSync(progressFile(12), { force: true });
  });

  it('B1: a dry run (explicit or by default) prints the plan and writes nothing, not even a progress file', async () => {
    initTarget();
    const before = await snapshot(targetEnv);
    for (const mode of [['--dry-run'], []]) {
      const run = runCli(restoreArgs(mode));
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain(String(totalDocuments()));
      expect(run.stdout).toContain('試算');
    }
    expect(await snapshot(targetEnv)).toEqual(before);
    expect(Object.keys(before.docs)).toHaveLength(0);
    expect(existsSync(progressFile(sourceHeadSeq()))).toBe(false);
  });

  it('B2: init then restore --execute rebuilds every business document, studentCodes and settlements included, identical to the source', async () => {
    initTarget();
    const run = runCli(restoreArgs(['--execute']));
    expect(run.status, run.stderr).toBe(0);
    expect(writtenThisRun(run)).toBe(totalDocuments());
    await expectRestoredLikeSource();
    expect(readProgress()).toMatchObject({ project: TARGET_PROJECT, datasetId: fixture.datasetId, toSeq: sourceHeadSeq(), writes: totalDocuments() });
    expect(readProgress().completedBatches).toBe(readProgress().totalBatches);
  }, 120_000);

  it('B2b: restoring to an earlier H leaves exactly the first H commands and the dataHead at H', async () => {
    initTarget();
    const run = runCli(restoreArgs(['--execute', '--to-seq', '12']));
    expect(run.status, run.stderr).toBe(0);
    const target = await snapshot(targetEnv);
    expect(Object.keys(target.docs).filter(key => key.startsWith('commands/'))).toHaveLength(12);
    expect(target.head).toMatchObject({ seq: 12, maintenance: true });
  }, 120_000);

  it('B3: re-exporting the restored target gives the same records, projectionState and totals as the source', async () => {
    initTarget();
    expect(runCli(restoreArgs(['--execute'])).status).toBe(0);
    const exportOf = async (project: RulesTestEnvironment) => {
      let exported: Awaited<ReturnType<ReturnType<typeof createCloudBackupRepository>['exportRange']>> | null = null;
      await project.withSecurityRulesDisabled(async context => {
        exported = await createCloudBackupRepository(context.firestore() as unknown as Firestore, { currentUid: () => R02_OPERATOR.uid })
          .exportRange({ fromSeq: 0, generatedAt: '2026-10-23T06:00:00.000Z' });
      });
      return exported!;
    };
    const [source, target] = [await exportOf(env), await exportOf(targetEnv)];
    expect(target.toSeq).toBe(source.toSeq);
    for (const key of ['records', 'projectionState', 'totals'] as const) expect(stableJson(target.manifest[key]), key).toBe(stableJson(source.manifest[key]));
  }, 120_000);

  it('B4: a target that already holds a business document exits 2 and writes nothing', async () => {
    initTarget();
    await targetEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore() as unknown as Firestore, 'students/stray'), { note: 'already here' });
    });
    const before = await snapshot(targetEnv);
    const run = runCli(restoreArgs(['--execute']));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('students');
    expect(await snapshot(targetEnv)).toEqual(before);
    expect(existsSync(progressFile(sourceHeadSeq()))).toBe(false);
  });

  it('B5: a target whose dataHead is not in maintenance exits 2', async () => {
    initTarget();
    await targetEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore() as unknown as Firestore, 'system/dataHead'), { maintenance: false });
    });
    const run = runCli(restoreArgs(['--execute']));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('maintenance');
    expect((await snapshot(targetEnv)).docs).toEqual({});
  });

  it('B6: a target without a dataHead (never initialised) exits 2, for a dry run too', async () => {
    for (const mode of [['--execute'], ['--dry-run']]) {
      const run = runCli(restoreArgs(mode));
      expect(run.status, mode.join()).toBe(2);
      expect(run.stderr).toContain('init');
    }
    expect((await snapshot(targetEnv)).head).toBeNull();
  });

  it('B7: a target initialised for another dataset exits 2', async () => {
    expect(runCli(initArgs(['--execute'], 'anonymous-p15-other')).status).toBe(0);
    const run = runCli(restoreArgs(['--execute']));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('datasetId');
    expect((await snapshot(targetEnv)).docs).toEqual({});
  });

  it('B8: a non-demo project with the Emulator host exits 64 before reading the chain', () => {
    const run = runCli(restoreArgs(['--execute'], []).map(arg => (arg === TARGET_PROJECT ? 'easyorder-prod' : arg)), null);
    expect(run.status).toBe(64);
    expect(run.stderr).toContain('demo-');
  });

  it('B9: --max-writes stops at a batch boundary with exit 75, and resume finishes with every document written exactly once', async () => {
    initTarget();
    const total = totalDocuments();
    const limit = Math.max(10, Math.floor(total / 20) * 10);
    const first = runCli(restoreArgs(['--execute'], ['--batch-size', '10', '--max-writes', String(limit)]));
    expect(first.status, first.stderr).toBe(75);
    expect(first.stderr).toContain('resume');
    const paused = readProgress();
    expect(paused.completedBatches).toBeGreaterThan(0);
    expect(paused.completedBatches).toBeLessThan(paused.totalBatches);
    expect(paused.writes).toBe(writtenThisRun(first));
    expect(paused.writes).toBeLessThanOrEqual(limit);
    expect(Object.keys((await snapshot(targetEnv)).docs).length).toBe(paused.writes);

    const second = runCli(resumeArgs(['--batch-size', '10']));
    expect(second.status, second.stderr).toBe(0);
    expect(writtenThisRun(first) + writtenThisRun(second)).toBe(total);
    expect(readProgress()).toMatchObject({ completedBatches: paused.totalBatches, writes: total });
    await expectRestoredLikeSource();
  }, 180_000);

  it('B9b: a limit smaller than one batch is refused up front with exit 64 and nothing written', async () => {
    initTarget();
    const run = runCli(restoreArgs(['--execute'], ['--batch-size', '10', '--max-writes', '5']));
    expect(run.status).toBe(64);
    expect((await snapshot(targetEnv)).docs).toEqual({});
    expect(existsSync(progressFile(sourceHeadSeq()))).toBe(false);
  });

  it('B10: a crash after a batch committed but before the progress file was written resumes without rewriting it', async () => {
    const total = totalDocuments();
    const batches = Math.ceil((total - 1) / 10) + 1;
    for (const crashAfter of [0, 1, batches - 1]) {
      await targetEnv.clearFirestore();
      rmSync(progressFile(sourceHeadSeq()), { force: true });
      initTarget();
      const crashed = runCli(restoreArgs(['--execute'], ['--batch-size', '10']), PASSWORD, { EASYORDER_EMULATOR_CRASH_AFTER_BATCH: String(crashAfter) });
      expect(crashed.status, `crash after ${crashAfter}`).toBe(1);
      expect(readProgress().completedBatches, `crash after ${crashAfter}`).toBe(crashAfter);
      const resumed = runCli(resumeArgs(['--batch-size', '10']));
      expect(resumed.status, `${crashAfter}: ${resumed.stderr}`).toBe(0);
      expect(readProgress(), `crash after ${crashAfter}`).toMatchObject({ completedBatches: batches, totalBatches: batches, writes: total });
      await expectRestoredLikeSource();
    }
  }, 300_000);

  it('B11: resuming with another --to-seq, another batch size or another chain exits 2 and writes nothing', async () => {
    initTarget();
    const total = totalDocuments();
    expect(runCli(restoreArgs(['--execute'], ['--batch-size', '10', '--max-writes', String(Math.max(10, Math.floor(total / 20) * 10))])).status).toBe(75);
    const before = await snapshot(targetEnv);
    const otherH = runCli(resumeArgs(['--batch-size', '10', '--to-seq', String(fixture.packages[0]!.toSeq)]));
    expect(otherH.status).toBe(2);
    const otherBatch = runCli(resumeArgs(['--batch-size', '20']));
    expect(otherBatch.status).toBe(2);
    expect(otherBatch.stderr).toContain('digest');
    const otherChain = writeChain('b11-chain.json', fixture.packages.slice(0, 2).map(item => ({ file: item.file })));
    const shorter = runCli(['resume', '--project', TARGET_PROJECT, '--manifest', otherChain, '--execute', '--batch-size', '10', '--to-seq', String(sourceHeadSeq() - 1)]);
    expect(shorter.status).toBe(2);
    expect(await snapshot(targetEnv)).toEqual(before);
  }, 120_000);

  it('B12: a progress file edited to claim more completed batches exits 2 and writes nothing', async () => {
    initTarget();
    const total = totalDocuments();
    expect(runCli(restoreArgs(['--execute'], ['--batch-size', '10', '--max-writes', String(Math.max(10, Math.floor(total / 20) * 10))])).status).toBe(75);
    const progress = readProgress();
    writeFileSync(progressFile(sourceHeadSeq()), JSON.stringify({ ...progress, completedBatches: progress.totalBatches, writes: total }));
    const before = await snapshot(targetEnv);
    const run = runCli(resumeArgs(['--batch-size', '10']));
    expect(run.status).toBe(2);
    expect(await snapshot(targetEnv)).toEqual(before);
    writeFileSync(progressFile(sourceHeadSeq()), '{"not":"a progress file"}');
    expect(runCli(resumeArgs(['--batch-size', '10'])).status).toBe(2);
  }, 120_000);

  it('B13: a restored target stays in maintenance, so the production writer is refused until the flag is cleared', async () => {
    initTarget();
    expect(runCli(restoreArgs(['--execute'])).status).toBe(0);
    await targetEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'operators', R02_OPERATOR.uid), { ...R02_OPERATOR });
      await setDoc(doc(db, 'system/accessLease'), { holderUid: R02_OPERATOR.uid, epoch: R02_LEASE_EPOCH, updatedAt: Timestamp.now() });
    });
    const writer = createCloudCommandRepository(operatorDb(targetEnv), { currentUser: () => operatorUser() });
    const newStudent = (index: number) => ({
      commandId: `00000000-0000-4000-8000-${(0xb13000 + index).toString(16).padStart(12, '0')}`, kind: 'CreateStudent' as const, leaseEpoch: R02_LEASE_EPOCH,
      targets: { studentId: `00000000-0000-4000-8000-${(0xb13100 + index).toString(16).padStart(12, '0')}` }, expectedRevisions: { student: 0 },
      payload: { studentCode: `73190${index}`, displayName: 'B13 Synthetic', aliases: [], openingBalance: { amount: 0, asOfDate: taipeiToday(), note: '' } },
    });
    const attempt = async (index: number) => { try { return (await writer.commitCommand(newStudent(index))).ok; } catch { return false; } };
    expect(await attempt(5)).toBe(false);
    await targetEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore() as unknown as Firestore, 'system/dataHead'), { maintenance: false });
    });
    expect(await attempt(6)).toBe(true);
  }, 120_000);

  it('B14: init refuses a target that already has a dataHead or any business document, and writes nothing', async () => {
    initTarget();
    const again = runCli(initArgs(['--execute']));
    expect(again.status).toBe(2);
    expect(again.stderr).toContain('dataHead');
    await targetEnv.clearFirestore();
    await targetEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore() as unknown as Firestore, 'vendors/stray'), { name: 'already here' });
    });
    const run = runCli(initArgs(['--execute']));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('vendors');
    expect((await snapshot(targetEnv)).head).toBeNull();
  });

  it('init without --execute is a dry run: nothing is created, and --execute creates only the maintenance dataHead and prints the bootstrap manifest', async () => {
    const dry = runCli(initArgs());
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain('試算');
    expect((await snapshot(targetEnv)).head).toBeNull();
    const out = reportPath('init-manifest.json');
    const run = runCli(initArgs(['--execute', '--out', out]));
    expect(run.status, run.stderr).toBe(0);
    const head = (await snapshot(targetEnv)).head!;
    expect(head).toMatchObject({ schemaVersion: 1, datasetId: fixture.datasetId, seq: 0, lastCommandId: null, maintenance: true, goLiveDate: '2026-10-01' });
    const manifest = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(manifest).sort()).toEqual(['bootstrapMethod', 'createdAt', 'createdPaths', 'dataHead', 'financialDocumentsCreated', 'manifestVersion', 'projectId']);
    expect(manifest).toMatchObject({ manifestVersion: 1, projectId: TARGET_PROJECT, createdPaths: ['system/dataHead'], financialDocumentsCreated: false });
    expect((manifest.dataHead as Record<string, unknown>).maintenance).toBe(true);
    expect(Object.keys((await snapshot(targetEnv)).docs)).toHaveLength(0);
  });

  it('B2c: the output of init, restore and resume and the progress file carry no name, code, UID, e-mail or remark of the source', async () => {
    const outputs: string[] = [];
    const init = runCli(initArgs(['--execute']));
    const first = runCli(restoreArgs(['--execute'], ['--batch-size', '10', '--max-writes', '20']));
    const second = runCli(resumeArgs(['--batch-size', '10']));
    for (const run of [init, first, second]) outputs.push(run.stdout, run.stderr);
    outputs.push(readFileSync(progressFile(sourceHeadSeq()), 'utf8'));
    expect([init.status, first.status, second.status]).toEqual([0, 75, 0]);
    expectAnonymous(outputs.join('\n'));
  }, 180_000);
});
