# Database

PostgreSQL 15 with PostGIS. `schema.sql` is the single source of truth until a
migration tool is chosen with the backend stack.

## Files

| Path | What |
|---|---|
| `schema.sql` | Extensions, enums, all tables, `running_price()` ladder, `refresh_price_snapshots()`, deal state machine triggers, placeholder weight-class seed. |
| `docker-compose.yml` | Local PostGIS on port 5432, user/password/db `lpb`. |
| `tests/00_fixtures.sql` | Test locations, users, farms, lots and the `test_new_deal` / `test_settle` / `test_settled_deal` helpers. |
| `tests/01_deal_state_machine.sql` | Legal and illegal transitions, event log, refund exclusion, outlier flagging. |
| `tests/02_price_engine.sql` | Fallback ladder rungs, thresholds, trailing window, exclusions, 30-day change, idempotent refresh, version bump. |
| `tests/run.sh` | Drops and recreates `lpb_test`, loads the schema, runs the test files in order. |

## Run

```bash
docker compose -f db/docker-compose.yml up -d
bash db/tests/run.sh
```

Every test file is plain SQL with `DO` blocks and `ASSERT`. A failing assert
stops the run with its message, so the output is either `all test files passed`
or the first broken expectation.

To use a Postgres that is not the compose one:

```bash
PSQL="psql -v ON_ERROR_STOP=1 -h localhost -U postgres" bash db/tests/run.sh
```

## Rules the schema enforces

- A deal only changes state along `deal_transition_allowed()`. Anything else raises.
- Only `settled` deals with `counts_for_price = true` feed snapshots. Refunds and
  flagged outliers never do. Admin review sets `counts_for_price` back.
- A settlement more than 40 percent from the latest province median is flagged
  before it counts.
- The board reads `price_snapshots` only. `running_price()` walks municipality
  (5 or more deals), province (3 or more), then `reference_prices`, preferring a
  class-specific reference row over a species-wide one.
- `farms` and `livestock_lots` carry `version`, bumped on every update, for the
  mobile app's `If-Match` optimistic lock.

## Open items

- Weight classes and default units are placeholders until Phase 0 confirms them.
- PSGC seed for `locations` is not in this repo yet. The PSA publishes the code
  list as a spreadsheet; the loader is a Phase 1 task.
- Thresholds in `min_sample_for_level()` are guesses to be tuned against real
  weekly volume (Phase 0 item P5).
