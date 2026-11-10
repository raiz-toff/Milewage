# The phone app is a native Android app with a plain-Kotlin engine and core, and no Google Play Services

Until 2026-11-10 the phone app was Expo and React Native (decision 1.6 of 2026-11-03) with three Kotlin modules of its own for tracking, QR scanning and the network check. On 2026-11-10 the owner decided that the phone app becomes a native Android app in `apps/android` (Kotlin, Jetpack Compose, Material 3), with no Expo and no React Native, that it must run on phones without Google services, and that an iPhone app will follow later, natively in SwiftUI, sharing the engine and the logic. We decided:

- **Five Gradle modules** (`apps/android/settings.gradle.kts`): `:engine`, the port of `packages/track-engine`, and `:core`, the models, formats, pairing, sending and tracking decisions, are plain Kotlin on the JVM with no `android.*`, `androidx.*`, `java.*` or `javax.*` in `src/main` (`ModuleRulesTest` in each fails otherwise), so they can become Kotlin Multiplatform `commonMain` for the iPhone app. `:data` (Room, OkHttp, Keystore, WorkManager), `:tracking` (the location service, receivers, notifications) and `:app` (Compose screens) are Android only and stay thin.
- **The engine gives the same bytes as the TypeScript** on the golden files, the conformance fixtures (`packages/track-engine/conformance/fixtures.json`) and millions of random cases, with its own port of V8's `sin`, `cos` and `atan2` (`apps/android/engine/README.md`). The server stays the source of truth and still recomputes every shift.
- **No Google Play Services, Firebase or ML Kit.** Location comes from the platform `LocationManager`, QR codes from ZXing on CameraX frames, discovery from the platform's NSD, reminders from the phone's own notifications and alarms. The build enforces it: `check<Variant>Policy` in `apps/android/app/build.gradle.kts` fails when a `com.google.android.gms`, `com.google.firebase`, `com.google.mlkit` or `com.google.android.play` artifact reaches the runtime classpath, or when the merged manifest asks for a permission outside `policyPermissions`. It runs with `assemble` and in `npm run verify:android`.
- **The same application id (`app.milewage.phone`) and upload key** as the Expo app, so the new app installs over it. It starts empty; the driver sends everything from the old app first and pairs again.
- **Android 8.0 (API 26) and later** (`minSdk 26`), target 36, compile 37. Library versions in `gradle/libs.versions.toml`, stable releases only.

## Considered options

- **Keep Expo and React Native**: rejected. Every native need (the location service, the scanner, discovery, the network check) was already a Kotlin module behind a JavaScript bridge, so the app was two stacks; `expo-notifications` always brings Firebase Cloud Messaging and Google's logging (TODO N1 of 2026-11-08); and the engine had to be checked on Hermes as well as on Node.
- **Kotlin Multiplatform from the start**: deferred. Nothing else uses it yet; keeping `:engine` and `:core` free of platform imports keeps the move a build change when the iPhone app starts.
- **Google's fused location provider and Activity Recognition**: rejected. They are Google Play Services and absent on de-Googled phones (see ADR 0011).

## Consequences

- `apps/phone` was removed on 2026-11-10. The conformance fixtures and their generator moved to `packages/track-engine` (`npm run conformance:fixtures`; `npm test` fails while they are stale). The upload key, `scripts/phone-keystore.sh`, `scripts/phone-signing-env.sh` and `scripts/phone-release-build.sh` (now running `apps/android/build-release.sh`) stay.
- `npm run verify` runs Gradle too (`verify:android`: unit tests, Android lint, the policy check), and CI has an `android` job. The signed APK is still built on the owner's machine only.
- The request models are hand-written Kotlin, checked field by field against `packages/shared/openapi/openapi.yaml` by `ContractDriftTest` in `:core`.
- Nothing here has run on a real phone yet. The field test in `TODO.md` is the proof; until then every claim about tracking on a device is untested.
