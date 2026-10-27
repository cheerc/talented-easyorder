#!/usr/bin/env node
// Local demo Hosting only. This must never be reused to claim production smoke evidence.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkRelease } from './lib/release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[2] !== '--release' || !process.argv[3] || process.argv.length !== 4) throw new Error('需要 --release <demo release>');
const release = await checkRelease(path.resolve(process.argv[3]));
assert.equal(release.emulator, true);
assert.equal(release.project, 'demo-easyorder');
const origin = 'http://127.0.0.1:5080';
const home = await fetch(`${origin}/`);
assert.equal(home.status, 200);
assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.equal(home.headers.get('x-frame-options'), 'DENY');
assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
assert.match(home.headers.get('cache-control'), /no-cache/);
const html = await home.text();
const spa = await fetch(`${origin}/p17/nested-route`);
assert.equal(await spa.text(), html);
assert.match(spa.headers.get('cache-control'), /no-cache/);
assert.match((await fetch(`${origin}/sw.js`)).headers.get('cache-control'), /no-cache/);
const asset = /(?:src|href)="(\/assets\/[^" ]+\.js)"/.exec(html)?.[1];
assert.ok(asset);
assert.match((await fetch(`${origin}${asset}`)).headers.get('cache-control'), /immutable/);
assert.ok(!Object.keys(release.files).some(name => name.endsWith('.map')));

const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
try {
  const context = await browser.newContext(); // CSP is enforced; no bypassCSP.
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__p17CspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__p17CspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`));
  });
  await page.goto(`${origin}/p17/nested-route`);
  await page.getByRole('button', { name: '使用 Google 登入', exact: true }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.evaluate(() => window.__p17CspViolations), []);
  assert.deepEqual(errors, []);
  await context.close();
} finally { await browser.close(); }
process.stdout.write('P17 demo Hosting smoke PASS: SPA, headers, cache, no source maps, signed-out app, enforced CSP; production OAuth/index/billing UNVERIFIED.\n');
