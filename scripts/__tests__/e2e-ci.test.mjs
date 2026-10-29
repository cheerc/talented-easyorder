import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../../frontend/package.json', import.meta.url), 'utf8'));
const gate = fileURLToPath(new URL('../e2e-ci-gate.mjs', import.meta.url));

test('CI runs every existing Playwright configuration and Hosting smoke in isolated shards', () => {
  const script = pkg.scripts['test:e2e'];
  const expected = ['playwright.config.ts', ...script.matchAll(/--config\s+(playwright\.[\w-]+\.config\.ts)/g)].map(x => typeof x === 'string' ? x : x[1]).sort();
  const actual = [...workflow.matchAll(/^\s+- config: (playwright[^\s]+\.config\.ts)$/gm)].map(x => x[1]).sort();
  assert.deepEqual(actual, expected);
  assert.match(workflow, /- config: hosting\s*$/m);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /name: playwright-report-\$\{\{ matrix\.config \}\}/);
  assert.match(workflow, /name: test-results-\$\{\{ matrix\.config \}\}/);
});

test('aggregate gate accepts only a successful full run or an explicit docs-only bypass', () => {
  const run = (...args) => spawnSync(process.execPath, [gate, ...args], { cwd: repo }).status;
  assert.equal(run('success', 'false', 'success'), 0);
  assert.equal(run('success', 'true', 'skipped'), 0);
  for (const args of [[], ['failure', 'true', 'skipped'], ['success', '', 'skipped'], ['success', 'false', 'skipped'], ['success', 'false', 'failure'], ['success', 'false', 'cancelled'], ['success', 'true', 'success']]) {
    assert.notEqual(run(...args), 0, args.join(' '));
  }
});
