/**
 * Typed application errors. Each carries a stable `code` and HTTP `status`
 * so the API layer can translate domain failures into responses without leaking internals.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** REQ 1.2 / ERR1: duplicate-email registration. */
export class DuplicateEmailError extends AppError {
  constructor(email: string) {
    super('DUPLICATE_EMAIL', `The email ${email} is already registered.`, 409);
  }
}

/** REQ 2.2: invalid credentials. */
export class AuthenticationError extends AppError {
  constructor(message = 'Invalid credentials.') {
    super('AUTHENTICATION_FAILED', message, 401);
  }
}

/** Session missing/expired (REQ 2.3). */
export class SessionExpiredError extends AppError {
  constructor(message = 'Session expired. Please sign in again.') {
    super('SESSION_EXPIRED', message, 401);
  }
}

/** REQ 2.5: viewer write attempt, or read-only billing lock (REQ 13.5). */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message, 403);
  }
}

/** REQ 16.4 / ERR4: cross-tenant access. Treated as not-found to avoid leaking existence. */
export class AuthorizationError extends AppError {
  constructor(message = 'Resource not found.') {
    super('NOT_AUTHORIZED', message, 404);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', `${resource} not found.`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 422, details);
  }
}

/** REQ 9.6 / ERR2: oversized upload. */
export class FileTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super('FILE_TOO_LARGE', `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`, 413);
  }
}

/** REQ 7.2 / ERR3: Bid Brain requested without entitlement. */
export class NotEntitledError extends AppError {
  constructor(feature = 'Bid Brain') {
    super(
      'NOT_ENTITLED',
      `${feature} is not included in your current plan. Upgrade to enable it.`,
      402,
    );
  }
}

/** REQ 14.3: region selection beyond tier limit. */
export class TierLimitError extends AppError {
  constructor(message: string) {
    super('TIER_LIMIT_EXCEEDED', message, 409);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
