import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FarmsModule } from '../farms/farms.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { MarketModule } from '../market/market.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, UsersModule, FarmsModule, LocationsModule, MarketModule],
  controllers: [AdminController, AdminAuthController],
  providers: [AdminService, AdminAuthService],
  exports: [AdminAuthService],
})
export class AdminModule {}
