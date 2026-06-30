import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { decryptBuffer, encryptBuffer } from './crypto.js';
import type { StorageDriver } from './types.js';

const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Encrypted local-filesystem storage for dev/test (REQ 16.1). Objects are written
 * as AES-256-GCM ciphertext under STORAGE_LOCAL_DIR. Keys are validated to prevent
 * path traversal (the service generates UUID keys).
 */
export class LocalEncryptedDriver implements StorageDriver {
  readonly driver = 'local' as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
    return join(this.baseDir, key);
  }

  async put(key: string, plaintext: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(path, encryptBuffer(plaintext));
  }

  async get(key: string): Promise<Buffer> {
    const blob = await readFile(this.pathFor(key));
    return decryptBuffer(blob);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
