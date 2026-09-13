# Mobile app (farmer, buyer, hauler)

Flutter, one codebase, Android first. Not started: the build machine needs the Flutter SDK and Android SDK, which the current development machine does not have. This file is the hand-off so the first day on a Flutter machine is spent building, not deciding.

## What it talks to

`docs/api/openapi.yaml`, served by `api/`. Run the API locally with no Docker (`api/README.md`) and point the app at `http://10.0.2.2:3000/v1` from the Android emulator. Every price the API returns carries `source`, `sample_count` and `location_code`; the app must display all three (a bare number is a defect in the contract's words).

## Screens, in build order

Wireframes: `docs/wireframes/` (canvas link in the root README). Phase 1 is the farmer app only.

1. Sign in: mobile number, one-time code, profile (name, language, role). `POST /auth/otp/request`, `POST /auth/otp/verify`, `PATCH /me`, `POST /me/roles`.
2. Farmer registration: farm name, province, municipality, barangay from `/locations`, pin, farm type, species. `POST /farms` with an `Idempotency-Key`.
3. Price board: `GET /prices/board?municipality_code=…`, cached offline with its ETag, revalidated with `If-None-Match`.
4. My herd: `GET /farms`, `GET /farms/{id}/lots`, lot form `POST /farms/{id}/lots`, vaccinations. Edits queue offline and replay through `POST /sync` with `tmp:` ids; a 409 result opens a merge screen showing `problem.current`.
5. Me: language, documents (`POST /uploads` then PUT the file, then `POST /me/documents`), pending verification state.

Buyer and hauler screens follow in Phases 2 and 3 once those API tag groups exist.

## Decisions already made for the app

- Filipino and English string files from the first build (`preferred_lang` on the profile).
- Offline first for the board and herd: local store, sync queue, conflict screen. Never silently overwrite.
- Tokens: 15-minute access token, refresh token rotated on every refresh; a 401 on refresh means sign in again.
- Photos: JPEG, resized to 1600 px on the device before upload; the API refuses files over 5 MB and checks magic bytes.
- Every screen shows the sample size and location level next to a price.
- Minimum tap target 44 px; test on a low-end Android (2 GB RAM, Android 10) from day one.

## Suggested structure

```
mobile/
  lib/
    api/         generated client from docs/api/openapi.yaml (openapi_generator or hand-written dio calls)
    auth/        otp flow, token store (flutter_secure_storage)
    board/       price board, offline cache
    herd/        farms, lots, vaccinations, sync queue
    me/          profile, documents, uploads
    l10n/        fil.arb, en.arb
  test/          widget tests per screen against a fake API
```

First task on the Flutter machine: `flutter create mobile --org ph.pricoboard --platforms android`, then wire sign-in against the local API and get the OTP code from the API log.
