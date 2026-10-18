import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';

import { base64UrlToBytes, utf8Decode } from './base64';
import { createCodeChallenge, randomBase64Url } from './pkce';
import {
  clearChatGptConnection,
  loadChatGptConnection,
  loadHostId,
  saveChatGptConnection,
  saveHostId,
} from './secureStore';
import {
  AiAuthError,
  connectionHasPlanSharing,
  type ChatGptConnection,
} from './types';

/**
 * Sign in with ChatGPT (OpenAI's `dynamic_agent_client` OAuth flow), adapted for
 * React Native.
 *
 * Notes on the mobile adaptation:
 *  - OpenAI requires a loopback redirect (`http://127.0.0.1:1455/auth/callback`)
 *    rather than a custom scheme. Mobile builds have no loopback HTTP server, so
 *    the sign-in WebView intercepts that navigation and hands the callback URL
 *    straight to `completeChatGptSignIn`. The URL is never actually fetched.
 *  - The ID token's RS256 signature is not verified (React Native has no WebCrypto
 *    RSA). The token arrives over TLS directly from the token endpoint, and we
 *    still validate `iss`, `aud` and `nonce`. Identity is only used to label the
 *    connection; it is never used to authorize against a Heft server.
 */

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const APP_NAME = 'Heft';
const REFRESH_SKEW_MS = 60_000;

export const CHATGPT_REDIRECT_URI = `http://127.0.0.1:1455${CALLBACK_PATH}`;

type Discovery = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
};

type TokenFields = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
};

export type ChatGptSignInAttempt = {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
};

export type ChatGptSessionInfo = {
  connected: boolean;
  email: string | null;
  name: string | null;
  planSharing: boolean;
  expiresAt: number | null;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** `URLSearchParams`-free query builder (React Native has no URL global). */
export function buildQuery(
  params: Record<string, string | undefined>
): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');
}

/** Parses an OAuth redirect URL into a map of query keys to all values. */
export function parseOAuthCallback(url: string): Record<string, string[]> {
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

  const result: Record<string, string[]> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const equals = pair.indexOf('=');
    const rawKey = equals === -1 ? pair : pair.slice(0, equals);
    const rawValue = equals === -1 ? '' : pair.slice(equals + 1);
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    (result[key] ??= []).push(value);
  }
  return result;
}

function exact(
  params: Record<string, string[]>,
  key: string
): string | null {
  const values = params[key];
  return values && values.length === 1 ? values[0] : null;
}

/** Reads claims from an ID token without verifying its signature (see header). */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AiAuthError(
      'invalid_id_token',
      'ChatGPT returned an invalid identity token.'
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(base64UrlToBytes(parts[1])));
  } catch {
    throw new AiAuthError(
      'invalid_id_token',
      'ChatGPT returned an invalid identity token.'
    );
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new AiAuthError(
      'invalid_id_token',
      'ChatGPT returned an invalid identity token.'
    );
  }
  return record;
}

let discoveryPromise: Promise<Discovery> | null = null;

async function discovery(): Promise<Discovery> {
  discoveryPromise ??= (async () => {
    let response: Awaited<ReturnType<typeof expoFetch>>;
    try {
      response = await expoFetch(`${ISSUER}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new AiAuthError(
        'discovery_failed',
        'Could not reach ChatGPT sign-in. Check your connection and try again.',
        true
      );
    }

    const data = response.ok ? await response.json().catch(() => null) : null;
    const record = asRecord(data);
    if (!record || record.issuer !== ISSUER) {
      throw new AiAuthError(
        'discovery_failed',
        'ChatGPT sign-in configuration could not be verified.',
        true
      );
    }

    const endpoint = (key: string, required: boolean): string | null => {
      const value = record[key];
      if (typeof value !== 'string' || !value.startsWith(`${ISSUER}/`)) {
        if (required) {
          throw new AiAuthError(
            'discovery_failed',
            'ChatGPT sign-in configuration could not be verified.',
            true
          );
        }
        return null;
      }
      return value;
    };

    return {
      authorizationEndpoint: endpoint('authorization_endpoint', true)!,
      tokenEndpoint: endpoint('token_endpoint', true)!,
      revocationEndpoint: endpoint('revocation_endpoint', false),
    };
  })().catch((error: unknown) => {
    discoveryPromise = null;
    throw error;
  });

  return discoveryPromise;
}

function describeTokenError(data: unknown, status: number): string {
  const record = asRecord(data);
  const code = record && typeof record.error === 'string' ? record.error : null;
  switch (code) {
    case 'invalid_grant':
      return 'ChatGPT sign-in was rejected or the code expired. Please try again.';
    case 'access_denied':
      return 'ChatGPT access was denied.';
    case 'invalid_client':
      return 'ChatGPT did not recognize this app registration. Please try again.';
    default:
      return `ChatGPT could not complete sign-in (HTTP ${status}). Please try again.`;
  }
}

async function requestToken(
  endpoint: string,
  fields: Record<string, string>
): Promise<Record<string, unknown>> {
  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: buildQuery(fields),
    });
  } catch {
    throw new AiAuthError(
      'network_error',
      'Could not reach ChatGPT. Check your connection and try again.',
      true
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AiAuthError(
      'token_request_failed',
      describeTokenError(data, response.status),
      response.status >= 500 || response.status === 429
    );
  }

  const record = asRecord(data);
  if (!record) {
    throw new AiAuthError(
      'invalid_token_response',
      'ChatGPT returned an invalid token response. Please sign in again.'
    );
  }
  return record;
}

function readTokenFields(data: Record<string, unknown>): TokenFields {
  const accessToken =
    typeof data.access_token === 'string' ? data.access_token : '';
  const tokenType =
    typeof data.token_type === 'string' ? data.token_type.toLowerCase() : '';
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : NaN;

  if (
    !accessToken ||
    tokenType !== 'bearer' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new AiAuthError(
      'invalid_token_response',
      'ChatGPT returned incomplete credentials. Please sign in again.'
    );
  }

  return {
    accessToken,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : null,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: (typeof data.scope === 'string' ? data.scope : '')
      .split(/\s+/)
      .filter(Boolean),
  };
}

async function getHostId(): Promise<string> {
  const existing = await loadHostId();
  if (existing) return existing;
  const id = `urn:uuid:${Crypto.randomUUID()}`;
  await saveHostId(id);
  return id;
}

function assertIdentityClaims(
  claims: Record<string, unknown>,
  clientId: string,
  nonce: string
): void {
  if (claims.iss !== ISSUER) {
    throw new AiAuthError('invalid_id_token', 'ChatGPT returned an untrusted identity.');
  }
  const audience = claims.aud;
  const audienceMatches =
    typeof audience === 'string'
      ? audience === clientId
      : Array.isArray(audience) && audience.includes(clientId);
  if (!audienceMatches || claims.nonce !== nonce) {
    throw new AiAuthError(
      'invalid_id_token',
      'The ChatGPT identity did not match this request. Please sign in again.'
    );
  }
}

/** Prepares the authorization URL and PKCE material for the sign-in WebView. */
export async function beginChatGptSignIn(): Promise<ChatGptSignInAttempt> {
  const provider = await discovery();
  const state = await randomBase64Url();
  const nonce = await randomBase64Url();
  const verifier = await randomBase64Url();
  const codeChallenge = await createCodeChallenge(verifier);
  const hostId = await getHostId();
  const existing = await loadChatGptConnection();

  const query = buildQuery({
    client_id: existing?.clientId ?? 'dynamic_agent_client',
    response_type: 'code',
    redirect_uri: CHATGPT_REDIRECT_URI,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    ext_agent_host_id: hostId,
    ...(existing?.clientId ? {} : { agent_name_hint: APP_NAME }),
    ...(existing?.email ? { login_hint: existing.email } : {}),
  });

  return {
    authorizationUrl: `${provider.authorizationEndpoint}?${query}`,
    redirectUri: CHATGPT_REDIRECT_URI,
    state,
    nonce,
    verifier,
  };
}

/** Exchanges the intercepted callback URL for tokens and persists the account. */
export async function completeChatGptSignIn(
  attempt: ChatGptSignInAttempt,
  callbackUrl: string
): Promise<ChatGptConnection> {
  const params = parseOAuthCallback(callbackUrl);

  if (exact(params, 'state') !== attempt.state) {
    throw new AiAuthError(
      'state_mismatch',
      'Sign-in could not be verified. Please try again.'
    );
  }

  const error = exact(params, 'error');
  if (error) {
    throw new AiAuthError(
      'authorization_denied',
      error === 'access_denied'
        ? 'ChatGPT sign-in was cancelled.'
        : `ChatGPT returned an error: ${error}.`
    );
  }

  const code = exact(params, 'code');
  const returnedClientId = exact(params, 'client_id');
  const existing = await loadChatGptConnection();
  const clientId = returnedClientId ?? existing?.clientId ?? null;

  if (
    !code ||
    !clientId ||
    clientId === 'dynamic_agent_client' ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId)
  ) {
    throw new AiAuthError(
      'registration_incomplete',
      'ChatGPT did not finish registering Heft. Please try again.'
    );
  }
  if (returnedClientId && existing?.clientId && returnedClientId !== existing.clientId) {
    throw new AiAuthError(
      'client_mismatch',
      'ChatGPT returned an unexpected app registration. Please try again.'
    );
  }

  const provider = await discovery();
  const data = await requestToken(provider.tokenEndpoint, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: attempt.verifier,
    redirect_uri: attempt.redirectUri,
    resource: RESOURCE,
  });

  const idToken = typeof data.id_token === 'string' ? data.id_token : null;
  if (!idToken) {
    throw new AiAuthError(
      'invalid_id_token',
      'ChatGPT did not return a verifiable identity.'
    );
  }
  const claims = decodeJwtClaims(idToken);
  assertIdentityClaims(claims, clientId, attempt.nonce);
  const fields = readTokenFields(data);

  const connection: ChatGptConnection = {
    clientId,
    ...fields,
    subject: typeof claims.sub === 'string' ? claims.sub : null,
    email: typeof claims.email === 'string' ? claims.email : null,
    name: typeof claims.name === 'string' ? claims.name : null,
    savedAt: new Date().toISOString(),
  };

  await saveChatGptConnection(connection);
  return connection;
}

/** Renews the access token (or throws `sign_in_required` when it cannot). */
export async function refreshChatGptConnection(
  connection: ChatGptConnection
): Promise<ChatGptConnection> {
  if (!connection.refreshToken) {
    throw new AiAuthError(
      'sign_in_required',
      'Your ChatGPT connection has expired. Please sign in again.'
    );
  }

  const provider = await discovery();
  const data = await requestToken(provider.tokenEndpoint, {
    grant_type: 'refresh_token',
    client_id: connection.clientId,
    refresh_token: connection.refreshToken,
    resource: RESOURCE,
  });

  const fields = readTokenFields({
    ...data,
    scope:
      typeof data.scope === 'string'
        ? data.scope
        : connection.scopes.join(' '),
  });

  const next: ChatGptConnection = {
    ...connection,
    ...fields,
    refreshToken: fields.refreshToken ?? connection.refreshToken,
    savedAt: new Date().toISOString(),
  };
  await saveChatGptConnection(next);
  return next;
}

/** Returns a currently-valid access token, refreshing first when needed. */
export async function getChatGptAccessToken(): Promise<string> {
  let connection = await loadChatGptConnection();
  if (!connection) {
    throw new AiAuthError(
      'sign_in_required',
      'Sign in with ChatGPT to use the assistant.'
    );
  }
  if (connection.expiresAt <= Date.now() + REFRESH_SKEW_MS) {
    connection = await refreshChatGptConnection(connection);
  }
  return connection.accessToken;
}

export async function getChatGptSessionInfo(): Promise<ChatGptSessionInfo> {
  const connection = await loadChatGptConnection();
  if (!connection) {
    return { connected: false, email: null, name: null, planSharing: false, expiresAt: null };
  }
  return {
    connected: true,
    email: connection.email,
    name: connection.name,
    planSharing: connectionHasPlanSharing(connection),
    expiresAt: connection.expiresAt,
  };
}

/** Removes local credentials and best-effort revokes the session remotely. */
export async function disconnectChatGpt(): Promise<void> {
  const connection = await loadChatGptConnection();
  await clearChatGptConnection();

  if (!connection?.refreshToken) return;

  try {
    const provider = await discovery();
    if (!provider.revocationEndpoint) return;
    await expoFetch(provider.revocationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: buildQuery({
        token: connection.refreshToken,
        token_type_hint: 'refresh_token',
        client_id: connection.clientId,
      }),
    });
  } catch {
    // Local credentials are already gone; remote revocation is best-effort.
  }
}
