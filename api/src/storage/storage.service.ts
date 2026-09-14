import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CONFIG, type AppConfig } from '../config.js';
import { ProblemException } from '../common/problem.js';

// Documents and photos never get public URLs. Clients get a short-lived signed
// PUT URL to upload, and admins get a 5-minute signed GET URL to view. The
// local provider keeps files under UPLOAD_DIR and serves them through this API;
// an S3 provider will hand out real pre-signed URLs with the same interface.
export type UploadPurpose = 'user_document' | 'farm_photo' | 'lot_photo' | 'vaccination_doc' | 'shipment_photo';
export type ContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const MAX_BYTES: Record<UploadPurpose, number> = {
  user_document: 10 * 1024 * 1024,
  vaccination_doc: 10 * 1024 * 1024,
  farm_photo: 5 * 1024 * 1024,
  lot_photo: 5 * 1024 * 1024,
  shipment_photo: 5 * 1024 * 1024,
};
const EXT: Record<ContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const KEY_PATTERN = /^(user_document|farm_photo|lot_photo|vaccination_doc|shipment_photo)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export interface UploadSlot {
  storage_key: string;
  upload_url: string;
  expires_at: string;
  headers: Record<string, string>;
}

interface Grant {
  key: string;
  op: 'put' | 'get';
  ct?: string;
  size?: number;
  exp: number;
}

@Injectable()
export class StorageService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** Storage keys are `<purpose>/<owner id>/<random>.<ext>`; the owner segment scopes admin lookups. */
  createSlot(ownerId: string, purpose: UploadPurpose, contentType: ContentType, byteSize: number): UploadSlot {
    if (byteSize > MAX_BYTES[purpose]) {
      throw ProblemException.payloadTooLarge(`${purpose} files may be at most ${MAX_BYTES[purpose] / 1024 / 1024} MB`);
    }
    if (purpose !== 'user_document' && purpose !== 'vaccination_doc' && contentType === 'application/pdf') {
      throw ProblemException.validation([{ field: 'content_type', message: 'Photos must be JPEG, PNG or WebP' }]);
    }
    const key = `${purpose}/${ownerId}/${randomUUID()}.${EXT[contentType]}`;
    const exp = Date.now() + 15 * 60 * 1000;
    const token = this.sign({ key, op: 'put', ct: contentType, size: byteSize, exp });
    return {
      storage_key: key,
      upload_url: `${this.config.PUBLIC_BASE_URL}/v1/uploads/local/${token}`,
      expires_at: new Date(exp).toISOString(),
      headers: { 'Content-Type': contentType },
    };
  }

  /** Short-lived read URL for admins; the caller logs the access. */
  viewUrl(key: string, ttlSeconds = 300): { url: string; expires_at: string } {
    const exp = Date.now() + ttlSeconds * 1000;
    return {
      url: `${this.config.PUBLIC_BASE_URL}/v1/uploads/local/${this.sign({ key, op: 'get', exp })}`,
      expires_at: new Date(exp).toISOString(),
    };
  }

  isValidKey(key: string) {
    return KEY_PATTERN.test(key);
  }

  /** True when the object was actually uploaded (so a document row never points at nothing). */
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  // ---- local provider ------------------------------------------------------

  async putLocal(token: string, contentType: string | undefined, body: Buffer) {
    const g = this.verify(token);
    if (g.op !== 'put') throw ProblemException.forbidden('Not an upload URL');
    if (contentType?.split(';')[0].trim() !== g.ct) throw ProblemException.badRequest(`Content-Type must be ${g.ct}`);
    if (body.length > (g.size ?? 0)) throw ProblemException.payloadTooLarge('Upload is larger than declared');
    if (body.length === 0) throw ProblemException.badRequest('Empty upload');
    if (!sniffMatches(g.ct!, body)) throw ProblemException.badRequest('File content does not match its declared type');
    const path = this.pathFor(g.key);
    mkdirSync(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { storage_key: g.key, bytes: body.length };
  }

  async getLocal(token: string): Promise<{ body: Buffer; contentType: string }> {
    const g = this.verify(token);
    if (g.op !== 'get') throw ProblemException.forbidden('Not a download URL');
    const path = this.pathFor(g.key);
    if (!existsSync(path)) throw ProblemException.notFound('File not found');
    const ext = g.key.slice(g.key.lastIndexOf('.') + 1) as keyof typeof EXT_TO_CT;
    return { body: await readFile(path), contentType: EXT_TO_CT[ext] ?? 'application/octet-stream' };
  }

  private pathFor(key: string) {
    if (!this.isValidKey(key)) throw ProblemException.badRequest('Invalid storage key');
    return resolve(join(this.config.UPLOAD_DIR, key));
  }

  private sign(g: Grant): string {
    const payload = Buffer.from(JSON.stringify(g)).toString('base64url');
    const mac = createHmac('sha256', this.config.JWT_SECRET).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }

  private verify(token: string): Grant {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) throw ProblemException.forbidden('Bad storage token');
    const expected = createHmac('sha256', this.config.JWT_SECRET).update(payload).digest();
    const given = Buffer.from(mac, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw ProblemException.forbidden('Bad storage token');
    const g = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Grant;
    if (g.exp < Date.now()) throw ProblemException.forbidden('Storage URL expired');
    return g;
  }
}

const EXT_TO_CT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** Magic-byte check so a renamed executable cannot be stored as a "photo". */
function sniffMatches(ct: string, b: Buffer): boolean {
  switch (ct) {
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8;
    case 'image/png':
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/webp':
      return b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/pdf':
      return b.subarray(0, 4).toString('ascii') === '%PDF';
    default:
      return false;
  }
}
