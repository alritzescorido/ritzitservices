import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [MarketModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class JobsModule {}
