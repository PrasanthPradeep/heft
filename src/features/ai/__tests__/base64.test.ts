import {
  base64ToBase64Url,
  base64ToBytes,
  base64UrlToBase64,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  utf8Decode,
  utf8Encode,
} from '../base64';

describe('base64 encoding', () => {
  it('matches known base64 output', () => {
    expect(bytesToBase64(utf8Encode('hello'))).toBe('aGVsbG8=');
    expect(bytesToBase64(utf8Encode('foobar'))).toBe('Zm9vYmFy');
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255, 128, 64]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});

describe('base64url', () => {
  it('replaces url-unsafe characters and strips padding', () => {
    expect(base64ToBase64Url('a+b/c==')).toBe('a-b_c');
    expect(base64UrlToBase64('YWJjZA')).toBe('YWJjZA==');
    expect(base64ToBase64Url(base64UrlToBase64('YWJjZA'))).toBe('YWJjZA');
  });

  it('encodes bytes to url-safe output without padding', () => {
    const encoded = bytesToBase64Url(Uint8Array.from([251, 255, 190]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...base64UrlToBytes(encoded)]).toEqual([251, 255, 190]);
  });
});

describe('utf8', () => {
  it('round-trips ascii', () => {
    expect(utf8Decode(utf8Encode('Weight 82.4 kg'))).toBe('Weight 82.4 kg');
  });

  it('round-trips multi-byte and astral characters', () => {
    const value = 'café — 追踪 🏃‍♂️';
    expect(utf8Decode(utf8Encode(value))).toBe(value);
  });

  it('decodes a base64url JWT-style payload', () => {
    const payload = { sub: 'user_123', email: 'a@b.com', n: 5 };
    const encoded = bytesToBase64Url(utf8Encode(JSON.stringify(payload)));
    expect(JSON.parse(utf8Decode(base64UrlToBytes(encoded)))).toEqual(payload);
  });
});
