import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type AccessClaims } from '../auth/auth.guard.js';
import { parseOr } from '../common/problem.js';
import { StorageService } from './storage.service.js';

const CreateUpload = z.object({
  purpose: z.enum(['user_document', 'farm_photo', 'lot_photo', 'vaccination_doc', 'shipment_photo']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  byte_size: z.coerce.number().int().min(1),
});

@Controller('uploads')
export class UploadsController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** Step one of an upload: get a slot. Step two is the PUT to upload_url. */
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    const { purpose, content_type, byte_size } = parseOr(CreateUpload, body);
    return this.storage.createSlot(user.sub, purpose, content_type, byte_size);
  }

  // Local storage provider endpoints. The token carries the grant, so these
  // are public in the auth sense; the signature is the credential.
  @Public()
  @Put('local/:token')
  async putLocal(@Param('token') token: string, @Req() req: Request) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return this.storage.putLocal(token, req.headers['content-type'], Buffer.concat(chunks));
  }

  @Public()
  @Get('local/:token')
  async getLocal(@Param('token') token: string, @Res() res: Response) {
    const { body, contentType } = await this.storage.getLocal(token);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  }
}
