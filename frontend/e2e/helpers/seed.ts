// E2E Firestore Data Seeder — uses Firestore Emulator REST API
// Ref: #269

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
export const PROJECT = process.env.FIREBASE_PROJECT_ID || 'demo-easyorder';


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
    headers: { 'Content-Type': 'application/json' },
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

export async function seedOperator(uid: string, email: string, role: string = 'admin'): Promise<void> {
  await createDoc('operators', uid, {
    uid,
    email,
    displayName: email.split('@')[0],
    role,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
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
  await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
}
