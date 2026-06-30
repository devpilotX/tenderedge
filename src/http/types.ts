import type { AuthContext } from '../auth/service.js';

// Attach the authenticated context to the request (populated by requireAuth).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
