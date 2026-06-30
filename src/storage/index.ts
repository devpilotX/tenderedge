import { env } from '../config/env.js';
import { LocalEncryptedDriver } from './local-driver.js';
import { S3Driver } from './s3-driver.js';
import type { StorageDriver } from './types.js';

export type { StorageDriver } from './types.js';

let instance: StorageDriver | null = null;

export function createStorageDriver(): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Driver({ bucket: env.S3_BUCKET, region: env.S3_REGION, endpoint: env.S3_ENDPOINT });
  }
  return new LocalEncryptedDriver(env.STORAGE_LOCAL_DIR);
}

export function getStorageDriver(): StorageDriver {
  if (!instance) instance = createStorageDriver();
  return instance;
}

/** Test helper to inject or reset the driver. */
export function setStorageDriver(d: StorageDriver | null): void {
  instance = d;
}
