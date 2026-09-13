import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module.js';
import { PricesModule } from '../prices/prices.module.js';
import { FarmsController } from './farms.controller.js';
import { FarmsService } from './farms.service.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [LocationsModule, PricesModule],
  controllers: [FarmsController, SyncController],
  providers: [FarmsService, SyncService],
  exports: [FarmsService],
})
export class FarmsModule {}
