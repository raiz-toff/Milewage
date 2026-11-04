# Copied from Comma

This directory started as a verbatim copy of Comma's local Expo native module (roadmap 17 section 3.6, PR M4.2).
It was copied once. Since M4.3 it is MileWage's own code and is not synced with Comma.

- Source path: `/home/coder/Production/commaApp/modules/comma-tracker` (read-only; never modified)
- Comma commit: `968e4c7a4447357039d9208de7a6239de90c72ad` (HEAD of `commaApp` on the copy date; the module's own source was last changed in `ba580cbb550d81f27a54ecd7496fc42a73236035`)
- Date copied: 2026-11-04
- Check: at PR M4.2 (git commit `04042a4` on main) `diff -r` against the source working tree reported no difference.

## Files as copied in M4.2 (relative to this directory)

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

Not copied: Gradle caches and build output that Comma tracks in git by mistake (`android/.gradle/**`, `android/build/**`).

## Changes since the copy

- M4.4 (09 section 5.1): the service writes every fix, unfiltered, to its own `tracker.db` (`TrackerBuffer.kt`, `AndroidSqlDb.kt`, `PointMapper.kt`); the Comma `comma.db` writer, the 20 m / 42 m/s filter and the running distance total are gone; module API is now `start`, `stop`, `isTracking`, `readPending`, `markUploaded`, `markRejected`, `evictUploaded`, `gnssOffsetMs`, `requestBatteryOptimizationSettings`.
- M4.3 (09 section 5.2): deleted `BootReceiver.kt` and `ShiftOverlay.kt`; removed the overlay, boot restart and battery-exemption request; cadence now comes from JS (`CadenceConfig.kt`, JUnit test); manifest declares no permissions (the list is in `apps/phone/app.json`, policy in `apps/phone/plugins/manifestPolicy.js`).

## Notes

- Autolinking finds the module through `expo.autolinking.nativeModulesDir = "./native"` in `apps/phone/package.json`.
