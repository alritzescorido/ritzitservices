import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AccessClaims } from '../auth/auth.guard.js';
import { int, isoTime, money, peso } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Queryable } from '../db/db.service.js';
import { DealsService } from '../market/deals.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderEvent } from './payment.provider.js';

// Booking deposits, the pilot payment model from docs/payments-paymongo.md.
// The deal's state machine is untouched; the deposit rides alongside it as
// deposits rows and deals.deposit_status. DealsService calls back in here after
// its own transactions commit (accepted, settled, cancelled, dispute resolved),
// because the gateway is an HTTP call and does not belong inside a transaction.

export type DepositStatus = 'pending' | 'paid' | 'lapsed' | 'released' | 'forfeited' | 'refunded';
export type DepositDecision = 'release_to_farmer' | 'refund_to_buyer' | 'hold';

const TRANSFER_FEE_PESOS = 10; // PayMongo list price per disbursement, ours to absorb
const METHODS = ['gcash', 'paymaya', 'qrph'];

const DEPOSIT_SQL = `
  select dp.*, bu.full_name as buyer_name, fu.full_name as farmer_name
    from deposits dp join users bu on bu.id = dp.buyer_id join users fu on fu.id = dp.farmer_id`;

@Injectable()
export class DepositsService implements OnModuleInit {
  private readonly log = new Logger(DepositsService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly db: DbService,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  get enabled() {
    return this.config.PAYMENTS_PROVIDER !== 'off';
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.deals.depositHooks = {
      afterAccepted: (dealId) => this.open(dealId),
      afterSettled: (dealId) => this.release(dealId, 'release'),
      afterCancelled: (dealId, who) => (who === 'buyer' ? this.release(dealId, 'forfeit') : this.refund(dealId, 'farmer cancelled')),
      afterDisputeResolved: (dealId, decision) => this.decide(dealId, decision),
    };
    this.log.log(`booking deposits on: ${this.config.DEPOSIT_PERCENT}% of the estimate, ${this.config.DEPOSIT_MIN_PESOS}-${this.config.DEPOSIT_MAX_PESOS} pesos, ${this.config.DEPOSIT_PAY_WINDOW_MINUTES} min to pay, provider ${this.provider.name}`);
  }

  // ---- amount ---------------------------------------------------------------

  /** What one deal is worth on the agreed terms, which both the deposit and the commission are taken from. */
  private estimate(deal: Record<string, unknown>): number {
    const price = Number(deal.agreed_price);
    return deal.unit === 'per_head' ? price * int(deal.agreed_heads) : deal.agreed_weight_kg ? price * Number(deal.agreed_weight_kg) : 0;
  }

  /**
   * One charge, two parts. The booking is the farmer's assurance and is the only
   * figure ever promised to them. The commission is the platform's fee, added on
   * top so it never comes out of the farmer's share, and earned only if the deal
   * settles. At COMMISSION_PERCENT=0 this is exactly the old behaviour.
   */
  async amountFor(deal: Record<string, unknown>): Promise<{ booking: number; commission: number; amount: number; pct: number }> {
    const est = this.estimate(deal);
    const tenth = Math.round((est * this.config.DEPOSIT_PERCENT) / 100);
    const booking = Math.min(this.config.DEPOSIT_MAX_PESOS, Math.max(this.config.DEPOSIT_MIN_PESOS, tenth));
    // The rate an admin set in the console, falling back to the environment until one has.
    const pct = await this.settings.number('commission_percent');
    const commission = Math.round(est * pct) / 100;
    return { booking, commission, amount: booking + commission, pct };
  }

  // ---- read -------------------------------------------------------------------

  private dto(r: Record<string, unknown>, forBuyer: boolean) {
    return {
      id: String(r.id),
      deal_id: String(r.deal_id),
      buyer_id: String(r.buyer_id),
      farmer_id: String(r.farmer_id),
      buyer_name: String(r.buyer_name),
      farmer_name: String(r.farmer_name),
      status: r.status as DepositStatus,
      amount: money(r.amount)!,
      booking: money(r.booking ?? r.amount)!,
      commission: money(r.commission ?? 0)!,
      fee: money(r.fee),
      net: money(r.net),
      provider: String(r.provider),
      checkout_url: forBuyer && r.status === 'pending' ? ((r.checkout_url as string | null) ?? null) : null,
      payment_method: (r.payment_method as string | null) ?? null,
      expires_at: isoTime(r.expires_at)!,
      paid_at: isoTime(r.paid_at),
      closed_at: isoTime(r.closed_at),
      transfer_status: (r.transfer_status as string | null) ?? null,
      failure_reason: (r.failure_reason as string | null) ?? null,
      created_at: isoTime(r.created_at)!,
    };
  }

  private async live(dealId: string, q: Queryable = this.db) {
    return q.query<Record<string, unknown>>(`${DEPOSIT_SQL} where dp.deal_id = $1 order by dp.created_at desc limit 1`, [dealId]).then((r) => r.rows[0]);
  }

  async get(user: AccessClaims, dealId: string) {
    const deal = await this.deals.row(dealId);
    const who = this.deals.party(deal, user);
    const r = await this.live(dealId);
    if (!r) throw ProblemException.notFound('No deposit on this deal');
    return this.dto(r, who === 'buyer');
  }

  // ---- open on acceptance -----------------------------------------------------

  /** Called by DealsService after the accept transaction. Never throws into the deal flow. */
  async open(dealId: string) {
    try {
      const deal = await this.deals.row(dealId);
      if (await this.live(dealId)) return;
      const { booking, commission, amount, pct } = await this.amountFor(deal);
      const { rows } = await this.db.query<{ id: string; expires_at: string }>(
        `insert into deposits (deal_id, buyer_id, farmer_id, amount, booking, commission, commission_pct, provider, expires_at)
         values ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8, now() + ($9 || ' minutes')::interval) returning id, expires_at::text as expires_at`,
        [dealId, deal.buyer_id, deal.farmer_id, amount.toFixed(2), booking.toFixed(2), commission.toFixed(2), pct.toFixed(2), this.provider.name, String(this.config.DEPOSIT_PAY_WINDOW_MINUTES)],
      );
      await this.db.query(`update deals set deposit_required = true, deposit_status = 'pending' where id = $1`, [dealId]);
      const breakdown = commission > 0 ? ` (${peso(booking)} held for the farmer plus ${peso(commission)} platform fee at ${pct}%)` : '';
      await this.db.query(`insert into deal_events (deal_id, from_state, to_state, note) values ($1, 'accepted', 'accepted', $2)`, [dealId, `booking deposit of ${peso(amount)} requested from the buyer${breakdown}, ${this.config.DEPOSIT_PAY_WINDOW_MINUTES} minutes to pay`]);
      const url = await this.checkout(rows[0].id, amount, deal);
      const mins = this.config.DEPOSIT_PAY_WINDOW_MINUTES;
      void this.deals.notify(String(deal.buyer_id), `Presyo ng Hayop: pay ${peso(amount)} within ${mins} minutes to hold the animals${commission > 0 ? ` (${peso(booking)} booking deposit plus ${peso(commission)} platform fee)` : ''}${url ? `: ${url}` : ' (open the app)'}. The deposit counts toward the price.`);
      void this.deals.notify(String(deal.farmer_id), `Presyo ng Hayop: deal agreed. Waiting for the buyer's ${peso(booking)} booking deposit (${mins} minutes). You will be told when it is paid.`);
    } catch (e) {
      this.log.error(`open deposit for ${dealId}: ${(e as Error).message}`);
    }
  }

  private async checkout(depositId: string, amount: number, deal: Record<string, unknown>): Promise<string | null> {
    try {
      const c = await this.provider.createCheckout({
        depositId,
        amountCentavos: Math.round(amount * 100),
        description: `Booking deposit, ${deal.agreed_heads} ${deal.species} from ${deal.farmer_name}`,
        payerName: String(deal.buyer_name),
        methods: METHODS,
      });
      await this.db.query(`update deposits set checkout_id = $2, checkout_url = $3, updated_at = now() where id = $1`, [depositId, c.checkoutId, c.checkoutUrl]);
      return c.checkoutUrl;
    } catch (e) {
      this.log.warn(`checkout for deposit ${depositId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Buyer asks for a fresh link when the first failed or was closed. */
  async refreshCheckout(user: AccessClaims, dealId: string) {
    const deal = await this.deals.row(dealId);
    if (this.deals.party(deal, user) !== 'buyer') throw ProblemException.forbidden('Only the buyer pays the deposit');
    const r = await this.live(dealId);
    if (!r || r.status !== 'pending') throw ProblemException.conflict(r ? `The deposit is ${r.status}` : 'No deposit on this deal');
    if (r.checkout_id) await this.provider.expireCheckout(String(r.checkout_id));
    const url = await this.checkout(String(r.id), Number(r.amount), deal);
    if (!url) throw ProblemException.conflict('The payment gateway did not return a checkout link; try again shortly');
    return this.get(user, dealId);
  }

  // ---- webhook ------------------------------------------------------------------

  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    let ev: ProviderEvent;
    try {
      ev = this.provider.parseWebhook(rawBody, headers);
    } catch (e) {
      throw ProblemException.badRequest(`Webhook rejected: ${(e as Error).message}`);
    }
    const ins = await this.db.query<{ id: string }>(
      `insert into payment_events (provider, event_id, event_type, payload) values ($1, $2, $3, $4::jsonb) on conflict (provider, event_id) do nothing returning id`,
      [this.provider.name, ev.eventId, ev.type, JSON.stringify(ev.raw)],
    );
    if (!ins.rows[0]) return { received: true, replay: true };
    const rowId = ins.rows[0].id;
    try {
      const depositId = await this.process(ev);
      await this.db.query(`update payment_events set processed_at = now(), deposit_id = $2 where id = $1`, [rowId, depositId]);
    } catch (e) {
      await this.db.query(`update payment_events set error = $2 where id = $1`, [rowId, (e as Error).message]);
      this.log.error(`webhook ${ev.eventId} (${ev.type}): ${(e as Error).message}`);
    }
    return { received: true, replay: false };
  }

  private async process(ev: ProviderEvent): Promise<string | null> {
    if (ev.type === 'checkout.paid') {
      const r = ev.depositId
        ? await this.db.one<Record<string, unknown>>(`select * from deposits where id = $1`, [ev.depositId])
        : await this.db.one<Record<string, unknown>>(`select * from deposits where checkout_id = $1`, [ev.checkoutId ?? '']);
      if (!r) throw new Error('deposit not found for paid checkout');
      if (r.status !== 'pending') return String(r.id); // already handled, or lapsed before the payment landed: admin sees it in the list
      const amount = Number(r.amount);
      const paid = ev.amountCentavos != null ? ev.amountCentavos / 100 : amount;
      if (Math.abs(paid - amount) > 0.01) throw new Error(`paid ${paid} differs from deposit ${amount}`);
      const fee = ev.feeCentavos != null ? ev.feeCentavos / 100 : 0;
      const net = amount - fee;
      await this.db.tx(async (q) => {
        await q.query(
          `update deposits set status = 'paid', paid_at = now(), payment_id = $2, payment_method = $3, fee = $4::numeric, net = $5::numeric, updated_at = now() where id = $1`,
          [r.id, ev.paymentId ?? null, ev.paymentMethod ?? null, fee.toFixed(2), net.toFixed(2)],
        );
        await q.query(`update deals set deposit_status = 'paid' where id = $1`, [r.deal_id]);
        await q.query(`insert into ledger_entries (deposit_id, deal_id, kind, amount, reference) values ($1, $2, 'deposit_in', $3::numeric, $4)`, [r.id, r.deal_id, amount.toFixed(2), ev.paymentId ?? null]);
        if (fee > 0) await q.query(`insert into ledger_entries (deposit_id, deal_id, kind, amount, reference) values ($1, $2, 'gateway_fee', $3::numeric, $4)`, [r.id, r.deal_id, (-fee).toFixed(2), ev.paymentId ?? null]);
        await q.query(`insert into deal_events (deal_id, from_state, to_state, note) values ($1, 'accepted', 'accepted', $2)`, [r.deal_id, `booking deposit ${peso(amount)} paid by ${ev.paymentMethod ?? 'wallet'}; deal booked, hauler job published`]);
      });
      const booking = Number(r.booking ?? r.amount);
      void this.deals.notify(String(r.farmer_id), `Presyo ng Hayop: ${peso(booking)} reserved for you, paid by the buyer and held through PayMongo. Prepare the animals for pickup.`);
      void this.deals.notify(String(r.buyer_id), `Presyo ng Hayop: payment of ${peso(amount)} received. The deal is booked; the balance is paid at delivery.`);
      return String(r.id);
    }
    if (ev.type === 'transfer.succeeded' || ev.type === 'transfer.failed') {
      const ok = ev.type === 'transfer.succeeded';
      const dep = await this.db.one<{ id: string; farmer_id: string }>(`select id, farmer_id from deposits where transfer_id = $1`, [ev.transferId ?? '']);
      if (dep) {
        await this.db.query(`update deposits set transfer_status = $2, failure_reason = $3, updated_at = now() where id = $1`, [dep.id, ok ? 'succeeded' : 'failed', ok ? null : (ev.failureReason ?? 'transfer failed')]);
        if (!ok) void this.deals.notify(dep.farmer_id, 'Presyo ng Hayop: we could not send your deposit payout. Check your payout account in the app.');
        return dep.id;
      }
      const acct = await this.db.one<{ user_id: string }>(`select user_id from payout_accounts where verify_ref = $1`, [ev.transferId ?? '']);
      if (acct) await this.db.query(`update payout_accounts set verified = $2, updated_at = now() where user_id = $1`, [acct.user_id, ok]);
      return null;
    }
    return null;
  }

  // ---- outcomes -------------------------------------------------------------------

  /** Settled: release to the farmer. Buyer cancelled: forfeit to the farmer. Both are a transfer to the payout account. */
  async release(dealId: string, mode: 'release' | 'forfeit') {
    const r = await this.live(dealId);
    if (!r || !['paid', 'released', 'forfeited'].includes(String(r.status))) return;
    if (r.transfer_id && r.transfer_status !== 'failed') return; // already sent
    const to: DepositStatus = mode === 'release' ? 'released' : 'forfeited';
    // Commission is earned on settlement only. When the buyer walks away the deal
    // never happened, so the platform keeps nothing and the farmer gets the lot.
    const booking = Number(r.booking ?? r.amount);
    const commission = Number(r.commission ?? 0);
    const payout = mode === 'release' ? booking : booking + commission;
    const acct = await this.db.one<Record<string, unknown>>(`select * from payout_accounts where user_id = $1`, [r.farmer_id]);
    if (!acct || !acct.verified) {
      await this.db.query(
        `update deposits set status = $2::deposit_status, closed_at = coalesce(closed_at, now()), transfer_status = 'pending', failure_reason = 'farmer has no verified payout account yet', updated_at = now() where id = $1`,
        [r.id, to],
      );
      await this.db.query(`update deals set deposit_status = $2::deposit_status where id = $1`, [dealId, to]);
      void this.deals.notify(String(r.farmer_id), `Presyo ng Hayop: ${peso(payout)} from the deposit is yours. Add your GCash or bank account under Me to receive it.`);
      return;
    }
    const result = await this.provider.transfer({
      reference: `${mode}-${String(r.id).slice(0, 8)}`,
      amountCentavos: Math.round(payout * 100),
      kind: acct.kind as 'gcash' | 'bank',
      accountNo: String(acct.account_no),
      accountName: String(acct.account_name),
      bankCode: (acct.bank_code as string | null) ?? null,
    });
    await this.db.tx(async (q) => {
      await q.query(
        `update deposits set status = $2::deposit_status, closed_at = coalesce(closed_at, now()), transfer_id = $3, transfer_status = $4, failure_reason = $5, updated_at = now() where id = $1`,
        [r.id, to, result.transferId, result.status, result.failureReason ?? null],
      );
      await q.query(`update deals set deposit_status = $2::deposit_status where id = $1`, [dealId, to]);
      if (result.status !== 'failed') {
        await q.query(`insert into ledger_entries (deposit_id, deal_id, kind, amount, reference) values ($1, $2, $3, $4::numeric, $5)`, [r.id, dealId, mode === 'release' ? 'release' : 'forfeit_payout', (-payout).toFixed(2), result.transferId]);
        await q.query(`insert into ledger_entries (deposit_id, deal_id, kind, amount, reference) values ($1, $2, 'transfer_fee', $3::numeric, $4)`, [r.id, dealId, (-TRANSFER_FEE_PESOS).toFixed(2), result.transferId]);
      }
    });
    if (result.status === 'failed') {
      void this.deals.notify(String(r.farmer_id), `Presyo ng Hayop: your deposit payout of ${peso(payout)} failed (${result.failureReason ?? 'transfer refused'}). Check your payout account.`);
    } else {
      void this.deals.notify(String(r.farmer_id), `Presyo ng Hayop: ${peso(payout)} from the booking deposit is on its way to your ${acct.kind === 'gcash' ? 'GCash' : 'bank account'}${mode === 'forfeit' ? ' (buyer cancelled, the whole deposit is forfeited to you)' : ''}.`);
    }
  }

  /** Farmer cancelled, or admin decided for the buyer: refund the whole amount. */
  async refund(dealId: string, reason: string) {
    const r = await this.live(dealId);
    if (!r) return;
    if (r.status === 'pending') {
      await this.lapseRow(r, 'deal cancelled before the deposit was paid');
      return;
    }
    if (r.status !== 'paid') return;
    const amount = Number(r.amount);
    const result = await this.provider.refund(String(r.payment_id ?? ''), Math.round(amount * 100), reason);
    await this.db.tx(async (q) => {
      await q.query(
        `update deposits set status = 'refunded', closed_at = now(), transfer_id = $2, transfer_status = $3, failure_reason = $4, updated_at = now() where id = $1`,
        [r.id, result.transferId, result.status, result.failureReason ?? null],
      );
      await q.query(`update deals set deposit_status = 'refunded' where id = $1`, [dealId]);
      if (result.status !== 'failed') await q.query(`insert into ledger_entries (deposit_id, deal_id, kind, amount, reference) values ($1, $2, 'refund', $3::numeric, $4)`, [r.id, dealId, (-amount).toFixed(2), result.transferId]);
    });
    void this.deals.notify(String(r.buyer_id), `Presyo ng Hayop: your booking deposit of ${peso(amount)} is being refunded (${reason}). Wallets usually receive it within 24 hours.`);
  }

  async decide(dealId: string, decision: DepositDecision) {
    if (decision === 'release_to_farmer') return this.release(dealId, 'release');
    if (decision === 'refund_to_buyer') return this.refund(dealId, 'admin resolved the dispute for the buyer');
  }

  private async lapseRow(r: Record<string, unknown>, note: string) {
    await this.db.query(`update deposits set status = 'lapsed', closed_at = now(), failure_reason = $2, updated_at = now() where id = $1 and status = 'pending'`, [r.id, note]);
    await this.db.query(`update deals set deposit_status = 'lapsed' where id = $1`, [r.deal_id]);
    if (r.checkout_id) await this.provider.expireCheckout(String(r.checkout_id)).catch(() => undefined);
  }

  /** Scheduler: lapse unpaid deposits past their window (the acceptance lapses with them) and retry payouts that waited for an account. */
  async sweep() {
    const due = await this.db.query<Record<string, unknown>>(`select * from deposits where status = 'pending' and expires_at < now()`);
    for (const r of due.rows) {
      await this.lapseRow(r, `not paid within ${this.config.DEPOSIT_PAY_WINDOW_MINUTES} minutes`);
      await this.deals.systemCancel(String(r.deal_id), `booking deposit of ${money(r.amount)} not paid within ${this.config.DEPOSIT_PAY_WINDOW_MINUTES} minutes; acceptance lapsed`).catch((e) => this.log.warn(`lapse ${r.deal_id}: ${(e as Error).message}`));
    }
    const waiting = await this.db.query<Record<string, unknown>>(
      `select dp.deal_id, dp.status::text as status from deposits dp join payout_accounts pa on pa.user_id = dp.farmer_id and pa.verified
        where dp.status in ('released', 'forfeited') and dp.transfer_id is null`,
    );
    for (const w of waiting.rows) await this.release(String(w.deal_id), w.status === 'released' ? 'release' : 'forfeit').catch((e) => this.log.warn(`retry payout ${w.deal_id}: ${(e as Error).message}`));
    return { lapsed: due.rows.length, payouts_retried: waiting.rows.length };
  }

  // ---- payout account -------------------------------------------------------------

  private acctDto(r: Record<string, unknown>) {
    const no = String(r.account_no);
    return {
      kind: r.kind as 'gcash' | 'bank',
      account_no: no,
      account_no_masked: no.length > 4 ? `${'*'.repeat(no.length - 4)}${no.slice(-4)}` : no,
      account_name: String(r.account_name),
      bank_code: (r.bank_code as string | null) ?? null,
      verified: Boolean(r.verified),
      updated_at: isoTime(r.updated_at)!,
    };
  }

  async getPayoutAccount(user: AccessClaims) {
    const r = await this.db.one<Record<string, unknown>>(`select * from payout_accounts where user_id = $1`, [user.sub]);
    if (!r) throw ProblemException.notFound('No payout account yet');
    return this.acctDto(r);
  }

  async putPayoutAccount(user: AccessClaims, input: { kind: 'gcash' | 'bank'; account_no: string; account_name: string; bank_code?: string | null }) {
    if (!user.roles.includes('farmer')) throw ProblemException.forbidden('Farmer role required');
    if (input.kind === 'bank' && !input.bank_code) throw ProblemException.validation([{ field: 'bank_code', message: 'Bank code is required for a bank account' }]);
    if (input.kind === 'gcash' && !/^(09|\+639)\d{9}$/.test(input.account_no)) throw ProblemException.validation([{ field: 'account_no', message: 'GCash number must be a Philippine mobile number' }]);
    const name = await this.db.one<{ full_name: string }>(`select full_name from users where id = $1`, [user.sub]);
    if (name && name.full_name.trim().toLowerCase() !== input.account_name.trim().toLowerCase()) {
      throw ProblemException.validation([{ field: 'account_name', message: `The account name must match the name on your ID (${name.full_name})` }]);
    }
    // One-peso test transfer proves the account exists. Verified at once when the provider answers synchronously,
    // otherwise when its transfer.succeeded webhook arrives.
    let verified = false;
    let ref: string | null = null;
    if (this.enabled) {
      const t = await this.provider.transfer({ reference: `verify-${user.sub.slice(0, 8)}`, amountCentavos: 100, kind: input.kind, accountNo: input.account_no, accountName: input.account_name, bankCode: input.bank_code ?? null });
      if (t.status === 'failed') throw ProblemException.validation([{ field: 'account_no', message: `Test transfer failed: ${t.failureReason ?? 'account refused'}` }]);
      verified = t.status === 'succeeded';
      ref = t.transferId;
    }
    await this.db.query(
      `insert into payout_accounts (user_id, kind, account_no, account_name, bank_code, verified, verify_ref)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (user_id) do update set kind = excluded.kind, account_no = excluded.account_no, account_name = excluded.account_name,
         bank_code = excluded.bank_code, verified = excluded.verified, verify_ref = excluded.verify_ref, updated_at = now()`,
      [user.sub, input.kind, input.account_no.trim(), input.account_name.trim(), input.bank_code ?? null, verified, ref],
    );
    return this.getPayoutAccount(user);
  }

  // ---- admin ------------------------------------------------------------------------

  async adminList(status: DepositStatus | undefined, limit: number) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `${DEPOSIT_SQL} ${status ? 'where dp.status = $2::deposit_status' : ''} order by dp.created_at desc limit $1`,
      status ? [limit, status] : [limit],
    );
    const t = await this.db.one<Record<string, string>>(
      `select coalesce(sum(net) filter (where status = 'paid'), 0)::text as held,
              coalesce(sum(booking) filter (where status = 'paid'), 0)::text as owed_to_farmers,
              coalesce(sum(net) filter (where status = 'released'), 0)::text as released,
              coalesce(sum(net) filter (where status = 'forfeited'), 0)::text as forfeited,
              coalesce(sum(amount) filter (where status = 'refunded'), 0)::text as refunded,
              coalesce(sum(commission) filter (where status = 'released'), 0)::text as commission_earned,
              count(*) filter (where status = 'pending')::text as pending_count
         from deposits`,
    );
    return {
      items: rows.map((r) => this.dto(r, false)),
      totals: { held: money(t?.held)!, owed_to_farmers: money(t?.owed_to_farmers ?? 0)!, released: money(t?.released)!, forfeited: money(t?.forfeited)!, refunded: money(t?.refunded)!, commission_earned: money(t?.commission_earned ?? 0)!, pending_count: int(t?.pending_count ?? 0) },
    };
  }
}
