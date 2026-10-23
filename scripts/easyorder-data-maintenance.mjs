#!/usr/bin/env node
// Launcher of the data-maintenance CLI. It only checks the runtime, teaches Node to find the app's extensionless
// TypeScript imports, and hands over to frontend/src/maintenance/cli.ts, which uses the same backup validation
// code as the app. Run `npm ci` in frontend/ first; this script adds no dependency of its own.
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT_ENVIRONMENT = 69;
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  process.stderr.write(`需要 Node 22.18 以上（建議 24）；目前是 ${process.versions.node}。\n`);
  process.exit(EXIT_ENVIRONMENT);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(resolve(root, 'frontend/node_modules/firebase'))) {
  process.stderr.write('找不到 frontend/node_modules；請先在 frontend/ 執行 npm ci。\n');
  process.exit(EXIT_ENVIRONMENT);
}

register('./lib/ts-extension-hook.mjs', import.meta.url);
const { main } = await import(pathToFileURL(resolve(root, 'frontend/src/maintenance/cli.ts')).href);
const { createNodeIo } = await import(pathToFileURL(resolve(root, 'frontend/src/maintenance/nodeIo.ts')).href);
process.exitCode = await main(process.argv.slice(2), createNodeIo());
