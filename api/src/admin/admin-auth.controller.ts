import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AccessClaims } from '../auth/auth.guard.js';
import { parseOr } from '../common/problem.js';
import { AdminAuthService } from './admin-auth.service.js';

const Login = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const Totp = z.object({ step_token: z.string().min(20), code: z.string().regex(/^[0-9]{6}$/, 'Code is 6 digits') });
const ChangePassword = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(12).max(200) });

@Controller('admin/auth')
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly adminAuth: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { email, password } = parseOr(Login, body);
    return this.adminAuth.login(email, password);
  }

  @Public()
  @Post('totp')
  @HttpCode(200)
  totp(@Body() body: unknown) {
    const { step_token, code } = parseOr(Totp, body);
    return this.adminAuth.totp(step_token, code);
  }

  @Roles('admin')
  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() admin: AccessClaims, @Body() body: unknown) {
    const { current_password, new_password } = parseOr(ChangePassword, body);
    await this.adminAuth.changePassword(admin.sub, current_password, new_password);
  }
}
