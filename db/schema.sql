-- Livestock Price Board — PostgreSQL schema draft v0.2
-- Target: PostgreSQL 15+ with PostGIS.
-- Status: draft for review. Weight classes and default price units are
-- placeholders until Phase 0 field validation confirms them.
--
-- Layout
--   1. Extensions and enums
--   2. Identity: users, roles, documents, auth (OTP, refresh tokens, devices, idempotency)
--   3. Geography: PSGC locations, restricted zones
--   4. Farms and livestock lots
--   5. Marketplace: listings, offers, deals, deal events
--   6. Logistics: shipments, shipment events
--   7. Trust: disputes, ratings, admin audit log
--   8. Prices: weight classes, reference prices, price snapshots
--   9. Price engine: running_price() ladder and refresh_price_snapshots()
--  10. Deal state machine trigger

-- =====================================================================
-- 1. Extensions and enums
-- =====================================================================
-- PostGIS is used in production for the geography columns below. Local test runs
-- (PGlite, plain Postgres on Windows) may not have it, so the extension is
-- optional: without it the geo_* domains fall back to the built-in point and
-- polygon types. No function in this schema calls ST_*; only column types differ.
do $$ begin
  create extension if not exists postgis;
exception when others then
  raise notice 'postgis not available, using built-in point/polygon fallback';
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'postgis') then
    execute 'create domain geo_point as geography(point, 4326)';
    execute 'create domain geo_multipolygon as geography(multipolygon, 4326)';
    execute $f$create function geo_from_lnglat(lng double precision, lat double precision) returns geo_point
      language sql immutable strict as 'select ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography::geo_point'$f$;
    execute $f$create function geo_lnglat(g geo_point) returns text
      language sql immutable strict as 'select ST_X($1::geometry)::text || '' '' || ST_Y($1::geometry)::text'$f$;
  else
    execute 'create domain geo_point as point';
    execute 'create domain geo_multipolygon as polygon';
    execute $f$create function geo_from_lnglat(lng double precision, lat double precision) returns geo_point
      language sql immutable strict as 'select point($1, $2)::geo_point'$f$;
    execute $f$create function geo_lnglat(g geo_point) returns text
      language sql immutable strict as 'select ($1)[0]::text || '' '' || ($1)[1]::text'$f$;
  end if;
end $$;
create extension if not exists pgcrypto;

create type user_role as enum ('farmer', 'buyer', 'hauler', 'admin');
create type verification_status as enum ('pending', 'verified', 'rejected', 'suspended');
create type species as enum ('hog', 'cattle', 'carabao', 'goat', 'native_chicken');
create type price_unit as enum ('per_kg_liveweight', 'per_head');
create type location_level as enum ('region', 'province', 'municipality', 'barangay');
create type listing_status as enum ('active', 'matched', 'withdrawn', 'expired');
create type offer_status as enum ('pending', 'countered', 'accepted', 'rejected', 'expired');
create type deal_state as enum (
  'accepted', 'hauler_assigned', 'in_transit', 'delivered',
  'settled', 'cancelled', 'disputed', 'refunded'
);
create type shipment_status as enum ('assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled');
create type dispute_status as enum ('open', 'under_review', 'resolved_settled', 'resolved_refunded', 'dismissed');
create type price_source as enum ('municipality', 'province', 'reference');

-- =====================================================================
-- 2. Identity
-- =====================================================================
create table users (
  id              uuid primary key default gen_random_uuid(),
  phone_e164      text not null unique,           -- +639XXXXXXXXX
  full_name       text not null,
  preferred_lang  text not null default 'fil',    -- 'fil' | 'en' | regional code
  verification    verification_status not null default 'pending',
  verified_at     timestamptz,
  verified_by     uuid references users(id),
  verification_notes text,                        -- reviewer note, shown to the user when rejected
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One account can hold several roles (a farmer who also hauls).
create table user_roles (
  user_id   uuid not null references users(id) on delete cascade,
  role      user_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table user_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  doc_type     text not null,        -- 'gov_id', 'business_permit', 'ltfrb_franchise', 'or_cr', ...
  storage_key  text not null,        -- object storage path, never a public URL
  status       verification_status not null default 'pending',
  reviewed_by  uuid references users(id),
  reviewed_at  timestamptz,
  notes        text,
  uploaded_at  timestamptz not null default now()
);
create index on user_documents (user_id);
create index on user_documents (status) where status = 'pending';

-- Phone OTP login. Codes are stored hashed; the SMS gateway sees the plaintext once.
create table auth_otp_challenges (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text not null,
  code_hash    text not null,
  attempts     smallint not null default 0,          -- locked at 5
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  request_ip   inet,
  created_at   timestamptz not null default now()
);
create index on auth_otp_challenges (phone_e164, created_at desc);

-- One row per issued refresh token. Rotated on every refresh; reuse of a
-- consumed token revokes the whole family (same device session).
create table refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  family_id    uuid not null,
  token_hash   text not null unique,
  device_id    text,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index on refresh_tokens (user_id);
create index on refresh_tokens (family_id);

create table user_devices (
  user_id      uuid not null references users(id) on delete cascade,
  device_id    text not null,                        -- app-generated per install
  platform     text not null,                        -- 'android' | 'ios' | 'web'
  push_token   text,
  app_version  text,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- Idempotency-Key store so an offline queue can retry a POST safely. Purge after 48 h.
create table idempotency_keys (
  key            uuid not null,
  user_id        uuid not null references users(id) on delete cascade,
  request_hash   text not null,                      -- same key + different body = 422
  response_code  smallint,
  response_body  jsonb,
  created_at     timestamptz not null default now(),
  primary key (user_id, key)
);
create index on idempotency_keys (created_at);

-- =====================================================================
-- 3. Geography
-- =====================================================================
-- Seeded from the Philippine Standard Geographic Code (PSGC).
-- The price board, filters and farm addresses all share this one tree.
create table locations (
  psgc_code   text primary key,                 -- 10-digit PSGC
  parent_code text references locations(psgc_code),
  level       location_level not null,
  name        text not null,
  centroid    geo_point,
  boundary    geo_multipolygon,    -- optional, for maps
  active      boolean not null default true
);
create index on locations (parent_code);
create index on locations (level);
create index on locations using gist (centroid);

-- Admin-marked movement restrictions (e.g. African swine fever zones).
create table restricted_zones (
  id            uuid primary key default gen_random_uuid(),
  location_code text not null references locations(psgc_code),
  species       species not null,
  reason        text not null,
  starts_on     date not null,
  ends_on       date,                            -- null = open-ended
  set_by        uuid not null references users(id),
  created_at    timestamptz not null default now()
);
create index on restricted_zones (location_code, species);

-- =====================================================================
-- 4. Farms and livestock lots
-- =====================================================================
create table farms (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references users(id),
  name           text not null,
  barangay_code  text not null references locations(psgc_code),
  address_line   text,
  geo            geo_point,
  farm_type      text,                            -- 'backyard', 'commercial', 'cooperative'
  permit_ref     text,
  photo_keys     text[] not null default '{}',   -- storage keys, max 5, never public URLs
  version        integer not null default 1,      -- optimistic lock for offline edits (If-Match)
  archived_at    timestamptz,                     -- soft delete
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on farms (owner_id);
create index on farms (barangay_code);

-- Species-specific weight bands. Prices are never blended across bands.
create table weight_classes (
  id       smallserial primary key,
  species  species not null,
  label    text not null,          -- '80-100 kg'
  min_kg   numeric(7,2),
  max_kg   numeric(7,2),
  unit     price_unit not null,    -- per_kg_liveweight or per_head
  sort     smallint not null,
  unique (species, label)
);

-- Version 1 tracks lots, not individual animals.
create table livestock_lots (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references farms(id) on delete cascade,
  species          species not null,
  breed            text,
  head_count       integer not null check (head_count > 0),
  avg_weight_kg    numeric(7,2) check (avg_weight_kg > 0),
  weight_class_id  smallint references weight_classes(id),
  age_months       smallint,
  sex              text,                          -- 'male','female','mixed'
  notes            text,
  photo_keys       text[] not null default '{}',
  version          integer not null default 1,    -- optimistic lock for offline edits (If-Match)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on livestock_lots (farm_id);

create table vaccination_records (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid not null references livestock_lots(id) on delete cascade,
  vaccine     text not null,
  given_on    date not null,
  given_by    text,
  doc_key     text,                               -- optional scanned record
  created_at  timestamptz not null default now()
);
create index on vaccination_records (lot_id);

-- =====================================================================
-- 5. Marketplace
-- =====================================================================
create table listings (
  id                    uuid primary key default gen_random_uuid(),
  lot_id                uuid not null references livestock_lots(id),
  farmer_id             uuid not null references users(id),
  heads_offered         integer not null check (heads_offered > 0),
  unit                  price_unit not null,
  asking_price          numeric(10,2) not null check (asking_price > 0),
  -- snapshot of what the board showed when the farmer listed, for analysis
  board_price_at_listing numeric(10,2),
  board_source_at_listing price_source,
  available_from        date not null default current_date,
  pickup_window_end     date,
  status                listing_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on listings (status, available_from);
create index on listings (farmer_id);

create table offers (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references listings(id),
  buyer_id         uuid not null references users(id),
  parent_offer_id  uuid references offers(id),     -- counter-offer chain
  offered_by       user_role not null check (offered_by in ('farmer','buyer')),
  price            numeric(10,2) not null check (price > 0),
  heads            integer not null check (heads > 0),
  expires_at       timestamptz not null,
  status           offer_status not null default 'pending',
  created_at       timestamptz not null default now()
);
create index on offers (listing_id, status);
create index on offers (buyer_id);

create table deals (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references listings(id),
  offer_id           uuid not null unique references offers(id),
  farmer_id          uuid not null references users(id),
  buyer_id           uuid not null references users(id),
  species            species not null,
  weight_class_id    smallint references weight_classes(id),
  unit               price_unit not null,
  agreed_price       numeric(10,2) not null check (agreed_price > 0),
  agreed_heads       integer not null check (agreed_heads > 0),
  agreed_weight_kg   numeric(9,2),                 -- listed basis
  delivered_heads    integer,
  delivered_weight_kg numeric(9,2),                -- actual at scale
  municipality_code  text not null references locations(psgc_code), -- farm's municipality
  province_code      text not null references locations(psgc_code),
  state              deal_state not null default 'accepted',
  needs_hauler       boolean not null default true,
  outlier_flag       boolean not null default false,  -- >40% from province median
  outlier_reviewed_by uuid references users(id),
  counts_for_price   boolean not null default true,   -- false once refunded or rejected as outlier
  accepted_at        timestamptz not null default now(),
  delivered_at       timestamptz,
  settled_at         timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on deals (state);
create index on deals (municipality_code, species, settled_at) where state = 'settled';
create index on deals (province_code, species, settled_at) where state = 'settled';
create index on deals (farmer_id);
create index on deals (buyer_id);

-- Every state change, who did it, from where. Immutable.
create table deal_events (
  id          bigserial primary key,
  deal_id     uuid not null references deals(id) on delete cascade,
  from_state  deal_state,
  to_state    deal_state not null,
  actor_id    uuid references users(id),
  note        text,
  geo         geo_point,
  created_at  timestamptz not null default now()
);
create index on deal_events (deal_id, created_at);

-- =====================================================================
-- 6. Logistics
-- =====================================================================
create table hauler_profiles (
  user_id        uuid primary key references users(id) on delete cascade,
  vehicle_plate  text not null,
  vehicle_type   text,
  capacity_heads integer,
  capacity_kg    numeric(9,2),
  rate_per_head  numeric(10,2),
  rate_per_trip  numeric(10,2),
  service_area   text[],                           -- PSGC province/municipality codes
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table shipments (
  id                    uuid primary key default gen_random_uuid(),
  deal_id               uuid not null unique references deals(id),
  hauler_id             uuid not null references users(id),
  status                shipment_status not null default 'assigned',
  shipping_permit_no    text,                      -- required before pickup
  vet_health_cert_no    text,                      -- required before pickup
  head_count_at_pickup  integer,
  scheduled_pickup_at   timestamptz,
  picked_up_at          timestamptz,
  delivered_at          timestamptz,
  agreed_fee            numeric(10,2),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on shipments (hauler_id, status);

create table shipment_events (
  id          bigserial primary key,
  shipment_id uuid not null references shipments(id) on delete cascade,
  status      shipment_status not null,
  geo         geo_point,
  photo_key   text,
  note        text,
  created_at  timestamptz not null default now()
);
create index on shipment_events (shipment_id, created_at);

-- =====================================================================
-- 7. Trust
-- =====================================================================
create table disputes (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references deals(id),
  raised_by     uuid not null references users(id),
  reason        text not null,                      -- 'weight_mismatch', 'health', 'non_payment', 'no_show', 'other'
  details       text,
  status        dispute_status not null default 'open',
  resolved_by   uuid references users(id),
  resolution    text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index on disputes (status) where status in ('open','under_review');

create table ratings (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id),
  rater_id    uuid not null references users(id),
  ratee_id    uuid not null references users(id),
  score       smallint not null check (score between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  unique (deal_id, rater_id, ratee_id)
);
create index on ratings (ratee_id);

-- Every admin write lands here. Reference price edits especially.
create table admin_audit_log (
  id          bigserial primary key,
  admin_id    uuid not null references users(id),
  action      text not null,                       -- 'verify_user', 'set_reference_price', 'resolve_dispute', ...
  target_type text not null,
  target_id   text not null,
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz not null default now()
);
create index on admin_audit_log (target_type, target_id);
create index on admin_audit_log (admin_id, created_at);

-- Console sign-in for staff: work email, password, authenticator code.
-- Farmers, buyers and haulers never have a row here; they sign in by phone OTP.
-- Accounts are created by a national admin (api: npm run admin:create), never self-registered.
create table admin_credentials (
  user_id            uuid primary key references users(id) on delete cascade,
  email              text not null unique,           -- lower-cased work email
  password_hash      text not null,                  -- scrypt, format scrypt$N$r$p$salt$hash
  totp_secret        text,                           -- base32; null until first sign-in sets it up
  totp_confirmed_at  timestamptz,
  failed_attempts    smallint not null default 0,    -- locked at 5 for 15 minutes
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Every scheduler run, so ops can see the nightly snapshot happened.
create table job_runs (
  id          bigserial primary key,
  job         text not null,                         -- 'nightly_snapshots', 'purge_expired'
  status      text not null,                         -- 'ok' | 'failed'
  detail      jsonb,
  duration_ms integer,
  ran_at      timestamptz not null default now()
);
create index on job_runs (job, ran_at desc);

-- =====================================================================
-- 8. Prices
-- =====================================================================
-- Admin-set floor for the fallback ladder. Source noted (PSA farmgate
-- series, trader survey) so users can see where a number came from.
create table reference_prices (
  id               uuid primary key default gen_random_uuid(),
  province_code    text not null references locations(psgc_code),
  species          species not null,
  weight_class_id  smallint references weight_classes(id),
  unit             price_unit not null,
  price            numeric(10,2) not null check (price > 0),
  source           text not null,
  effective_from   date not null,
  set_by           uuid not null references users(id),
  created_at       timestamptz not null default clock_timestamp()  -- same-day corrections must order deterministically
);
create index on reference_prices (province_code, species, weight_class_id, effective_from desc);

-- The board reads ONLY from this table. Written nightly and on every
-- settlement by refresh_price_snapshots(). One row per level per class per day.
create table price_snapshots (
  id               bigserial primary key,
  snapshot_date    date not null,
  location_code    text not null references locations(psgc_code),
  location_level   location_level not null,     -- municipality or province
  species          species not null,
  weight_class_id  smallint references weight_classes(id),
  unit             price_unit not null,
  window_days      smallint not null default 7,
  median_price     numeric(10,2),
  low_price        numeric(10,2),
  high_price       numeric(10,2),
  sample_count     integer not null default 0,
  change_30d_pct   numeric(6,2),
  computed_at      timestamptz not null default now(),
  -- nulls not distinct: a null weight_class_id (species-wide row) must still be unique per day
  unique nulls not distinct (snapshot_date, location_code, species, weight_class_id, window_days)
);
create index on price_snapshots (location_code, species, weight_class_id, snapshot_date desc);

-- =====================================================================
-- 9. Price engine
-- =====================================================================
-- Minimum settled deals before a municipality figure is shown on its own.
-- Kept as a function so the threshold can be tuned without a schema change.
create or replace function min_sample_for_level(p_level location_level)
returns integer language sql immutable as $$
  select case p_level when 'municipality' then 5 when 'province' then 3 else 1 end;
$$;

-- Ladder: municipality median -> province median -> admin reference.
-- Returns exactly one row with the level actually used and its evidence,
-- plus the municipality figure (possibly thin) so the UI can grey it out.
create or replace function running_price(
  p_species           species,
  p_weight_class_id   smallint,
  p_municipality_code text,
  p_as_of             date default current_date
)
returns table (
  source          price_source,
  location_code   text,
  median_price    numeric,
  low_price       numeric,
  high_price      numeric,
  sample_count    integer,
  change_30d_pct  numeric,
  muni_median     numeric,
  muni_count      integer
)
language plpgsql stable as $$
#variable_conflict use_column
declare
  v_province text;
  m record;
  p record;
  r record;
begin
  select parent_code into v_province from locations where psgc_code = p_municipality_code;

  select * into m from price_snapshots
   where location_code = p_municipality_code and species = p_species
     and weight_class_id is not distinct from p_weight_class_id
     and snapshot_date <= p_as_of
   order by snapshot_date desc limit 1;

  if m.sample_count >= min_sample_for_level('municipality') then
    return query select 'municipality'::price_source, m.location_code, m.median_price, m.low_price,
                        m.high_price, m.sample_count, m.change_30d_pct, m.median_price, m.sample_count;
    return;
  end if;

  select * into p from price_snapshots
   where location_code = v_province and species = p_species
     and weight_class_id is not distinct from p_weight_class_id
     and snapshot_date <= p_as_of
   order by snapshot_date desc limit 1;

  if p.sample_count >= min_sample_for_level('province') then
    return query select 'province'::price_source, p.location_code, p.median_price, p.low_price,
                        p.high_price, p.sample_count, p.change_30d_pct,
                        m.median_price, coalesce(m.sample_count, 0);
    return;
  end if;

  -- Exact weight class first; a species-wide row (weight_class_id null) covers
  -- any class without its own reference.
  select * into r from reference_prices
   where province_code = v_province and species = p_species
     and (weight_class_id = p_weight_class_id or weight_class_id is null)
     and effective_from <= p_as_of
   order by (weight_class_id is null), effective_from desc, created_at desc limit 1;

  return query select 'reference'::price_source, v_province, r.price, null::numeric, null::numeric,
                      0, null::numeric, m.median_price, coalesce(m.sample_count, 0);
end;
$$;

-- Recompute municipality and province snapshots for one date.
-- Called nightly for current_date and again after each settlement.
create or replace function refresh_price_snapshots(p_date date default current_date, p_window integer default 7)
returns integer language plpgsql as $$
declare
  v_rows integer := 0;
begin
  with settled as (
    select d.*, l.parent_code as prov_from_muni
      from deals d
      join locations l on l.psgc_code = d.municipality_code
     where d.state = 'settled'
       and d.counts_for_price
       and d.settled_at >= (p_date - (p_window - 1)) and d.settled_at < p_date + 1
  ),
  per_level as (
    select municipality_code as location_code, 'municipality'::location_level as lvl, species, weight_class_id, unit, agreed_price from settled
    union all
    select province_code, 'province', species, weight_class_id, unit, agreed_price from settled
  ),
  agg as (
    select location_code, lvl, species, weight_class_id, unit,
           (percentile_cont(0.5) within group (order by agreed_price))::numeric(10,2) as med,
           min(agreed_price) as lo, max(agreed_price) as hi, count(*) as n
      from per_level
     group by location_code, lvl, species, weight_class_id, unit
  ),
  prior as (
    select location_code, species, weight_class_id, median_price
      from price_snapshots
     where snapshot_date = p_date - 30 and window_days = p_window
  ),
  ins as (
    insert into price_snapshots (snapshot_date, location_code, location_level, species, weight_class_id, unit,
                                 window_days, median_price, low_price, high_price, sample_count, change_30d_pct)
    select p_date, a.location_code, a.lvl, a.species, a.weight_class_id, a.unit, p_window,
           a.med, a.lo, a.hi, a.n,
           case when pr.median_price is not null and pr.median_price > 0
                then round((a.med - pr.median_price) / pr.median_price * 100, 2) end
      from agg a
      left join prior pr on pr.location_code = a.location_code and pr.species = a.species
                        and pr.weight_class_id is not distinct from a.weight_class_id
    on conflict (snapshot_date, location_code, species, weight_class_id, window_days) do update
      set median_price = excluded.median_price, low_price = excluded.low_price, high_price = excluded.high_price,
          sample_count = excluded.sample_count, change_30d_pct = excluded.change_30d_pct, computed_at = now()
    returning 1
  )
  select count(*) into v_rows from ins;
  return v_rows;
end;
$$;

-- =====================================================================
-- 10. Deal state machine
-- =====================================================================
create or replace function deal_transition_allowed(p_from deal_state, p_to deal_state)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('accepted','hauler_assigned'), ('accepted','delivered'),      -- buyer self-hauls
    ('accepted','cancelled'),
    ('hauler_assigned','in_transit'), ('hauler_assigned','cancelled'),
    ('in_transit','delivered'),
    ('delivered','settled'), ('delivered','disputed'),
    ('disputed','settled'), ('disputed','refunded')
  );
$$;

create or replace function deals_enforce_transition()
returns trigger language plpgsql as $$
begin
  if new.state <> old.state then
    if not deal_transition_allowed(old.state, new.state) then
      raise exception 'deal % cannot move from % to %', old.id, old.state, new.state;
    end if;
    if new.state = 'settled'   then new.settled_at   := coalesce(new.settled_at, now()); end if;
    if new.state = 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
    if new.state = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
    if new.state = 'refunded'  then new.counts_for_price := false; end if;
    insert into deal_events (deal_id, from_state, to_state) values (old.id, old.state, new.state);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger deals_state_guard
before update on deals
for each row execute function deals_enforce_transition();

-- Flag settlements far from the province median before they count.
create or replace function deals_flag_outlier()
returns trigger language plpgsql as $$
declare
  v_prov_median numeric;
begin
  if new.state = 'settled' and old.state <> 'settled' then
    select median_price into v_prov_median
      from price_snapshots
     where location_code = new.province_code and species = new.species
       and weight_class_id is not distinct from new.weight_class_id
     order by snapshot_date desc limit 1;
    if v_prov_median is not null and abs(new.agreed_price - v_prov_median) / v_prov_median > 0.40 then
      new.outlier_flag := true;
      new.counts_for_price := false;     -- admin review restores it
    end if;
  end if;
  return new;
end;
$$;

create trigger deals_outlier_guard
before update on deals
for each row execute function deals_flag_outlier();

-- Generic updated_at maintenance for the tables that carry it.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

-- Same, plus a version bump for records the mobile app edits offline.
create or replace function touch_versioned() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.version := old.version + 1; return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['users','listings','hauler_profiles','shipments'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
  foreach t in array array['farms','livestock_lots'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_versioned()', t, t);
  end loop;
end $$;

-- =====================================================================
-- Seed: placeholder weight classes (confirm in Phase 0)
-- =====================================================================
insert into weight_classes (species, label, min_kg, max_kg, unit, sort) values
  ('hog', 'under 60 kg',   null, 60,   'per_kg_liveweight', 1),
  ('hog', '60-80 kg',      60,   80,   'per_kg_liveweight', 2),
  ('hog', '80-100 kg',     80,   100,  'per_kg_liveweight', 3),
  ('hog', '100-120 kg',    100,  120,  'per_kg_liveweight', 4),
  ('hog', 'over 120 kg',   120,  null, 'per_kg_liveweight', 5),
  ('cattle', 'under 250 kg', null, 250, 'per_kg_liveweight', 1),
  ('cattle', '250-350 kg',   250,  350, 'per_kg_liveweight', 2),
  ('cattle', '350-450 kg',   350,  450, 'per_kg_liveweight', 3),
  ('cattle', 'over 450 kg',  450,  null,'per_kg_liveweight', 4),
  ('carabao', 'all',        null, null, 'per_kg_liveweight', 1),
  ('goat', 'kid',           null, 15,   'per_head', 1),
  ('goat', 'grower',        15,   25,   'per_head', 2),
  ('goat', 'mature',        25,   null, 'per_head', 3),
  ('native_chicken', 'all', null, null, 'per_head', 1);
