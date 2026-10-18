/**
 * Dependency-free base64 / base64url / UTF-8 helpers.
 *
 * React Native has no reliable `atob`/`btoa`, so the OAuth flow (PKCE and JWT
 * decoding) uses these instead. Everything here is synchronous and pure so it
 * can be unit-tested in Node.
 */

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index] ?? 0;
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);

    result += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    result += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    result += b1 === undefined ? '=' : BASE64_ALPHABET[(triplet >> 6) & 0x3f];
    result += b2 === undefined ? '=' : BASE64_ALPHABET[triplet & 0x3f];
  }
  return result;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const output = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let written = 0;

  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
  }

  return output.subarray(0, written);
}

export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  return remainder === 0
    ? normalized
    : normalized + '='.repeat(4 - remainder);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return base64ToBase64Url(bytesToBase64(bytes));
}

export function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(base64UrlToBase64(value));
}

/** Encodes a string as UTF-8 bytes without relying on TextEncoder. */
export function utf8Encode(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Decodes UTF-8 bytes into a string without relying on TextDecoder. */
export function utf8Decode(bytes: Uint8Array): string {
  let result = '';
  let index = 0;

  while (index < bytes.length) {
    const first = bytes[index];
    index += 1;

    let code: number;
    if (first < 0x80) {
      code = first;
    } else if (first < 0xe0) {
      code = ((first & 0x1f) << 6) | (bytes[index] & 0x3f);
      index += 1;
    } else if (first < 0xf0) {
      code =
        ((first & 0x0f) << 12) |
        ((bytes[index] & 0x3f) << 6) |
        (bytes[index + 1] & 0x3f);
      index += 2;
    } else {
      code =
        ((first & 0x07) << 18) |
        ((bytes[index] & 0x3f) << 12) |
        ((bytes[index + 1] & 0x3f) << 6) |
        (bytes[index + 2] & 0x3f);
      index += 3;
    }

    result += String.fromCodePoint(code);
  }

  return result;
}
