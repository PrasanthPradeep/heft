import * as Crypto from 'expo-crypto';

import { base64ToBase64Url, bytesToBase64Url } from './base64';

/** Cryptographically random base64url string, used for PKCE/state/nonce. */
export async function randomBase64Url(byteCount = 32): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(byteCount);
  return bytesToBase64Url(bytes);
}

/** PKCE S256 challenge: base64url(SHA-256(verifier)). */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return base64ToBase64Url(digest);
}
