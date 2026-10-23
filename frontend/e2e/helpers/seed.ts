// E2E Firestore Data Seeder — uses Firestore Emulator REST API
// Ref: #269

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
export const PROJECT = 'demo-easyorder';

export interface EmulatorAccessLease {
  holderUid: string | null;
  epoch: number;
  updatedAt: Date;
}


function toFirestoreValue(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function toFirestoreDoc(data: Record<string, unknown>): { fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

async function createDoc(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?documentId=${docId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner',
    },
    body: JSON.stringify(toFirestoreDoc(data)),
  });
  if (!res.ok) {
    const text = await res.text();
    // Ignore ALREADY_EXISTS — doc may already be seeded
    if (!text.includes('ALREADY_EXISTS')) {
      throw new Error(`Failed to create ${collection}/${docId}: ${text}`);
    }
  }
}

async function patchDoc(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
  const mask = new URLSearchParams();
  for (const field of Object.keys(data)) mask.append('updateMask.fieldPaths', field);
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${docId}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body: JSON.stringify(toFirestoreDoc(data)),
  });
  if (!res.ok) throw new Error(`Failed to update ${collection}/${docId}: ${await res.text()}`);
}

/**
 * Demo Emulator only. A lease reseed rewinds `epoch` outside the transaction path, so event documents
 * numbered above the new epoch would turn the next acquire (which creates `accessEvents/{epoch + 1}`) into
 * an update that the Rules deny. Remove them whenever the seed lowers or resets the epoch.
 */
async function purgeAccessEventsAbove(epoch: number): Promise<void> {
  const base = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/accessEvents`;
  const res = await fetch(`${base}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`Failed to list accessEvents: ${await res.text()}`);
  const body = await res.json() as { documents?: Array<{ name: string }> };
  for (const document of body.documents ?? []) {
    const id = document.name.split('/').pop() ?? '';
    if (Number(id) > epoch) await removeDocument('accessEvents', id);
  }
}

/** Demo Emulator only: create or update the given fields of one document through the Admin REST route. */
export async function upsertDocument(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
  await patchDoc(collection, docId, data);
  if (collection === 'system' && docId === 'accessLease' && typeof data.epoch === 'number') {
    await purgeAccessEventsAbove(data.epoch);
  }
}

/** Demo Emulator only: remove one document through the Admin REST route (missing documents are fine). */
export async function removeDocument(collection: string, docId: string): Promise<void> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`,
    { method: 'DELETE', headers: { Authorization: 'Bearer owner' } },
  );
  if (!res.ok) throw new Error(`Failed to delete ${collection}/${docId}: ${await res.text()}`);
}

function operatorData(uid: string, email: string, active: boolean, role: string): Record<string, unknown> {
  return {
    uid,
    email,
    displayName: email.split('@')[0],
    role,
    active,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

export async function seedOperator(
  uid: string,
  email: string,
  role: string = 'admin',
  active = true,
): Promise<void> {
  await createDoc('operators', uid, operatorData(uid, email, active, role));
}

export async function setOperatorActive(uid: string, active: boolean): Promise<void> {
  await patchDoc('operators', uid, { active, updatedAt: new Date() });
}

export async function seedInitialLease(): Promise<void> {
  await createDoc('system', 'accessLease', {
    holderUid: null,
    epoch: 0,
    updatedAt: new Date(),
  });
}

/** Admin REST seed for deliberate server-time/epoch scenarios in the Emulator only. */
export async function seedAccessLease(lease: EmulatorAccessLease): Promise<void> {
  await patchDoc('system', 'accessLease', { ...lease });
  await purgeAccessEventsAbove(lease.epoch);
}

function decodeFirestoreValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const fields = value as Record<string, unknown>;
  if ('stringValue' in fields) return fields.stringValue;
  if ('integerValue' in fields) return Number(fields.integerValue);
  if ('doubleValue' in fields) return fields.doubleValue;
  if ('booleanValue' in fields) return fields.booleanValue;
  if ('timestampValue' in fields) return new Date(String(fields.timestampValue));
  if ('nullValue' in fields) return null;
  return undefined;
}

/** Read authoritative holder/epoch/time through the Emulator's admin REST route. */
export async function readAccessLease(): Promise<EmulatorAccessLease> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/system/accessLease`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  if (!res.ok) throw new Error(`Failed to read system/accessLease: ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, unknown> };
  const fields = body.fields ?? {};
  const holderUid = decodeFirestoreValue(fields.holderUid);
  const epoch = decodeFirestoreValue(fields.epoch);
  const updatedAt = decodeFirestoreValue(fields.updatedAt);
  if (!(updatedAt instanceof Date) || typeof epoch !== 'number') {
    throw new Error('system/accessLease has an invalid Emulator REST shape');
  }
  return {
    holderUid: typeof holderUid === 'string' ? holderUid : null,
    epoch,
    updatedAt,
  };
}

/** Authenticated REST request used to verify that non-Google identities are denied by Rules. */
export async function readLeaseWithIdToken(idToken: string): Promise<Response> {
  return fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/system/accessLease`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
}

export async function seedStudent(studentId: string, name: string, balance: number): Promise<void> {
  await createDoc('students', studentId, {
    id: studentId,
    displayName: name,
    aliases: [],
    className: null,
    groupName: null,
    openingBalance: balance,
    currentBalance: balance,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'seed',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: 'seed',
    revision: 1,
    lastTransactionId: null,
  });
}

export async function seedTodayMenu(itemName: string, price: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await createDoc('today_menus', today, {
    itemName,
    price,
    vendorId: 'v-seed',
    vendorNameSnapshot: '測試供應商',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function clearFirestoreData(): Promise<void> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`Failed to clear Firestore Emulator data: ${await res.text()}`);
}
