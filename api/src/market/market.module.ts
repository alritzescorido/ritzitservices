import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { PricesModule } from '../prices/prices.module.js';
import { DealsController } from './deals.controller.js';
import { DealsService } from './deals.service.js';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';

@Module({
  imports: [AuthModule, LocationsModule, PricesModule],
  controllers: [MarketController, DealsController],
  providers: [MarketService, DealsService],
  exports: [MarketService, DealsService],
})
export class MarketModule {}
