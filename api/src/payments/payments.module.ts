import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CONFIG, type AppConfig } from '../config.js';
import { MarketModule } from '../market/market.module.js';
import { DepositsService } from './deposits.service.js';
import { FakePaymentProvider, PAYMENT_PROVIDER, PayMongoProvider } from './payment.provider.js';
import { PaymentsController } from './payments.controller.js';

@Module({
  imports: [AuthModule, MarketModule],
  controllers: [PaymentsController],
  providers: [
    DepositsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [CONFIG],
      // 'off' still gets the fake so payout-account verification and admin lists work; DepositsService checks `enabled` before asking for money.
      useFactory: (config: AppConfig) => (config.PAYMENTS_PROVIDER === 'paymongo' ? new PayMongoProvider(config) : new FakePaymentProvider(config)),
    },
  ],
  exports: [DepositsService],
})
export class PaymentsModule {}
