import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptBuffer, decryptBuffer } from '../../src/storage/crypto.js';
import { LocalEncryptedDriver } from '../../src/storage/local-driver.js';

/**
 * RT2: a stored then retrieved Business_Document returns byte-identical content
 * (REQ 9.1, 9.3). Verified at the crypto layer and through the encrypted local
 * storage driver. (Documents are AES-256-GCM encrypted at rest, REQ 16.1.)
 */
const bytesArb = fc.uint8Array({ maxLength: 4096 });

describe('RT2 — document storage round-trip is byte-identical', () => {
  it('AES-256-GCM encrypt → decrypt returns the original bytes', () => {
    fc.assert(
      fc.property(bytesArb, (arr) => {
        const original = Buffer.from(arr);
        const restored = decryptBuffer(encryptBuffer(original));
        return restored.equals(original);
      }),
      { numRuns: 200 },
    );
  });

  it('local encrypted driver store → retrieve returns the original bytes', async () => {
    const dir = join('./storage', `rt2-${randomUUID()}`);
    const driver = new LocalEncryptedDriver(dir);
    try {
      await fc.assert(
        fc.asyncProperty(bytesArb, async (arr) => {
          const original = Buffer.from(arr);
          const key = randomUUID().replace(/-/g, '');
          await driver.put(key, original);
          const restored = await driver.get(key);
          return restored.equals(original);
        }),
        { numRuns: 60 },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ciphertext on disk is not the plaintext (encrypted at rest)', async () => {
    const dir = join('./storage', `rt2enc-${randomUUID()}`);
    const driver = new LocalEncryptedDriver(dir);
    try {
      const plain = Buffer.from('SECRET licence number ABC-123', 'utf8');
      const key = randomUUID().replace(/-/g, '');
      await driver.put(key, plain);
      const { readFile } = await import('node:fs/promises');
      const onDisk = await readFile(join(dir, key));
      expect(onDisk.includes(plain)).toBe(false);
      expect((await driver.get(key)).equals(plain)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
