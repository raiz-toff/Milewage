# Copied from Comma

This directory is a verbatim copy of Comma's local Expo native module (roadmap 17 section 3.6, PR M4.2).
It is copied once. After the trim in M4.3 it is MileWage's own code and is not synced with Comma.

- Source path: `/home/coder/Production/commaApp/modules/comma-tracker` (read-only; never modified)
- Comma commit: `968e4c7a4447357039d9208de7a6239de90c72ad` (HEAD of `commaApp` on the copy date; the module's own source was last changed in `ba580cbb550d81f27a54ecd7496fc42a73236035`)
- Date copied: 2026-11-04
- Check: `diff -r` against the source working tree (clean for these paths) reports no difference.

## Files (relative to this directory)

<!-- files:start -->

- `LICENSE`
- `android/build.gradle`
- `android/src/main/AndroidManifest.xml`
- `android/src/main/java/expo/modules/commatracker/ActivityTransitionReceiver.kt`
- `android/src/main/java/expo/modules/commatracker/BootReceiver.kt`
- `android/src/main/java/expo/modules/commatracker/CommaTrackerModule.kt`
- `android/src/main/java/expo/modules/commatracker/LocationTrackingService.kt`
- `android/src/main/java/expo/modules/commatracker/ShiftOverlay.kt`
- `expo-module.config.json`
- `index.ts`
- `ios/CommaTracker.podspec`
- `ios/CommaTrackerModule.swift`
- `src/CommaTracker.types.ts`
- `src/CommaTrackerModule.ts`
- `src/CommaTrackerModule.web.ts`

<!-- files:end -->

## Not copied

Gradle caches and build output that Comma tracks in git by mistake: `android/.gradle/**` and `android/build/**`.

## Notes

- Autolinking finds the module through `expo.autolinking.nativeModulesDir = "./native"` in `apps/phone/package.json`.
- Prettier ignores this directory so the copy stays byte-identical until M4.3.
