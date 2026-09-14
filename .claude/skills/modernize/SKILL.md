---
name: modernize
description: Audit and modernise the Livestock Price Board code base in safe, verified steps. Use when the user asks to "modernize", "upgrade dependencies", "clean up", "remove deprecated", "tech debt", "refactor for maintainability", or after a framework or Node release. Also handles the one-off patch scripts that accumulate under scripts/.
---

# Code modernisation for the Livestock Price Board

You are keeping a working, tested system current without breaking it. Every change lands as its own small commit with the checks green before and after. Nothing is upgraded on faith: read the changelog, run the checks, then decide.

## 1. Audit first, report before touching anything

Run and read all of these. Numbers and versions come from tool output, never from memory.

1. **Toolchain.** `node -v`, `npm -v`. Compare with `.github/workflows/ci.yml` (`node-version`) and any `engines` field. CI and the development machine must agree; they diverged once (runs #1 to #5 failed on Node 22 while Node 24 passed locally).
2. **Dependencies.** In `api/` and `web-admin/`: `npm outdated` (columns: Current, Wanted, Latest) and `npm audit --omit=dev` then `npm audit`. Separate three buckets: patch/minor within range (`npm update` takes them), majors (need a changelog read), and audit findings (state severity and whether a fix exists without a major).
3. **Deprecations.** Run `npm run build` in both packages and `npx tsc --noEmit -p tsconfig.json` in `api/`; collect every deprecation warning (for example the vite-tsconfig-paths notice that Vite now resolves paths natively). Run `npm run lint` in both and list rule warnings by rule name with counts.
4. **Repo hygiene.** List `scripts/patch-*.mjs` (one-off contract and schema patches already applied; candidates for deletion once `db/migrations/` and `docs/api/openapi.yaml` carry the result), `db/migrations/*.sql` (are they numbered, idempotent, and all reflected in `db/schema.sql`), TODO/FIXME comments (`rg -n "TODO|FIXME|XXX" api/src web-admin/src db`), and files in `api/src` or `web-admin/src` that nothing imports.
5. **Contract drift.** `npx redocly lint docs/api/openapi.yaml` (0 errors required) and a spot check that every `@Controller` route in `api/src` appears in the contract: `rg -n "@(Get|Post|Put|Patch|Delete)\(" api/src` against the paths list.

Write the audit in the house format (Ritz first line; Verified Facts, Assumptions, Risks & Edge Cases, Recommendations). Recommendations are an ordered list of proposed steps, each with: what changes, why now, what could break, how it is verified. Stop here and let the user pick unless they already said "do it all" or named the steps.

## 2. Apply, one step per commit

For each approved step, in this order of preference:

1. **Patch and minor updates** (`npm update` per package, then `npm ci` from a clean `node_modules` to prove the lockfile installs). Run the full check set (section 4). Commit: `deps(api): patch and minor updates <date>`.
2. **Majors, one package at a time.** Read the release notes first (`npm view <pkg> homepage`, then the changelog or GitHub releases). Upgrade, fix compile errors, run checks, commit with the breaking changes named in the body. If the fix needs more than an hour or touches more than ten files, stop and report instead.
3. **Deprecation removals.** Replace the deprecated API with the documented successor; never suppress the warning.
4. **Cleanup.** Delete applied patch scripts only after confirming `git log -- scripts/<file>` shows the commit that applied them and the target file carries the change. Move any comment worth keeping into the schema or contract itself.
5. **Refactors** only when they remove duplication that has bitten twice (the three `seed-demo-*.mjs` scripts share a `call()` helper, for example) or when a rule below is violated. No rewrites for taste.

Never combine a dependency upgrade with a behaviour change in one commit.

## 3. Rules this code base lives by (do not modernise these away)

- **Two database engines.** Every SQL statement runs on PostgreSQL 15 with PostGIS and on PGlite without it. No PostGIS functions outside the `geo_*` domain helpers in `db/schema.sql`; cast numerics, dates and timestamps to text in `select` lists; no querying the shared connection inside `db.tx` on PGlite (it deadlocks). Verify with `npm run db:test` at the root and the API e2e suite.
- **Contract first.** `docs/api/openapi.yaml` changes before or with the code, lints with 0 errors, and keeps RFC 9457 problem+json, `Idempotency-Key` on mobile writes, `If-Match` versions, money and weights as decimal strings, dates as `YYYY-MM-DD`, timestamps as RFC 3339 UTC.
- **API style.** NestJS with ESM (`.js` import suffixes), explicit `@Inject()` tokens on every constructor parameter, zod through `parseOr`, no parameter properties in the console (`erasableSyntaxOnly`). Money in pesos as strings at the API boundary; centavos only inside the payment provider.
- **Schema.** `db/schema.sql` is the truth for fresh databases; every change to an existing database goes through a numbered, idempotent file in `db/migrations/`. Never edit an applied migration.
- **Windows dev machine, Node only.** No Docker, psql, Python or gh. Heredocs and `node -e` mangle backticks and `$`; write scripts to files under `scripts/` or the scratchpad and use replacer functions with `String.replace`.
- **Attribution.** Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The user pushes with `! git push`.

## 4. The check set (all must be green before every commit)

```bash
npm run -s db:test                                        # repo root, PGlite
cd api && npx tsc --noEmit -p tsconfig.json && npm run -s lint && npm run -s test:e2e
cd web-admin && npm run -s lint && npx vitest run && npm run -s build
npx --no-install redocly lint docs/api/openapi.yaml       # 0 errors; warnings are acceptable
```

Report the test count line from the e2e run. If anything fails, fix or revert the step; never commit red.

## 5. Close out

- Summarise in the house format: what was upgraded (from and to), what was removed, what was left alone and why, and the check verdicts.
- Append a dated entry to `docs/PROGRESS.md` under the heading `Modernisation` with the same facts, newest first.
- Note anything the user must do (push, rotate a key, restart the demo API on port 3000 with the same environment as before).
