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
  const required = [
    'playwright.config.ts', 'playwright.p12c.config.ts', 'playwright.prototype.config.ts',
    'playwright.p13a.config.ts', 'playwright.p13a-dev.config.ts', 'playwright.p13a-no-config.config.ts',
    'playwright.p13b1.config.ts', 'playwright.p13b2.config.ts', 'playwright.keyboard.config.ts',
  ].sort();
  const actual = [...workflow.matchAll(/^\s+- config: (playwright(?:\.[\w-]+)?\.config\.ts)$/gm)].map(x => x[1]).sort();
  assert.deepEqual(expected, required);
  assert.deepEqual(actual, required);
  assert.match(workflow, /- config: hosting\s*$/m);
  assert.match(workflow, /fail-fast: false/);
  const shards = workflow.split('  e2e-shards:\n')[1]?.split('  e2e:\n')[0] ?? '';
  const aggregate = workflow.split('  e2e:\n')[1] ?? '';
  assert.match(shards, /needs: change-scope/);
  assert.doesNotMatch(shards, /needs:.*build-and-test/);
  assert.match(shards, /needs\.change-scope\.outputs\.docs_only == 'false'/);
  assert.match(shards, /firebase emulators:exec --project demo-easyorder --only auth,firestore/);
  assert.match(aggregate, /needs: \[change-scope, e2e-shards\]/);
  assert.match(aggregate, /if: always\(\)/);
  assert.match(aggregate, /node --test scripts\/__tests__\/e2e-ci\.test\.mjs/);
  assert.match(aggregate, /node scripts\/e2e-ci-gate\.mjs/);
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
