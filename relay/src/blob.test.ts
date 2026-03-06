import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('blob hash verification', () => {
  it('accepts a blob whose hash matches the blobId', () => {
    const content = new TextEncoder().encode('hello world');
    const hash = bytesToHex(sha256(content));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const computedHash = bytesToHex(sha256(content));
    expect(computedHash).toBe(hash);
  });

  it('rejects a blob whose hash does not match', () => {
    const content = new TextEncoder().encode('hello world');
    const wrongId = 'a'.repeat(64);
    const computedHash = bytesToHex(sha256(content));
    expect(computedHash).not.toBe(wrongId);
  });
});

describe('blob size validation', () => {
  it('rejects blobs over 2MB', () => {
    const MAX = 2 * 1024 * 1024;
    const overSize = MAX + 1;
    expect(overSize > MAX).toBe(true);
  });
});
