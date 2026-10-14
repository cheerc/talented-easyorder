// Auth Emulator helpers for synthetic Google-provider E2E accounts.
// These identities exist only in demo-easyorder's local Auth Emulator.

import { PROJECT } from './seed';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const API_KEY = 'dummy-api-key';

export const E2E_IDENTITIES = {
  operatorA: { email: 'e2e-operator-a@talented.com.tw', displayName: 'E2E Operator A' },
  operatorB: { email: 'e2e-operator-b@talented.com.tw', displayName: 'E2E Operator B' },
  inactive: { email: 'e2e-inactive-operator@talented.com.tw', displayName: 'E2E Inactive Operator' },
} as const;

export interface EmulatorGoogleUser {
  localId: string;
  idToken: string;
  email: string;
  refreshToken: string;
}

export type EmulatorPasswordUser = EmulatorGoogleUser;

function syntheticGoogleSubject(email: string): string {
  const hex = Buffer.from(email.toLowerCase(), 'utf8').toString('hex');
  return BigInt(`0x${hex}`).toString(10);
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** A deliberately synthetic, unsigned OIDC token accepted only by Auth Emulator. */
export function createSyntheticGoogleIdToken(email: string, nowMs = Date.now()): string {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = base64UrlJson({ alg: 'none', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: 'https://accounts.google.com',
    aud: PROJECT,
    sub: syntheticGoogleSubject(email),
    email,
    email_verified: true,
    name: email.split('@')[0],
    given_name: 'E2E',
    family_name: 'Operator',
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });
  return `${header}.${payload}.e2e-emulator-signature`;
}

/** Create or retrieve a Google-provider account through the Auth Emulator IdP endpoint. */
export async function createGoogleEmulatorUser(email: string): Promise<EmulatorGoogleUser> {
  const idToken = createSyntheticGoogleIdToken(email);
  const postBody = new URLSearchParams({
    providerId: 'google.com',
    id_token: idToken,
    returnSecureToken: 'true',
  }).toString();
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestUri: 'http://localhost',
        postBody,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`Failed to create Google Auth Emulator user: ${await res.text()}`);
  return res.json() as Promise<EmulatorGoogleUser>;
}

/** Delete all identities from the demo Auth Emulator before the E2E run. */
export async function clearEmulatorAuth(): Promise<void> {
  const res = await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to clear Auth Emulator users: ${await res.text()}`);
}

/**
 * Creates the legacy test email as a password user for a negative Rules assertion only.
 * Application E2E sign-in always uses GoogleAuthProvider credentials.
 */
export async function createPasswordEmulatorUserForRulesDenial(
  email: string,
  password: string,
): Promise<EmulatorPasswordUser> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`Failed to create negative password user: ${await res.text()}`);
  const user = (await res.json()) as EmulatorPasswordUser;

  const verifyRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: user.localId, emailVerified: true }),
    },
  );
  if (!verifyRes.ok) throw new Error(`Failed to verify negative password user: ${await verifyRes.text()}`);

  const signInRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!signInRes.ok) throw new Error(`Failed to sign in negative password user: ${await signInRes.text()}`);
  return signInRes.json() as Promise<EmulatorPasswordUser>;
}

export function decodeFirebaseIdTokenClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('Auth Emulator returned a malformed Firebase ID token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}
