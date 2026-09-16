# Admin console

React 19, Vite, TypeScript. Talks only to the API in `api/`; it holds no data of its own.

## Run locally

```bash
# terminal 1: the API on port 3000 (see api/README.md)
cd api && npm run start:dev

# terminal 2: the console on port 5173, proxying /v1 to the API
cd web-admin && npm install && npm run dev
```

Create a console admin first, once:

```bash
cd api && npm run admin:create -- --phone +639170000001 --email you@example.ph --name "Your Name" --password '<at least 12 characters>'
```

Sign in at http://localhost:5173 with that email and password. The first sign-in shows an authenticator secret; add it to Google Authenticator, Authy or Aegis and enter the code.

## Screens

| Route | Wireframe | What it does |
|---|---|---|
| `/sign-in` | Admin console sign-in | Email and password, then the 6-digit authenticator code. Enrolment on first use, lockout after five failures |
| `/` | Overview | API health, last snapshot, verification backlog, reference prices in force, recent admin actions. Button to recompute snapshots now |
| `/verification` | Verification queue | Oldest first, filter by role and province. Detail with documents (view, accept, reject with note), farms, a checklist, and verify or reject with a note the user reads |
| `/deals` | Deal status | Every deal with filters by state, species, province and flagged outliers. Detail with agreed versus delivered figures, the hauler's shipment (truck, permit and vet certificate numbers, heads loaded, last position, hand-over), payment record, timeline; let a flagged settlement count or keep it out |
| `/disputes` | Disputes | Open, under review or all. Both sides' figures side by side, the deal timeline, and resolution as settled (optionally at a corrected weight), refunded or dismissed with a note both parties read. When a booking deposit was paid, a fourth line decides where it goes |
| `/deposits` | Deposits | What the gateway wallet holds, what went to farmers, what went back to buyers, and payouts that failed |
| `/reports` | Reports | Period and province filters. Deals by state, settled volume and median price by species, people by role with activity, time to settle, dispute rate, deposits, hauling, thin municipalities. Export deals as CSV |
| `/users` | Users | Everyone, filterable by role, status and name or phone, with province, deal count and last sign-in. Pending people link to the verification queue |
| `/reference-prices` | Reference prices | Current or full history per province and species. Set a price (species-wide or per class, large changes flagged). Import the PSA CSV, all or nothing |
| `/restricted-zones` | Restricted zones editor | Active on a date, or everything. Create with a municipality search; set an end date |
| `/audit-log` | Audit log | Newest first, filter by action and target, before and after JSON |
| `/settings` | (not wireframed) | Platform commission and whether an ID is required before verification. Each carries the explanation the API supplies, so the wording cannot drift from the behaviour. Every save is audited |
| `/account` | Account | Change password (ends other sessions), sign out |

Not built: photo viewing on shipments.

## Build and deploy

```bash
npm run build          # tsc -b && vite build -> dist/
VITE_API_BASE=https://api.example.ph/v1 npm run build   # point at a real API
```

`dist/` is static; host it anywhere. Add the console's origin to the API's `CORS_ORIGINS`. The page sets `noindex`.

## Checks

```bash
npm run lint        # oxlint
npx vitest run      # unit tests for formatting and the query builder
npm run build       # type check and bundle
```

## Notes

- Tokens live in `sessionStorage`: closing the tab signs you out. A 401 triggers one refresh, then a redirect to sign-in.
- Every admin write sends an `Idempotency-Key`, as the contract requires, so a double click cannot double-write.
- Palette and type follow the proposal and blueprint pages so the product reads as one thing.
