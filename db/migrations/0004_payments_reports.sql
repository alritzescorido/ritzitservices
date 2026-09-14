-- Deposits, payout accounts, ledger and webhook inbox for databases created
-- before 14 Sep 2026 (later). db/schema.sql has all of this for fresh databases.
-- Idempotent. Run outside a transaction: the enum creation is guarded.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'deposit_status') then
    create type deposit_status as enum ('pending', 'paid', 'lapsed', 'released', 'forfeited', 'refunded');
  end if;
end $$;

alter table deals add column if not exists deposit_required boolean not null default false;
alter table deals add column if not exists deposit_status deposit_status;

create table if not exists payout_accounts (
  user_id       uuid primary key references users(id),
  kind          text not null,
  account_no    text not null,
  account_name  text not null,
  bank_code     text,
  verified      boolean not null default false,
  verify_ref    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists deposits (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references deals(id),
  buyer_id          uuid not null references users(id),
  farmer_id         uuid not null references users(id),
  status            deposit_status not null default 'pending',
  amount            numeric(10,2) not null check (amount > 0),
  fee               numeric(10,2),
  net               numeric(10,2),
  provider          text not null,
  checkout_id       text,
  checkout_url      text,
  payment_id        text,
  payment_method    text,
  expires_at        timestamptz not null,
  paid_at           timestamptz,
  closed_at         timestamptz,
  transfer_id       text,
  transfer_status   text,
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists deposits_deal_id_idx on deposits (deal_id);
create index if not exists deposits_status_expires_at_idx on deposits (status, expires_at);
create unique index if not exists deposits_one_live_per_deal on deposits (deal_id) where status in ('pending', 'paid');

create table if not exists ledger_entries (
  id          bigserial primary key,
  deposit_id  uuid not null references deposits(id),
  deal_id     uuid not null references deals(id),
  kind        text not null,
  amount      numeric(12,2) not null,
  reference   text,
  created_at  timestamptz not null default now()
);
create index if not exists ledger_entries_deal_id_idx on ledger_entries (deal_id);

create table if not exists payment_events (
  id           bigserial primary key,
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  deposit_id   uuid references deposits(id),
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (provider, event_id)
);
