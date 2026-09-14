-- Phase 3 logistics columns for databases created before 14 Sep 2026.
-- db/schema.sql has all of this for fresh databases. Idempotent.
alter table offers add column if not exists dropoff_location_code text references locations(psgc_code);
alter table deals add column if not exists dropoff_location_code text references locations(psgc_code);
alter table shipments add column if not exists vehicle_plate text;
alter table shipments add column if not exists photo_keys text[] not null default '{}';
alter table shipments add column if not exists cancel_reason text;
alter table shipments drop constraint if exists shipments_deal_id_key;
create unique index if not exists shipments_one_live_per_deal on shipments (deal_id) where status <> 'cancelled';
alter table shipment_events add column if not exists kind text;

create or replace function deal_transition_allowed(p_from deal_state, p_to deal_state)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('accepted','hauler_assigned'), ('accepted','delivered'),
    ('accepted','cancelled'),
    ('hauler_assigned','in_transit'), ('hauler_assigned','cancelled'),
    ('hauler_assigned','accepted'),
    ('in_transit','delivered'),
    ('delivered','settled'), ('delivered','disputed'),
    ('disputed','settled'), ('disputed','refunded'), ('disputed','delivered')
  );
$$;
