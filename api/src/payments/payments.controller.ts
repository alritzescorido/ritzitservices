import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DepositsService } from './deposits.service.js';

const Uuid = z.string().uuid();
const PayoutZ = z.object({
  kind: z.enum(['gcash', 'bank']),
  account_no: z.string().trim().min(6).max(34),
  account_name: z.string().trim().min(2).max(120),
  bank_code: z.string().trim().max(20).nullable().optional(),
});
const StatusZ = z.enum(['pending', 'paid', 'lapsed', 'released', 'forfeited', 'refunded']);
const ListQ = z.object({ status: StatusZ.optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

@Controller()
export class PaymentsController {
  constructor(
    @Inject(DepositsService) private readonly deposits: DepositsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('deals/:deal_id/deposit')
  get(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string) {
    return this.deposits.get(user, parseOr(Uuid, id, 'params'));
  }

  @Post('deals/:deal_id/deposit/checkout')
  async refresh(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), { checkout: dealId }, async () => ({ status: 200, body: await this.deposits.refreshCheckout(user, dealId) }));
    res.status(out.status).json(out.body);
  }

  @Get('me/payout-account')
  payout(@CurrentUser() user: AccessClaims) {
    return this.deposits.getPayoutAccount(user);
  }

  @Put('me/payout-account')
  putPayout(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    return this.deposits.putPayoutAccount(user, parseOr(PayoutZ, body));
  }

  /** Provider callbacks. Signature checked by the provider; events stored once by id. */
  @Public()
  @Post('payments/webhook')
  @HttpCode(200)
  webhook(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.deposits.handleWebhook(raw, req.headers as Record<string, string | string[] | undefined>);
  }

  /** Where the hosted checkout sends the buyer back. The apps intercept this URL; browsers see a plain page. */
  @Public()
  @Get('payments/return')
  returnPage(@Query('result') result: string | undefined, @Res() res: Response) {
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Presyo ng Hayop</title><body style="font-family:system-ui;padding:24px"><h2>${result === 'paid' ? 'Deposit received' : 'Payment not completed'}</h2><p>${result === 'paid' ? 'You can close this page and return to the app.' : 'Return to the app to try again within the payment window.'}</p></body>`);
  }

  /** Fake provider only: a page standing in for the gateway, with a button that fires the paid webhook. */
  @Public()
  @Get('payments/fake/checkout/:checkout_id')
  fakeCheckout(@Param('checkout_id') checkoutId: string, @Query('deposit') depositId: string | undefined, @Query('amount') amount: string | undefined, @Res() res: Response) {
    if (this.config.PAYMENTS_PROVIDER !== 'fake') return res.status(404).type('text').send('not found');
    const pesos = (Number(amount ?? 0) / 100).toFixed(2);
    const body = JSON.stringify({ id: `evt_${checkoutId}`, type: 'checkout.paid', deposit_id: depositId, checkout_id: checkoutId, amount: Number(amount ?? 0), fee: Math.round(Number(amount ?? 0) * 0.0223), payment_method: 'gcash' });
    return res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Fake gateway</title><body style="font-family:system-ui;padding:24px;max-width:480px">
<h2>Fake payment gateway</h2><p>Booking deposit <b>PHP ${pesos}</b>. This page stands in for PayMongo during development.</p>
<button id="pay" style="font-size:16px;padding:10px 18px">Pay with GCash</button> <span id="out"></span>
<script>document.getElementById('pay').onclick=async()=>{const r=await fetch('/v1/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}});document.getElementById('out').textContent=r.ok?'Paid. Return to the app.':'Failed: '+r.status;};</script></body>`);
  }

  @Roles('admin')
  @Get('admin/deposits')
  adminList(@Query() query: unknown) {
    const q = parseOr(ListQ, query, 'query');
    return this.deposits.adminList(q.status, q.limit);
  }
}
