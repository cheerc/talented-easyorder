// E2E Auth Helper — Firebase Auth Emulator REST API
// Ref: #269

import { PROJECT } from './seed';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const API_KEY = 'dummy-api-key';

export interface EmulatorUser {
  localId: string;
  idToken: string;
  email: string;
  refreshToken: string;
}

/** Create a new user in the Auth Emulator via REST API */
export async function createEmulatorUser(email: string, password: string): Promise<EmulatorUser> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`Failed to create emulator user: ${await res.text()}`);
  return res.json() as Promise<EmulatorUser>;
}

/** Sign in an existing user via Auth Emulator REST API */
export async function signInEmulatorUser(email: string, password: string): Promise<EmulatorUser> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`Failed to sign in emulator user: ${await res.text()}`);
  return res.json() as Promise<EmulatorUser>;
}

/** Delete all users from Auth Emulator */
export async function clearEmulatorAuth(): Promise<void> {
  // The project ID must match the one used in firebase.json
  await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
  });
}
