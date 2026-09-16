import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AccessClaims } from '../auth/auth.guard.js';
import { parseOr } from '../common/problem.js';
import { SettingsService } from './settings.service.js';

const PatchZ = z.object({ key: z.string().min(1).max(60), value: z.union([z.string(), z.number(), z.boolean()]) });

@Controller()
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  /** What the apps need before anyone signs in, such as whether an ID is required. */
  @Public()
  @Get('settings')
  publicSettings() {
    return this.settings.publicSettings();
  }

  @Roles('admin')
  @Get('admin/settings')
  all() {
    return this.settings.all();
  }

  @Roles('admin')
  @Patch('admin/settings')
  set(@CurrentUser() admin: AccessClaims, @Body() body: unknown) {
    const { key, value } = parseOr(PatchZ, body);
    return this.settings.set(admin.sub, key, value);
  }
}
