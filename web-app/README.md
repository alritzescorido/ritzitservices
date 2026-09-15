# Presyo ng Hayop, phone web app

The farmer, buyer and hauler screens from `docs/wireframes/`, as a phone-first web app. React 19, Vite, TypeScript, same toolchain and palette as the admin console. It talks only to the API in `api/`; every price shows where it comes from and how many sales it rests on.

The blueprint plans these screens as a Flutter app. This web app exists so the flows can be used on a phone today, from a browser or "Add to Home Screen", while the Flutter build waits for a machine with the SDK. It shares the contract and nothing else, so either can be retired without touching the other.

## Run locally, open on your phone

```bash
# terminal 1: the API, reachable from the phone. Replace 192.168.1.196 with this PC's Wi-Fi address (ipconfig).
cd api && PUBLIC_BASE_URL=http://192.168.1.196:3000 CORS_ORIGINS=http://192.168.1.196:5178,http://localhost:5178,http://localhost:5177 \
  DATABASE_URL=pglite://./.data/demo DB_AUTO_SCHEMA=true JWT_SECRET=... OTP_PEPPER=... OTP_DEV_CODE=123456 PAYMENTS_PROVIDER=fake node dist/main.js

# terminal 2: the app on port 5178, listening on all interfaces, proxying /v1 to the API
cd web-app && npm install && npm run dev
```

On the phone, same Wi-Fi, open `http://192.168.1.196:5178`. Windows Firewall must allow Node on ports 3000 and 5178 the first time (it asks). Chrome's menu offers "Add to Home Screen"; the manifest makes it open full screen.

`PUBLIC_BASE_URL` matters: upload links and the payment checkout link are built from it, and the phone cannot reach `localhost`.

## Screens

| Route | Who | Wireframe | What it does |
|---|---|---|---|
| `/sign-in` | all | Signin, OtpCode | Mobile number, 6-digit code. Dev code is `123456` when `OTP_DEV_CODE` is set |
| `/register` | all | RegisterFarmer, RegisterBuyer, RegisterHauler | Name, language, role; farm and barangay for farmers, truck for haulers, documents by role |
| `/` | all | Main | Running price per weight class for my municipality, source and sample size on every row, 14-day sparkline, 30-day change. Last board kept on the device for offline |
| `/herd` | farmer | Herd | Farms and lots; add a farm (barangay search), add a lot with heads, average weight, photo |
| `/sell` | farmer | Listing | Post a lot at a price against the board; see offers; accept, counter or decline |
| `/market` | buyer | BuyerBrowse, BuyerOffer | Listings in my province; offer with pickup day, hauler wanted, delivery point. Shows the deposit that follows acceptance |
| `/deals`, `/deals/:id` | farmer, buyer | Deal, BuyerReceive | Every deal; the next step for the reader: pay the deposit, confirm count and weight, record payment, confirm it arrived, dispute, cancel, rate |
| `/jobs` | hauler | HaulJobs | Booked deals wanting a truck; fee and pickup time to take one |
| `/trips`, `/trips/:id` | hauler | HaulPickup, HaulTransit | Pickup checklist that gates "Start trip"; position sharing, checkpoint, delay, problem; hand-over |
| `/me` | all | Profile | Verification status, documents, payout account (farmers), truck (haulers), language, sign out |

## Checks

```bash
npm run lint        # oxlint (warnings on setState-in-effect are known, same as the console)
npx vitest run      # formatting helpers
npm run build       # tsc -b && vite build -> dist/
```

## Notes

- Tokens live in `localStorage` so the app survives closing the browser, as a phone app should. A 401 refreshes once, then returns to sign-in.
- Home municipality and the last board are kept on the device (`lpb.home`, `lpb.board`).
- Photos go straight from the phone to the signed upload URL; the API checks type and size.
- Position sharing uses the browser's geolocation every two minutes while a trip is in transit and the toggle is on. It stops when the page is closed; a native app would keep going in the background, which is one reason the Flutter build remains the plan.
- Filipino labels on the tabs and key actions; full string files come with the Flutter app.
