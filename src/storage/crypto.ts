import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM authenticated encryption for Business_Documents at rest (REQ 16.1).
 * The stored blob layout is: [12-byte IV][16-byte auth tag][ciphertext]. The 32-byte
 * key comes from DOCUMENT_ENCRYPTION_KEY (base64). GCM authentication means any
 * tampering with the ciphertext fails decryption.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('DOCUMENT_ENCRYPTION_KEY is not set; cannot encrypt documents.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `DOCUMENT_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  cachedKey = key;
  return key;
}

export function encryptBuffer(plain: Buffer, key: Buffer = getEncryptionKey()): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptBuffer(blob: Buffer, key: Buffer = getEncryptionKey()): Buffer {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Resets the cached key (tests that change the env key). */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}
