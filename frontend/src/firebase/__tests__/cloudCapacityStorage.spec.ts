// @ts-expect-error Node-only file access loads the real Rules, the index file and the checked-in footprints.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, collectionGroup, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentFootprint, type IndexConfig } from '../../maintenance/capacityModel';
import { acquireLease, releaseLease } from '../activeAccountLease';
import { createCloudBackupCommandRepository } from '../cloudBackupCommandRepository';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';
import { createCloudOrderRepository } from '../cloudOrderRepository';
import { createCloudReportActionRepository } from '../cloudReportActionRepository';
import { buildKindSteps, type KindScenarioDeps } from './helpers/kindScenario';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, uuid } from './helpers/r02Scenario';

/**
 * P16e storage footprints: what every committed command adds to the database, in bytes, by the official size formulas
 * (`maintenance/capacityModel.ts`: Firestore storage-size page) applied to the documents the production writer really creates on
 * the real Rules, with the index entries of the checked-in `firestore.indexes.json`. The 27 command kinds run the same steps as
 * the P16b matrix and the P16d table; each step's footprint is the documents it created (a document it only updated is already
 * counted where it was created). The lease events come from the production lease functions. The result must equal the checked-in
 * `docs/ops/p16-storage-footprints.json`; the gate (`maintenance/capacityGate.ts`) projects two years from it.
 */
declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_CAPACITY === 'true';
if (required && !emulatorHost) throw new Error('P16e storage footprints require FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');
/** Where to write the footprints this run measured (to regenerate the checked-in file); unset in CI. */
const writeFootprintsPath = process.env.EASYORDER_P16_WRITE_FOOTPRINTS;
const footprintsFile = `${process.cwd()}/../docs/ops/p16-storage-footprints.json`;
const indexesFile = `${process.cwd()}/../firestore.indexes.json`;

const OP = R02_OPERATOR;
const COLLECTIONS = ['commands', 'transactions', 'days', 'students', 'studentCodes', 'vendors', 'accessEvents', 'backfillDays', 'postCloseEntries'];

interface Created { collection: string; documentBytes: number; indexBytes: number }
interface Profile {
  /** The documents each command kind created, sized. */
  kinds: Record<string, Created[]>;
  /** One lease event (`accessEvents`) of an acquire and of a release. */
  leaseEvents: { acquire: Created[]; release: Created[] };
  /** The largest command document of all 27 kinds (the limit is 64 KiB with its before/after). */
  maxCommand: { kind: string; documentBytes: number };
}
interface Footprints {
  schemaVersion: 1;
  /** The student of the steps has one alias of three characters: what a roster typically holds. */
  typical: Profile;
  /** The student has the most the Rules allow, ten aliases of 100 characters (it is also the profile of the Rules budget). */
  worst: Profile;
  /** The top-level fields of the documents of each collection (the union over everything created): `indexCoverage.test.ts` checks that every one is indexed on purpose. */
  fields: Record<string, string[]>;
}
const PROFILES: Array<{ name: 'typical' | 'worst'; aliases?: (char: string) => string[] }> = [
  { name: 'typical', aliases: char => [char.repeat(3)] },
  { name: 'worst' },
];

let env: RulesTestEnvironment;
let app: Firestore;
let epoch = R02_LEASE_EPOCH;
let nextId = 30_000;
const id = () => uuid(++nextId);

function dbFor(identity: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(identity.uid, {
    email: identity.email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}
async function admin<T>(run: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async context => { result = await run(context.firestore() as unknown as Firestore); });
  return result;
}
const adminData = (path: string) => admin(async db => (await getDoc(doc(db, path))).data());

/** Every document of the collections the Rules allow, by path. */
const snapshotAll = () => admin(async db => {
  const found = new Map<string, Record<string, unknown>>();
  for (const name of COLLECTIONS) {
    for (const item of (await getDocs(collection(db, name))).docs) found.set(item.ref.path, item.data());
  }
  for (const item of (await getDocs(collectionGroup(db, 'settlements'))).docs) found.set(item.ref.path, item.data());
  return found;
});

const normalized = (path: string) => (/^days\/[^/]+\/settlements\//.test(path) ? 'days/*/settlements' : path.split('/')[0]!);

describeWithEmulator('P16e storage footprints: what each command adds to the database', () => {
  const user = operatorUser();
  const current = { currentUser: () => user };
  const indexes = JSON.parse(readFileSync(indexesFile, 'utf8') as string) as IndexConfig;
  const emptyProfile = (): Profile => ({ kinds: {}, leaseEvents: { acquire: [], release: [] }, maxCommand: { kind: '', documentBytes: 0 } });
  const measured: Footprints = { schemaVersion: 1, typical: emptyProfile(), worst: emptyProfile(), fields: {} };
  const fieldSets = new Map<string, Set<string>>();

  const setBase = (patch: Record<string, unknown> = {}) => admin(async db => {
    await setDoc(doc(db, `operators/${OP.uid}`), { ...OP });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: OP.uid, epoch, updatedAt: Timestamp.now(), ...patch });
  });
  const created = async (before: Map<string, Record<string, unknown>>): Promise<Created[]> => {
    const after = await snapshotAll();
    const added: Created[] = [];
    for (const [path, data] of after) {
      if (before.has(path)) continue;
      const footprint = documentFootprint({ path, data }, indexes);
      const names = fieldSets.get(normalized(path)) ?? new Set<string>();
      for (const name of Object.keys(data)) names.add(name);
      fieldSets.set(normalized(path), names);
      added.push({ collection: normalized(path), ...footprint });
    }
    // a stable order, so that the file does not change from run to run
    return added.sort((a, b) => a.collection.localeCompare(b.collection) || a.documentBytes - b.documentBytes || a.indexBytes - b.indexBytes);
  };
  const ok = (result: { ok: boolean }, label: string) => {
    if (!result.ok) throw new Error(`P16e scenario: ${label} failed ${JSON.stringify(result)}`);
  };
  const read = async (path: string) => (await adminData(path)) as Record<string, number & string>;
  const headSeq = async () => (await read('system/dataHead')).seq as number;
  const revisions = async (studentId: string, dayId: string) => ({
    student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${dayId}`)).revision,
  });

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(`${process.cwd()}/../firestore.rules`, 'utf8') },
    });
    app = dbFor(OP);
  }, 180_000);
  afterAll(async () => { await env.cleanup(); });

  for (const profile of PROFILES) {
    const result = measured[profile.name];
    it(`${profile.name}: sizes the documents every command kind creates`, async () => {
      await seedEmptySource(env, `anonymous-p16e-storage-${profile.name}`);
      epoch = R02_LEASE_EPOCH;
      const deps: KindScenarioDeps = {
        writer: createCloudCommandRepository(app, current),
        orders: createCloudOrderRepository(app, current),
        closing: createCloudDayCloseRepository(app, current),
        backups: createCloudBackupRepository(app, { currentUid: () => OP.uid }),
        backupReceipts: createCloudBackupCommandRepository(app, current),
        reports: createCloudReportActionRepository(app, current),
        get epoch() { return epoch; },
        backupPassword: 'p16e-storage-password',
        ...(profile.aliases ? { aliases: profile.aliases } : {}),
        read, id, ok, headSeq, revisions,
      };
      for (const step of buildKindSteps(deps)) {
        await setBase();
        if (step.setup) await step.setup();
        const before = await snapshotAll();
        ok(await step.run() as { ok: boolean }, step.kind);
        localStorage.clear();
        const added = await created(before);
        expect(added.filter(item => item.collection === 'commands'), `${step.kind} creates one command`).toHaveLength(1);
        result.kinds[step.kind] = added;
        for (const item of added) {
          if (item.collection === 'commands' && item.documentBytes > result.maxCommand.documentBytes) result.maxCommand = { kind: step.kind, documentBytes: item.documentBytes };
        }
      }
      expect(Object.keys(result.kinds)).toHaveLength(27);
    }, 600_000);

    it(`${profile.name}: sizes the access events of a lease acquire and release`, async () => {
      await setBase({ holderUid: null });
      let at = (await read('system/accessLease')).epoch as number;
      let before = await snapshotAll();
      expect((await acquireLease(app, OP.uid, at, OP.email)).status).toBe('acquired');
      result.leaseEvents.acquire = await created(before);
      at = (await read('system/accessLease')).epoch as number;
      before = await snapshotAll();
      expect(await releaseLease(app, OP.uid, at, OP.email)).toBe(true);
      result.leaseEvents.release = await created(before);
      expect(result.leaseEvents.acquire.map(item => item.collection)).toEqual(['accessEvents']);
      expect(result.leaseEvents.release.map(item => item.collection)).toEqual(['accessEvents']);
    }, 60_000);
  }

  it('keeps every command document under 64 KiB, and equals the checked-in footprints', () => {
    for (const profile of PROFILES) expect(measured[profile.name].maxCommand.documentBytes, profile.name).toBeLessThan(64 * 1024);
    measured.fields = Object.fromEntries([...fieldSets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, names]) => [name, [...names].sort()]));
    if (writeFootprintsPath) writeFileSync(writeFootprintsPath, `${JSON.stringify(measured, null, 2)}\n`);
    const checkedIn = JSON.parse(readFileSync(footprintsFile, 'utf8') as string) as Footprints;
    expect(measured).toEqual(checkedIn);
  });
});
