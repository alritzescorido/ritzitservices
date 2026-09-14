import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [MarketModule, PaymentsModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class JobsModule {}
