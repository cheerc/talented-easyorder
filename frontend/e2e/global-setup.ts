// E2E Global Setup — runs before all Playwright tests
// Creates test users in Auth Emulator and seeds Firestore data
// Ref: #269

import { clearEmulatorAuth, createGoogleEmulatorUser, E2E_IDENTITIES } from './helpers/auth';
import { clearFirestoreData, PROJECT, seedInitialLease, seedOperator } from './helpers/seed';

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function seedEmptyDataHead(): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/system?documentId=dataHead`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      fields: {
        schemaVersion: { integerValue: '1' },
        datasetId: { stringValue: 'e2e-empty-p06-dataset' },
        seq: { integerValue: '0' },
        lastCommandId: { nullValue: null },
        maintenance: { booleanValue: false },
        goLiveDate: { stringValue: taipeiToday() },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  if (!res.ok) throw new Error(`Failed to initialize the empty P06 Emulator dataHead: ${await res.text()}`);
}

export default async function globalSetup() {
  console.log('[e2e] Global setup: clearing emulator state...');
  await clearEmulatorAuth();
  await clearFirestoreData();

  console.log('[e2e] Global setup: creating synthetic Google-provider operators...');
  const operatorA = await createGoogleEmulatorUser(E2E_IDENTITIES.operatorA.email);
  const operatorB = await createGoogleEmulatorUser(E2E_IDENTITIES.operatorB.email);
  const inactiveOperator = await createGoogleEmulatorUser(E2E_IDENTITIES.inactive.email);
  await seedOperator(operatorA.localId, E2E_IDENTITIES.operatorA.email, 'admin');
  await seedOperator(operatorB.localId, E2E_IDENTITIES.operatorB.email, 'admin');
  await seedOperator(inactiveOperator.localId, E2E_IDENTITIES.inactive.email, 'admin', false);
  await seedInitialLease();
  await seedEmptyDataHead();

  console.log('[e2e] Global setup complete with an empty P06 dataset; no financial students were seeded.');
}
