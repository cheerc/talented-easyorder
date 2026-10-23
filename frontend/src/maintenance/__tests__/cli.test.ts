import { describe, expect, it } from 'vitest';
import { createBackupManifest, encryptBackup, sha256Hex } from '../../firebase/cloudBackup';
import { main, type CliIo } from '../cli';

const PASSWORD = 'p15-unit-password';

function harness(files: Record<string, Uint8Array | string> = {}, password = PASSWORD) {
  const store = new Map<string, Uint8Array | string>(Object.entries(files));
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  let passwordReads = 0;
  const io: CliIo = {
    async readFile(path) {
      const value = store.get(path);
      if (value === undefined) throw new Error(`ENOENT ${path}`);
      return typeof value === 'string' ? new TextEncoder().encode(value) : value;
    },
    async writeFile(path, data) { written.set(path, data); },
    async readPassword() { passwordReads += 1; return password; },
    stdout: text => { out.push(text); },
    stderr: text => { err.push(text); },
    now: () => 0,
  };
  return { io, out, err, written, passwordReads: () => passwordReads, text: () => out.join('') + err.join('') };
}

async function emptyPackage(datasetId: string, previousSha: string | null) {
  const manifest = createBackupManifest({
    datasetId, commandSchemaVersion: 1, fromSeq: 0, toSeq: 0, headCommandId: null, previousPackageSha256: previousSha,
    generatedAt: '2026-10-23T03:00:00.000Z', records: [], baseState: {}, projectionState: {}, totals: {},
  });
  const bytes = await encryptBackup(manifest, PASSWORD);
  return { bytes, sha256: await sha256Hex(bytes) };
}

const chainJson = (datasetId: string, packages: Array<{ file: string; sha256?: string }>) =>
  JSON.stringify({ format: 'easyorder-restore-chain', version: 1, datasetId, packages });

describe('P15a CLI usage and exit codes', () => {
  it('--help lists every subcommand and exits 0', async () => {
    const h = harness();
    expect(await main(['--help'], h.io)).toBe(0);
    for (const name of ['validate', 'init', 'restore', 'resume', 'verify', 'finalize']) expect(h.text()).toContain(name);
  });

  it('exits 64 without a subcommand, with an unknown one, or without --manifest', async () => {
    for (const argv of [[], ['frobnicate'], ['validate']]) {
      const h = harness();
      expect(await main(argv, h.io), argv.join(' ')).toBe(64);
      expect(h.err.join('')).not.toBe('');
    }
  });

  it('refuses a password on the command line, in either spelling, and never reads stdin for it', async () => {
    for (const argv of [['validate', '--manifest', 'chain.json', '--password', 'x'], ['validate', '--manifest', 'chain.json', '--password=x']]) {
      const h = harness();
      expect(await main(argv, h.io)).toBe(64);
      expect(h.err.join('')).toContain('密碼');
      expect(h.passwordReads()).toBe(0);
    }
  });

  it('exits 64 for a malformed --to-seq and for an unknown flag', async () => {
    for (const extra of [['--to-seq', 'abc'], ['--to-seq', '-1'], ['--to-seq', '1.5'], ['--bogus']]) {
      const h = harness();
      expect(await main(['validate', '--manifest', 'chain.json', ...extra], h.io), extra.join(' ')).toBe(64);
    }
  });

  it('says plainly that the later subcommands are not provided yet, and exits 64 (never a fake success)', async () => {
    for (const name of ['init', 'restore', 'resume', 'verify', 'finalize']) {
      const h = harness();
      expect(await main([name, '--project', 'demo-easyorder-restore'], h.io), name).toBe(64);
      expect(h.err.join('')).toContain('尚未提供');
    }
  });
});

describe('P15a validate with the in-memory chain (empty packages)', () => {
  it('validates a chain at H=0 and writes an anonymous report only when asked', async () => {
    const one = await emptyPackage('anonymous-unit-a', null);
    const files = { '/chain/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.easyorder-backup', sha256: one.sha256 }]),
      '/chain/one.easyorder-backup': one.bytes };
    const h = harness(files);
    expect(await main(['validate', '--manifest', '/chain/chain.json', '--report', '/out/report.json'], h.io)).toBe(0);
    const report = JSON.parse(h.written.get('/out/report.json') ?? 'null');
    expect(report).toMatchObject({ datasetId: 'anonymous-unit-a', toSeq: 0, students: { count: 0, balanceSum: 0 } });
    const none = harness(files);
    expect(await main(['validate', '--manifest', '/chain/chain.json'], none.io)).toBe(0);
    expect(none.written.size).toBe(0);
  });

  it('fails closed with exit 2 on a wrong password, writing no report', async () => {
    const one = await emptyPackage('anonymous-unit-a', null);
    const h = harness({ '/c/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.bak' }]), '/c/one.bak': one.bytes }, 'wrong-password');
    expect(await main(['validate', '--manifest', '/c/chain.json', '--report', '/out/r.json'], h.io)).toBe(2);
    expect(h.err.join('')).toContain('密碼錯誤或備份內容已損毀');
    expect(h.written.size).toBe(0);
  });

  it('fails closed with exit 2 when the chain file lists a different SHA-256 than the package bytes', async () => {
    const one = await emptyPackage('anonymous-unit-a', null);
    const h = harness({ '/c/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.bak', sha256: 'a'.repeat(64) }]), '/c/one.bak': one.bytes });
    expect(await main(['validate', '--manifest', '/c/chain.json'], h.io)).toBe(2);
    expect(h.err.join('')).toContain('SHA-256');
  });

  it('fails closed with exit 2 on a mixed dataset, a wrong previous hash, a bad chain file and a missing package', async () => {
    const one = await emptyPackage('anonymous-unit-a', null);
    const otherDataset = await emptyPackage('anonymous-unit-b', one.sha256);
    const wrongPrevious = await emptyPackage('anonymous-unit-a', 'c'.repeat(64));
    const base = { '/c/one.bak': one.bytes, '/c/other.bak': otherDataset.bytes, '/c/wrong.bak': wrongPrevious.bytes };
    const cases: Array<[string, string, RegExp]> = [
      ['mixed dataset', chainJson('anonymous-unit-a', [{ file: 'one.bak' }, { file: 'other.bak' }]), /datasetId/],
      ['wrong previous hash', chainJson('anonymous-unit-a', [{ file: 'one.bak' }, { file: 'wrong.bak' }]), /previousPackageSha256/],
      ['chain file format', JSON.stringify({ format: 'something-else', version: 1, datasetId: 'anonymous-unit-a', packages: [] }), /還原鏈/],
      ['empty package list', chainJson('anonymous-unit-a', []), /還原鏈/],
      ['missing package', chainJson('anonymous-unit-a', [{ file: 'absent.bak' }]), /absent\.bak/],
      ['not json', 'nope', /還原鏈/],
    ];
    for (const [label, chain, message] of cases) {
      const h = harness({ ...base, '/c/chain.json': chain });
      expect(await main(['validate', '--manifest', '/c/chain.json'], h.io), label).toBe(2);
      expect(h.err.join(''), label).toMatch(message);
    }
  });

  it('exits 2 when --to-seq is beyond the last package', async () => {
    const one = await emptyPackage('anonymous-unit-a', null);
    const h = harness({ '/c/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.bak' }]), '/c/one.bak': one.bytes });
    expect(await main(['validate', '--manifest', '/c/chain.json', '--to-seq', '1'], h.io)).toBe(2);
    expect(h.err.join('')).toContain('to-seq');
  });
});
