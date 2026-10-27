#!/usr/bin/env node
// Exercise the generated service worker against an actual navigation endpoint.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Supply the built public directory');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__/auth/handler') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<title>OAuth network endpoint</title>');
  }
  try {
    const name = url.pathname === '/' ? '/index.html' : url.pathname;
    const body = await readFile(path.join(publicDir, name));
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { chromium } = createRequire(path.join(root, 'frontend/package.json'))('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
  await page.goto(`${origin}/__/auth/handler?synthetic=1`);
  assert.equal(await page.title(), 'OAuth network endpoint', 'OAuth navigation must reach the server');
  console.log('PASS: controlled OAuth navigation reaches the server');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
