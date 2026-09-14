import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CONFIG, type AppConfig } from '../config.js';

// The gateway behind booking deposits. Amounts are in centavos at this boundary,
// as PayMongo counts them; the services above work in pesos. Two
// implementations: PayMongo for production and a fake for tests and demos.

export interface CheckoutInput {
  depositId: string;
  amountCentavos: number;
  description: string;
  payerName?: string;
  /** Wallet and QR rails the buyer may use. Cards are off unless asked for. */
  methods: string[];
}
export interface Checkout {
  checkoutId: string;
  checkoutUrl: string;
}
export interface TransferInput {
  reference: string;
  amountCentavos: number;
  kind: 'gcash' | 'bank';
  accountNo: string;
  accountName: string;
  bankCode?: string | null;
}
export interface TransferResult {
  transferId: string;
  status: 'pending' | 'succeeded' | 'failed';
  failureReason?: string;
}
/** A provider event, normalised. `depositId` comes from the checkout metadata we set. */
export interface ProviderEvent {
  eventId: string;
  type: 'checkout.paid' | 'transfer.succeeded' | 'transfer.failed' | 'other';
  depositId?: string;
  checkoutId?: string;
  paymentId?: string;
  paymentMethod?: string;
  amountCentavos?: number;
  feeCentavos?: number;
  transferId?: string;
  failureReason?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<Checkout>;
  expireCheckout(checkoutId: string): Promise<void>;
  refund(paymentId: string, amountCentavos: number, reason: string): Promise<TransferResult>;
  transfer(input: TransferInput): Promise<TransferResult>;
  /** Verify and parse a webhook. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * In-process gateway for tests and the local demo. Checkout links point at a
 * page this API serves; "paying" is a webhook POST without a signature. Transfers
 * succeed at once unless the account number ends in 0000 (a failure to test).
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async createCheckout(input: CheckoutInput): Promise<Checkout> {
    const checkoutId = `cs_fake_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    return { checkoutId, checkoutUrl: `${this.config.PUBLIC_BASE_URL}/v1/payments/fake/checkout/${checkoutId}?deposit=${input.depositId}&amount=${input.amountCentavos}` };
  }
  async expireCheckout(): Promise<void> {}
  async refund(paymentId: string, amountCentavos: number): Promise<TransferResult> {
    return { transferId: `ref_fake_${randomUUID().slice(0, 8)}`, status: amountCentavos > 0 && paymentId ? 'succeeded' : 'failed' };
  }
  async transfer(input: TransferInput): Promise<TransferResult> {
    if (input.accountNo.endsWith('0000')) return { transferId: `tr_fake_${randomUUID().slice(0, 8)}`, status: 'failed', failureReason: 'Account not found at the receiving institution' };
    return { transferId: `tr_fake_${randomUUID().slice(0, 8)}`, status: 'succeeded' };
  }
  parseWebhook(rawBody: Buffer): ProviderEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const type = String(body.type ?? '');
    return {
      eventId: String(body.id ?? randomUUID()),
      type: type === 'checkout.paid' || type === 'transfer.succeeded' || type === 'transfer.failed' ? type : 'other',
      depositId: body.deposit_id as string | undefined,
      checkoutId: body.checkout_id as string | undefined,
      paymentId: (body.payment_id as string | undefined) ?? `pay_fake_${randomUUID().slice(0, 8)}`,
      paymentMethod: (body.payment_method as string | undefined) ?? 'gcash',
      amountCentavos: body.amount as number | undefined,
      feeCentavos: body.fee as number | undefined,
      transferId: body.transfer_id as string | undefined,
      failureReason: body.failure_reason as string | undefined,
      raw: body,
    };
  }
}

/**
 * PayMongo: Checkout Sessions for collection, Refunds, and Transfers (Disbursements)
 * from the merchant wallet. Webhook signatures: header `Paymongo-Signature: t=..,te=..,li=..`,
 * HMAC-SHA256 of `${t}.${rawBody}` with the webhook secret, compared to `li` (live) or `te` (test).
 * Field names follow the public API reference; verify against the account before go-live.
 */
@Injectable()
export class PayMongoProvider implements PaymentProvider {
  readonly name = 'paymongo';
  private readonly log = new Logger(PayMongoProvider.name);
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    if (!config.PAYMONGO_SECRET_KEY || !config.PAYMONGO_WEBHOOK_SECRET) {
      throw new Error('PAYMENTS_PROVIDER=paymongo needs PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET');
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.config.PAYMONGO_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.PAYMONGO_SECRET_KEY}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as T & { errors?: { detail?: string }[] };
    if (!res.ok) {
      const detail = json?.errors?.map((e) => e.detail).join('; ') ?? res.statusText;
      this.log.warn(`${method} ${path} -> ${res.status} ${detail}`);
      throw new Error(`PayMongo ${method} ${path} failed: ${detail}`);
    }
    return json;
  }

  async createCheckout(input: CheckoutInput): Promise<Checkout> {
    const r = await this.call<{ data: { id: string; attributes: { checkout_url: string } } }>('POST', '/checkout_sessions', {
      data: {
        attributes: {
          line_items: [{ name: input.description, amount: input.amountCentavos, currency: 'PHP', quantity: 1 }],
          payment_method_types: input.methods,
          description: input.description,
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          success_url: `${this.config.PAYMENTS_RETURN_URL}?deposit=${input.depositId}&result=paid`,
          cancel_url: `${this.config.PAYMENTS_RETURN_URL}?deposit=${input.depositId}&result=cancelled`,
          metadata: { deposit_id: input.depositId },
        },
      },
    });
    return { checkoutId: r.data.id, checkoutUrl: r.data.attributes.checkout_url };
  }

  async expireCheckout(checkoutId: string): Promise<void> {
    await this.call('POST', `/checkout_sessions/${checkoutId}/expire`).catch((e) => this.log.warn(`expire ${checkoutId}: ${(e as Error).message}`));
  }

  async refund(paymentId: string, amountCentavos: number, reason: string): Promise<TransferResult> {
    const r = await this.call<{ data: { id: string; attributes: { status: string } } }>('POST', '/refunds', {
      data: { attributes: { amount: amountCentavos, payment_id: paymentId, reason: 'requested_by_customer', notes: reason.slice(0, 250) } },
    });
    return { transferId: r.data.id, status: r.data.attributes.status === 'succeeded' ? 'succeeded' : 'pending' };
  }

  async transfer(input: TransferInput): Promise<TransferResult> {
    // Transfers API (Disbursements): InstaPay for banks, e-wallet rail for GCash. Asynchronous; the
    // outcome arrives as transfer.succeeded / transfer.failed webhooks.
    const r = await this.call<{ data: { id: string; attributes: { status: string } } }>('POST', '/transfers', {
      data: {
        attributes: {
          amount: input.amountCentavos,
          currency: 'PHP',
          reference_number: input.reference.slice(0, 40),
          destination: input.kind === 'gcash'
            ? { type: 'ewallet', provider: 'gcash', account_number: input.accountNo, account_name: input.accountName }
            : { type: 'bank', bank_code: input.bankCode, account_number: input.accountNo, account_name: input.accountName, rail: 'instapay' },
        },
      },
    });
    const st = r.data.attributes.status;
    return { transferId: r.data.id, status: st === 'succeeded' ? 'succeeded' : st === 'failed' ? 'failed' : 'pending' };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent {
    const sig = String(headers['paymongo-signature'] ?? '');
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=').map((x) => x.trim()) as [string, string]));
    const expected = createHmac('sha256', this.config.PAYMONGO_WEBHOOK_SECRET!).update(`${parts.t}.${rawBody.toString('utf8')}`).digest('hex');
    const given = parts.li || parts.te || '';
    if (!parts.t || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      throw new Error('bad webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as { data: { id: string; attributes: { type: string; data: { id: string; attributes: Record<string, unknown> } } } };
    const type = body.data.attributes.type;
    const inner = body.data.attributes.data;
    const attrs = inner.attributes;
    const ev: ProviderEvent = { eventId: body.data.id, type: 'other', raw: body };
    if (type === 'checkout_session.payment.paid') {
      const payments = (attrs.payments as { id: string; attributes: Record<string, unknown> }[] | undefined) ?? [];
      const p = payments[0];
      const pa = p?.attributes ?? {};
      return {
        ...ev,
        type: 'checkout.paid',
        checkoutId: inner.id,
        depositId: (attrs.metadata as Record<string, string> | undefined)?.deposit_id,
        paymentId: p?.id,
        paymentMethod: (pa.source as { type?: string } | undefined)?.type ?? undefined,
        amountCentavos: pa.amount as number | undefined,
        feeCentavos: pa.fee as number | undefined,
      };
    }
    if (type === 'transfer.succeeded' || type === 'transfer.failed') {
      return { ...ev, type, transferId: inner.id, failureReason: (attrs.failure_reason as string | undefined) ?? undefined };
    }
    return ev;
  }
}
