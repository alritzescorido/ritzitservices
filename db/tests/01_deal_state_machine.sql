-- Deal state machine: deals_enforce_transition() and deals_flag_outlier().
-- Each block asserts one behaviour. A failed assert aborts the run with the message.

-- 1. Illegal jump is refused and leaves no event row.
do $$
declare v uuid; v_err text;
begin
  v := test_new_deal('0304924000', 185);
  begin
    update deals set state = 'in_transit' where id = v;
    raise exception 'expected accepted -> in_transit to be refused';
  exception when others then
    v_err := sqlerrm;
  end;
  assert v_err like '%cannot move from accepted to in_transit%', 'wrong error: ' || v_err;
  assert (select state from deals where id = v) = 'accepted', 'state must be unchanged';
  assert (select count(*) from deal_events where deal_id = v) = 0, 'no event on refused transition';
  raise notice 'ok 1: illegal transition refused';
end $$;

-- 2. Happy path with hauler: each step allowed, timestamps and events written.
do $$
declare v uuid;
begin
  v := test_new_deal('0304924000', 185);
  update deals set state = 'hauler_assigned' where id = v;
  update deals set state = 'in_transit'      where id = v;
  update deals set state = 'delivered'       where id = v;
  assert (select delivered_at from deals where id = v) is not null, 'delivered_at set';
  update deals set state = 'settled'         where id = v;
  assert (select settled_at from deals where id = v) is not null, 'settled_at set';
  assert (select counts_for_price from deals where id = v), 'settled deal counts for price';
  assert (select count(*) from deal_events where deal_id = v) = 4, 'four events';
  assert (select array_agg(to_state order by id) from deal_events where deal_id = v)
         = array['hauler_assigned','in_transit','delivered','settled']::deal_state[], 'event order';
  raise notice 'ok 2: happy path with hauler';
end $$;

-- 3. Buyer self-hauls: accepted -> delivered is allowed.
do $$
declare v uuid;
begin
  v := test_new_deal('0304924000', 185);
  update deals set state = 'delivered' where id = v;
  assert (select state from deals where id = v) = 'delivered';
  raise notice 'ok 3: self-haul shortcut';
end $$;

-- 4. Dispute -> refunded excludes the deal from the price board.
do $$
declare v uuid;
begin
  v := test_new_deal('0304924000', 185);
  update deals set state = 'delivered' where id = v;
  update deals set state = 'disputed'  where id = v;
  update deals set state = 'refunded'  where id = v;
  assert (select counts_for_price from deals where id = v) = false, 'refunded must not count';
  assert (select settled_at from deals where id = v) is null, 'refunded has no settled_at';
  raise notice 'ok 4: refund excluded from price';
end $$;

-- 5. Dispute -> settled still counts and stamps settled_at.
do $$
declare v uuid;
begin
  v := test_new_deal('0304924000', 185);
  update deals set state = 'delivered' where id = v;
  update deals set state = 'disputed'  where id = v;
  update deals set state = 'settled'   where id = v;
  assert (select counts_for_price from deals where id = v), 'dispute settled counts';
  assert (select settled_at from deals where id = v) is not null;
  raise notice 'ok 5: dispute resolved to settled';
end $$;

-- 6. Terminal states are terminal.
do $$
declare v uuid; v_err text;
begin
  v := test_settled_deal('0304924000', 185);
  begin
    update deals set state = 'cancelled' where id = v;
    raise exception 'expected settled -> cancelled to be refused';
  exception when others then v_err := sqlerrm; end;
  assert v_err like '%cannot move%', v_err;

  v := test_new_deal('0304924000', 185);
  update deals set state = 'cancelled' where id = v;
  assert (select cancelled_at from deals where id = v) is not null, 'cancelled_at set';
  begin
    update deals set state = 'accepted' where id = v;
    raise exception 'expected cancelled -> accepted to be refused';
  exception when others then v_err := sqlerrm; end;
  assert v_err like '%cannot move%', v_err;
  raise notice 'ok 6: terminal states';
end $$;

-- 7. Non-state updates pass without writing an event.
--    (now() is fixed inside one transaction, so updated_at cannot be compared here.)
do $$
declare v uuid;
begin
  v := test_new_deal('0304924000', 185);
  update deals set delivered_heads = 9 where id = v;
  assert (select delivered_heads from deals where id = v) = 9, 'plain update applied';
  assert (select count(*) from deal_events where deal_id = v) = 0, 'no event for non-state update';
  raise notice 'ok 7: non-state update';
end $$;

-- 8. Outlier flag: needs a province snapshot to compare against.
do $$
declare v uuid; n integer;
begin
  -- Tests 2, 5 and 6 already settled three deals at 185. Add five more and snapshot:
  -- sorted 180,185,185,185,185,190,195,200 -> province median 185.
  perform test_settled_deal('0304924000', 180);
  perform test_settled_deal('0304924000', 185);
  perform test_settled_deal('0304924000', 190);
  perform test_settled_deal('0304924000', 195);
  perform test_settled_deal('0304924000', 200);
  n := refresh_price_snapshots(current_date, 7);
  assert n >= 2, 'snapshot rows written: ' || n;
  assert (select median_price from price_snapshots
           where location_code = '0304900000' and species = 'hog' and weight_class_id = test_hog_class()
             and snapshot_date = current_date) = 185, 'province median 185';

  -- 62 percent above median: flagged, excluded until admin review.
  v := test_settled_deal('0304924000', 300);
  assert (select outlier_flag from deals where id = v), 'outlier flagged';
  assert (select counts_for_price from deals where id = v) = false, 'outlier excluded';

  -- 35 percent above: inside the 40 percent band, counts.
  v := test_settled_deal('0304924000', 250);
  assert (select outlier_flag from deals where id = v) = false, 'inside band not flagged';
  assert (select counts_for_price from deals where id = v), 'inside band counts';

  -- 44 percent below: flagged too (symmetry).
  v := test_settled_deal('0304924000', 104);
  assert (select outlier_flag from deals where id = v), 'low outlier flagged';

  -- Admin review restores it.
  update deals set counts_for_price = true, outlier_reviewed_by = '00000000-0000-0000-0000-000000000003' where id = v;
  assert (select counts_for_price from deals where id = v), 'admin restore';
  raise notice 'ok 8: outlier flagging';
end $$;

-- 9. Cleanup so the price engine tests start from zero deals.
truncate deal_events, deals, offers, listings restart identity cascade;
truncate price_snapshots restart identity;
do $$ begin raise notice 'state machine tests passed'; end $$;
