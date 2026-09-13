import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ProblemFilter } from './common/problem.js';
import { AppConfigModule } from './config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { LocationsModule } from './locations/locations.module.js';
import { PricesModule } from './prices/prices.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [AppConfigModule, DbModule, AuthModule, UsersModule, LocationsModule, PricesModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}
