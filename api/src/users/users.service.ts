import { Inject, Injectable } from '@nestjs/common';
import { DbService, type Queryable } from '../db/db.service.js';
import { isoTime, maskPhone } from '../common/format.js';
import { ProblemException } from '../common/problem.js';

export interface UserDto {
  id: string;
  phone_masked: string;
  full_name: string;
  preferred_lang: string;
  roles: string[];
  verification: string;
  verified_at: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  phone_e164: string;
  full_name: string;
  preferred_lang: string;
  verification: string;
  verified_at: string | null;
  created_at: string;
  roles: string[] | null;
}

const SELECT = `
  select u.id, u.phone_e164, u.full_name, u.preferred_lang, u.verification::text as verification,
         u.verified_at::text as verified_at, u.created_at::text as created_at,
         coalesce(array_agg(r.role::text order by r.role) filter (where r.role is not null), '{}') as roles
    from users u left join user_roles r on r.user_id = u.id`;

@Injectable()
export class UsersService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  toDto(row: UserRow): UserDto {
    return {
      id: row.id,
      phone_masked: maskPhone(row.phone_e164),
      full_name: row.full_name,
      preferred_lang: row.preferred_lang,
      roles: row.roles ?? [],
      verification: row.verification,
      verified_at: isoTime(row.verified_at),
      created_at: isoTime(row.created_at)!,
    };
  }

  async byId(id: string, q: Queryable = this.db): Promise<UserDto> {
    const { rows } = await q.query<UserRow>(`${SELECT} where u.id = $1 group by u.id`, [id]);
    if (!rows[0]) throw ProblemException.notFound('User not found');
    return this.toDto(rows[0]);
  }

  /** Find by phone or create with an empty name; the profile step fills it in. */
  async findOrCreateByPhone(phone: string, q: Queryable = this.db): Promise<{ user: UserDto; created: boolean }> {
    const existing = await q.query<UserRow>(`${SELECT} where u.phone_e164 = $1 group by u.id`, [phone]);
    if (existing.rows[0]) return { user: this.toDto(existing.rows[0]), created: false };
    const created = await q.query<{ id: string }>(
      `insert into users (phone_e164, full_name) values ($1, '') returning id`,
      [phone],
    );
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
}
