import { Body, Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AccessClaims } from '../auth/auth.guard.js';
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

@Controller('me')
export class MeController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

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
}
