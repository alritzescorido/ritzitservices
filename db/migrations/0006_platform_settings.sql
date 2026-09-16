-- Admin-editable settings, for databases created before 16 Sep 2026. Idempotent.
create table if not exists platform_settings (
  key         text primary key,
  value       text not null,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now()
);
