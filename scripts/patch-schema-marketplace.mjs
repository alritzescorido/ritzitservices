// One-off: Phase 2 columns. Offers carry the buyer's hauling choice and a note;
// deals record the off-platform payment as both sides confirm it.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('payment_reference')) {
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
  `  expires_at       timestamptz not null,
  status           offer_status not null default 'pending',
  created_at       timestamptz not null default now()
);
create index on offers (listing_id, status);`,
  `  expires_at       timestamptz not null,
  status           offer_status not null default 'pending',
  needs_hauler     boolean not null default true,   -- buyer books a hauler in the app, or brings a truck
  pickup_on        date,                            -- buyer's proposed pickup day
  note             text,
  responded_by     uuid references users(id),       -- who accepted, rejected or countered it
  responded_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index on offers (listing_id, status);
create index on offers (status, expires_at) where status = 'pending';`,
);

rep(
  `  accepted_at        timestamptz not null default now(),
  delivered_at       timestamptz,
  settled_at         timestamptz,
  cancelled_at       timestamptz,`,
  `  -- Off-platform payment for the pilot (decision 3): the buyer records how they paid,
  -- the farmer confirms receipt, and only then does the deal settle.
  payment_method     text,                          -- 'gcash' | 'bank' | 'cash'
  payment_reference  text,
  buyer_paid_at      timestamptz,
  farmer_confirmed_at timestamptz,
  delivery_note      text,
  cancel_reason      text,
  accepted_at        timestamptz not null default now(),
  delivered_at       timestamptz,
  settled_at         timestamptz,
  cancelled_at       timestamptz,`,
);

writeFileSync(path, s);
console.log('schema.sql: offers.needs_hauler/pickup_on/note/responded_*, deals payment columns added');
