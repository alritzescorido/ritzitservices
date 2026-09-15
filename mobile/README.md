# Presyo ng Hayop, mobile app (Flutter)

The farmer app from `docs/wireframes/`, one Dart codebase for Android and iOS. Phase 1 of `docs/development-plan.md`. Buyers and haulers use `web-app/` until their screens are added here.

It talks only to the API in `api/` through `docs/api/openapi.yaml`. Every price it shows carries its source, sample size and location, because a bare number is a defect in the contract's words.

## Build and run

The toolchain lives outside the repo and is not on PATH. In Git Bash:

```bash
export PATH=/c/src/flutter/bin:/c/src/jdk17/bin:$PATH JAVA_HOME=/c/src/jdk17 ANDROID_HOME=C:/src/android-sdk
cd mobile
flutter pub get
flutter analyze && flutter test
flutter build apk --debug          # build/app/outputs/flutter-apk/app-debug.apk
flutter run                        # on a connected phone with USB debugging on
```

Installed 15 Sep 2026 on the development machine: Flutter stable at `C:\src\flutter` (git clone, not winget), Temurin JDK 17 at `C:\src\jdk17`, Android SDK at `C:\src\android-sdk` through the command-line tools with platforms 35 and 36. `flutter doctor` is green except Visual Studio, which only matters for Windows desktop builds.

## Put it on a phone

1. Build the debug APK with the command above.
2. Copy `build/app/outputs/flutter-apk/app-debug.apk` to the phone, or run `adb install -r` that file with USB debugging on. `adb` is at `C:\src\android-sdk\platform-tools\adb.exe`.
3. Android warns about installing from an unknown source. Allow it for the file manager or browser you used.
4. Start the API so the phone can reach it (`PUBLIC_BASE_URL` must be the PC's Wi-Fi address, not localhost; see `web-app/README.md` for the full command).
5. On the app's sign-in screen open **Server settings** and set the API address, for example `http://192.168.1.196:3000/v1`. It is remembered.
6. Sign in with a demo farmer, for example +639170001001, code `123456` while `OTP_DEV_CODE` is set.

The debug APK allows cleartext HTTP so it can reach a local API. A release build for the field must use HTTPS and drop `usesCleartextTraffic`.

## iPhone

The iOS target exists and is configured: bundle id `ph.presyonghayop.presyo`, the same as Android, with the camera, photo and local-network permission strings iOS demands. Without those strings iOS kills the app the moment the camera opens, so they are not optional.

**It cannot be built on this machine.** Compiling for iPhone needs Xcode, which runs only on macOS. Two consequences:

- CI does the checking. The `ios` job on GitHub's macOS runner builds the app unsigned on every push, so a change that breaks iOS is caught even though nobody here has a Mac. Free for public repositories.
- Putting it on a real iPhone needs a Mac and an Apple Developer account, 99 US dollars a year. With those, `flutter build ipa` and TestFlight are the route. A free Apple account can sideload to your own phone through Xcode, but the app expires after seven days.

`NSAllowsLocalNetworking` is switched on so the app can reach the pilot API over plain HTTP on a private address. Remove that block from `ios/Runner/Info.plist` once the API is served over HTTPS.

Until a Mac is available, iPhone users open `web-app/` in Safari and add it to the Home Screen.

## Screens

| Tab | Wireframe | What it does |
|---|---|---|
| Sign in | Signin, OtpCode | Mobile number, 6-digit code, resend timer, API address under Server settings |
| Register | RegisterFarmer | Name, language, farm with a two-step location picker (town, then barangay), farm type, barangay clearance and ID by camera |
| Presyo | Main | Running price per weight class, source and sample size on every row, 14-day sparkline, 30-day change, pull to refresh. Last board cached on the phone for the field |
| Hayop | Herd | Farms and lots; add a farm, add a lot with heads, average weight and a camera photo |
| Ibenta | Listing | Post a lot against the board; accept, counter or decline each offer |
| Deals | Deal | Agreed figures, deposit line, hauler progress, confirm the payment arrived, dispute, cancel, rate, timeline |
| Ako | Profile | Verification status, documents with review notes, payout account, language, sign out |

## Layout

| Path | What |
|---|---|
| `lib/api/client.dart` | One HTTP client: base URL from settings, tokens in secure storage, one refresh on 401, `Idempotency-Key` on writes, signed uploads, problem+json to `ApiException` |
| `lib/api/models.dart` | Hand-written models for the operations the app uses. Money and weights stay decimal strings |
| `lib/api/api.dart` | One function per contract operation |
| `lib/ui.dart` | Theme and shared widgets, same palette as the console and web app |
| `lib/screens/` | One file per screen |

## Not built yet

Offline queue and `POST /sync` for herd edits (the board is cached, edits are not), buyer and hauler screens, push notifications, Filipino and English string files (labels are inline today), release signing, the deposit payment link for buyers.
