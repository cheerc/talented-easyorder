// E2E Global Setup — runs before all Playwright tests
// Creates test users in Auth Emulator and seeds Firestore data
// Ref: #269

import { clearEmulatorAuth, createEmulatorUser } from './helpers/auth';
import { clearFirestoreData, seedOperator, seedStudent, seedTodayMenu } from './helpers/seed';

export default async function globalSetup() {
  console.log('[e2e] Global setup: clearing emulator state...');
  await clearEmulatorAuth();
  await clearFirestoreData();

  console.log('[e2e] Global setup: creating test operator...');
  const user = await createEmulatorUser('test@talented.com.tw', 'test1234');
  await seedOperator(user.localId, 'test@talented.com.tw', 'admin');

  console.log('[e2e] Global setup: seeding test data...');
  await seedStudent('S001', '王小明', 1000);
  await seedStudent('S002', '李小華', 500);
  await seedTodayMenu('雞腿便當', 80);

  console.log('[e2e] Global setup complete.');
}
