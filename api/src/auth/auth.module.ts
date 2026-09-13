import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { CONFIG, type AppConfig } from '../config.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ConsoleSmsProvider, SMS_PROVIDER } from './sms.provider.js';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'livestock-price-board' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'livestock-price-board' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [JwtModule, SMS_PROVIDER],
})
export class AuthModule {}
