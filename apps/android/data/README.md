# :data (and the API, connection, pairing, shift, sending and diagnostics code in :core)

Storage, the server connection, secure storage, the shift model, sending and diagnostics. The logic
that is not Android lives in `:core` so it runs on the JVM in tests and can become Kotlin
Multiplatform code: `app.milewage.core.api` (models, encoder, client), `app.milewage.core.connect`
(home or away, discovery, messages), `app.milewage.core.pairing` (codes, links, credential, device
session), `app.milewage.core.shift` (start, end, the engine run, recovery, edits, summary),
`app.milewage.core.sync` (outbox, sending, change log, restore resend, status, reminders, retention)
and `app.milewage.core.diagnostics` (allowlist, ring, upload). The app reaches all of it through one
object, `MileWageData` (below).
`:data` holds the Android adapters. Each is a port of the Expo app's code (`apps/phone/src/...`)
and its tests carry the Expo tests' cases.

## The API client

- `ApiClient` (`:core`) is the port of `apps/phone/src/api/client.ts`. It runs over the
  `HttpTransport` port; `OkHttpTransport` (`:data`) implements it on the client from
  `HttpClients.create(anyHttp)`. Calls are typed by the endpoint table `Api` (`Endpoints.kt`):
  `client.call(Api.settings)`, `client.call(Api.redeem, RedeemRequest(...))`.
- Every request carries `Accept`, `X-Client-Time` and, once paired, `Authorization: Bearer mwd_...`.
  The client never logs; exception messages hold only the status and the code.
- Failures are one type, `ApiException(status, code, retryable, retryAfterS, problem)`, with
  `failure: ApiFailure` for the screens and senders (unreachable, insecure address, wrong server,
  not MileWage, revoked, unauthorised, app too old (426), API version unsupported, read-only,
  restoring, server full, rate limited, invalid code, link expired, ...). The phone's own codes are
  in `ApiCodes` (`network`, `bad_response`, `insecure_address`, `wrong_server`, `not_milewage`,
  `api_unsupported`); the rest are the server's Problem codes.
- Shift changes are built once by `ShiftRequests.encode(ShiftChange)` (the port of
  `sync/shiftRequests.ts`) and sent with `client.send(request)`; an outbox row
  (`kind`, `entityKey`, `body`) gives the same request back with `ShiftRequests.requestFor`.
  Point batches and diagnostics go gzipped.

## The contract: how drift is caught

`packages/shared/openapi/openapi.yaml` is the contract. The Kotlin models (`Models.kt`) are written
by hand and `ContractDriftTest` (`:core:test`) fails when they and the spec disagree. It reads the
YAML from the repository and checks, for every operation in `Api.all`:

1. the path and method exist with the same `operationId`;
2. the request and response models match their schemas field by field (`DescriptorCheck`): every
   Kotlin field exists under the same wire name with the same JSON type; a request model writes every
   field the spec requires and only enum values it allows; a response model needs only fields the
   spec requires, is nullable where the spec allows null, and knows every enum value;
3. a contract-valid answer for every status the phone reads (`ContractFixtures`) validates against
   the spec (JSON Schema 2020-12, networknt json-schema-validator) and decodes with the model;
4. what the phone sends validates against the request schema (`ShiftRequestsTest` for every shift
   change and the point batch, `ContractDriftTest` for pairing, linking and diagnostics).

Why not generated: OpenAPI Generator 7.27 (kotlin, kotlinx_serialization) was tried on this spec.
`EpochMs` has no `format: int64`, so every timestamp came out as `Int` (it overflows); enums came out
`@Contextual`, uuids and dates as `java.util.UUID`/`java.time.LocalDate` (not multiplatform), and
its OpenAPI 3.1 support is labelled beta (it also rejects the spec's YAML without
`--skip-validate-spec`). Hand-written models with this two-way check catch the same drift.

When the spec changes:
1. Run `./gradlew :core:test`. The failures name each field and operation.
2. Update the answer in `src/test/.../support/ContractFixtures.kt` if an answer changed, then the
   model in `Models.kt` (and `Endpoints.kt` for a new or moved operation; a new operation needs a
   fixture per status).
3. Model rules: integers are `Long`; enums the phone sends or branches on are Kotlin enums, enums it
   only shows are strings (a newer server may add values); response fields an older server lacks get
   defaults.

One spec quirk is handled in the check: `ManualTripPut` is `allOf: [TripCreate, {edited_at}]` and
TripCreate says `additionalProperties: false`, which strict JSON Schema reads as "edited_at is not
allowed". The server validates its own merged object, so the check merges `allOf` members first.
(`unevaluatedProperties: false` on ManualTripPut would say it in the spec.)

## Connection rules (plan 28)

- **Two addresses.** A credential has a home address (on the home network, plain http allowed) and
  an away address (https, through Tailscale). `RoutePicker` uses home when the phone is on Wi-Fi or
  Ethernet and `GET <home>/healthz` answers within 1.5 s as a MileWage server with the paired
  instance id (`HealthProbe`); otherwise away. On mobile data it does not try home. The choice is kept
  for a minute and dropped when a request gets no answer. On Wi-Fi with a silent home address it
  looks (at most every 10 minutes, in the background) for the same instance on the Wi-Fi and keeps its
  new address (`Pairing.updateHome`, home addresses only).
- **Plain http only to a home address.** `ApiClient` refuses before building anything, and
  `HomeOnlyCleartext` in OkHttp refuses every hop, redirects included. The home address stored at
  pairing is always a home address (`HomeAddress`), so it passes the gate; a server's answer cannot
  store anything else (home must be a home address, away must be https outside it).
- **Identity on every answer.** An answer naming another `X-MileWage-Instance` than the paired one
  halts the device session (`WRONG_SERVER`): nothing is sent until the driver re-pairs. An answer
  without the header (a captive portal) is not a wrong server. Every other answer goes to
  `PairingDeps.onAnswer` with its restore generation, for the sending task's restore check.
- **Discovery.** `NsdDiscovery` browses `_milewage._tcp` with the platform NsdManager for 4 s and
  resolves each service (`registerServiceInfoCallback` on Android 14+, `resolveService` before).
  `Discovery.serversFrom` keeps record version 1 on home addresses only. Older phones (before
  T extensions 7) need a Wi-Fi multicast lock to receive mDNS: `CHANGE_WIFI_MULTICAST_STATE`
  (normal, no prompt) is in the manifest and the policy list; the lock is held only while browsing.
- **Android 17.** At targetSdk 36 local network access comes with INTERNET and the platform docs
  say not to declare `ACCESS_LOCAL_NETWORK`. When targetSdk becomes 37 it is a runtime permission
  (NEARBY_DEVICES group) for discovery and for any connection to the home address: add it to the
  manifest and the policy list, and ask before discovery or a home request while
  `AndroidNet.localNetworkPermissionNeeded()` is true.
- **Messages.** `Reach.addressProblem` (before connecting) and `Reach.explainFailure` (after) return
  types, not words; each case's KDoc has the Expo app's English for strings.xml.

## Pairing flows

- **Code** (QR, pasted text, `milewage://pair?...` link, or the https page link
  `<server>/pair#v=1&t=...`): `PairingLinks.parse(text)` then `pairing.redeem(link)`. With a home
  address in the code the phone redeems at home when it answers on the Wi-Fi, else at the code's
  address. Check `Reach.addressProblem(link.baseUrl, release)` first. A link that opens the app goes
  through `IncomingLinks.accept` (once per link) and `IncomingLinks.decide` (already paired: say so,
  never switch servers silently).
- **Link code on the home Wi-Fi**: `net.discover()`, then `pairing.startLink(server.url)` (show
  `userCode`), then `pairing.awaitLink(url, start)` (polls at the interval, slows down on
  `slow_down`, throws `link_expired`), or `pollLink` one at a time.
- **Storage.** The credential (`Credential`, with the token) is JSON in the Keystore-backed
  `SecretStore` under `pairing.credential`; the cached settings, the setup flag and a stored revoke
  are in the `pairing` DataStore file. A credential the Keystore can no longer open reads as
  "not paired".
- **Revoked, refused, another server.** `DeviceSession` holds the halt every sender obeys:
  `REPAIR` (401 `device_revoked`, kept across restarts; `pairing.status()` is `REVOKED`),
  `WRONG_SERVER` (blocks every request), `AUTH_PROBLEM` (other 401/403). Pairing again lifts every
  halt; so does `device.resume()` ("Send now", "Check the address").
- **Unpair**: `pairing.unpair(waiting = { unsent data exists })` refuses while data waits; pass
  `{ false }` after the driver confirms losing it.

## QR codes

`QrDecoder` reads a QR code from a luminance frame with ZXing (`com.google.zxing:core`, plain Java,
no Google services). `QrFrameAnalyzer` is the CameraX `ImageAnalysis.Analyzer` (Y plane of the
default YUV_420_888 output) with `ScanGate`. The scan screen adds `camera-camera2`,
`camera-lifecycle` and `camera-view` (or `camera-compose`) in `:app`, binds a Preview and an
`ImageAnalysis` (`STRATEGY_KEEP_ONLY_LATEST`) with this analyzer, and asks for CAMERA only then.

## The database (Room 3, `app.milewage.data.db`)

`MileWageDatabase` (version 1, schema exported to `data/schemas/` and committed). The native app
**starts empty**: nothing is imported from the Expo app's SQLite files (`milewage-app.db`,
`tracker.db`). The driver pairs again after installing it, and anything the Expo app had not sent
must be sent before updating (release notes).

| Table               | Holds                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shifts`            | One row per shift, the running one too: status, segmenter, times, local date, totals (null until a result), digest, version, flags (phone and server), manifest, recon, send state, server deduction, battery, notes. |
| `fixes`             | The record: every fix with `seq` INTEGER PRIMARY KEY AUTOINCREMENT (strictly increasing, never reused), the wire fields, the local-only `provider`, `elapsed_realtime_ms`, `phone_time_ms`, and `send_state` 0 pending / 1 sent (`sent_at`) / 2 set aside (refused for good; kept, left out of results). No foreign key: a fix is never lost to a missing parent. |
| `interruptions`     | The tracker's interruptions, copied to the shift at its end.                                                                                                |
| `trips`             | Automatic trips (with the driver's trip edit applied in place, `edited_at` set) and manual trips. Cascades from `shifts`.                                    |
| `stops`, `routes`   | The result's stops and the simplified route (one JSON row per shift, out of the list queries). Cascade.                                                     |
| `odometer_readings` | `(shift, shift_start/shift_end)`. Cascade.                                                                                                                  |
| `vehicles`          | From `GET /vehicles` and the change log: a shift starts offline.                                                                                            |
| `outbox`            | The queue of changes (`kind`, `entity_key`, exact request `body`, `status` pending/parked). An answered row is deleted.                                    |
| `overwrite_log`     | The phone's side of the overwrite log: what it had when the server's value replaced it (`recon_diff`, `superseded_by_server`, `deleted_on_server`).          |
| `resend_marks`      | One per shift to send again after a server restore (`gen`, `phase` todo/queued, `after_seq`).                                                               |
| `bookkeeping`       | Small values: change-log cursor, restore generation, last pull, last vehicle, odometer checks, reminder state, diagnostics state.                          |
| `diag_events`       | The diagnostics ring, validated events only.                                                                                                                |

Write-ahead logging, foreign keys on, and `synchronous = FULL` on every connection (`DurableDriver`
turns Room's `NORMAL` into `FULL`): a commit is on storage before the call returns, also across a
power loss. Fixes are appended by the tracker one delivery per transaction (1 to 3 fixes every 5 to
15 s while moving, one a minute when still): about 3,000 small commits for a 12-hour shift; SQLite's
automatic checkpoint (1,000 pages) keeps the log small. Indices cover the queries: fixes by
`(shift, seq)`, `(send_state, shift, seq)` and `(send_state, sent_at)`; outbox by `(status, id)`,
`(shift, kind)` and `(kind, entity_key)`.

**Retention** (`Retention` in `:core`, `FixQueue.evictSent`): the Expo app's rule exactly (a sent
fix goes 14 days after the server acknowledged it, never a pending one, nothing while a restore may
still ask for them) plus one condition: its shift must be confirmed by the server (sent, end
accepted, nothing of it queued) and not running.

`RoomLocalStore` implements every storage port of `:core` (`LocalStore`), the tracker's `FixStore`
and an `InterruptionLog`. Room's `@Upsert` is not used: it tells a conflict by the exception's
message, which the JVM tests' SQLite stub drops; the DAO updates, then inserts.

## The shift model (`app.milewage.core.shift`)

`ShiftModel` (start, end, recovery, edits, the notification buttons as `ShiftCommands`), `ShiftRun`
(the engine input from stored fixes, interruptions, trip edits and clock skew; `processShift` on a
background dispatcher), `Summaries` (day, week, month; running value), `LiveTotals` (the running
distance from the stored fixes, incrementally), `OdometerDue`. Record first: every operation writes
the shift row, readings, edits and outbox in one transaction before it returns and never waits for
the network. The shift's create is queued at the start like every other change.

- **End**: stop the tracker, store the end time, run the engine (off the main thread), then in one
  transaction the result, the interruptions, `shift.end` (manifest, phone result, interruptions)
  and the status. A kill in between is finished by `recover()`.
- **Unfinished shift** (`recover()` at app start): a running shift the tracker is not recording is
  started again; one that recorded nothing for 12 hours is ended at its last qualified fix, never
  "now" (`lastFixEnd`, flag `shift_auto_closed`); `closeUnfinished()` does it on the driver's word.
- **Manual trips** get the purpose "Business driving" when the driver gives none (the AR5 fix:
  the server refuses an empty purpose, and every phone-added trip was parked for it).
- **Deduction estimate**: the server's value wins for a shift the change log sent; others are
  estimated through `MileageRates` on the business distance (total minus personal trips). Only the
  driver's own rate is implemented: **the country packs (`@milewage/shared` `mileageDeduction`) are
  not ported yet**, so with official rates the phone shows the server's values and none for shifts
  the server has not valued.

## Sending (`app.milewage.core.sync`)

One module, `Sender`, a port of AR5's `sync/sender.ts` with its pieces (`Outbox`, `OutboxRunner`,
`PointSender`, `ChangePuller`, `RestoreCheck`, `RestoreResend`, `Retention`, `buildStatus`,
`UnsyncedReminders`). A round:

1. `GET /settings` (a wrong server shows before data goes; the restore generation is read here).
2. A shift the server holds open (create acknowledged, end queued) is closed first.
3. What a server restore lost (`RestoreResend`): the running shift first, then oldest first:
   create, every fix still on the phone, then readings, end and edits through the outbox.
4. The running shift: its create and start reading, then its fixes in batches of 100.
5. Ended shifts oldest first: create and readings, every fix in batches of 500 (413/422 halve the
   batch, refused fixes are set aside), then `end` (it waits for the shift's last fix). Between
   batches the running shift's overdue fixes go first.
6. The running shift again, then edits of shifts already sent, then `GET /sync/changes`, then the
   retention rule.

The server keeps one active shift per driver, so shifts are opened there in order: the running
shift's create waits until every older shift the phone sends is created and ended, and an older
shift not yet created waits while the running one is open there. A running shift's create refused
with `shift_already_active` (a shift running on the web or another phone) is kept, not parked: the
shift keeps recording and `RunningShiftView.serverHasOtherShift` says so.

Halts (`DeviceSession`): revoked, wrong server, sign-in problem stop every request; nothing is
dropped. Pairing again (code or link) lifts them at once and wakes the loop: sending resumes with
no restart and every queued change goes (AR3). `retrySending()` lifts halts and refusals.

Conflicts, as the Expo app: the server's recalculation replaces the phone's numbers and the phone's
go to the overwrite log (`recon_diff`); a queued phone edit strictly newer than the server's row
keeps its value and wins when sent, older or equal loses and is logged; a shift whose create or end
only the phone holds is not overwritten by the feed; a delete on the web removes the shift and logs
its unsent edits.

Restore: `RestoreCheck.observe` is plugged into `PairingDeps.onAnswer` (`ServerConnection(onAnswer =
...)`, done by `MileWageData`). A higher `X-MileWage-Restore-Gen` marks every shift whose create is
not queued for resending, clears their server ids, shows them "on phone only" again and blocks
eviction until the resend is done.

Unsynced reminders (decision 1.5d): `Reminder.dueAt` (none before 3 days, then at most daily,
stronger from 7) and `UnsyncedReminders` keep exactly one reminder scheduled through the app's
`ReminderPort` (show, schedule, cancel, granted). `:data` posts nothing itself.

### Background sending

- In the process: `Sender.start(scope)` runs a round at once, on every `kick()` (a change queued, a
  shift ended, the network back, a re-pair), on the retry delay after a failure, and every upload
  interval (60 s or the server's hint) while a shift runs (the tracker's foreground service keeps
  the process). Idle otherwise.
- `WorkSendScheduler`: unique one-time work `milewage-send` (network required, KEEP, exponential
  backoff from 30 s) on every queued change, and unique periodic work `milewage-send-periodic`
  (hourly, network required). `SendWorker` calls `MileWageData.runInBackground()` through the
  Application (`MileWageDataProvider`).
- Not expedited: expedited work is quota-limited, and below Android 12 WorkManager runs it as a
  foreground service, which from targetSdk 34 needs a type (dataSync: a permission outside the
  manifest policy, and Android 15's six-hour daily limit). Nothing is urgent: every change is on
  disk before it is queued.
- Home or away is chosen per request by the existing `RoutePicker` (`pairing.session()`); sending
  never picks an address itself.

## Diagnostics (`app.milewage.core.diagnostics`)

`PhoneDiagnostics` (a port of `phoneDiagnostics.ts`) with `Allowlist`/`DiagKinds` (a port of the
shared allowlist for the kinds the phone records): counts and states only, never coordinates
(decision 1.5c). Events: `app.start`, `shift.summary` and `engine.run` at a shift's end,
`upload.window` and `diag.self` every 10 minutes, `crash`, and the tracker's events as
`service.event` (`trackingSink`). App events go as `phone_js` (the contract's name for the app
layer), the tracker's as `phone_native`. Sent through `POST /diagnostics/events`, gzipped, at most
200 per batch, never while fixes wait.

## The facade: `MileWageData`

The Application makes one (`MileWageData.create`) and implements `MileWageDataProvider`. Every
`Flow` re-reads when a table it reads changes (Room's invalidation tracker) or sending changes;
every suspend function commits before it returns.

```kotlin
class MileWageData {
    companion object {
        fun create(
            context: Context,
            anyHttp: Boolean,                 // BuildConfig debug only
            appVersion: String,               // BuildConfig.VERSION_NAME
            scope: CoroutineScope,            // the Application's
            recorder: Recorder,               // :app's adapter over TrackingController (below)
            reminders: ReminderPort? = null,  // :app's notifications; null: banner only
            battery: BatteryPort? = null,     // for shift.summary
        ): MileWageData
        fun assemble(...): MileWageData     // tests: own database, pairing and clock
        fun ratesOf(s: Settings?): MileageRates
    }

    // Parts
    val store: RoomLocalStore
    val pairing: Pairing                      // status, redeem, link, unpair, device halts
    val connection: ServerConnection?         // net (Tailscale, discovery), route
    val shifts: ShiftModel
    val sender: Sender
    val diagnostics: PhoneDiagnostics

    // For :tracking: trackingDependencies(context, fixStore, shiftCommands, trackingDiagnostics)
    val fixStore: FixStore
    val shiftCommands: ShiftCommands
    val trackingDiagnostics: TrackingDiagnostics
    val interruptionLog: InterruptionLog      // if interruptions should live in Room instead of prefs

    // Lifecycle
    fun start(device: DeviceInfo)             // Application.onCreate: recover, app.start, loop, periodic work
    fun kick()                                // foreground, network back, a screen that shows sending
    suspend fun runInBackground(): BackgroundResult   // SendWorker
    suspend fun diagnosticsWindow()
    suspend fun updateReminders()
    suspend fun reminderShownOnBanner()

    // Reads
    fun homeSummary(): Flow<HomeSummary>                  // day, week, month: shifts, unsent, total, business, deduction
    fun runningShift(): Flow<RunningShiftView?>          // shift, distanceM, deductionSoFarCents, vehicle, serverHasOtherShift
    fun shiftList(limit: Int = 200): Flow<List<ShiftListItem>>   // shift, marker, vehicle; newest first
    fun shiftDetail(clientId: String): Flow<ShiftDetail?>        // trips, stops, route, odometer, interruptions, overwrites
    fun syncStatus(): Flow<SendStatus>                    // sync (colour, counts, message, halt), progress
    fun vehicles(): Flow<List<VehicleRecord>>
    suspend fun summaryNow(): HomeSummary
    suspend fun runningNow(): RunningShiftView?
    suspend fun detailNow(clientId: String): ShiftDetail?

    // Writes
    suspend fun startShift(vehicleId: Long, odometerStartM: Long? = null): StartResult  // Started, NotPaired, AlreadyRunning, RecorderRefused
    suspend fun endShift(odometerEndM: Long? = null): EndResult                          // Ended(shift, run), NoShift
    suspend fun closeUnfinished(): EndResult
    suspend fun setOdometerStart(readingM: Long): EditResult
    suspend fun editTrip(tripKey: String, kind: TripKind? = null, purpose: String? = null): EditResult
    suspend fun addManualTrip(clientId: String, kind: TripKind, startedAt: Long, endedAt: Long, distanceM: Long, purpose: String? = null): EditResult
    suspend fun setOdometer(clientId: String, kind: OdometerKind, readingM: Long): EditResult
    suspend fun setNotes(clientId: String, notes: String): EditResult
    suspend fun markOverwriteSeen(id: Long)
    suspend fun odometerDue(vehicleId: Long): Boolean
    suspend fun markOdometerChecked(vehicleId: Long)
    suspend fun lastVehicleId(): Long?
    suspend fun refreshVehicles(): VehicleList            // vehicles, offline
    suspend fun sendNow(): Boolean                        // true: nothing left on the phone only
    suspend fun retrySending(): Boolean                   // "Send now": lifts halts and refusals
    fun cancelSending()
    suspend fun hasUnsentData(): Boolean
    suspend fun unpair(loseUnsentData: Boolean = false): Boolean   // refused while data waits
}
```

`EditResult` is `Ok` or `Refused(NO_SHIFT | FINALIZED | RUNNING | NO_TRIP | INVALID)`. Words for
`StatusMessage`, `ShiftMarker` and `Reminder` are in their KDoc (the Expo app's English) for
strings.xml. Amounts: metres and cents as `Long`; format with `app.milewage.core.format`.

The `Recorder` the app implements (`:data` cannot depend on `:tracking`):

```kotlin
class TrackingRecorder(private val c: TrackingController) : Recorder {
    override suspend fun start(id: String, startedAt: Long) = c.startShift(id, startedAt) == TrackingController.StartResult.STARTED
    override suspend fun stop() = c.stopShift()
    override suspend fun recording() = c.status.value.takeIf { it.mode == TrackingMode.RECORDING }?.shiftClientId
    override suspend fun interruptions(id: String) = c.interruptions(id)
    override fun gnssOffsetMs() = c.gnssOffsetMs()
}
```

## Tests

`./gradlew :core:test :data:testDebugUnitTest :data:lintDebug`. The database runs on the desktop
JVM with the bundled SQLite (`androidx.sqlite:sqlite-bundled-jvm`, test only; no Robolectric) and
the same entities, DAOs and driver wrapper; the network through the real OkHttp stack to
`FakeMileWage`, a MockWebServer that behaves like the server (one active shift, fixes by seq,
restore with a generation). `DatabaseTest` also opens a database built only from the exported
schema JSON. `EndToEndTest` plays a shift online and offline-then-online and times the engine on a
12-hour shift (`build/engine-timing.txt`).
