# MileWage for Android (native)

The native Android app: Kotlin, Jetpack Compose and Material 3. It replaces the Expo app in
`apps/phone` and installs over it (same application id `app.milewage.phone`, same upload key).
This is the skeleton: the theme, the navigation shell, the house components and the module layout.
The engine port, storage, tracking, pairing, sending and the real screens come next.

## Modules

| Module      | Kind               | Holds                                                                                                                                                                                  |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:engine`   | plain Kotlin (JVM) | The port of `packages/track-engine`. Integer arithmetic, bit for bit with the TypeScript. See `engine/README.md`.                                                                      |
| `:core`     | plain Kotlin (JVM) | Shared models, formatting (money in minor units, distance, clock times, days, durations), the home-address rule, and the ports (`SecretStore`, `Clock`) the Android modules implement. |
| `:data`     | Android library    | Room 3 database, the HTTP client (OkHttp, kotlinx.serialization), the Keystore-backed `SecretStore`, UI preferences (DataStore), sending (WorkManager).                                |
| `:tracking` | Android library    | The location foreground service and the boot receiver (placeholders), with their manifest entries.                                                                                     |
| `:app`      | Android app        | `MainActivity`, `MileWageTheme`, navigation, the house components and the screens.                                                                                                     |

`:engine` and `:core` have no `android.*`, `androidx.*`, `java.*` or `javax.*` in `src/main`
(`ModuleRulesTest` in each fails otherwise), so they can become Kotlin Multiplatform `commonMain`
when the iPhone app arrives. Everything that is not Android-specific goes there. Each module builds
and tests on its own (`./gradlew :core:test`), so several people can work in parallel.

## Build

JDK 17 and the Android SDK (`ANDROID_HOME`, platform 37). From `apps/android`:

```sh
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew test lint            # unit tests of every module, Android lint
./build-release.sh             # tests, lint, then the signed release APK
```

`build-release.sh` signs with the upload key when `$HOME/.milewage/keystore.env` exists (made once by
`scripts/phone-keystore.sh`, read by `scripts/phone-signing-env.sh`, as for the Expo app), else with
the debug key. `--publish PATH` copies the APK where the server hands it out.

- `versionName` is the root `VERSION` file.
- `versionCode` is `MILEWAGE_VERSION_CODE` (default 3, above the Expo app's last release, 2). Raise
  it for every build handed out.
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
- **Colours** come from the theme, never a hex in a screen. `BrandColors` is generated from Lane
  yellow `#FFC21F` with material-color-utilities (Fidelity, 2021 spec, standard contrast), the same
  settings as the web's `apps/web/scripts/m3-theme.mjs`; `BrandSchemeTest` pins it to the generator
  and to the web's `m3-scheme.json`. `MaterialTheme.extendedColors` adds `earned` (money in only)
  and `spent` (money out and destructive actions). Settings > Use wallpaper colours switches to the
  phone's Material You colours (Android 12+, off by default).
- **Type and shape**: Material 3's type scale on the system font, Material 3's shape scale.
- **Screens** use the house components in `ui/components`: `Screen`, `ListRow`, `Rows`,
  `SectionLabel`, `StatTile`, `EmptyState`, `ConfirmHost`, `LocalSnackbars`. Strings live in
  `strings.xml` and follow the MileWage voice (`.claude/skills/milewage-design`).
- **R8** is on for release, with keep rules in `app/proguard-rules.pro` and
  `data/consumer-rules.pro`. Room schemas are exported to `data/schemas/` and committed.
- The owner tests on a real phone; there is no emulator here. Say what is untested.
