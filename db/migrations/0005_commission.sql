-- Splits the booking deposit into the farmer's assurance and the platform's
-- commission, for databases created before 15 Sep 2026. Idempotent.
-- Existing rows are all commission-free, so booking equals what was charged.
alter table deposits add column if not exists booking numeric(10,2);
alter table deposits add column if not exists commission numeric(10,2) not null default 0;
alter table deposits add column if not exists commission_pct numeric(5,2) not null default 0;
update deposits set booking = amount where booking is null;
alter table deposits alter column booking set not null;
