-- Test fixtures. Run after schema.sql on a fresh database (see db/tests/run.sh).
-- Fixed UUIDs so the other test files can reference rows without lookups.
-- Location codes are well-formed 10-digit PSGC-style codes, not real ones.

-- Locations: one region, one province, two municipalities, one barangay each.
insert into locations (psgc_code, parent_code, level, name) values
  ('0300000000', null,         'region',       'Central Luzon'),
  ('0304900000', '0300000000', 'province',     'Nueva Ecija'),
  ('0304924000', '0304900000', 'municipality', 'Talavera'),
  ('0304905000', '0304900000', 'municipality', 'Cabanatuan City'),
  ('0304924001', '0304924000', 'barangay',     'Bakal I'),
  ('0304905001', '0304905000', 'barangay',     'Aduas Centro');

-- Users: farmer in Talavera, farmer in Cabanatuan, one buyer, one admin.
insert into users (id, phone_e164, full_name, verification) values
  ('00000000-0000-0000-0000-000000000001', '+639170000001', 'Farmer Talavera',   'verified'),
  ('00000000-0000-0000-0000-000000000002', '+639170000002', 'Buyer One',         'verified'),
  ('00000000-0000-0000-0000-000000000003', '+639170000003', 'Admin One',         'verified'),
  ('00000000-0000-0000-0000-000000000004', '+639170000004', 'Farmer Cabanatuan', 'verified');
insert into user_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'farmer'),
  ('00000000-0000-0000-0000-000000000002', 'buyer'),
  ('00000000-0000-0000-0000-000000000003', 'admin'),
  ('00000000-0000-0000-0000-000000000004', 'farmer');

-- Farms and one hog lot each, average 90 kg (weight class "80-100 kg").
insert into farms (id, owner_id, name, barangay_code, farm_type) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Talavera Farm',   '0304924001', 'backyard'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'Cabanatuan Farm', '0304905001', 'backyard');

insert into livestock_lots (id, farm_id, species, head_count, avg_weight_kg, weight_class_id)
select '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'hog', 20, 90, id
  from weight_classes where species = 'hog' and label = '80-100 kg';
insert into livestock_lots (id, farm_id, species, head_count, avg_weight_kg, weight_class_id)
select '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'hog', 20, 90, id
  from weight_classes where species = 'hog' and label = '80-100 kg';

-- ---------------------------------------------------------------------
-- Helpers used by the test files.
-- ---------------------------------------------------------------------

-- Hog weight class id for 80-100 kg.
create or replace function test_hog_class() returns smallint language sql stable as $$
  select id from weight_classes where species = 'hog' and label = '80-100 kg';
$$;

-- Create listing + accepted offer + deal in state 'accepted' for a municipality.
-- p_muni must be '0304924000' (Talavera) or '0304905000' (Cabanatuan).
create or replace function test_new_deal(p_muni text, p_price numeric, p_heads integer default 10)
returns uuid language plpgsql as $$
declare
  v_farmer uuid; v_lot uuid; v_listing uuid; v_offer uuid; v_deal uuid;
begin
  if p_muni = '0304924000' then
    v_farmer := '00000000-0000-0000-0000-000000000001'; v_lot := '20000000-0000-0000-0000-000000000001';
  elsif p_muni = '0304905000' then
    v_farmer := '00000000-0000-0000-0000-000000000004'; v_lot := '20000000-0000-0000-0000-000000000002';
  else
    raise exception 'unknown test municipality %', p_muni;
  end if;

  insert into listings (lot_id, farmer_id, heads_offered, unit, asking_price)
  values (v_lot, v_farmer, p_heads, 'per_kg_liveweight', p_price)
  returning id into v_listing;

  insert into offers (listing_id, buyer_id, offered_by, price, heads, expires_at, status)
  values (v_listing, '00000000-0000-0000-0000-000000000002', 'buyer', p_price, p_heads, now() + interval '1 day', 'accepted')
  returning id into v_offer;

  insert into deals (listing_id, offer_id, farmer_id, buyer_id, species, weight_class_id, unit,
                     agreed_price, agreed_heads, agreed_weight_kg, municipality_code, province_code, needs_hauler)
  values (v_listing, v_offer, v_farmer, '00000000-0000-0000-0000-000000000002', 'hog', test_hog_class(), 'per_kg_liveweight',
          p_price, p_heads, p_heads * 90, p_muni, '0304900000', false)
  returning id into v_deal;

  return v_deal;
end;
$$;

-- Walk a deal accepted -> delivered -> settled (buyer self-hauls), settling at p_at.
create or replace function test_settle(p_deal uuid, p_at timestamptz default now())
returns void language plpgsql as $$
begin
  update deals set state = 'delivered', delivered_heads = agreed_heads, delivered_weight_kg = agreed_weight_kg where id = p_deal;
  update deals set state = 'settled', settled_at = p_at where id = p_deal;
end;
$$;

-- Create and settle in one call. Returns the deal id.
create or replace function test_settled_deal(p_muni text, p_price numeric, p_at timestamptz default now())
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := test_new_deal(p_muni, p_price);
  perform test_settle(v, p_at);
  return v;
end;
$$;

do $$ begin raise notice 'fixtures loaded'; end $$;
