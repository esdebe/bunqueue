/**
 * Fast hash functions
 * FNV-1a implementation for consistent hashing
 */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/**
 * FNV-1a hash function (32-bit)
 * Fast, good distribution for strings
 */
export function fnv1a(str: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0; // Convert to unsigned 32-bit
}

/**
 * Calculate shard index from string
 * Uses 32 shards (& 0x1F mask)
 */
export const SHARD_COUNT = 32;
export const SHARD_MASK = 0x1f;

export function shardIndex(key: string): number {
  return fnv1a(key) & SHARD_MASK;
}

/**
 * Calculate processing shard index from job ID (UUIDv7 string)
 */
export function processingShardIndex(jobId: string): number {
  return fnv1a(jobId) & SHARD_MASK;
}

/**
 * Generate a simple UUID v4
 */
export function uuid(): string {
  const hex = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      result += '-';
    } else if (i === 14) {
      result += '4';
    } else if (i === 19) {
      result += hex[(Math.random() * 4) | 8];
    } else {
      result += hex[(Math.random() * 16) | 0];
    }
  }
  return result;
}

/**
 * Constant-time string comparison
 * Prevents timing attacks on token validation
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
