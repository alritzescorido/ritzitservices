import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProblemFilter } from './common/problem.js';
import { AppConfigModule } from './config.module.js';
import { DbModule } from './db/db.module.js';
import { FarmsModule } from './farms/farms.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { MarketModule } from './market/market.module.js';
import { PricesModule } from './prices/prices.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [AppConfigModule, DbModule, StorageModule, AuthModule, UsersModule, LocationsModule, PricesModule, FarmsModule, MarketModule, AdminModule, JobsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}
