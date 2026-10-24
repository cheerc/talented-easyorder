/**
 * Writes the synthetic R02 backup chain (three encrypted P14 packages and chain.json) into a directory, so that anyone can
 * follow the Emulator drill of docs/ops/firebase-restore-runbook.md. It is a tool, not a gate: it does nothing unless
 * EASYORDER_P15_FIXTURE_DIR names the output directory. Synthetic data only; the password is the fixed text below.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { describe, expect, it } from 'vitest';
import { generateR02Fixture } from './helpers/r02Scenario';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const outputDir = process.env.EASYORDER_P15_FIXTURE_DIR;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const rulesPath = path.resolve(process.cwd(), '../firestore.rules');

const DRILL_FIXTURE_PASSWORD = 'p15-fixture-password';

describe.skipIf(!outputDir || !emulatorHost)('P15d drill fixture generator (opt-in tool)', () => {
  it('writes the synthetic chain and its three packages into EASYORDER_P15_FIXTURE_DIR', async () => {
    const env = await initializeTestEnvironment({
      projectId: 'demo-easyorder', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(rulesPath, 'utf8') },
    });
    try {
      const fixture = await generateR02Fixture({ env, dir: path.resolve(outputDir!), password: DRILL_FIXTURE_PASSWORD });
      expect(fixture.packages).toHaveLength(3);
    } finally {
      await env.cleanup();
    }
  }, 180_000);
});
