import { describe, expect, it } from 'vitest';
import { createBackupManifest, encryptBackup, sha256Hex } from '../../firebase/cloudBackup';
import { main, type CliIo } from '../cli';
import type { FetchLike } from '../firestoreRest';

const PASSWORD = 'p15-unit-password';

interface HarnessOptions {
  password?: string;
  env?: Record<string, string>;
  tty?: boolean;
  lines?: string[];
  fetchImpl?: FetchLike;
}

function harness(files: Record<string, Uint8Array<ArrayBuffer> | string> = {}, options: HarnessOptions = {}) {
  const password = options.password ?? PASSWORD;
  const lines = [...(options.lines ?? [])];
  const fetchCalls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const store = new Map<string, Uint8Array<ArrayBuffer> | string>(Object.entries(files));
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
    clock: () => new Date('2026-10-23T08:00:00.000Z'),
    env: options.env ?? {},
    isTty: () => options.tty ?? false,
    async readLine() { return lines.shift() ?? ''; },
    fetch: async (url, init) => {
      fetchCalls.push({ url, method: init.method, body: init.body });
      if (!options.fetchImpl) throw new Error('unexpected fetch in a test that must not touch the network');
      return options.fetchImpl(url, init);
    },
  };
  return { io, out, err, written, fetchCalls, passwordReads: () => passwordReads, text: () => out.join('') + err.join('') };
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

});

describe('P15c verify and finalize arguments and the wrong-target guard', () => {
  const base = ['--project', 'demo-easyorder-restore', '--manifest', '/c/chain.json'];

  it('verify and finalize are listed in --help with their flags and are no longer "not provided"', async () => {
    const h = harness();
    expect(await main(['--help'], h.io)).toBe(0);
    for (const word of ['--operators', '--report']) expect(h.text()).toContain(word);
    expect(h.text()).not.toContain('尚未提供');
  });

  it('exits 64 with zero network calls and no password read for a wrong target, a missing flag or a bad flag', async () => {
    const cases: Array<[string, HarnessOptions, string[]]> = [
      ['verify wrong target', { env: EMULATOR }, ['verify', '--project', 'easyorder-prod', '--manifest', '/c/chain.json']],
      ['finalize wrong target', { env: EMULATOR }, ['finalize', '--project', 'easyorder-prod', '--manifest', '/c/chain.json', '--operators', '/c/ops.json', '--execute']],
      ['verify no project', { env: EMULATOR }, ['verify', '--manifest', '/c/chain.json']],
      ['verify no manifest', { env: EMULATOR }, ['verify', '--project', 'demo-easyorder-restore']],
      ['finalize no operators', { env: EMULATOR }, ['finalize', ...base, '--execute']],
      ['finalize password flag', { env: EMULATOR }, ['finalize', ...base, '--operators', '/c/ops.json', '--password', 'x']],
      ['verify unknown flag', { env: EMULATOR }, ['verify', ...base, '--bogus']],
      ['verify bad to-seq', { env: EMULATOR }, ['verify', ...base, '--to-seq', 'x']],
      ['finalize real project without a terminal', { env: REAL_ENV, tty: false }, ['finalize', '--project', 'easyorder-drill', '--manifest', '/c/chain.json', '--operators', '/c/ops.json', '--execute']],
    ];
    for (const [label, options, argv] of cases) {
      const h = harness({}, options);
      expect(await main(argv, h.io), label).toBe(64);
      expect(h.fetchCalls, label).toHaveLength(0);
      expect(h.passwordReads(), label).toBe(0);
    }
  });

  it('exits 64, before any network call, when the operators file is missing, not JSON, empty or malformed', async () => {
    const one = await emptyPackage('anonymous-unit-a', null);
    const chain = { '/c/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.bak' }]), '/c/one.bak': one.bytes };
    const cases: Array<[string, Record<string, string>]> = [
      ['missing', {}],
      ['not json', { '/c/ops.json': 'nope' }],
      ['empty list', { '/c/ops.json': '[]' }],
      ['not a list', { '/c/ops.json': '{"uid":"u","email":"a@example.test"}' }],
      ['no email', { '/c/ops.json': '[{"uid":"u"}]' }],
      ['duplicate uid', { '/c/ops.json': '[{"uid":"u","email":"a@example.test"},{"uid":"u","email":"b@example.test"}]' }],
      ['extra field', { '/c/ops.json': '[{"uid":"u","email":"a@example.test","role":"admin"}]' }],
    ];
    for (const [label, extra] of cases) {
      const h = harness({ ...chain, ...extra }, { env: EMULATOR });
      expect(await main(['finalize', ...base, '--operators', '/c/ops.json', '--execute'], h.io), label).toBe(64);
      expect(h.fetchCalls, label).toHaveLength(0);
    }
  });
});

const EMULATOR = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
const REAL_ENV = { EASYORDER_ACCESS_TOKEN: 'secret-test-token' };

describe('P15b argument handling and the wrong-target guard (B8)', () => {
  it('B8: a non-demo project with the Emulator host, and a demo- project without it, exit 64 with zero network calls and no password read', async () => {
    const cases: Array<[string, HarnessOptions, string[]]> = [
      ['emulator + real project', { env: EMULATOR }, ['restore', '--project', 'easyorder-prod', '--manifest', '/c/chain.json', '--execute']],
      ['no emulator + demo project', { env: REAL_ENV }, ['restore', '--project', 'demo-x-restore', '--manifest', '/c/chain.json', '--execute']],
      ['no emulator + no token', { env: {} }, ['restore', '--project', 'easyorder-drill', '--manifest', '/c/chain.json', '--dry-run']],
      ['resume wrong target', { env: EMULATOR }, ['resume', '--project', 'easyorder-prod', '--manifest', '/c/chain.json', '--execute']],
      ['init wrong target', { env: EMULATOR }, ['init', '--project', 'easyorder-prod', '--dataset', 'anonymous-x', '--go-live-date', '2026-10-01', '--execute']],
      ['init demo without emulator', { env: REAL_ENV }, ['init', '--project', 'demo-x-restore', '--dataset', 'anonymous-x', '--go-live-date', '2026-10-01']],
    ];
    for (const [label, options, argv] of cases) {
      const h = harness({}, options);
      expect(await main(argv, h.io), label).toBe(64);
      expect(h.fetchCalls, label).toHaveLength(0);
      expect(h.passwordReads(), label).toBe(0);
      expect(h.text(), label).not.toContain('secret-test-token');
    }
  });

  it('refuses --execute against a non-Emulator project when stdin is not a terminal, before any network call', async () => {
    const h = harness({}, { env: REAL_ENV, tty: false });
    expect(await main(['restore', '--project', 'easyorder-drill', '--manifest', '/c/chain.json', '--execute'], h.io)).toBe(64);
    expect(h.err.join('')).toContain('終端機');
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('exits 64 for --dry-run together with --execute, resume without --execute, and malformed --max-writes / --batch-size', async () => {
    const base = ['--project', 'demo-easyorder-restore', '--manifest', '/c/chain.json'];
    const cases: Array<[string, string[]]> = [
      ['both modes', ['restore', ...base, '--dry-run', '--execute']],
      ['resume dry', ['resume', ...base]],
      ['resume dry-run flag', ['resume', ...base, '--dry-run']],
      ['max-writes 0', ['restore', ...base, '--execute', '--max-writes', '0']],
      ['max-writes text', ['restore', ...base, '--execute', '--max-writes', 'many']],
      ['batch-size 101', ['restore', ...base, '--execute', '--batch-size', '101']],
      ['batch-size 0', ['restore', ...base, '--execute', '--batch-size', '0']],
      ['no project', ['restore', '--manifest', '/c/chain.json']],
      ['no manifest', ['restore', '--project', 'demo-easyorder-restore']],
      ['password flag', ['restore', ...base, '--password', 'x']],
      ['execute with a value', ['restore', ...base, '--execute=yes']],
      ['init without dataset', ['init', '--project', 'demo-easyorder-restore', '--go-live-date', '2026-10-01']],
      ['init without go-live-date', ['init', '--project', 'demo-easyorder-restore', '--dataset', 'anonymous-x']],
      ['init bad date', ['init', '--project', 'demo-easyorder-restore', '--dataset', 'anonymous-x', '--go-live-date', '2026-02-30']],
      ['init bad dataset', ['init', '--project', 'demo-easyorder-restore', '--dataset', 'has space', '--go-live-date', '2026-10-01']],
    ];
    for (const [label, argv] of cases) {
      const h = harness({}, { env: EMULATOR });
      expect(await main(argv, h.io), label).toBe(64);
      expect(h.fetchCalls, label).toHaveLength(0);
    }
  });

  it('lists init, restore and resume with their flags in --help', async () => {
    const h = harness();
    expect(await main(['--help'], h.io)).toBe(0);
    for (const word of ['--execute', '--dry-run', '--max-writes', '--go-live-date', '75']) expect(h.text()).toContain(word);
  });
});

describe('P15b confirmation for a real (non-Emulator) project', () => {
  const root = 'projects/easyorder-drill/databases/(default)/documents';
  const answer: FetchLike = async (url, init) => {
    const body = (status: number, value: unknown) => ({ ok: status === 200, status, text: async () => JSON.stringify(value) });
    if (url.endsWith(':commit')) return body(200, {});
    if (url.endsWith(':batchGet')) {
      return body(200, [{ found: { name: `${root}/system/dataHead`, fields: {
        schemaVersion: { integerValue: '1' }, datasetId: { stringValue: 'anonymous-unit-a' }, seq: { integerValue: '0' }, lastCommandId: { nullValue: null },
        maintenance: { booleanValue: true }, goLiveDate: { stringValue: '2026-10-01' }, updatedAt: { timestampValue: '2026-10-23T00:00:00.000000000Z' },
      } } }]);
    }
    if (url.endsWith(':runQuery')) return body(200, [{ readTime: 't' }]);
    expect(init.method).toBe('GET');
    return body(200, {});
  };

  async function files() {
    const one = await emptyPackage('anonymous-unit-a', null);
    return { '/c/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.bak' }]), '/c/one.bak': one.bytes };
  }

  it('does not write when the typed confirmation is not exactly RESTORE <project> <dataset> <H>', async () => {
    for (const typed of ['', 'restore easyorder-drill anonymous-unit-a 0', 'RESTORE easyorder-drill anonymous-unit-a 1', 'RESTORE easyorder-drill anonymous-unit-a 0 ']) {
      const h = harness(await files(), { env: REAL_ENV, tty: true, lines: [typed], fetchImpl: answer });
      expect(await main(['restore', '--project', 'easyorder-drill', '--manifest', '/c/chain.json', '--execute'], h.io), typed).toBe(64);
      expect(h.fetchCalls.filter(call => call.method === 'POST' && call.url.endsWith(':commit')), typed).toHaveLength(0);
      expect(h.written.size, typed).toBe(0);
    }
  });

  it('proceeds with the exact confirmation and sends the token only as a header', async () => {
    const h = harness(await files(), { env: REAL_ENV, tty: true, lines: ['RESTORE easyorder-drill anonymous-unit-a 0'], fetchImpl: answer });
    expect(await main(['restore', '--project', 'easyorder-drill', '--manifest', '/c/chain.json', '--execute'], h.io)).toBe(0);
    expect(h.fetchCalls.every(call => call.url.startsWith('https://firestore.googleapis.com/'))).toBe(true);
    expect(h.fetchCalls.every(call => !(call.body ?? '').includes('secret-test-token'))).toBe(true);
    expect(h.text()).not.toContain('secret-test-token');
  });

  it('a dry run needs no confirmation and no terminal, and writes no file and sends no commit', async () => {
    const h = harness(await files(), { env: REAL_ENV, tty: false, fetchImpl: answer });
    expect(await main(['restore', '--project', 'easyorder-drill', '--manifest', '/c/chain.json'], h.io)).toBe(0);
    expect(h.fetchCalls.some(call => call.url.endsWith(':commit'))).toBe(false);
    expect(h.written.size).toBe(0);
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
    const h = harness({ '/c/chain.json': chainJson('anonymous-unit-a', [{ file: 'one.bak' }]), '/c/one.bak': one.bytes }, { password: 'wrong-password' });
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
