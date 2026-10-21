import { formatStorageSize } from '@/lib/format';

describe('formatStorageSize', () => {
  it('handles zero and invalid values', () => {
    expect(formatStorageSize(0)).toBe('0 KB');
    expect(formatStorageSize(-1)).toBe('0 KB');
    expect(formatStorageSize(Number.NaN)).toBe('0 KB');
  });

  it('formats bytes and kilobytes', () => {
    expect(formatStorageSize(512)).toBe('512 B');
    expect(formatStorageSize(1024)).toBe('1 KB');
    expect(formatStorageSize(2048)).toBe('2 KB');
  });

  it('formats megabytes with one decimal below 10 MB', () => {
    expect(formatStorageSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatStorageSize(200 * 1024 * 1024)).toBe('200 MB');
  });
});
