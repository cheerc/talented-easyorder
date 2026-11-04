import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../ci-change-scope.mjs', import.meta.url));
const { classify, isDocsPath } = await import('../ci-change-scope.mjs');

const docsCases = [
  ['CLAUDE.md'],
  ['docs/DEVELOPMENT-HANDOFF.md', 'CONTRIBUTING.md'],
  ['.github/PULL_REQUEST_TEMPLATE.md'],
  ['docs/x.pdf'],
  ['docs/ops/baselines/a.txt'],
  ['docs/img/a.PNG', 'docs/img/b.svg', 'docs/img/c.jpeg', 'docs/img/d.gif', 'docs/img/e.jpg'],
];
const nonDocsCases = [
  ['docs/ops/p16-capacity-costs.json'],
  ['docs/ops/firebase-web-config.demo.json'],
  ['docs/ui_sample/screens.jsx'],
  ['.github/ISSUE_TEMPLATE/bug_report.yml'],
  ['.github/workflows/ci.yml'],
  ['scripts/x.mjs', 'docs/x.md'], // --no-renames output of a rename scripts/x.mjs -> docs/x.md
  ['x.pdf'], // binary whitelist applies only under docs/
  ['docs/notes.md.json'],
  ['docs/notes.md/run.sh'],
  ['frontend/X.MD'], // *.md is case-sensitive, as in the previous grep rule
  ['docs/a.md '], // trailing space: path is not trimmed
  ['docs/a.md\r'], // CRLF residue must not pass as Markdown
];

test('docs-only whitelist accepts Markdown anywhere and documentation assets under docs/', () => {
  for (const paths of docsCases) {
    const r = classify(paths);
    assert.equal(r.docsOnly, true, paths.join(','));
    assert.deepEqual(r.nonDocs, []);
  }
});

test('everything outside the whitelist is non-docs (fail toward full CI)', () => {
  for (const paths of nonDocsCases) {
    assert.equal(classify(paths).docsOnly, false, paths.join(','));
  }
  assert.equal(isDocsPath('docs/ops/p16-capacity-gate.json'), false);
});

test('classify lists only non-docs paths and treats empty input as non-docs', () => {
  assert.deepEqual(classify(['README.md', 'frontend/src/a.ts']), { docsOnly: false, nonDocs: ['frontend/src/a.ts'] });
  assert.equal(classify([]).docsOnly, false);
  assert.equal(classify(['']).docsOnly, false);
  assert.equal(classify(['', '  ']).docsOnly, false);
  assert.equal(classify(['  ']).docsOnly, false);
  assert.equal(classify(['README.md', '']).docsOnly, true);
});

test('isDocsPath and classify agree on every path', () => {
  for (const p of ['a.md', 'A.MD', 'a.md ', 'a.md\r', 'docs/x.PNG', 'docs/x.json', 'x.png']) {
    assert.equal(classify([p]).docsOnly, isDocsPath(p), JSON.stringify(p));
  }
});

test('CLI reads stdin paths and writes docs_only to GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  const run = (input, withOutput = true) => {
    const out = join(dir, `out-${Math.random()}`);
    writeFileSync(out, '');
    const env = { ...process.env };
    if (withOutput) env.GITHUB_OUTPUT = out; else delete env.GITHUB_OUTPUT;
    const r = spawnSync(process.execPath, [cli], { input, env, encoding: 'utf8' });
    return { r, file: withOutput ? readFileSync(out, 'utf8') : null };
  };
  assert.equal(run('docs/a.md\nCONTRIBUTING.md\n').file, 'docs_only=true\n');
  const mixed = run('docs/a.md\nfrontend/src/a.ts\n');
  assert.equal(mixed.file, 'docs_only=false\n');
  assert.match(mixed.r.stdout, /frontend\/src\/a\.ts/);
  assert.equal(run('').file, 'docs_only=false\n');
  assert.equal(run('scripts/x.mjs\ndocs/x.md\n').file, 'docs_only=false\n');
  const noOut = run('docs/a.md\n', false);
  assert.match(noOut.r.stdout, /docs_only=true/);
  assert.equal(noOut.r.status, 0);
});
