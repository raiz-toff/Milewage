# 09 — Background GPS Decision (Expo vs Native Module)

**Lead Agent:** Agent 1 (Mobile & Android Systems Specialist)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** PROPOSED DECISION for Gate 2 (needs Human sign-off)  
**Parent:** [`plans/milewage/README.md`](./README.md) · Related: [`02-mobile-architecture-plan.md`](./02-mobile-architecture-plan.md), `06` items 1.5, 1.6

---

## 1. The Question

Gate 2 requires settling whether Expo SDK 56 with `expo-location` + `expo-task-manager` background location is enough for MileWage on Android 14/15+, or whether a small custom native module (a Kotlin foreground service using `FusedLocationProviderClient`) is needed.

## 2. Key Finding: Comma Already Answered This

Comma (`/home/coder/Production/commaApp`, read-only) already ships on the same Expo SDK (`expo ~56.0.12`, React Native 0.85.3) **and** contains a local Expo native module, `modules/comma-tracker` (about 870 lines of Kotlin):

| File | What it does |
|---|---|
| `LocationTrackingService.kt` (444 lines) | Foreground service, `foregroundServiceType="location"`, `FusedLocationProviderClient`, writes fixes straight to SQLite, `START_STICKY`, `onTaskRemoved` restart, notification channel |
| `ActivityTransitionReceiver.kt` | Activity Transition API (IN_VEHICLE / WALKING / STILL) gates the GPS radio: GPS is removed after 150 s of confirmed stillness and resumed on movement |
| `BootReceiver.kt` | Restarts the service after reboot mid-shift (24 h staleness guard) |
| `ShiftOverlay.kt` | Floating "live shift" pill over other apps (needs `SYSTEM_ALERT_WINDOW`) |

Comma's own docs (`docs/development/native-module.md`, `docs/architecture/gps-engine.md`) record the reasoning: a JS process not attached to a foreground service can be killed within seconds of screen-off, and the native layer is "deliberately thin" with "no JS on the hot path". Comma's `src/registry/gpsConfig.ts` notes the native service hardcodes its cadence (10 s interval, 20 m min distance, 42 m/s jitter cutoff).

This is a project owned by the same Human Operator, on the same stack, already past the "does Expo alone work" question. Per decision 1.2 the code is **copied and re-verified**, not shared.

## 3. Evidence (external)

| # | Finding | Source |
|---|---|---|
| E1 | `expo-location` config plugin adds `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` (the latter needed from Android 14) when `isAndroidForegroundServiceEnabled` is on; the option defaults to true when `isAndroidBackgroundLocationEnabled` is true. | [Expo Location docs (latest)](https://docs.expo.dev/versions/latest/sdk/location/) |
| E2 | `startLocationUpdatesAsync` exposes only a foreground-service notification (`notificationTitle`, `notificationBody`, `notificationColor`, `killServiceOnDestroy`), plus accuracy / time / distance intervals. No hook for activity-gating the radio or custom sampling logic. | same |
| E3 | Expo docs state a terminated app will **not** automatically restart when a location event occurs, due to platform limitations. | same; corroborated by a forum report of updates stopping when the app is killed ([Expo forum](https://forums.expo.dev/t/android-get-location-as-foreground-service-without-accessing-background-location/49240)) |
| E4 | The SDK reference lists Expo SDK 56 with minimum Android 7+ and `targetSdkVersion` 36. A newer `expo-location/next` API appears in v58 docs; not SDK 56. | [Expo SDK reference](https://docs.expo.dev/versions/latest/) · [v58 location-next](https://docs.expo.dev/versions/v58.0.0/sdk/location-next/) |
| E5 | Apps targeting Android 14 must declare a foreground service type in the manifest; omission raises `MissingForegroundServiceTypeException` at `startForeground()`. The `location` type needs `FOREGROUND_SERVICE_LOCATION`, location services on, and a location runtime permission. | [Android 14: FGS types required](https://developer.android.com/about/versions/14/changes/fgs-types-required) · [Play Help: FGS requirements](https://support.google.com/googleplay/android-developer/answer/13392821) |
| E6 | A location foreground service cannot be created while the app is in the background unless `ACCESS_BACKGROUND_LOCATION` is granted. | same Android 14 / Play pages |
| E7 | Android 15 introduces a 6-hour-per-24-hours timeout, but the documentation applies it to `dataSync` and `mediaProcessing` types only. **The documentation scopes the timeout to `dataSync` and `mediaProcessing`; `location` is not listed. No page states "location has no timeout" in so many words, so this is an inference and test A4 is the real proof.** | [Android 15 FGS type changes](https://developer.android.com/about/versions/15/changes/foreground-service-types) · [FGS timeouts](https://developer.android.com/develop/background-work/services/fg-service-timeout) |
| E8 | Android 12+ blocks starting foreground services from the background except for listed exemptions. For Bluetooth, the documented route is `CompanionDeviceService` with `REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND`. **No documented exemption was found for starting from a plain Bluetooth broadcast receiver.** **On Android 14 and higher, a foreground service that needs while-in-use permissions such as location cannot be created from the background at all unless the app holds `ACCESS_BACKGROUND_LOCATION`, even where an exemption applies** (S0, FGS troubleshooting page). | [Restrictions on background starts](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) · [BLE background guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/background) |
| E9 | The Activity Transition API (`IN_VEHICLE` enter/exit) delivers trip start/stop events only when needed and is preferred over the Sampling API for lower power. Needs `ACTIVITY_RECOGNITION` runtime permission on Android 10+ and Play Services 12.0.0+. | [Transition API](https://developer.android.com/develop/sensors-and-location/location/transitions) |
| E10 | Play requires a background-location permissions declaration (core-feature justification, demo video, prominent in-app disclosure shown before the runtime prompt mentioning "location" and background use). Apps targeting Android 14+ also declare each foreground service type in Play Console with a video. Failing this can block updates or remove the app. | [Play background location policy](https://support.google.com/googleplay/android-developer/answer/9799150) · [Play FGS declaration](https://support.google.com/googleplay/android-developer/answer/13392821) · secondary: [Radar](https://radar.com/blog/guide-to-play-store-background-location-approval) |
| E11 | OEM kills: Xiaomi (MIUI / HyperOS) is the most consistently reported offender, even with a foreground service; swiping from recents can kill it. Samsung is mixed: one third-party page says One UI 6 guarantees foreground services built to the Android 14 policy, which is unverified. | [dontkillmyapp.com/samsung](https://dontkillmyapp.com/samsung) · [B4X Xiaomi thread](https://b4x.com/android/forum/threads/how-to-prevent-a-app-from-killing-by-xiaomi-both-miui-and-hyper-os.169194) · [Traccar forum](https://www.traccar.org/forums/topic/traccar-client-stops-reporting-after-idle-period-of-time/page/2/) |
| E12 | iOS: Apple reviewers scrutinise background location (guideline 2.5.4 / 5.1.1); the feature must visibly need persistent location. "Always" authorization is required to be relaunched by significant-change updates; with When-In-Use, iOS shows a blue status-bar pill during background use. Secondary sources only. | [Expo forum on rejections](https://forums.expo.dev/t/ios-app-store-rejections-with-the-location-background-mode/25537) · [Capgo](https://capgo.app/blog/why-ios-stops-background-location-updates-capacitor/) |

**Research limits (stated plainly):** E7 is an absence of evidence, not a confirmed "no timeout for location". E8's Bluetooth finding and E11's Samsung claim come from secondary or missing sources. The Expo docs pages searched were "latest", not a pinned `v56.0.0` page. All of these are tested in Spike A rather than assumed.

## 4. Options Compared

| Criterion | A. `expo-location` + `expo-task-manager` only | B. Copy Comma's Kotlin foreground-service module (trimmed) |
|---|---|---|
| Foreground service type + permissions | Plugin adds them (E1) | Declared by hand in the module manifest (Comma already does) |
| Survives swipe from recents / restart | Docs say a terminated app won't restart (E3); `killServiceOnDestroy` is the only control | `stopWithTask=false`, `START_STICKY`, `onTaskRemoved` restart (proven in Comma, still to be re-verified) |
| Adaptive sampling | Accuracy, `timeInterval`, `distanceInterval` only (E2); no activity gating | Full control: Activity Transition gates the GPS radio, `maxUpdateDelay` batching |
| JS on the hot path | Task callback runs JS; fragile when JS is torn down | None: Kotlin writes the buffer directly |
| Battery | Radio stays on whenever a task is running | Radio removed after confirmed stillness (Comma's design) |
| Offline buffer | JS writes `expo-sqlite` from the task | Native writes the buffer; JS reads |
| Code to write / maintain | Almost none | About 400–500 lines Kotlin after trimming (copied, then verified) |
| iOS later | Same API on iOS | Needs a Swift counterpart behind the same module interface |
| OEM defences | Same permission requests | Same permission requests |

## 5. Decision

**Use a small local Expo native module (Option B).** Copy Comma's `LocationTrackingService`, `ActivityTransitionReceiver` and module scaffolding into the MileWage repo, then trim and re-verify. `expo-location` stays only for permission request UI and "location services enabled" checks. `expo-task-manager` is **not** used.

Why: the product's whole job is gap-free, battery-friendly tracking with the screen off. Option A cannot gate the radio on movement, depends on JS surviving, and does not restart after a kill. Option B already exists, runs on this exact SDK, and costs a copy-and-verify rather than a new build.

### 5.1 Scope of the native module (and nothing more)

1. Foreground service, `foregroundServiceType="location"`, `startForeground()` with the explicit type argument (needed on Android 14, per Comma's code comment and E5).
2. `FusedLocationProviderClient` request, with last-known-fix anchor at start.
3. Activity Transition gating: remove updates after 150 s `STILL`, resume on movement; if `ACTIVITY_RECOGNITION` is denied, degrade to always-on GPS (Comma's behaviour).
4. Write **every fix the provider delivers**, with its accuracy and speed, to a **dedicated native-owned buffer DB file**. The service applies **no distance filter, spike cut or accuracy filter and keeps no running total** (capture mode is the one exception, §5.9): all thresholds live in the shared engine (`14` §3.2, §5), so there is one implementation to test. (Comma's `getActiveDistanceMeters` idea is dropped; the live number comes from the engine's accumulator.) The buffer is `telemetry_buffer` (schema in `02` §3.1), a separate file, not the app's `expo-sqlite` database. Comma writes into the shared DB from Kotlin; a separate file avoids two-writer lock contention. JS reads and acknowledges rows through module methods.
5. Module API (platform-neutral so iOS can implement it later): `start(shiftClientId, cadenceConfig)`, `stop()`, `isTracking()`, `readPending(limit)`, `markUploaded(seqs)` (sets `sync_status = 'UPLOADED'` and `uploaded_at`; it no longer deletes), `evictUploaded(olderThanMs)` (deletes only `UPLOADED` rows older than the cutoff; it can never delete a `PENDING` row, `15` §2.1), `markRejected(seqs)` (moves permanently refused points to the quarantine table in `02` §3.1), `gnssOffsetMs()` (latest `fix_time − System.currentTimeMillis()`, used to stamp event times, `15` §10), `requestBatteryOptimizationSettings()`, and for diagnostics (`16` §6, §8) `readDiag(limit)`, `markDiagUploaded(seqs)`, `setDiagConfig(level, levelUntil, captureConfig)`, `readCaptureFixes(limit)` and `markCaptureUploaded(seqs)`. Points are identified by the device-assigned `seq`, as in `07` §2.5 and `08` §4.
6. **Restart-after-kill depends on background location (Android 14+, S0).** `START_STICKY` and the task-removed restart start a location foreground service from the background, which Android 14+ allows only when the app holds `ACCESS_BACKGROUND_LOCATION` ("Allow all the time"). If the driver grants only "While using the app", a killed service cannot restart itself until the app is opened. Requirements: onboarding must request "Allow all the time" after the Play-required disclosure (§5.6); if it is denied, the app shows a persistent warning that tracking will stop if the app is killed; on next app open the shift is recovered and the gap marked (§5.2). The recovery path also writes an **interruption** record `{fromMs: last fix time, toMs: recovery time}` that the app stores with the shift and sends with `shift.end`, so the engine records the cause as flag `tracking_interrupted` instead of guessing it from the gap (`14` §7.3). Spike A test A12 checks both cases.

### 5.2 Explicitly cut from Comma's module

| Cut | Reason |
|---|---|
| `ShiftOverlay.kt` (floating pill) and `SYSTEM_ALERT_WINDOW` | Not tied to a driver problem in Gate 1; Comma's own plugin notes this permission "commonly triggers manual review / rejection" on Play. Re-add only if the Human asks. |
| `BootReceiver.kt` | Restarting a location FGS from a boot broadcast is exactly the case Android 12+ restricts (E8; Comma's code already abandons on refusal). Mid-shift reboot is rare. On next app open, recover the shift and mark the gap honestly. Revisit after Spike A. |
| Hardcoded cadence constants | Move into one config object passed from JS at `start()`, so tuning needs no native rebuild. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in the copied manifest | Comma declares it. Play restricts it to apps whose core function is adversely affected by Doze (§5.3); remove it and send the driver to the system battery settings instead. |

### 5.3 Permissions (Android manifest)

`ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACTIVITY_RECOGNITION`, `POST_NOTIFICATIONS` (Android 13+), `CAMERA` (amended 2026-11-06 by owner decision: scanning the pairing QR code; used only on the pairing screen, no microphone; decoded with ZXing, without Google ML Kit, from 2026-11-07, plan 24 §6). Network access is already implied by the sync. **Not requested:** `SYSTEM_ALERT_WINDOW`, `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`, `RECORD_AUDIO`. Keep Comma's plugin that strips unwanted transitive permissions.

`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`: Comma declares it. Android's Doze guidance and Google Play's Device and Network Abuse policy (S0 claim 11) allow requesting the exemption only when the core function is adversely affected, and tell most apps to send users to the general battery settings instead ([Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby), [Play policy](https://support.google.com/googleplay/android-developer/answer/16559646)). Default for MileWage: **do not declare it**; instead open the system battery-optimization settings screen from onboarding and walk the driver through the OEM steps. Remove it from the copied manifest (§5.2). Requesting it is defensible only if Spike A shows OEM killing despite the foreground service, and would then need a Play review justification.

### 5.4 Upload path

- **Decision:** v1 uploads batches from **JS** (50–100 points, gzip, per `02` §3.2) on a timer while the app process is alive, and flushes on app open and shift end. The foreground service keeps the process at foreground-service importance, so JS timers are expected to keep running screen-off. **This is an assumption, tested in Spike A.**
- **Backlog mode (`15` §6):** after an outage the same JS worker drains shifts oldest first in batches of up to **500** points, sends `shift.end` only after every point of its manifest is acknowledged, shows determinate progress, and can be cancelled and resumed (state lives in the two databases, not in a session). It stays in JS: the backlog is a few MB, so no native uploader is justified.
- **Fallback if the assumption fails:** a native uploader inside the service. Not built until the spike proves it is needed.
- **Rejected:** `WorkManager` periodic uploads. Minimum 15-minute period; wrong for a live map, and extra moving parts.
- Points are durable in the native buffer before any network attempt, so a failed upload never loses data. Server insert is idempotent on `(device_id, seq)` (`07` §2.5, `08` §5).

### 5.5 Auto-start (Bluetooth / vehicle detection)

- **v1: no silent auto-start.** A shift starts when the driver taps. Android 12+ blocks starting a foreground service from the background (E8) and no plain-Bluetooth-receiver exemption was found. On Android 14+ any background start of the location service would also need `ACCESS_BACKGROUND_LOCATION` (§5.1 item 6).
- **v1.1 candidate:** a Bluetooth-connect or `IN_VEHICLE` event posts a notification, "Connected to car. Start shift?". The tap brings the app to a user-visible state, from which starting the service is permitted. This needs no special permission beyond notifications and `ACTIVITY_RECOGNITION`.
- **Later, only if the Human wants hands-free start:** `CompanionDeviceManager` + `REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND` (E8). It adds a pairing UX, and the app must still hold `ACCESS_BACKGROUND_LOCATION` (§5.1 item 6); justify before building.

### 5.5a Server module flags (README §1.3)

The tracker is a module the phone can switch off. At pairing and at every app start the app reads `modules` from `GET /settings` (`08` §16.1). With `tracking` off it does not start the native service and does not run the upload worker. With `stops` off (the `stops_enabled` setting) it hides the estimated split and the read-only stop markers; there are no delivery buttons or counts in any case (decision 1.5b). The app captures `stops_enabled` into each new shift's `segmenter` at shift start. Because the native module's interface (§5.1) is platform-neutral, iOS can implement the same interface later without touching the rest of the app.

### 5.6 Play Store plan

Core feature is mileage tracking during a shift (start shift, ride, end shift; stops are inferred from the track), so the background-location justification is straightforward. Prepare before first Play submission: the permissions declaration form, a demo video (disclosure → runtime prompt → tracking continuing in background), the foreground-service-type declaration with its video, and a prominent in-app disclosure shown **before** the runtime permission prompt (wording includes "location" and that it is used in the background / when the app is closed). Reuse Comma's onboarding permission pages as a starting point.

### 5.7 Device caveats

| Device family | Expectation | Mitigation |
|---|---|---|
| Pixel (stock) | Works as designed | Baseline for Spike A |
| Samsung (One UI) | Mixed reports (E11) | Battery setting "Unrestricted" for MileWage; remove from "sleeping apps"; verify on a real device |
| Xiaomi / Redmi (HyperOS) | Worst case (E11) | Autostart on, battery "No restrictions", lock app in recents; link instructions in onboarding; if Spike A fails here, document as a known-limited device rather than building more native code |
| De-Googled (GrapheneOS etc.) | Fused location and Activity Transition depend on Play Services | `02` proposes a `LocationManager` fallback. **Defer it** (Anti-slop, below); detect missing Play services with the Play services availability check at first launch (not by catching a crash) and degrade to unavailable with a clear message. What happens on a device without Play services is undocumented and **not tested** (the owner's Samsung has Play services, `12` §16). Raise with the Human, since self-hosters may skew toward these phones. |

### 5.8 iOS implications (later release)

The React Native UI and the JS sync/upload layer carry over. The native module needs a Swift implementation behind the same API (`CLLocationManager`, `allowsBackgroundLocationUpdates`, "Always" authorization, significant-change relaunch). Comma's `ios/CommaTrackerModule.swift` exists and was not reviewed here. Expect: an App Review justification for background location (E12), a blue pill unless "Always" is granted, and no Activity-Transition equivalent (iOS uses `CMMotionActivityManager`). iOS gets its own spike; it is not assumed to work.

### 5.9 Diagnostics hooks (decision 1.5c, `16`)

The module records its own lifecycle facts into a table in the same native-owned `tracker.db`, through one interface, `DiagSink`, with a writer and a no-op implementation (the no-op is the module toggle). Nothing else in the module knows about diagnostics.

- **Hook points** are the places Comma's service already logs today: service created and destroyed, task removed, `startForeground` refused, permission lost, still-gating on and off, activity-transition registration, anchor fix saved. Each becomes one `service.event` row (`16` §3.2) instead of a `Log.d` line. Window counters (`track.window`) are plain variables updated inside the existing location callback; the first callback after a 10-minute boundary writes one row. **No timer, alarm, job, wake lock or extra thread is added.**
- **No coordinates in diagnostics or logs.** The copied module's `Log.*` calls are audited when it is copied (the first 30 lines of Comma's module log no location), and a CI check bans location-bearing arguments (`16` §4.2).
- **Capture mode** (module `capture`, `16` §8) adds a `captureConfig` to `start()`: the service requests the dense cadence, writes every fix to `capture_fixes`, and writes to `telemetry_buffer` only fixes that meet the production cadence (at least 10 s and 20 m since the last written fix). This is the one place the service applies a gate to what reaches the buffer, active in capture mode only. It is unverified against the provider's own behaviour; shifts recorded this way carry the `capture_session` flag.
- **Cut:** logcat shipping, minidumps, a native crash handler that captures memory. The native crash event is the Java/Kotlin exception class plus frames, with the message withheld unless the class is allowlisted (`16` §4.3).
- **Permissions:** none added.

## 6. Proposed Changes to the `02` Sampling Table

(These were applied to `02` §2.2 in the 14/15 reconciliation of 2026-11-04. The cadence below is a tracker **input**; the filters are the engine's, `14` §4-5.)

Comma's proven cadence is one request at 10 s / 20 m with activity gating. The 4-tier speed table in `02` §2.2 needs re-requesting location updates on each speed change, which adds native complexity with no evidence that it is needed to hit the battery budget.

| Driving state | Trigger | Request | Notes |
|---|---|---|---|
| **Moving** | Activity Transition = IN_VEHICLE / ON_BICYCLE / ON_FOOT | `PRIORITY_HIGH_ACCURACY`, interval **10 s**, min displacement **20 m**, `maxUpdateDelay` **30 s** | Comma's proven values (`14` §4). 5 s / 10 m is experiment E1, adopted only if it beats the baseline by the bar in `14` §12. |
| **Still** | `STILL` confirmed for **150 s** | Remove location updates (GPS radio off) | Short stops (traffic lights) keep GPS on. Resume on next movement transition. |

Moved to the engine (`14` §5.3): the stationary gate (20 m from the last accepted fix), the 42 m/s spike cut and the 50 m accuracy filter. The native service applies none of them.

Cut: the separate "Highway", "City" and "Approach" tiers, and the 60 s stationary heartbeat. Re-introduce a tier only if Spike A shows the battery or accuracy budget is missed.

## 7. Spike A — Pass / Fail Criteria

**Devices (minimum 3):** a Pixel on Android 14 or 15, a mid-range Samsung (One UI 6+), a Xiaomi/Redmi (HyperOS). Release build, not a dev client. Battery-optimization settings set per §5.7. Screen off, phone in a car mount, mixed driving.

| # | Test | PASS | FAIL action |
|---|---|---|---|
| A1 | Battery, ≥ 2 h driving with screen off (dumpsys batterystats + % delta) | ≤ **3.5 %/h** on Pixel and Samsung | Raise interval / displacement; if still failing, add speed tiers back |
| A2 | Gaps | No gap > 60 s between points while moving, excluding documented no-fix places (tunnel, garage) | Investigate OEM kill vs fix quality |
| A3 | Distance accuracy over a ≥ 50 km route vs the car odometer | Within **±2 %** | Tune filters |
| A4 | Survival: swipe from recents, 30 min screen-off, Doze | Service alive; points keep arriving on Pixel and Samsung; Xiaomi passes with documented settings or is recorded as known-limited | Fix restart path; do not add more native code for Xiaomi alone |
| A5 | Stationary 45 min | Added distance < **0.3 km**; GPS updates absent from `dumpsys location` after the 150 s timeout | Fix gating / phantom guard |
| A6 | Kill the app process mid-drive, then reopen | Zero committed points lost; shift recovered; gap marked | Fix buffer writes |
| A7 | JS upload timer with screen off for 30 min (§5.4 assumption) | Batches reach the server at expected cadence | Build the native uploader |
| A8 | Upload idempotency: replay a batch twice | Server holds each point once | Fix the `(device_id, seq)` scheme (`07`/`08`) |
| A9 | Resident memory (`dumpsys meminfo`) | < **60 MB** (`02` §1) | Profile JS side |
| A10 | Start the service from the background on Android 14/15 (notification-tap path, §5.5) | Starts without `ForegroundServiceStartNotAllowedException` | Keep manual start only |
| A12 | Restart after process kill with "Allow all the time" versus only "While using the app" (§5.1 item 6) | "All the time": service restarts or the shift is cleanly recoverable. "While using": behaviour recorded and the warning is shown | Make "Allow all the time" a hard onboarding requirement; keep the persistent warning |
| A15 | Diagnostics cost (`16` §6.2) | Over the ride days at level basic: read `diag.self` (`cpu_ms_per_h`, `writes_per_h`); audit that diagnostics registers no timer, alarm, job, wake lock or extra request (`dumpsys alarm`, `dumpsys jobscheduler`, code review) | CPU < **0.5 s per hour** and ≤ **30 writes per hour** **(new)**; zero extra wakeups or requests | Lengthen the window; if still failing, default diagnostics to `off` |

Spike A passes when A1–A6 and A8 pass on Pixel and Samsung. A7, A9 and A10 select between the designs named in their fail actions. A15 (diagnostics cost) must meet its budgets, or diagnostics default to `off`.

**Added by `14` §10 (see `12` §6 for how they run in the slim plan):** A13 conformance, the engine's output on the fixture set must be byte-identical under Node 22 and under Hermes on the S24 Ultra; A14 parallel ride, Comma's tracker and the MileWage tracker on the same trip, totals compared (`14` §10.2); A15 `processShift` on 5,000 fixes in under 200 ms on the S24 Ultra.

## 8. Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| `expo-location` + `expo-task-manager` only | No activity-gated radio, JS-dependent, no restart after kill (E2, E3) |
| Third-party background-geolocation library (e.g. a paid RN plugin) | New dependency and likely licence cost; Comma already has working code; conflicts with the no-third-party-tracking-SDK scope rule in `01` |
| Fully native Android app | Loses the shared TypeScript monorepo (decision 1.3) and the iOS reuse path |
| Foreground service + `WorkManager` uploads | 15-minute minimum period; wrong for live tracking |
| Raw GNSS / NMEA tracking | Already rejected in `02` §5 |

## 9. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Findings
> 1. **Copying code is not verifying it.** Comma's module runs, but this document did not run it. Every claim in §5 is a hypothesis until Spike A. Copy it, then test, rather than trusting "it works in Comma".
> 2. **Speed tiers and heartbeat cut.** The `02` four-tier table had no evidence behind it. One request plus activity gating is the smaller design.
> 3. **Overlay, boot receiver and `SYSTEM_ALERT_WINDOW` cut.** No Gate 1 driver problem needs them, and the permission invites Play review friction.
> 4. **No native uploader, no `WorkManager`, no auto-start in v1.** Each is built only if a spike criterion fails.
> 5. **De-Googled `LocationManager` fallback deferred.** It doubles the location code paths. This is a scope question for the Human, not a technical one.
> 6. **Unverified items flagged, not hidden:** no confirmed Android 15 timeout for `location` (E7), no confirmed Bluetooth-receiver exemption (E8), unverified Samsung One UI 6 claim (E11), Play policy for `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` unchecked (§5.3), iOS facts from secondary sources (E12).

## 10. Human Decisions Needed

1. Approve Option B (copy and trim Comma's native module) as the Android tracking engine.
2. Confirm cutting the overlay, boot receiver and the four-tier sampling table.
3. Decide whether de-Googled phones (no Play Services) must be supported in v1.
4. Confirm the device set for Spike A (Pixel, Samsung, Xiaomi), and that you can supply them.
