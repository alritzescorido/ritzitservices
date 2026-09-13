import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FarmsModule } from '../farms/farms.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, UsersModule, FarmsModule, LocationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
