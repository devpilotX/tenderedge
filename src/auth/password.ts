import { hash, verify } from '@node-rs/argon2';

/**
 * One-way password hashing with argon2id (REQ 2.6). @node-rs/argon2 ships prebuilt
 * binaries and defaults to the argon2id variant with sensible memory/time costs.
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    // Malformed hash or mismatch — treat as a failed verification, never throw.
    return false;
  }
}
