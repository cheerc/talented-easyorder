#!/usr/bin/env node
// Uses a built demo release and a synthetic auth domain; no real OAuth credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const release = path.resolve(process.argv[2] ?? '');
const config = JSON.parse(await readFile(path.join(release, 'firebase.json'), 'utf8'));
const html = await readFile(path.join(release, 'public/index.html'), 'utf8');
const policy = config.hosting.headers.find(h => h.source === '**').headers.find(h => h.key === 'Content-Security-Policy').value;
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': policy });
  // Retain the built meta CSP while avoiding app scripts; test the two enforced policies together.
  res.end(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const browser = await require('playwright').chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('https://auth.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: '<p>synthetic auth iframe</p>'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => {
    window.cspBlocked = [];
    document.addEventListener('securitypolicyviolation', e => window.cspBlocked.push(e.blockedURI));
    const frame = document.createElement('iframe');
    frame.src = 'https://auth.example.test/__/auth/iframe';
    document.body.appendChild(frame);
  });
  try {
    await page.frameLocator('iframe').getByText('synthetic auth iframe').waitFor({timeout: 5000});
  } catch {
    assert.deepEqual(await page.evaluate(() => window.cspBlocked), [], 'CSP blocked the configured auth iframe');
    throw new Error('configured auth iframe did not load');
  }
  assert.deepEqual(await page.evaluate(() => window.cspBlocked), []);
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.src = 'https://other.example.test/';
    document.body.appendChild(frame);
  });
  await page.waitForFunction(() => window.cspBlocked.includes('https://other.example.test'));
  process.stdout.write('PASS: configured auth iframe loads and unrelated iframe is blocked with both CSP policies enforced\n');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
