import { Inject, Injectable } from '@nestjs/common';
import { DbService, type Queryable } from '../db/db.service.js';
import { isoTime, maskPhone } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { StorageService } from '../storage/storage.service.js';

export interface UserDto {
  id: string;
  phone_masked: string;
  full_name: string;
  preferred_lang: string;
  roles: string[];
  verification: string;
  verification_notes?: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface UserDocumentDto {
  id: string;
  doc_type: string;
  status: string;
  notes: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
}

interface UserRow {
  id: string;
  phone_e164: string;
  full_name: string;
  preferred_lang: string;
  verification: string;
  verification_notes: string | null;
  verified_at: string | null;
  created_at: string;
  roles: string[] | null;
}

const SELECT = `
  select u.id, u.phone_e164, u.full_name, u.preferred_lang, u.verification::text as verification, u.verification_notes,
         u.verified_at::text as verified_at, u.created_at::text as created_at,
         coalesce(array_agg(r.role::text order by r.role) filter (where r.role is not null), '{}') as roles
    from users u left join user_roles r on r.user_id = u.id`;

const DOC_SELECT = `select id, doc_type, status::text as status, notes, uploaded_at::text as uploaded_at, reviewed_at::text as reviewed_at
  from user_documents`;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  toDto(row: UserRow): UserDto {
    return {
      id: row.id,
      phone_masked: maskPhone(row.phone_e164),
      full_name: row.full_name,
      preferred_lang: row.preferred_lang,
      roles: row.roles ?? [],
      verification: row.verification,
      ...(row.verification === 'rejected' || row.verification === 'suspended' ? { verification_notes: row.verification_notes } : {}),
      verified_at: isoTime(row.verified_at),
      created_at: isoTime(row.created_at)!,
    };
  }

  toDocumentDto(r: Record<string, unknown>): UserDocumentDto {
    return {
      id: String(r.id),
      doc_type: String(r.doc_type),
      status: String(r.status),
      notes: (r.notes as string | null) ?? null,
      uploaded_at: isoTime(r.uploaded_at)!,
      reviewed_at: isoTime(r.reviewed_at),
    };
  }

  async byId(id: string, q: Queryable = this.db): Promise<UserDto> {
    const { rows } = await q.query<UserRow>(`${SELECT} where u.id = $1 group by u.id`, [id]);
    if (!rows[0]) throw ProblemException.notFound('User not found');
    return this.toDto(rows[0]);
  }

  /** Raw phone for notifications; never returned to clients. */
  async phoneOf(id: string): Promise<string | null> {
    const row = await this.db.one<{ phone_e164: string }>(`select phone_e164 from users where id = $1`, [id]);
    return row?.phone_e164 ?? null;
  }

  /** Find by phone or create with an empty name; the profile step fills it in. */
  async findOrCreateByPhone(phone: string, q: Queryable = this.db): Promise<{ user: UserDto; created: boolean }> {
    const existing = await q.query<UserRow>(`${SELECT} where u.phone_e164 = $1 group by u.id`, [phone]);
    if (existing.rows[0]) return { user: this.toDto(existing.rows[0]), created: false };
    const created = await q.query<{ id: string }>(`insert into users (phone_e164, full_name) values ($1, '') returning id`, [phone]);
    return { user: await this.byId(created.rows[0].id, q), created: true };
  }

  async update(id: string, patch: { full_name?: string; preferred_lang?: string }): Promise<UserDto> {
    await this.db.query(
      `update users set full_name = coalesce($2, full_name), preferred_lang = coalesce($3, preferred_lang), updated_at = now()
        where id = $1`,
      [id, patch.full_name ?? null, patch.preferred_lang ?? null],
    );
    return this.byId(id);
  }

  async addRole(id: string, role: 'farmer' | 'buyer' | 'hauler'): Promise<UserDto> {
    await this.db.query(`insert into user_roles (user_id, role) values ($1, $2::user_role) on conflict do nothing`, [id, role]);
    return this.byId(id);
  }

  async listDocuments(userId: string): Promise<UserDocumentDto[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(`${DOC_SELECT} where user_id = $1 order by uploaded_at desc`, [userId]);
    return rows.map((r) => this.toDocumentDto(r));
  }

  async registerDocument(userId: string, docType: string, storageKey: string): Promise<UserDocumentDto> {
    if (!this.storage.isValidKey(storageKey) || !storageKey.startsWith(`user_document/${userId}/`)) {
      throw ProblemException.validation([{ field: 'storage_key', message: 'Not one of your user_document uploads' }]);
    }
    if (!(await this.storage.exists(storageKey))) {
      throw ProblemException.validation([{ field: 'storage_key', message: 'File was not uploaded yet. PUT it to upload_url first.' }]);
    }
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into user_documents (user_id, doc_type, storage_key) values ($1, $2, $3)
       returning id, doc_type, status::text as status, notes, uploaded_at::text as uploaded_at, reviewed_at::text as reviewed_at`,
      [userId, docType, storageKey],
    );
    return this.toDocumentDto(rows[0]);
  }

  async touchDevice(userId: string, d: { device_id: string; platform: string; push_token?: string; app_version?: string }) {
    await this.db.query(
      `insert into user_devices (user_id, device_id, platform, push_token, app_version)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, device_id) do update
         set platform = excluded.platform, push_token = coalesce(excluded.push_token, user_devices.push_token),
             app_version = coalesce(excluded.app_version, user_devices.app_version), last_seen_at = now()`,
      [userId, d.device_id, d.platform, d.push_token ?? null, d.app_version ?? null],
    );
  }
}
