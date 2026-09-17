# Presyo ng Hayop, mobile app (Flutter)

The app from `docs/wireframes/`, one Dart codebase for Android and iOS, covering all three roles: farmer, buyer and hauler. Phase 1 of `docs/development-plan.md`. It is the same ground as `web-app/`, which stays the way in for anyone who would rather not install anything.

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

## On the development emulator

The `presyo` emulator on the development machine renders **release and profile** builds correctly and **debug** builds as a blank off-white page. That is the emulator, not the app: ordinary Android apps render fine and the widget and render trees are correct throughout. To look at the app there:

```bash
flutter build apk --release --target-platform android-x64
adb uninstall ph.presyonghayop.presyo        # signatures differ from the debug build
adb install build/app/outputs/flutter-apk/app-release.apk
adb shell am start -n ph.presyonghayop.presyo/.MainActivity
```

There is no hot reload that way, so get the code right before building. Debug builds stay fine for `flutter analyze`, `flutter test` and a real phone. Do not spend time on GPU modes: host, software, swangle, swiftshader, Impeller and Skia all behave the same.

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
| Register | RegisterFarmer, RegisterBuyer, RegisterHauler | Name, language, and the role. A farmer adds a farm with a two-step location picker (town, then barangay) and a farm type; a buyer has nothing more to set up; a hauler gives a plate, a vehicle and a capacity. The documents asked for follow the role |
| Presyo | Main | Running price per weight class, source and sample size on every row, 14-day sparkline, 30-day change, pull to refresh. Last board cached on the phone for the field |
| Hayop | Herd | Farms and lots; add a farm, add a lot with heads, average weight and a camera photo |
| Ibenta | Listing | Post a lot against the board; accept, counter or decline each offer |
| Bilhin | BuyerBrowse, BuyerOffer | What is for sale, each asking price beside the board price so a buyer can see whether it is dear; an offer carries heads, a pickup day, whether a hauler is wanted and where to deliver |
| Trabaho | HaulJobs | Booked deals wanting a truck, soonest pickup first, with a "fits my truck" filter; take one with your fee and a pickup time |
| Biyahe | HaulPickup, HaulTransit | The pickup checklist that gates the start of a trip (shipping permit number, vet certificate number, head count, a photo of the load), position sharing every two minutes, checkpoint, delay and problem pings, hand-over |
| Deals | Deal | Both sides of it. Agreed figures, deposit line, hauler progress and the timeline for everyone; a farmer confirms the payment arrived; a buyer pays the deposit through GCash, Maya or QR Ph, confirms what arrived and records the balance |
| Ako | Profile | Verification status, documents with review notes, payout account (farmers), truck (haulers), taking on another role, language, sign out |

Which tabs appear follows the roles the person holds, merged when there is more than one: a farmer who also buys sees Presyo, Hayop, Ibenta, Deals, Bilhin and Ako, with Presyo and Deals not repeated. `tabKeysFor` in `lib/screens/shell.dart` is that rule, and a test pins it.

## Layout

| Path | What |
|---|---|
| `lib/api/client.dart` | One HTTP client: base URL from settings, tokens in secure storage, one refresh on 401, `Idempotency-Key` on writes, signed uploads, problem+json to `ApiException` |
| `lib/api/models.dart` | Hand-written models for the operations the app uses. Money and weights stay decimal strings |
| `lib/api/api.dart` | One function per contract operation |
| `lib/ui.dart` | Theme and shared widgets, same palette as the console and web app |
| `lib/screens/` | One file per screen |

## Location

Only the hauler screens ask for it, and only while a trip is running: Biyahe stamps the pickup and the hand-over, and shares a position every two minutes so the farmer and the buyer can follow the truck. A refused permission does not block the trip; the checklist and the hand-over still work, nobody can follow the truck. The permissions are declared in `android/app/src/main/AndroidManifest.xml` and `ios/Runner/Info.plist`.

## Not built yet

Offline queue and `POST /sync` for herd edits (the board is cached, edits are not), push notifications, Filipino and English string files (labels are inline today), release signing, a map of a trip in progress (positions are recorded and listed, not drawn).
