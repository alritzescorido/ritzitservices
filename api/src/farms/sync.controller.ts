import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AccessClaims } from '../auth/auth.guard.js';
import { parseOr } from '../common/problem.js';
import { SyncOperationZ, SyncService } from './sync.service.js';

const SyncBatch = z.object({ operations: z.array(SyncOperationZ).min(1).max(200) });

@Controller('sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Post()
  @HttpCode(200)
  async apply(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    const { operations } = parseOr(SyncBatch, body);
    return { results: await this.sync.apply(user.sub, user.roles, operations) };
  }
}
