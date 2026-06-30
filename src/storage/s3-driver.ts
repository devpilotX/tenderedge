import { decryptBuffer, encryptBuffer } from './crypto.js';
import type { StorageDriver } from './types.js';

/**
 * Production S3 storage driver (REQ 16.1, 16.2). Objects are **client-side encrypted**
 * with AES-256-GCM before upload, so contents are protected at rest independent of
 * bucket-level settings, and transit to S3 is over TLS.
 *
 * The AWS SDK is imported dynamically so the default (local) build and test suite
 * have no AWS dependency. Install `@aws-sdk/client-s3` and set STORAGE_DRIVER=s3 to use it.
 */
export class S3Driver implements StorageDriver {
  readonly driver = 's3' as const;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string | undefined;
  private clientPromise: Promise<{
    client: unknown;
    PutObjectCommand: new (i: unknown) => unknown;
    GetObjectCommand: new (i: unknown) => unknown;
    DeleteObjectCommand: new (i: unknown) => unknown;
  }> | null = null;

  constructor(opts: { bucket: string; region: string; endpoint?: string }) {
    if (!opts.bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    this.bucket = opts.bucket;
    this.region = opts.region;
    this.endpoint = opts.endpoint || undefined;
  }

  private async sdk() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        // Non-literal specifier so the optional dependency isn't resolved at build time.
        const pkg = '@aws-sdk/client-s3';
        const mod = (await import(pkg)) as unknown as {
          S3Client: new (cfg: unknown) => unknown;
          PutObjectCommand: new (i: unknown) => unknown;
          GetObjectCommand: new (i: unknown) => unknown;
          DeleteObjectCommand: new (i: unknown) => unknown;
        };
        const client = new mod.S3Client({
          region: this.region,
          ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true } : {}),
        });
        return {
          client,
          PutObjectCommand: mod.PutObjectCommand,
          GetObjectCommand: mod.GetObjectCommand,
          DeleteObjectCommand: mod.DeleteObjectCommand,
        };
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, plaintext: Buffer): Promise<void> {
    const { client, PutObjectCommand } = await this.sdk();
    const send = (client as { send: (c: unknown) => Promise<unknown> }).send.bind(client);
    await send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: encryptBuffer(plaintext) }));
  }

  async get(key: string): Promise<Buffer> {
    const { client, GetObjectCommand } = await this.sdk();
    const send = (client as { send: (c: unknown) => Promise<unknown> }).send.bind(client);
    const res = (await send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))) as {
      Body: { transformToByteArray: () => Promise<Uint8Array> };
    };
    const bytes = Buffer.from(await res.Body.transformToByteArray());
    return decryptBuffer(bytes);
  }

  async delete(key: string): Promise<void> {
    const { client, DeleteObjectCommand } = await this.sdk();
    const send = (client as { send: (c: unknown) => Promise<unknown> }).send.bind(client);
    await send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
