# MileWage for Android (native)

The native Android app: Kotlin, Jetpack Compose and Material 3. It replaced the Expo app (removed
from the repository on 2026-11-10) and installs over it (same application id `app.milewage.phone`,
same upload key). It starts empty: the driver pairs it again (see `data/README.md`).
The engine port, storage, tracking, sending and every screen are in: first run with pairing (QR
scanner, link code on the home Wi-Fi, a pasted code or address, Tailscale), the setup steps, the
permissions ladder, Home, the running shift, Shifts, a shift's detail, Settings and Diagnostics.

## Modules

| Module      | Kind               | Holds                                                                                                                                                                                                                     |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:engine`   | plain Kotlin (JVM) | The port of `packages/track-engine`. Integer arithmetic, bit for bit with the TypeScript. See `engine/README.md`.                                                                                                         |
| `:core`     | plain Kotlin (JVM) | Shared models, formatting (money in minor units, distance, clock times, days, durations), the home-address rule, and the ports (`SecretStore`, `Clock`) the Android modules implement.                                    |
| `:data`     | Android library    | Room 3 database, the HTTP client (OkHttp, kotlinx.serialization), the Keystore-backed `SecretStore`, UI preferences (DataStore), sending (WorkManager).                                                                   |
| `:tracking` | Android library    | Recording a shift: the location foreground service, the notification buttons (End shift, Keep going), the boot receiver (resumes a running shift after a restart) and the `TrackingController`. See `tracking/README.md`. |
| `:app`      | Android app        | `MileWageApp` (the service locator `AppGraph`, the tracking and sending wiring, reminders), `MainActivity`, `MileWageTheme`, navigation, the house components, the screens and their view models. See "The app" below.    |

`:engine` and `:core` have no `android.*`, `androidx.*`, `java.*` or `javax.*` in `src/main`
(`ModuleRulesTest` in each fails otherwise), so they can become Kotlin Multiplatform `commonMain`
when the iPhone app arrives. Everything that is not Android-specific goes there. Each module builds
and tests on its own (`./gradlew :core:test`), so several people can work in parallel.

## Build

JDK 17 and the Android SDK (`ANDROID_HOME`, default `$HOME/android-sdk`, platform 37). No emulator
in this project's workflow: tests run on the JVM (Robolectric for the screens) and the owner tests
on a real phone. From `apps/android`:

```sh
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk (debug key)
./gradlew test lint            # unit tests of every module, Android lint
./build-release.sh             # tests, lint, policy, then the signed release APK
```

From the repository root, `npm run verify:android` runs the unit tests, lint and the policy check of
both variants (`scripts/verify-android.sh`, which stops with the fix when JDK 17 or the SDK is
missing); `npm run verify` runs it after the JavaScript checks. CI runs the same, plus
`assembleDebug` and the screenshots, in the `android` job of `.github/workflows/verify.yml`.

The release APK is built with `scripts/phone-release-build.sh` (it runs `build-release.sh`), on the
owner's machine only, because CI never holds the upload key. It signs with the upload key when
`$HOME/.milewage/keystore.env` exists (made once by `scripts/phone-keystore.sh`, read by
`scripts/phone-signing-env.sh`), else with the debug key. It writes
`app/build/outputs/apk/release/app-release.apk` and a copy named `milewage-<VERSION>.apk` for the
GitHub release; `--publish PATH` copies the APK where the server hands it out.

- `versionName` is the root `VERSION` file.
- `versionCode` is `MILEWAGE_VERSION_CODE`, or the default in `app/build.gradle.kts` (3: the Expo
  app's last release was 2). `npm run version:check` fails when the default is below the last
  `versionCode` named in a released section of `CHANGELOG.md`. Raise it for every build handed out.
- minSdk 26 (Android 8.0), targetSdk 36, compileSdk 37. Library versions are in
  `gradle/libs.versions.toml`: latest stable only, no alpha, beta or rc.

## Rules

- **No Google Play Services, no Firebase, no ML Kit.** The app runs on de-Googled phones. Location
  comes from the platform `LocationManager`. `checkReleasePolicy` fails the build if any such
  artifact reaches the runtime classpath.
- **Manifest policy.** The merged manifest may ask only for the permissions listed in
  `policyPermissions` (`app/build.gradle.kts`); a library that adds one fails the build. No
  `SYSTEM_ALERT_WINDOW`, no activity recognition. `allowBackup="false"` and data extraction rules
  that exclude everything.
- **Plain http only to a home address.** Android's network security config cannot express address
  ranges, so it allows cleartext and `HomeOnlyCleartext` (`:data`) refuses http to anything that is
  not a home address before a request leaves the phone. The rule is `HomeAddress` in `:core`, a port
  of `packages/shared/src/home-address.ts` with the same tests. Only system certificate authorities
  are trusted.
- **Secrets** go through `SecretStore`: AES-256-GCM under a non-exportable Android Keystore key, the
  sealed text in DataStore (`KeystoreSecretStore`). Not `security-crypto`, which Google deprecated.
- **Colours** come from the theme, never a hex in a screen. `BrandColors` is the web's scheme
  ("Asphalt and lane", `apps/web/scripts/m3-theme.mjs` and `m3-scheme.json`): Lane yellow `#FFC21F`
  on neutrals at Asphalt's hue, Fidelity, 2021 spec, with the web's overrides (ink `primary`, the
  grey page `background`). `BrandSchemeTest` pins the recipe, the generated values and every role to
  the JSON; Android's one own value is `inversePrimary` (the snackbar action). `ContrastTest` holds
  the pairs the app draws. Screens take their level from `MaterialTheme.surfaces` (page, card, fill,
  popover) and put cards in `CardSurface`. `MaterialTheme.extendedColors` adds `earned` (money in
  only) and `spent` (money out only); destructive actions use Material's `error`. The yellow is the
  brand button, the route sketch's lane, the tab bar's lane dash, the scanner's corners and the
  notification accent. Settings > Use wallpaper colours switches to the phone's Material You
  colours (Android 12+, off by default).
- **Type and shape**: Material 3's type scale on the system font, Material 3's shape scale.
- **Screens** use the house components in `ui/components`: `Screen`, `ListRow`, `Rows`,
  `SectionLabel`, `StatTile`, `EmptyState`, `ConfirmHost`, `LocalSnackbars`. Strings live in
  `strings.xml` and follow the MileWage voice (`.claude/skills/milewage-design`).
- **R8** is on for release, with keep rules in `app/proguard-rules.pro` and
  `data/consumer-rules.pro`. Room schemas are exported to `data/schemas/` and committed.
- The owner tests on a real phone; there is no emulator here. Say what is untested.

## The app (`:app`)

**Wiring.** `MileWageApp` makes one `AppGraph`, the service locator (no DI framework): `data`
(`MileWageData.create` with `TrackingRecorder`, `ReminderNotifications`, `AndroidBattery`),
`tracking` (`TrackingController`, lazy: its runtime reads `trackingDependencies` back from the
Application), `trackingDependencies`, the view models' seams `shiftData` (`ShiftData`) and
`trackingView` (`TrackingView`), first run's and Settings' seams `pairingPort` (`PairingPort`),
`netView` (`NetView`), `trackingSettings`, `appearance`, `links` (`PairLinkInbox`),
`diagnosticsSource`, `uiPreferences` (theme, wallpaper colours).
The Application is the `TrackingDependenciesProvider` and the `MileWageDataProvider` (the send
worker), creates the reminder channel, calls `data.start(...)`, keeps the shift notification's
details in step (`ShiftNoticeSync`), and on every foreground calls `ensureRunning()` and `kick()`.
A crash is recorded in the diagnostics ring. View models are made by `ui/ViewModels.kt` from the graph.

**Layers.** Decisions are plain Kotlin in `logic/` (start checks, the tracker's state in words, the
sync banner, the setup checklist, week groups, flags, the server's changes, trip choices, the route
projection, the diagnostics summary) and return types, not words; `ui/Texts.kt` maps them to
`strings.xml`. View models (`ui/*/…ViewModel.kt`) combine the facade's flows into one state and run
actions; screens (`…Content`) only render a state. Numbers go through `model/Formats` (`:core`'s
formatters in the driver's unit, currency, zone and 12/24 h).

**Navigation.** `AppShell` shows one of three graphs by the gate (`logic/FirstRun.kt` `Gates`): first
run while not paired, the setup steps after a first connection (`pairing.setupPending()`), then the
app. It moves between them by itself when the pairing changes; no screen navigates there.

**Screens.** First run (`ui/firstrun`): Welcome, Set up your server, Connect (servers announced on
this Wi-Fi, the scanner, a link that opened the app with "Connect to this server?", a pasted code or a
typed server address), the scanner (CameraX `camera-compose` `CameraXViewfinder`, `:data`'s ZXing
`QrFrameAnalyzer`), Link this phone (6-digit code), Tailscale; then Connected, the permissions and
Ready. Permissions (`ui/permissions`, the ladder in `logic/Permissions.kt`): the Location switch,
precise location, "Allow all the time" asked on its own after it, notifications, battery (the system's
exemption list; `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` stays out of the manifest), local network on
Android 17 at targetSdk 37; every "Fix permissions" leads there. Home (summary, sync banner, setup
checklist, vehicle, Start shift; while a shift runs: time, distance, deduction so far, the tracker's
state with its fix, End shift with a confirm, the odometer check), Shifts (weeks, send state, things
to check, paging), a shift's detail (route sketch on a Canvas, totals, trips with their purpose edit,
added trips, stops, odometer, notes, the server's changes and checks in words with the web's advice,
Send now), Settings (`ui/settings`: server and connection check, connect to a different server, the
"Still on shift?" reminder, sending, theme and wallpaper colours, the server's
units, Help on the server, About with the licences and the source), Diagnostics (long press on Home's
title; a button in debug builds; also Settings > Diagnostics).

**Icons** are Material Symbols Rounded, the web's set and names, as Kotlin vectors in
`ui/icons/Icons.kt`, generated offline from `@iconify-icons/material-symbols` by
`scripts/material-symbols.mjs` (add a name there and run it with Node 22). The licences screen reads
`res/raw/aboutlibraries.json`, made at build time by the AboutLibraries plugin.

**Tests.** `./gradlew :app:testDebugUnitTest`: the decisions, the view models with fakes
(`kotlinx-coroutines-test`), and the screens on the JVM with Robolectric (SDK 35: Robolectric's
SDK 36 needs Java 21). `./gradlew :app:recordRoborazziDebug` also writes a PNG of every screen state,
light and dark (`app/build/screens/`).
