import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { MarketModule } from '../market/market.module.js';
import { LogisticsController } from './logistics.controller.js';
import { LogisticsService } from './logistics.service.js';

@Module({
  imports: [AuthModule, LocationsModule, MarketModule],
  controllers: [LogisticsController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
