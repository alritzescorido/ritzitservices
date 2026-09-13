-- Price engine: running_price() fallback ladder and refresh_price_snapshots().
-- Starts from zero deals and zero snapshots (01_deal_state_machine.sql truncates).

-- 1. Nothing at all: ladder bottoms out at 'reference' with no price. The API
--    renders this as "no data", never as a bare number.
do $$
declare r record;
begin
  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.source = 'reference', 'source ' || r.source;
  assert r.median_price is null, 'no price';
  assert r.sample_count = 0, 'sample 0';
  assert r.muni_count = 0, 'muni count 0';
  assert r.location_code = '0304900000', 'location is the province';
  raise notice 'ok 1: empty ladder';
end $$;

-- 2. Reference price: species-wide row, then a class-specific row wins for its class,
--    and as_of respects effective_from.
do $$
declare r record;
begin
  insert into reference_prices (province_code, species, weight_class_id, unit, price, source, effective_from, set_by)
  values ('0304900000', 'hog', null, 'per_kg_liveweight', 175, 'PSA farmgate test', current_date - 30, '00000000-0000-0000-0000-000000000003');

  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.source = 'reference' and r.median_price = 175, 'species-wide reference used';

  insert into reference_prices (province_code, species, weight_class_id, unit, price, source, effective_from, set_by)
  values ('0304900000', 'hog', test_hog_class(), 'per_kg_liveweight', 180, 'trader survey test', current_date - 1, '00000000-0000-0000-0000-000000000003');

  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.median_price = 180, 'class-specific reference preferred: ' || r.median_price;

  select * into r from running_price('hog', test_hog_class(), '0304924000', current_date - 10);
  assert r.median_price = 175, 'as_of before class row falls back to species-wide: ' || r.median_price;
  raise notice 'ok 2: reference fallback';
end $$;

-- 3. Three settled deals in Talavera: below the municipality threshold (5),
--    meets the province threshold (3). Ladder answers at province level.
do $$
declare r record; n integer;
begin
  perform test_settled_deal('0304924000', 180);
  perform test_settled_deal('0304924000', 185);
  perform test_settled_deal('0304924000', 190);
  n := refresh_price_snapshots(current_date, 7);
  assert n = 2, 'one municipality row + one province row, got ' || n;

  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.source = 'province', 'source ' || r.source;
  assert r.median_price = 185, 'province median ' || r.median_price;
  assert r.sample_count = 3, 'sample ' || r.sample_count;
  assert r.low_price = 180 and r.high_price = 190, 'band';
  assert r.muni_median = 185 and r.muni_count = 3, 'thin municipality figure still returned for greying out';

  -- Cabanatuan has no deals of its own but shares the province.
  select * into r from running_price('hog', test_hog_class(), '0304905000');
  assert r.source = 'province' and r.median_price = 185, 'neighbour municipality gets province';
  assert r.muni_count = 0 and r.muni_median is null, 'neighbour muni figure empty';
  raise notice 'ok 3: province rung';
end $$;

-- 4. Five deals: municipality rung.
do $$
declare r record;
begin
  perform test_settled_deal('0304924000', 195);
  perform test_settled_deal('0304924000', 200);
  perform refresh_price_snapshots(current_date, 7);

  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.source = 'municipality', 'source ' || r.source;
  assert r.median_price = 190, 'muni median ' || r.median_price;
  assert r.sample_count = 5, 'sample ' || r.sample_count;
  assert r.location_code = '0304924000', 'location is the municipality';
  raise notice 'ok 4: municipality rung';
end $$;

-- 5. Trailing window: a deal settled 8 days ago is out, 6 days ago is in.
do $$
declare r record;
begin
  perform test_settled_deal('0304924000', 250, now() - interval '8 days');
  perform refresh_price_snapshots(current_date, 7);
  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.sample_count = 5 and r.median_price = 190, '8-day-old deal excluded';

  perform test_settled_deal('0304924000', 250, now() - interval '6 days');
  perform refresh_price_snapshots(current_date, 7);
  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.sample_count = 6, '6-day-old deal included, sample ' || r.sample_count;
  assert r.median_price = 192.5, 'median of 6 is midpoint 192.5, got ' || r.median_price;
  assert r.high_price = 250, 'high 250';
  raise notice 'ok 5: window edges';
end $$;

-- 6. Refunded and outlier deals never enter the snapshot.
do $$
declare r record; v uuid;
begin
  v := test_new_deal('0304924000', 100);
  update deals set state = 'delivered' where id = v;
  update deals set state = 'disputed'  where id = v;
  update deals set state = 'refunded'  where id = v;

  v := test_settled_deal('0304924000', 400);   -- > 40 percent above 192.5, flagged by trigger
  assert (select outlier_flag from deals where id = v), 'outlier flagged';

  perform refresh_price_snapshots(current_date, 7);
  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.sample_count = 6 and r.median_price = 192.5, 'refund and outlier excluded';
  raise notice 'ok 6: exclusions';
end $$;

-- 7. 30-day change compares to the snapshot exactly 30 days earlier, same window.
do $$
declare r record;
begin
  insert into price_snapshots (snapshot_date, location_code, location_level, species, weight_class_id, unit, window_days,
                               median_price, low_price, high_price, sample_count)
  values (current_date - 30, '0304924000', 'municipality', 'hog', test_hog_class(), 'per_kg_liveweight', 7, 175, 170, 180, 6);
  perform refresh_price_snapshots(current_date, 7);
  select * into r from running_price('hog', test_hog_class(), '0304924000');
  assert r.change_30d_pct = 10.00, '(192.5-175)/175 = 10 percent, got ' || coalesce(r.change_30d_pct::text, 'null');
  raise notice 'ok 7: 30-day change';
end $$;

-- 8. Refresh is idempotent: rerun upserts, no duplicate rows.
do $$
declare n1 integer; n2 integer; c integer;
begin
  n1 := refresh_price_snapshots(current_date, 7);
  n2 := refresh_price_snapshots(current_date, 7);
  assert n1 = n2, 'same row count on rerun';
  select count(*) into c from price_snapshots
   where snapshot_date = current_date and location_code = '0304924000' and species = 'hog'
     and weight_class_id = test_hog_class() and window_days = 7;
  assert c = 1, 'exactly one row per key per day, got ' || c;
  raise notice 'ok 8: idempotent refresh';
end $$;

-- 9. Weight classes are never blended: a different hog class has its own ladder.
do $$
declare r record; other smallint;
begin
  select id into other from weight_classes where species = 'hog' and label = '60-80 kg';
  select * into r from running_price('hog', other, '0304924000');
  assert r.source = 'reference', 'other class has no deals, falls to reference: ' || r.source;
  assert r.median_price = 175, 'species-wide reference covers the other class: ' || coalesce(r.median_price::text, 'null');
  raise notice 'ok 9: classes isolated';
end $$;

-- 10. Optimistic lock: farm and lot versions bump on update.
do $$
declare v0 integer; v1 integer;
begin
  select version into v0 from farms where id = '10000000-0000-0000-0000-000000000001';
  update farms set name = 'Talavera Farm 2' where id = '10000000-0000-0000-0000-000000000001';
  select version into v1 from farms where id = '10000000-0000-0000-0000-000000000001';
  assert v1 = v0 + 1, 'farm version bump';
  select version into v0 from livestock_lots where id = '20000000-0000-0000-0000-000000000001';
  update livestock_lots set head_count = 19 where id = '20000000-0000-0000-0000-000000000001';
  select version into v1 from livestock_lots where id = '20000000-0000-0000-0000-000000000001';
  assert v1 = v0 + 1, 'lot version bump';
  raise notice 'ok 10: version bump';
end $$;

do $$ begin raise notice 'price engine tests passed'; end $$;
