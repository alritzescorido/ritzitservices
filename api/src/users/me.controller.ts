import { Body, Controller, Get, Headers, HttpCode, Inject, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr, ProblemException } from '../common/problem.js';
import { UsersService } from './users.service.js';

const UpdateMe = z
  .object({
    full_name: z.string().trim().min(2).max(120).optional(),
    preferred_lang: z.enum(['fil', 'en', 'ceb', 'ilo', 'hil', 'bcl', 'war']).optional(),
  })
  .refine((v) => v.full_name !== undefined || v.preferred_lang !== undefined, {
    message: 'Send full_name or preferred_lang',
    path: ['full_name'],
  });

const AddRole = z.object({ role: z.enum(['farmer', 'buyer', 'hauler', 'admin']) });

const RegisterDocument = z.object({
  doc_type: z.enum(['gov_id', 'selfie_with_id', 'business_permit', 'ltfrb_franchise', 'or_cr', 'coop_membership', 'barangay_clearance']),
  storage_key: z.string().max(200),
});

const Device = z.object({
  device_id: z.string().min(1).max(120),
  platform: z.enum(['android', 'ios', 'web']),
  push_token: z.string().max(500).optional(),
  app_version: z.string().max(40).optional(),
});

@Controller('me')
export class MeController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  @Get()
  me(@CurrentUser() user: AccessClaims) {
    return this.users.byId(user.sub);
  }

  @Patch()
  update(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    return this.users.update(user.sub, parseOr(UpdateMe, body));
  }

  @Post('roles')
  @HttpCode(200)
  addRole(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    const { role } = parseOr(AddRole, body);
    if (role === 'admin') throw ProblemException.forbidden('Admin accounts are created by a national admin');
    return this.users.addRole(user.sub, role);
  }

  @Get('documents')
  async documents(@CurrentUser() user: AccessClaims) {
    return { items: await this.users.listDocuments(user.sub) };
  }

  /** Step two of a document upload: the file is in storage, now attach it to the account for review. */
  @Post('documents')
  async registerDocument(@CurrentUser() user: AccessClaims, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const input = parseOr(RegisterDocument, body);
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), input, async () => ({
      status: 201,
      body: await this.users.registerDocument(user.sub, input.doc_type, input.storage_key),
    }));
    res.status(out.status).json(out.body);
  }

  @Post('devices')
  @HttpCode(204)
  async registerDevice(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    await this.users.touchDevice(user.sub, parseOr(Device, body));
  }
}
