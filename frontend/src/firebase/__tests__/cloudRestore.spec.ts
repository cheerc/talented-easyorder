// @ts-expect-error Node-only child process access is used to run the real launcher, as an operator would.
import { spawnSync } from 'node:child_process';
// @ts-expect-error Node-only file access is used to load the real Firestore Rules and to read the CLI output.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node-only OS access is used to place the generated fixture in a temporary directory.
import { tmpdir } from 'node:os';
// @ts-expect-error Node-only path access is used to locate the real Firestore Rules and the launcher.
import path from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptBackup, recalculateBackupTotals, replayBackupProjections, type BackupCommandRecord } from '../cloudBackup';
import { generateOtherDatasetPackage, generateR02Fixture, type R02Fixture, type R02Package } from './helpers/r02Scenario';

declare const process: { env: Record<string, string | undefined>; cwd: () => string; execPath: string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_RESTORE === 'true';
if (required && !emulatorHost) throw new Error('P15 cloud restore Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? path.resolve(process.cwd(), '../firestore.rules'));
const launcher = path.resolve(process.cwd(), '../scripts/easyorder-data-maintenance.mjs');
const PASSWORD = 'p15-fixture-password';

let env: RulesTestEnvironment;
let fixture: R02Fixture;
let otherPackage: R02Package;
let scratch: string;

// Loading the Rules into a cold Emulator and writing the whole R02 scenario takes a while.
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-easyorder', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(rulesPath, 'utf8') } });
  scratch = mkdtempSync(path.join(tmpdir(), 'p15-restore-'));
  fixture = await generateR02Fixture({ env, dir: path.join(scratch, 'source'), password: PASSWORD });
  otherPackage = await generateOtherDatasetPackage({ env, dir: path.join(scratch, 'source'), password: PASSWORD, datasetId: 'anonymous-p15-other' });
}, 180_000);
afterAll(async () => env.cleanup());

interface CliRun { status: number | null; stdout: string; stderr: string }

/** Runs the real launcher in a child process with the password on stdin, the way an operator does. */
function runCli(args: string[], password: string | null = PASSWORD): CliRun {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    input: password === null ? '' : `${password}\n`, encoding: 'utf8', timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function writeChain(name: string, packages: Array<{ file: string; sha256?: string }>, datasetId = fixture.datasetId): string {
  const chainPath = path.join(fixture.dir, name);
  writeFileSync(chainPath, JSON.stringify({ format: 'easyorder-restore-chain', version: 1, datasetId, packages }));
  return chainPath;
}

const report = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
const reportPath = (name: string) => path.join(scratch, name);

async function sourceRecords(): Promise<BackupCommandRecord[]> {
  const records: BackupCommandRecord[] = [];
  for (const item of fixture.packages) {
    records.push(...(await decryptBackup(readFileSync(path.join(fixture.dir, item.file)), PASSWORD)).records);
  }
  return records;
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
      expect(Object.fromEntries(Object.entries(result.days).map(([dayId, value]) => [dayId, (value as { totals: unknown }).totals]))).toEqual(expectedTotals);
      expect(result.collections.students).toBe(Object.keys(expected).filter(key => key.startsWith('students/')).length);
      expect(result.collections.transactions).toBe(Object.keys(expected).filter(key => key.startsWith('transactions/')).length);
      expect(result.packageBoundary.matchesPackageProjection, `H=${toSeq}`).toBe(boundaries.includes(toSeq) && toSeq > 0 ? true : null);
    }
  });

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
    const everything = `${readFileSync(out, 'utf8')}\n${run.stdout}\n${run.stderr}`;
    for (const value of fixture.known) expect(everything, value).not.toContain(value);
    expect(everything).not.toContain(PASSWORD);
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
    const later = runCli(['restore', '--project', 'demo-easyorder-restore'], null);
    expect(later.status).toBe(64);
    expect(later.stderr).toContain('尚未提供');
  });
});
