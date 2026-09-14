// One-off: deposits through a payment gateway (decision 3 as proposed in
// docs/payments-paymongo.md), farmer payout accounts, a ledger, and the webhook
// inbox. The deal keeps its state machine; the deposit rides alongside it as
// deposit_status, so "booked" in the blueprint is accepted + deposit paid.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('create table deposits')) {
  console.log('already patched');
  process.exit(0);
}
const rep = (a, b) => {
  if (!s.includes(a)) {
    console.error(`anchor not found: ${a.slice(0, 60)}`);
    process.exit(1);
  }
  s = s.replace(a, () => b);
};

rep(
  `create type price_source as enum ('municipality', 'province', 'reference');`,
  `create type price_source as enum ('municipality', 'province', 'reference');
create type deposit_status as enum ('pending', 'paid', 'lapsed', 'released', 'forfeited', 'refunded');`,
);

rep(
  `  needs_hauler       boolean not null default true,
  outlier_flag       boolean not null default false,  -- >40% from province median`,
  `  needs_hauler       boolean not null default true,
  -- Booking deposit (decision 3): required when a payment provider is configured.
  -- The hauler job is published only once the deposit is paid ("booked").
  deposit_required   boolean not null default false,
  deposit_status     deposit_status,                  -- null when not required
  outlier_flag       boolean not null default false,  -- >40% from province median`,
);

rep(
  `create index on shipment_events (shipment_id, created_at);`,
  `create index on shipment_events (shipment_id, created_at);

-- =====================================================================
-- Payments: booking deposits, payout accounts, ledger, webhook inbox
-- =====================================================================

-- Where a farmer is paid: a GCash number or a bank account. Verified by a
-- one-peso test transfer; the account name must match the ID on file.
create table payout_accounts (
  user_id       uuid primary key references users(id),
  kind          text not null,                        -- 'gcash' | 'bank'
  account_no    text not null,
  account_name  text not null,
  bank_code     text,                                 -- InstaPay/PESONet code for banks
  verified      boolean not null default false,
  verify_ref    text,                                 -- provider transfer id of the test transfer
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per deposit asked of a buyer. Amounts in pesos. The wallet at the
-- provider must equal the sum of net over 'paid' rows plus the float.
create table deposits (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references deals(id),
  buyer_id          uuid not null references users(id),
  farmer_id         uuid not null references users(id),
  status            deposit_status not null default 'pending',
  amount            numeric(10,2) not null check (amount > 0),   -- what the buyer pays
  fee               numeric(10,2),                     -- gateway acceptance fee, known when paid
  net               numeric(10,2),                     -- amount - fee
  provider          text not null,                     -- 'paymongo' | 'fake'
  checkout_id       text,
  checkout_url      text,
  payment_id        text,                              -- provider payment id once paid
  payment_method    text,                              -- gcash, paymaya, qrph, ...
  expires_at        timestamptz not null,              -- pay by this time or the acceptance lapses
  paid_at           timestamptz,
  closed_at         timestamptz,                       -- released, forfeited, refunded or lapsed at
  transfer_id       text,                              -- disbursement or refund id at the provider
  transfer_status   text,                              -- 'pending' | 'succeeded' | 'failed'
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on deposits (deal_id);
create index on deposits (status, expires_at);
create unique index deposits_one_live_per_deal on deposits (deal_id) where status in ('pending', 'paid');

-- Money movements, signed from the platform wallet's point of view.
create table ledger_entries (
  id          bigserial primary key,
  deposit_id  uuid not null references deposits(id),
  deal_id     uuid not null references deals(id),
  kind        text not null,       -- 'deposit_in' | 'gateway_fee' | 'release' | 'forfeit_payout' | 'refund' | 'transfer_fee'
  amount      numeric(12,2) not null,
  reference   text,
  created_at  timestamptz not null default now()
);
create index on ledger_entries (deal_id);

-- Every webhook the provider sent, once. Replays are answered from here.
create table payment_events (
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
);`,
);

rep(
  `    -- 'nightly_snapshots', 'purge_expired'`,
  `    -- 'nightly_snapshots', 'purge_expired', 'deposit_sweep'`,
);
writeFileSync(path, s);
console.log('schema.sql: deposits, payout accounts, ledger, payment events, deal deposit columns');
