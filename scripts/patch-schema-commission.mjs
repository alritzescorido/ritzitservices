// One-off: split the deposit into the farmer's booking assurance and the
// platform's commission. The buyer pays both in one charge; only the booking
// is ever promised to the farmer.
//
// The rule the code enforces: commission is earned on settlement only. If the
// deal fails the platform takes nothing.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('commission_pct')) {
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
  `  amount            numeric(10,2) not null check (amount > 0),   -- what the buyer pays`,
  `  amount            numeric(10,2) not null check (amount > 0),   -- what the buyer pays: booking + commission
  booking           numeric(10,2) not null,            -- the farmer's assurance, released to them on settlement
  commission        numeric(10,2) not null default 0,  -- the platform's fee, kept only when the deal settles
  commission_pct    numeric(5,2) not null default 0,   -- rate in force when the deal was struck, kept for history`,
);

writeFileSync(path, s);
console.log('schema.sql: deposits split into booking and commission');
