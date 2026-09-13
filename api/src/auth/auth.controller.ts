import { Body, Controller, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseOr } from '../common/problem.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, type AccessClaims } from './auth.guard.js';

const Phone = z.string().regex(/^\+63[0-9]{10}$/, 'Use the +63 format, e.g. +639171234567');
const Device = z.object({
  device_id: z.string().min(1).max(120),
  platform: z.enum(['android', 'ios', 'web']),
  push_token: z.string().max(500).optional(),
  app_version: z.string().max(40).optional(),
});
const RequestOtp = z.object({ phone: Phone });
const VerifyOtp = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^[0-9]{6}$/, 'Code is 6 digits'),
  device: Device.optional(),
});
const Refresh = z.object({ refresh_token: z.string().min(20) });
const Logout = z.object({ refresh_token: z.string().min(20).optional() }).optional();

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  requestOtp(@Body() body: unknown, @Ip() ip: string) {
    const { phone } = parseOr(RequestOtp, body);
    return this.auth.requestOtp(phone, ip || null);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() body: unknown) {
    const { challenge_id, code, device } = parseOr(VerifyOtp, body);
    return this.auth.verifyOtp(challenge_id, code, device);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    const { refresh_token } = parseOr(Refresh, body);
    return this.auth.refresh(refresh_token);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    const parsed = parseOr(Logout, body ?? undefined);
    await this.auth.logout(user.sub, parsed?.refresh_token);
  }
}
