-- Phase 2 marketplace columns for databases created before 14 Sep 2026.
-- db/schema.sql already contains all of this for fresh databases; this file
-- brings an existing one up to date. Idempotent.
--   node api/scripts/load-sql.mjs --db api/.data/demo --file db/migrations/0002_phase2_marketplace.sql
alter table offers add column if not exists needs_hauler boolean not null default true;
alter table offers add column if not exists pickup_on date;
alter table offers add column if not exists note text;
alter table offers add column if not exists responded_by uuid references users(id);
alter table offers add column if not exists responded_at timestamptz;
create index if not exists offers_status_expires_at_idx on offers (status, expires_at) where status = 'pending';

alter table deals add column if not exists payment_method text;
alter table deals add column if not exists payment_reference text;
alter table deals add column if not exists buyer_paid_at timestamptz;
alter table deals add column if not exists farmer_confirmed_at timestamptz;
alter table deals add column if not exists delivery_note text;
alter table deals add column if not exists cancel_reason text;

-- A dismissed dispute returns the deal to delivered so the parties can finish payment.
create or replace function deal_transition_allowed(p_from deal_state, p_to deal_state)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('accepted','hauler_assigned'), ('accepted','delivered'),
    ('accepted','cancelled'),
    ('hauler_assigned','in_transit'), ('hauler_assigned','cancelled'),
    ('in_transit','delivered'),
    ('delivered','settled'), ('delivered','disputed'),
    ('disputed','settled'), ('disputed','refunded'), ('disputed','delivered')
  );
$$;
