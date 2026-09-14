// One-off: Phase 3 columns. Where the buyer wants the animals delivered, what the
// hauler drove and photographed, and one more legal transition: a hauler who
// backs out before pickup puts the deal back on the job board.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('dropoff_location_code')) {
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
  `  pickup_on        date,                            -- buyer's proposed pickup day
  note             text,`,
  `  pickup_on        date,                            -- buyer's proposed pickup day
  dropoff_location_code text references locations(psgc_code), -- where the buyer wants the animals delivered
  note             text,`,
);
rep(
  `  municipality_code  text not null references locations(psgc_code), -- farm's municipality
  province_code      text not null references locations(psgc_code),`,
  `  municipality_code  text not null references locations(psgc_code), -- farm's municipality
  province_code      text not null references locations(psgc_code),
  dropoff_location_code text references locations(psgc_code),         -- buyer's delivery point, for the haul job`,
);
rep(
  `  agreed_fee            numeric(10,2),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on shipments (hauler_id, status);`,
  `  agreed_fee            numeric(10,2),
  vehicle_plate         text,                      -- copied from the hauler profile at acceptance
  photo_keys            text[] not null default '{}',  -- pickup and delivery photos, storage keys
  cancel_reason         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on shipments (hauler_id, status);`,
);
rep(
  `    ('hauler_assigned','in_transit'), ('hauler_assigned','cancelled'),`,
  `    ('hauler_assigned','in_transit'), ('hauler_assigned','cancelled'),
    ('hauler_assigned','accepted'),                                   -- hauler withdrew before pickup, job reopens`,
);
rep('  deal_id               uuid not null unique references deals(id),', '  deal_id               uuid not null references deals(id),');
rep('create index on shipments (hauler_id, status);', "create index on shipments (hauler_id, status);
create unique index shipments_one_live_per_deal on shipments (deal_id) where status <> 'cancelled'; -- a withdrawn hauler frees the job");
rep('  status      shipment_status not null,
  geo         geo_point,', '  status      shipment_status not null,
  kind        text,                -- position | checkpoint | delay | problem | pickup | handover | cancelled
  geo         geo_point,');
writeFileSync(path, s);
console.log('schema.sql: dropoff codes, shipment plate/photos/cancel reason, hauler withdrawal transition');
