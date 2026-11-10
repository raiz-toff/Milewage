# :tracking

Location recording for a shift, and the opt-in "You seem to be driving. Start a shift?" prompt.
Platform `LocationManager` only: no Google Play Services, no Firebase, so it runs on de-Googled
phones.

Every decision is plain Kotlin in `:core` (`app.milewage.core.tracking`) and tested on the JVM:
`TrackingCore` (the coordinator), `StillnessMonitor`, `DriveDetector`, `LocationPlan`,
`LiveDistance`, `FixMapper`, `ShiftNotice`. This module only applies it: the foreground service,
the notifications, the receivers and the controller. Robolectric is not used: the Android layer is
kept thin enough that there is nothing worth simulating, and its pure helpers are JVM-tested.

## Wiring (the app)

```kotlin
class MileWageApp : Application(), TrackingDependenciesProvider {
    override val trackingDependencies by lazy {
        trackingDependencies(this, fixStore = roomFixStore, shiftCommands = shiftCommands, diagnostics = diag)
    }
}
```

- `FixStore`: the points table (`:data`, Room). `InMemoryFixStore` in `:core` until it lands.
- `ShiftCommands`: the seam for the notification buttons (below).
- `TrackingController.get(context)`: `startShift(id, startedAt)`, `stopShift()`,
  `setDetection(on)`, `updateSettings(...)`, `setNotice(shiftNotice(...))`, `status`
  (`StateFlow<TrackingStatus>`, no coordinates), `gnssOffsetMs()`, `interruptions(id)`,
  `permissions()`, `ensureRunning()` (call when the app comes to the foreground).
- At shift end the app passes `interruptions(id)` and `ClockSkew.medianPhoneMinusGnssMs(fixes)` to
  the engine (`ShiftInput.interruptions`, `clockSkewMs`).

### Ending and starting from a notification

Starting or ending a shift is more than recording (the shift row, the server call, the engine run
and the hand-off), so the tracker never does either itself. "End shift" (on the shift and on the
nudge) calls `ShiftCommands.endShift()`; "Start" on the prompt calls
`ShiftCommands.startDetectedShift(driveStartedAt)`. The app does its work and calls
`TrackingController.stopShift()` / `startShift()` back. If the app answers `OPEN_APP` (no vehicle
yet, not paired) or takes over 8 s, a notice says "Open MileWage to ...": Android 12+ does not let a
receiver open an activity from a notification button.

## State machines

```
Shift (StillnessMonitor)                 thresholds: still radius max(40 m, acc A + acc B), 150 s, 9 km/h
  FULL ── usable fix inside the radius 150 s after the anchor (and after the last wake-up) ──▶ LOW
  FULL ── no usable fix for 5 min (indoors, a tunnel) ─────────────────────────────────────▶ LOW
  LOW  ── a fix outside the radius, a usable fix at 9 km/h, or the significant-motion sensor ─▶ FULL
          (a wake-up stays FULL for at least 150 s)
  "Still on shift?" once per still period after 30 min (setting; 0 is off); movement or
  "Keep going" takes it down. Never ends a shift.

No shift, detection on (DriveDetector)
  IDLE ── motion sensor / idle fix moved (>= 60 m and both accuracies) at >= 9 km/h or after 3 min
          / a fix reporting >= 10 km/h ──▶ PROBING (GPS 3 s)
  PROBING ── fast: 3 usable fixes, every step >= 25 km/h, straight line >= 70% ─────▶ DETECTED
          ── sustained: last 3 min, >= 90 s moving, moving speed >= 14 km/h, >= 400 m ─▶ DETECTED
          ── no usable fix 60 s / nothing promising 90 s (after 90 s) / 6 min ──▶ IDLE + backoff
             (3, 6, 12, 20 min; vehicle-speed evidence skips it, up to 3 failures in a row)
  DETECTED (prompt up, GPS at 5 s, fixes kept: 20 min, 600 at most)
          ── "Start" ──▶ PAUSED (shift records; the kept fixes are stored under the shift)
          ── "Not now" or swipe / 15 min unanswered / drive ended ──▶ COOLDOWN
  COOLDOWN ── the drive has ended (5 min still on a fix, or 10 min without fixes) and the
              quiet hour (60 min; 30 min after a shift) is over ──▶ IDLE
  PAUSED ── shift ends ──▶ COOLDOWN (no prompt on the drive home)
```

Cycling: couriers on bicycles and scooters are prompted by the sustained rule. Its moving speed
leaves out time at red lights, so 15 to 25 km/h city riding confirms in about 3 to 4 minutes;
walking and jogging (up to 12 km/h) never do. The price is a prompt on a bus or a fast run, which
"Not now" quiets for the drive and an hour.

## Provider strategy

| State                     | Requests                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Shift, FULL               | `gps`, 5 s, no distance filter, batching up to 15 s (Android 12+ chips that support it)   |
| Shift, LOW                | `gps` 60 s (AOSP duty-cycles GNSS at 10 s and over), `network` 60 s, `passive`, motion sensor |
| Detection idle            | `network` 60 s, `passive`, motion sensor; `gps` 120 s only if the phone has neither      |
| Probe / prompt up         | `gps` 3 s / 5 s                                                                           |

- Recording uses the GNSS provider, not `FUSED_PROVIDER` (API 31+): fused "may combine inputs from
  several other location providers", is Google's provider on Google phones and AOSP's elsewhere,
  and is missing below Android 12
  ([LocationManager](https://developer.android.com/reference/android/location/LocationManager#FUSED_PROVIDER)).
  The engine wants raw GNSS fixes with GNSS time.
- Only fixes from the recording provider are stored. Network positions (Wi-Fi, cell) feed the
  decisions but are not stored: indoors a Wi-Fi position 40 m off with a 30 m radius would count
  as a move. `passive` GNSS fixes (another app's navigation) are stored; the copy of our own fix
  is dropped as a duplicate.
- Each stored fix keeps the points table's fields (same meanings, server contract unchanged) plus
  local-only `provider`, `elapsedRealtimeMs` and `phoneTimeMs`, so clock skew is measured on GNSS
  fixes only and late (batched) fixes are not mistaken for skew.

## Battery

GPS runs at full rate only while moving. After 150 s still it drops to the low-power watch. The
significant-motion sensor (no permission needed, unlike the step sensors:
[Sensor](https://developer.android.com/reference/android/hardware/Sensor#TYPE_SIGNIFICANT_MOTION))
wakes it at once on most phones; without the sensor, the 60 s GNSS and network checks do, so a late
wake-up costs at most about a minute of straight line. Drive detection costs a network position a
minute plus short GPS probes, and a silent "Watching for drives" notification.

## Kill, reboot, permission loss, GPS off

- **Swiped away / killed**: `stopWithTask="false"`, `START_STICKY`, and a restart alarm
  (`setAndAllowWhileIdle`, no exact-alarm permission). The shift, its live distance, the low-power
  state and the detector's prompt are restored from snapshots. A service found dead while a shift
  recorded at full rate leaves a `SERVICE_RESTARTED` interruption (a flag for the engine; distance
  is never changed by it).
- **Reboot / app update**: the boot receiver (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`) resumes a
  running shift and detection. Allowed from the background
  ([exemptions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#background-start-restriction-exemptions);
  Android 15's boot rule does not cover `location`:
  [behaviour changes](https://developer.android.com/about/versions/15/behavior-changes-15#fgs-boot-completed)).
  Without "Allow all the time" Android 14+ refuses a location service started from the background
  ([while-in-use](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#wiu-restrictions)),
  so the driver gets "Your shift is not recording. Open MileWage to keep recording it."
- **A start Android refuses** (restart alarm on Android 12+ without a battery exemption): the same
  notice, no crash. `ensureRunning()` resumes when the app is opened.
- **Permission taken away**: Android kills the app. On the next start the gap is a
  `SERVICE_RESTARTED` interruption; without permission the service cannot start and the notice asks
  the driver to open the app (`status.problem`).
- **Location switch off**: recording pauses, `status.problem = LOCATION_OFF`, and the span is kept
  as a `LOCATION_OFF` interruption when it comes back.
- Coordinates are never logged. Diagnostics (`TrackingDiagnostics`) carry counts and states only.

## Field test (owner, on a real phone)

1. Allow precise location "all the time" and notifications; set battery to unrestricted.
2. **Car**: start a shift, drive 5 km with stops. The notification distance grows every 0.1 km and
   is close to the shift's final total. The chip shows on Android 16.
3. **Scooter or bicycle**: a 20-minute ride with traffic lights. Same checks.
4. **Tunnel or underground car park**: the shift keeps recording after it; the route has a straight
   line through the tunnel and no crash.
5. **10-minute stop**: park, wait 10 minutes, drive off. The stop shows in the shift, and the drive
   away is recorded from its start (the low-power watch woke in time; check there is no long
   straight line out of the stop). Note how fast it woke.
6. **30-minute stop**: "Still on shift?" appears once. Try "Keep going", then another 30-minute stop
   and "End shift".
7. **Kill the app** mid-shift (swipe from recents, then force stop from Settings on a second try):
   recording resumes by itself after the swipe; after a force stop, opening the app resumes it.
8. **Reboot mid-shift**: recording resumes after unlock without opening the app.
9. **Location switch off** for a minute mid-shift, then on: recording resumes.
10. **Drive detection**: turn it on in Settings with no shift. Drive off: the prompt comes within
    about a minute (car) or 4 minutes (bicycle). "Start" begins a shift from the drive's start.
    Next day, "Not now": no second prompt on that drive, none within the hour.
11. **Walking and a bus ride** with detection on: no prompt walking; a bus may prompt.
12. **De-Googled phone** (LineageOS without microG, or GrapheneOS), if available: steps 2, 5, 8
    and 10. The idle watch then uses the motion sensor or 2-minute GPS checks.
13. Battery: note the battery used over a full shift and over a day with detection on.
