// E2E Global Setup — runs before all Playwright tests
// Creates test users in Auth Emulator and seeds Firestore data
// Ref: #269

import { clearEmulatorAuth, createGoogleEmulatorUser, E2E_IDENTITIES } from './helpers/auth';
import { clearFirestoreData, seedInitialLease, seedOperator, seedStudent, seedTodayMenu } from './helpers/seed';

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

  console.log('[e2e] Global setup: seeding test data...');
  await seedStudent('S001', 'E2E Student One', 1000);
  await seedStudent('S002', 'E2E Student Two', 500);
  await seedTodayMenu('雞腿便當', 80);

  console.log('[e2e] Global setup complete.');
}
