import { env } from '../config/env.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'billing-provider' });

export interface ChargeRequest {
  accountId: string;
  amountPaise: number;
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  reference?: string;
  reason?: string;
}

/** A payment provider that charges a subscription (REQ 13.3). */
export interface BillingProvider {
  readonly name: string;
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/**
 * Mock provider for dev/test. Succeeds by default; tests can override the outcome
 * with `setOutcome` to exercise retry and read-only paths deterministically.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock';
  private outcome: (req: ChargeRequest) => ChargeResult = () => ({ success: true, reference: 'mock' });

  setOutcome(fn: (req: ChargeRequest) => ChargeResult): void {
    this.outcome = fn;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const result = this.outcome(req);
    log.debug({ account: req.accountId, amountPaise: req.amountPaise, result }, 'mock charge');
    return result;
  }
}

/**
 * Production Stripe provider. The SDK is imported dynamically so the default build
 * needs no `stripe` dependency. Install `stripe` and set BILLING_DRIVER=stripe.
 * Uses an idempotency key so retried charges are not double-billed.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe';
  private clientPromise: Promise<{ paymentIntents: { create: (params: unknown, opts: unknown) => Promise<{ status: string; id: string }> } }> | null = null;

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const pkg = 'stripe';
        const mod = (await import(pkg)) as unknown as { default: new (key: string) => unknown };
        const Stripe = mod.default;
        return new Stripe(env.STRIPE_SECRET_KEY) as unknown as {
          paymentIntents: { create: (params: unknown, opts: unknown) => Promise<{ status: string; id: string }> };
        };
      })();
    }
    return this.clientPromise;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    try {
      const stripe = await this.client();
      const intent = await stripe.paymentIntents.create(
        { amount: req.amountPaise, currency: 'inr', confirm: true, metadata: { accountId: req.accountId } },
        { idempotencyKey: req.idempotencyKey },
      );
      return { success: intent.status === 'succeeded', reference: intent.id, reason: intent.status };
    } catch (err) {
      return { success: false, reason: err instanceof Error ? err.message : 'charge failed' };
    }
  }
}

let instance: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (!instance) {
    instance = env.BILLING_DRIVER === 'stripe' ? new StripeBillingProvider() : new MockBillingProvider();
  }
  return instance;
}

export function setBillingProvider(p: BillingProvider | null): void {
  instance = p;
}
