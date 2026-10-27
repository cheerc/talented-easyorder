import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { expect, it } from 'vitest';
import { createFirestoreRest, resolveTarget } from '../firestoreRest';
import { planEmptyActivation } from '../activateEmpty';

it.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('P17: a stale head rejects the whole activation without a partial operator or lease', async () => {
  const project = 'demo-easyorder';
  const env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('../firestore.rules', 'utf8') } });
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'anonymous-p17', seq: 0, lastCommandId: null, maintenance: true, goLiveDate: '2026-10-25', updatedAt: Timestamp.now(),
    }));
    const rest = createFirestoreRest(resolveTarget(project, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), fetch);
    const plan = await planEmptyActivation(rest, [{ uid: 'p17-synthetic', email: 'p17@example.test' }], { _type: 'timestamp', seconds: 1, nanoseconds: 0 });
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'system/dataHead'), { updatedAt: Timestamp.now() }));
    await expect(rest.commit(plan.writes)).rejects.toThrow();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDocs(collection(db, 'operators'))).empty).toBe(true);
      expect((await getDoc(doc(db, 'system/accessLease'))).exists()).toBe(false);
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.maintenance).toBe(true);
    });
  } finally { await env.cleanup(); }
}, 30_000);
