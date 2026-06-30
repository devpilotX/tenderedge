/**
 * Object-storage abstraction for Business_Documents. Drivers encrypt at rest, so a
 * stored object is always ciphertext regardless of backend (REQ 16.1).
 *
 *  - LocalEncryptedDriver (dev/test): AES-256-GCM files on disk.
 *  - S3Driver (production): AES-256-GCM client-side encryption + S3 PutObject.
 *
 * `put` accepts plaintext and stores ciphertext; `get` returns the decrypted plaintext.
 */
export interface StorageDriver {
  put(key: string, plaintext: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  readonly driver: 'local' | 's3';
}
