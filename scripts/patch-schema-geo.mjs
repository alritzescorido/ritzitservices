// One-off: add engine-neutral helpers for the geo_point domain to db/schema.sql.
// geo_from_lnglat(lng, lat) builds a point; geo_lnglat(g) reads one back as "lng lat".
// PostGIS and the plain-Postgres fallback need different expressions, so both are
// created inside the existing DO block that picks the domain implementation.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');

const before = `    execute 'create domain geo_point as geography(point, 4326)';
    execute 'create domain geo_multipolygon as geography(multipolygon, 4326)';
  else
    execute 'create domain geo_point as point';
    execute 'create domain geo_multipolygon as polygon';
  end if;`;

const after = `    execute 'create domain geo_point as geography(point, 4326)';
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
  end if;`;

if (!s.includes(before)) {
  console.error('anchor not found; schema already patched or changed');
  process.exit(1);
}
s = s.replace(before, after);
writeFileSync(path, s);
console.log('schema.sql: geo helpers added');
