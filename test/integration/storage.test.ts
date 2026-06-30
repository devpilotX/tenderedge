import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createStorageDriver } from '../../src/storage/index.js';
import { LocalEncryptedDriver } from '../../src/storage/local-driver.js';

/**
 * Integration test for encrypted object-storage wiring (REQ 16.1). Exercises the
 * configured driver (local AES-256-GCM in dev/test) through the put/get/delete
 * lifecycle. The S3 driver shares the same interface and client-side encryption.
 */
describe('Integration — encrypted object storage boundary (REQ 16.1)', () => {
  it('selects the local encrypted driver from configuration', () => {
    const driver = createStorageDriver();
    expect(driver.driver).toBe('local');
  });

  it('stores, retrieves byte-identical, and deletes an object', async () => {
    const dir = `./storage/itg-${randomUUID()}`;
    const driver = new LocalEncryptedDriver(dir);
    try {
      const key = randomUUID().replace(/-/g, '');
      const data = randomBytes(2048);
      await driver.put(key, data);
      const back = await driver.get(key);
      expect(back.equals(data)).toBe(true);

      await driver.delete(key);
      await expect(driver.get(key)).rejects.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
