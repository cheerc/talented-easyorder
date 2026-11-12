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
    'playwright.config.ts', 'playwright.p12c.config.ts',
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

test('browser shard budget leaves execution time after observed slow dependency installation', () => {
  const shards = workflow.split('  e2e-shards:\n')[1]?.split('  e2e:\n')[0] ?? '';
  const jobMinutes = Number(shards.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  // run 42058577173: browser/dependency installation was cancelled after 559s.
  // run 42055665921: npm ci 53s, PDF tools 5s, longest browser suite 238s.
  // Installation is a censored lower bound, not a guarantee of mirror latency.
  const observedInstallSeconds = 559;
  const dependencySeconds = 53 + 5;
  const longestSuiteSeconds = 238;
  const setupAndArtifactReserveSeconds = 60;
  assert.ok(Number.isFinite(jobMinutes), 'browser shards require an explicit finite job timeout');
  assert.ok(jobMinutes * 60 >= observedInstallSeconds + dependencySeconds
    + longestSuiteSeconds + setupAndArtifactReserveSeconds,
  'job budget must leave room for browser execution and cleanup after observed slow installation');
  assert.ok(jobMinutes <= 20, 'bounded CI repair must not permit jobs longer than 20 minutes');
  assert.doesNotMatch(shards, /continue-on-error:/);
});

test('aggregate gate accepts only a successful full run or an explicit docs-only bypass', () => {
  const run = (...args) => spawnSync(process.execPath, [gate, ...args], { cwd: repo }).status;
  assert.equal(run('success', 'false', 'success'), 0);
  assert.equal(run('success', 'true', 'skipped'), 0);
  for (const args of [[], ['failure', 'true', 'skipped'], ['success', '', 'skipped'], ['success', 'false', 'skipped'], ['success', 'false', 'failure'], ['success', 'false', 'cancelled'], ['success', 'true', 'success']]) {
    assert.notEqual(run(...args), 0, args.join(' '));
  }
});

test('change-scope classifies via the tested script with rename detection off', () => {
  const scope = workflow.split('  change-scope:\n')[1]?.split('  build-and-test:\n')[0] ?? '';
  assert.match(scope, /run: \|\n\s+set -o pipefail\n/);
  assert.match(scope, /git diff --name-only --no-renames /);
  assert.match(scope, /node scripts\/ci-change-scope\.mjs/);
  assert.doesNotMatch(scope, /grep -v '\^docs\/'/);
  assert.doesNotMatch(scope, /event_name }}" != "pull_request"/);
  const build = workflow.split('  build-and-test:\n')[1]?.split('  e2e-shards:\n')[0] ?? '';
  assert.match(build, /node --test \.\.\/scripts\/__tests__\/ci-change-scope\.test\.mjs/);
});

test('change-scope inherits the parent push result only on push, never on workflow_dispatch', () => {
  const scope = workflow.split('  change-scope:\n')[1]?.split('  build-and-test:\n')[0] ?? '';
  assert.match(scope, /permissions:\n\s+contents: read\n\s+actions: read\n/);
  assert.match(scope, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(scope, /node scripts\/ci-change-scope\.mjs --push --before "\$BEFORE" --parent-green /);
  assert.match(scope, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$BEFORE&event=push&status=success/);
  assert.match(scope, /git diff --name-only --no-renames "\$BEFORE" "\$GITHUB_SHA"/);
  // gh/diff failure must fail closed to full CI
  assert.match(scope, /parent_green=false/);
  assert.match(scope, /workflow_dispatch\)[\s\S]*docs_only=false/);
  const build = workflow.split('  build-and-test:\n')[1]?.split('  e2e-shards:\n')[0] ?? '';
  assert.doesNotMatch(build, /Docs-only PR detected/);
});

// Issue #674: browser/Hosting shards stalled 16-19 min in apt (`apt-get update`)
// during "Install Playwright Browsers" / "Install PDF inspection tools" until the
// 20-minute job timeout. Evidence: runs 42757108002, 42759804425, 42760681241.
// Contract: every install sub-step is its own named step, is bounded below the job
// budget, and may retry at most once (install commands only, never tests).
const shardsSection = () => workflow.split('  e2e-shards:\n')[1]?.split('  e2e:\n')[0] ?? '';
const shardSteps = () => shardsSection().split(/\n      - (?=\w+:)/).slice(1);
const stepName = (s) => s.match(/^name: (.*)$/m)?.[1] ?? '';
const stepNamed = (re) => shardSteps().find(s => re.test(stepName(s)));
const stepMinutes = (step) => Number(step?.match(/^ {8}timeout-minutes: (\d+)$/m)?.[1]);

test('apt and browser download are separate named install steps, each bounded by a step timeout', () => {
  const apt = stepNamed(/apt/i);
  const browser = stepNamed(/^Install Playwright (?:Chromium|Browsers)/i);
  assert.ok(apt, 'an apt install step must be named so a stall identifies apt, not the browser download');
  assert.ok(browser, 'the browser download must be its own named step');
  assert.notEqual(apt, browser);
  assert.doesNotMatch(shardsSection(), /playwright install [^\n]*--with-deps/,
    '--with-deps hides apt inside the browser step; use install-deps in the apt step');
  assert.match(apt, /playwright install-deps chromium/);
  assert.match(apt, /apt-get install --no-install-recommends -y poppler-utils/);
  assert.match(browser, /run: npx playwright install chromium\s*$/m);
  const jobMinutes = Number(shardsSection().match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  for (const [name, step] of [['apt', apt], ['browser', browser]]) {
    const minutes = stepMinutes(step);
    assert.ok(Number.isFinite(minutes), `${name} install step needs an explicit timeout-minutes`);
    assert.ok(minutes < jobMinutes / 2, `${name} install step timeout must stay well below the job timeout`);
  }
});

test('apt is bounded by short timeouts and at most one bounded retry of the install command', () => {
  const apt = stepNamed(/apt/i) ?? '';
  assert.match(apt, /Acquire::Retries/);
  assert.match(apt, /Acquire::http::Timeout/);
  assert.match(apt, /Acquire::https::Timeout/);
  const attempts = apt.match(/for attempt in ([\d ]+); do/)?.[1].trim().split(/\s+/).length;
  assert.equal(attempts, 2, 'exactly one retry (two attempts) of the install command');
  const perAttempt = Number(apt.match(/timeout (\d+) bash -c/)?.[1]);
  assert.ok(Number.isFinite(perAttempt), 'each attempt must run under `timeout <seconds>`');
  assert.ok(attempts * perAttempt < stepMinutes(apt) * 60, 'step timeout must cover all attempts');
  assert.match(apt, /::error::/, 'a stalled attempt must name the failing sub-step in the log');
});

// Observed on PR #680 run 42806819173 (prototype shard): attempt 1 hit `timeout 240` while the
// root apt-get child was still downloading; `timeout` only signals our own process group, so the
// orphan kept /var/lib/dpkg/lock-frontend and attempt 2 died with "Unable to acquire the dpkg
// frontend lock". A retry is only meaningful if the orphan is reaped first.
test('a timed-out apt attempt reaps the orphaned root apt-get before the retry starts', () => {
  const apt = stepNamed(/apt/i) ?? '';
  const loop = apt.slice(apt.indexOf('for attempt in'));
  const reap = loop.match(/sudo pkill [^\n]*apt-get[^\n]*/)?.[0];
  assert.ok(reap, 'failed attempts must kill the leftover apt-get that still holds the dpkg lock');
  assert.ok(loop.indexOf(reap) > loop.indexOf('timeout 240 bash -c'), 'reaping happens after the attempt');
  assert.ok(loop.indexOf(reap) < loop.indexOf('done'), 'reaping happens inside the retry loop, before the next attempt');
  assert.match(loop, /sudo dpkg --configure -a/, 'repair an interrupted dpkg state before retrying');
});

test('install steps plus observed suite budget still fit inside the job timeout', () => {
  const jobMinutes = Number(shardsSection().match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  const installMinutes = stepMinutes(stepNamed(/apt/i)) + stepMinutes(stepNamed(/^Install Playwright (?:Chromium|Browsers)/i));
  const npmCiSeconds = 53;
  const longestSuiteSeconds = 238;
  const setupAndArtifactReserveSeconds = 60;
  assert.ok(installMinutes * 60 + npmCiSeconds + longestSuiteSeconds + setupAndArtifactReserveSeconds <= jobMinutes * 60,
    'worst-case bounded install must still leave room for the longest suite');
  assert.ok(jobMinutes <= 20, 'job limit must not be raised for #674');
});

test('test steps are never retried; retries are limited to the apt install command', () => {
  const shards = shardsSection();
  const suite = stepNamed(/Run isolated browser suite/) ?? '';
  assert.match(suite, /npx playwright test/);
  assert.doesNotMatch(suite, /for attempt|retry|timeout \d+ bash/i);
  assert.doesNotMatch(shards, /--retries|nick-fields\/retry/);
});
