// One-off: settings an admin can change from the console without a deploy.
// Deliberately a tiny key/value table: the shape of each value is owned and
// validated by api/src/settings/settings.service.ts, and every change writes an
// audit row like any other admin action.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('create table platform_settings')) {
  console.log('already patched');
  process.exit(0);
}
const anchor = `create table job_runs (`;
if (!s.includes(anchor)) {
  console.error('anchor not found');
  process.exit(1);
}
s = s.replace(
  anchor,
  () => `-- Settings an admin changes from the console. The environment supplies the
-- value used the first time a key is asked for; after that this table is the
-- truth, so a rate change does not need a deploy.
create table platform_settings (
  key         text primary key,
  value       text not null,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now()
);

create table job_runs (`,
);
writeFileSync(path, s);
console.log('schema.sql: platform_settings');
