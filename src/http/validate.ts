import type { ZodSchema } from 'zod';
import { ValidationError } from '../core/errors.js';

/** Parses input against a schema, raising a 422 ValidationError on failure. */
export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'Invalid request.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
