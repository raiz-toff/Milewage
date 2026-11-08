# 14 — Phone Processing Specification (the shared track engine)

**Lead Agents:** Agent 1 (Mobile Systems) & Agent 3 (Standards & Compliance)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION — decisions made, awaiting Human review. No code is written by this document.  
**Build note (2026-11-08):** built; what was done and what differs is in [`progress.md`](./progress.md). Decisions 1.5a and 1.5b are recorded in `06` section 2. No sign-off of this document itself is recorded in `06` section 6; it is an input to roadmap `17`, which the owner approved on 2026-11-04 (Gate 4).  
**Parent:** [`plans/milewage/README.md`](./README.md)  
**Implements:** Gate 1 items **1.5a** (the phone is a working local app, offline for weeks) and **1.5b** (no per-delivery taps: stops are auto-detected, the active/deadhead split is an estimate, labelling is web-only) in [`06`](./06-human-in-the-loop-review-gates.md).  
**Inputs:** Comma's code, read-only (`utils/geoCalculations.ts`, `src/registry/gpsConfig.ts`, `store/useActiveShift.ts`, `hooks/useGPSTracking.ts`, `modules/comma-tracker/.../LocationTrackingService.kt`, `docs/architecture/gps-engine.md`, `web/src/core/gps-tracker.js`), and MileWage `02`, `07`, `08`, `09`, README §1.3.  
**Companion:** [`15`](./15-offline-storage-and-sync-spec.md) (offline storage and sync) holds the phone's tables, retention and the sync protocol. This document owns the algorithm, the result shape and the identities (`trip_key`, `calc_version`, `input_digest`); `15` owns where they are stored and sent. Reconciled on 2026-11-04 (`11` §7).

---

## 1. What this document decides

When a driver is offline for a week, the phone cannot wait for the server to turn GPS points into miles. The phone must produce the same totals, trips and route the server will produce, show them immediately, and later have the server confirm them.

The way to guarantee that is **one engine, two hosts**:

```
                    packages/shared/track-engine   (pure TypeScript, no I/O)
                         │                    │
        runs on the phone (Hermes)     runs on the server (Node 22)
        at shift end, on every edit,   on upload, on every edit,
        and live during the shift      on recalculate
                         │                    │
              shows the driver at once   authoritative; flags a mismatch
```

This document specifies the engine's interface, its parameters, the rules it applies, how phone and server stay in agreement, how it is tested, and how it is versioned.

---

## 2. What Comma actually does (read from the code, not from the docs)

Comma's mileage is accurate for its owner, and this section records exactly why, and where its docs and code disagree.

| # | Fact | Source |
|---|---|---|
| C1 | Sampling: `FusedLocationProviderClient`, `PRIORITY_HIGH_ACCURACY`, **10 s interval, 20 m minimum displacement, `maxUpdateDelay` 30 s**. | `LocationTrackingService.kt` `startLocationUpdates()` |
| C2 | The native service drops a fix before saving it if the **implied speed exceeds 42 m/s (151 km/h)** or it is **less than 20 m from the last *saved* fix**. The anchor is the last saved fix, so a dropped fix never moves it and slow creeping still accumulates (the next fix is measured against the same anchor). | `processLocation()` |
| C3 | Only `lat`, `lon`, `timestamp` (the fix's own time) are saved, into `temp_native_points`. **Accuracy, speed and bearing are not kept.** | `saveLocationToDatabase()`, `schema.ts` |
| C4 | At shift end JavaScript re-reads those points in timestamp order and, for each consecutive pair, computes haversine (R = 6,371,000 m), applies the same 42 m/s jitter test, and **classifies the segment by its own speed: under 5 km/h = "dead", otherwise "active"**. Totals are converted to miles/km per segment and rounded with `toFixed(2)`. | `useActiveShift.endShift()`, `geoCalculations.ts`, `gpsConfig.ts` |
| C5 | The route is simplified with `simplify-js` (Ramer-Douglas-Peucker, high quality) at about **10 m** and stored as `shifts.routePath`. | `endShift()` |
| C6 | **The raw points are deleted** (`db.delete(tempNativePoints)`) as soon as the shift is saved. The `location_points` table exists but the phone's `endShift` does not fill it. So Comma **cannot recompute** a shift. Only the simplified route and the totals survive. | `endShift()` step 7 |
| C7 | GPS is switched off after **150 s of confirmed stillness** (Activity Transition API) and back on at movement. The first fix on start is the "last known location" if it is under 60 s old. | `ACTION_STILL`, `startLocationUpdates()` |
| C8 | The web tracker uses a 25 m accuracy cut, a 10 m minimum movement, the same 150 km/h cut, and "dead until the first order is marked". | `web/src/core/gps-tracker.js` |
| C9 | There is **no test suite and no fixture data** in the Comma repository outside `node_modules` (checked). | repository search |

**Three findings that change this plan:**

1. **"Dead" means three different things in Comma.** The database doc says dead miles are "GPS distance while not on a delivery". The phone code classifies by segment speed (C4). The web app classifies by "before the first order" (C8). `isFirstOrderReceived` exists on the phone but `endShift` never reads it. The phone's "dead" miles are really the distance covered in segments moving slower than 5 km/h, which is mostly slow creeping and the first fix after a stop, not deadhead driving. The *total* is unaffected, which is why Comma's total feels accurate. **The active/dead split is the weak part of Comma, and MileWage does not copy it** (§6).
2. **Comma's accuracy comes from three simple things:** the provider's own distance gate, an anchor-relative 20 m gate, and a speed-spike cut. Nothing clever. The engine keeps all three.
3. **Comma throws the evidence away** (C6). MileWage keeps raw fixes, with accuracy and speed, so any shift can be recomputed and audited.

---

## 3. The engine: interface and boundaries

**Package:** `packages/shared/track-engine` in the MileWage monorepo. Pure TypeScript. No imports from React Native, Node, the database or the network. No `Date.now()`, no `Math.random()`, no `Intl`, no locale. This is what lets the same file run on Hermes and on Node and give the same answer.

```ts
// All numbers are integers. Times are UTC epoch milliseconds. Coordinates are degrees x 1e7.
interface Fix {                       // one stored point (matches 07 §2.5 / 02 §3.1)
  seq: number;                        // device-assigned, strictly increasing, never reused
  recordedAt: number;                 // the fix's own GNSS time
  latE7: number; lonE7: number;
  accuracyM: number;                  // horizontal accuracy radius, whole metres
  speedDmps?: number;                 // reported speed, decimetres per second
  bearingDeg?: number; altitudeM?: number;
}

interface StopLabelInput {            // from 07 §2.8 stop_labels (web only); only the role matters to the engine
  stopKey: string;
  role: 'pickup' | 'dropoff' | 'other';
}

interface Stop {                      // derived by stage 5; becomes a 07 §2.8 stops row
  stopKey: string;                    // `${shiftClientId}:${startedAt}:stop`
  startedAt: number; endedAt: number; dwellS: number;
  latE7: number; lonE7: number;       // the anchor fix
  confidence: 'low' | 'medium' | 'high';
  estRole: 'pickup' | 'dropoff' | 'none';            // the engine's estimate
  role: 'pickup' | 'dropoff' | 'other' | 'none';     // the role used: the label if any, else estRole
}

interface ShiftInput {
  shiftClientId: string;
  startedAt: number;
  endedAt: number;                    // for an unfinished shift: the time of the last fix (§7.4)
  fixes: Fix[];                       // any order, duplicates allowed; the engine sorts and de-duplicates
  segmenter: 'stops' | 'whole_shift'; // fixed per shift at its start from the stops setting (07 §2.3); never read from live settings
  stopLabels?: StopLabelInput[];      // always empty on the phone before the server has the shift; set only by the server from web labels
  interruptions?: { fromMs: number; toMs: number }[];  // tracker stopped/restarted, written by the app's recovery path
  edits?: TripEdit[];                 // driver reclassifications from 07 §3 rule 7
}

interface ShiftResult {
  algorithmVersion: number;           // §11; stored as shifts.calc_version
  inputDigest: string;                // §9.2
  totals: { totalM: number; activeM: number; deadheadM: number; personalM: number };
  trips: Trip[];                      // 07 §2.3: kind, original_kind, started_at, ended_at, start/end, distance_m, purpose
  stops: Stop[];                      // empty when segmenter is 'whole_shift'
  route: { latE7: number; lonE7: number; t: number }[];   // simplified, for the minimap and replay (display only)
  flags: Flag[];                      // §8; audit-relevant facts about data quality
  stats: Record<string, number>;      // counts per drop reason, fixes in/used, gap metres, etc.
}

function processShift(input: ShiftInput): ShiftResult;     // the authority: batch, deterministic
function createLiveAccumulator(startedAt: number): {       // the phone's live total during a shift
  push(fix: Fix): void;
  runningTotalM(): number;                                 // approximate, never stored
};
```

### 3.1 Stages (fixed order, plain functions)

| # | Stage | Does | Toggle |
|---|---|---|---|
| 1 | `normalize` | Sort by `(recordedAt, seq)`; drop duplicate `seq`; drop fixes outside the shift window | always on |
| 2 | `qualify` | Drop fixes with `accuracyM > 50` (§5.2) | always on |
| 3 | `gate` | Walk fixes against the **last accepted fix**: drop non-positive time, drop implied speed over 42 m/s, drop under 20 m movement, otherwise accept and add the distance (§5.3) | always on |
| 4 | `gaps` | Flag accepted segments that crossed a signal gap (§7) | always on (flags only, never changes distance) |
| 5 | `stops` | Find dwell clusters in the **qualified** fixes (stage 2 output, before the gate) and give each a confidence (§6.2, §6.5) | only when `segmenter = 'stops'`; reads no accepted-fix distance, so it cannot change a total |
| 6 | `segment` | Split accepted segments into trips: **stop-based estimate** or **whole-shift** (§6) | the existing segmenter slot (`08` §16.3) |
| 7 | `edits` | Re-apply the driver's trip reclassifications (§6.7) | always on |
| 8 | `route` | Simplify accepted fixes for display (§5.5) | always on |

`createLiveAccumulator` runs stages 1-3 only, one fix at a time, using the same stage functions, so the live number and the final number can differ only by what the later stages and sorting change. The live number is shown to the driver but never stored; `processShift` replaces it at shift end.

### 3.2 Module boundaries

- The engine knows nothing about **where** fixes come from (native buffer, server table) or **where** results go. Hosts adapt their storage to `ShiftInput` and `ShiftResult`.
- The native tracker (`09` §5.1) only **records**. It applies no distance filter and keeps no running total. All thresholds live in the engine, so there is exactly one implementation to test.
- Tracker cadence (interval, minimum displacement) is an **input** chosen by the app at `start()`. The engine's thresholds are an **algorithm** and are versioned (§11). Changing cadence needs no version bump; changing a threshold does.
- Thresholds are constants in the package. They are **not** user settings, server settings or feature flags, because totals must be reproducible.

---

## 4. Baseline values: Comma, current MileWage docs, and what is adopted

Rule used: **adopt Comma's proven value unless there is evidence for a different one.** No evidence exists yet for any change, so the changes below are experiments (§12), not defaults.

| Parameter | Comma | MileWage docs today (`02`/`07`/`09`) | **Adopted for v1** | Why |
|---|---|---|---|---|
| Fix interval (tracker input) | 10 s | 5 s | **10 s** | Comma's value, proven on the owner's real rides. `09` §6 called 5 s "a starting value to be tuned". Tested as E1. |
| Provider minimum displacement (input) | 20 m | 10 m | **20 m** | Same reasoning. E1. |
| `maxUpdateDelay` (input) | 30 s | 30 s | **30 s** | Already agreed. |
| Stillness before GPS off | 150 s | 150 s | **150 s** | Already agreed. |
| Accuracy filter | none on the phone; 25 m on the web | 50 m (`07` §3 rule 1) | **50 m** | Phone never filtered by accuracy because it never stored it (C3). 50 m is the loosest value both specs allow, so it removes only clearly bad fixes. 25 m is tested as E2. |
| Spike cut | 42 m/s (151 km/h) | 150 km/h | **42 m/s (420 dm/s)** | Identical. A 125cc scooter cannot reach it, so it catches only glitches. |
| Stationary/phantom guard | 20 m from the last saved fix | speed < 1.5 km/h and move < 12 m (`02` §5, `07` §3 rule 2) | **20 m from the last accepted fix** | Comma's guard is a superset of the 12 m rule and was proven. Having two overlapping rules adds complexity for no evidence. `07` rule 2 is replaced (§14). |
| Distance formula | haversine, R = 6,371,000 m | haversine | **haversine, R = 6,371,000 m** | Same radius, so a MileWage replay of Comma's data matches. |
| Route simplification (display) | RDP about 10 m | 5 m for the 90-day archive (`07` §4.2) | **10 m for display; the archive keeps 5 m** | Different jobs. Totals never use the simplified route. |
| Active/deadhead rule | segment speed < 5 km/h | delivery windows (`07` §3, tapped) | **stop-based estimate; no taps** | §6. Decision 1.5b replaced the tapped delivery windows. |
| Rounding | float sum, `toFixed(2)` in display unit | integer metres | **integer decimetres per segment, integer metres in output** | §9. |

---

## 5. The rules, precisely

### 5.1 Normalize (stage 1)

1. Sort by `(recordedAt, seq)`. Ties on time are broken by `seq`.
2. Keep the first occurrence of each `seq` (a retried upload cannot double-count).
3. Drop fixes before `startedAt - 5 min` or after `endedAt + 10 min` (the same window the server accepts, `08` §5).

### 5.2 Qualify (stage 2)

Drop any fix with `accuracyM > 50`. Fixes are **kept in storage** and only skipped here, so a later version can use them (`08` §5: accuracy is never a reason to reject on upload).

### 5.3 Gate (stage 3), the core of the distance

State: the **anchor**, the last accepted fix. The first qualifying fix is accepted as the anchor with no distance.

For every later fix `f`, with `dt = f.recordedAt - anchor.recordedAt` and `d` = haversine distance from the anchor to `f`, rounded to the nearest decimetre (`dm`):

1. `dt <= 0` → drop, count `non_positive_dt`.
2. `d_dm * 1000 > 420 * dt_ms` (implied speed above 42 m/s) → drop, count `speed_spike`. The anchor does **not** move.
3. `d_dm < 200` (under 20 m) → drop, count `within_gate`. The anchor does **not** move, so slow creeping accumulates against the same anchor and is counted once it reaches 20 m.
4. Otherwise accept: add `d_dm` to the running total, `f` becomes the anchor.

All comparisons use integers (§9). The result for any input that Comma's native service + `endShift` would have accepted is the same set of segments and the same distance.

**Known bounds of this method, stated honestly:**
- It measures the **sum of straight segments between recorded fixes**. On curves and at turns this is slightly **shorter** than the path ridden. How much is not known for this cadence on Toronto streets; E1 measures it.
- Up to 19.9 m of movement after the last accepted fix at shift end is not counted.
- This bias is toward under-counting, which is the safe direction for a tax record, and it is why the engine never "corrects" distance by smoothing (§12, E4).

### 5.4 Distance is never overridden

Per `07` §3 rule 8, nobody edits `distance_m` of an auto trip. A trip the tracker missed is added as a manual trip, and exports mark it.

### 5.5 Route (stage 8)

Ramer-Douglas-Peucker over accepted fixes, tolerance 10 m, in a local equirectangular projection, timestamps carried with each point. First and last points are always kept. The engine uses **its own small implementation**, not `simplify-js`, so the output cannot change when a dependency updates. It is checked for equivalence against `simplify-js` on the fixtures. The route is for display and replay only; **no total is ever computed from it.**

---

## 6. Active vs deadhead: auto-detected stops, estimated split

### 6.1 The decision (1.5b)

A rider mid-shift does not tap Accepted, Picked up and Dropped off for every order, so the engine never needs them. The phone only has **start shift** and **end shift**. Everything else is inferred from the GPS track:

1. **Total business miles** come from the whole shift and never depend on stops. This is the tax figure, and it is identical with stops on or off.
2. **Stops** are detected automatically (§6.2). They are recorded as facts with a confidence.
3. The **active/deadhead split is an estimate** from the stop pattern (§6.3). It is labelled "estimated" wherever it appears.
4. **Labelling** stops (pickup, dropoff, other, platform, payout, notes) is optional and happens **only in the web app**, after the fact (§6.6). Labels improve the estimate; nothing requires them.
5. The whole feature is one setting, `settings.stops_enabled` (default on). When off, the shift is a single `active` trip named `Business driving`, with `deadhead_m = 0`, and no stop UI or routes are used. The value is captured per shift in `shifts.segmenter` at shift start, so a later toggle never changes an existing shift.

Comma's speed rule (§2 finding 1) and "before the first order" rule are still rejected. The previous design of this section, tapped delivery windows, is replaced by this one.

### 6.2 Stop detection (stage 5)

**Input:** the qualified fixes (stage 2 output: sorted, de-duplicated, accuracy at most 50 m), **before** the 20 m gate. The gate drops the fixes that sit inside a dwell, so stop detection must read the stage-2 list. All arithmetic is integer, using the same rounded-decimetre haversine as §5.3.

**Parameters** (constants in the package, versioned with `algorithmVersion`, not user settings):

| Constant | Value | Meaning |
|---|---|---|
| `stopRadiusDm` | 400 (40 m) | A fix belongs to a dwell if it is within this distance of the dwell's anchor (its first fix). Larger than normal parked jitter, smaller than a block |
| `stopMinDwellMs` | 120 000 | A cluster shorter than this is not recorded as a stop (traffic lights, brief pauses) |
| `stopToggleDwellMs` | 180 000 | An **unlabelled** stop must last at least this long to change the estimate (§6.3) |
| `stopBreakDwellMs` | 1 800 000 | A stop at least this long is flagged `long_stop` and does **not** change the estimate (a break, or a long wait that only a label can classify) |
| `stopWakeGapMs`, `stopWakeRadiusDm` | 90 000, 1 500 (150 m) | The wake-up rule below |
| `stopMergeRadiusDm`, `stopMergeRideMs` | 1 000 (100 m), 120 000 | Merge rule below |
| `stopStartGuardMs`, `stopStartGuardRadiusDm` | 300 000, 1 500 | Start guard below |

**Algorithm (scan once, left to right):**

1. Take fix `i` as the anchor. Extend the cluster over following fixes while each is within `stopRadiusDm` of the anchor.
2. **Wake-up rule.** The tracker switches GPS off after 150 s of stillness (C7), so a long stop has few fixes, and the first fix after wake-up is often already moving. If the next fix after the cluster comes after a gap of at least `stopWakeGapMs` and lies within `stopWakeRadiusDm` of the anchor, it is added to the cluster as its last member. Without this rule a ten-minute wait would read as 150 s.
3. `dwell = time(last member) - time(anchor)`. If `dwell >= stopMinDwellMs` the cluster is a stop: `startedAt` is the anchor time, `endedAt` the last member's time, the coordinates are the anchor's. Continue at the fix after the last member. Otherwise continue at `i + 1`.
4. **Merge rule.** Two consecutive stops whose anchors are within `stopMergeRadiusDm` and with less than `stopMergeRideMs` between the first one's end and the second one's start are one stop (walking to the door and back to the scooter; moving along a restaurant car park). The merged stop keeps the first one's key and the second one's end.
5. **Start guard.** A stop that starts within `stopStartGuardMs` of the shift start and whose anchor is within `stopStartGuardRadiusDm` of the shift's first fix gets `estRole = none`, so sitting at the start location does not read as a pickup.
6. `stopKey = <shift client_id>:<anchor recordedAt ms>:stop`. The same string on phone and server.

The scan is `O(n)` in practice: a cluster only looks ahead over fixes within the dwell, and a rider moving at ordinary speed leaves the radius within two fixes.

### 6.3 Estimating active vs deadhead from stops (stage 6)

A small state machine over the stops in time order. The state starts as **deadhead** (riding to the first pickup).

| Stop | Effect on the state |
|---|---|
| Has a driver label `pickup` | Set **active** |
| Has a driver label `dropoff` | Set **deadhead** |
| Has a driver label `other` | No change |
| Unlabelled, `dwell >= stopToggleDwellMs`, below `stopBreakDwellMs`, not start-guarded | **Flip**: deadhead becomes active (`estRole = pickup`), active becomes deadhead (`estRole = dropoff`) |
| Unlabelled otherwise (low confidence, break-length, start-guarded) | No change (`estRole = none`) |

The state **changes at the stop's `endedAt`** (departure). Each accepted segment takes the state in force at its end time, so the ride into a stop belongs to the previous state and the ride out of it to the new one. Distance during the dwell is zero by the gate, so no metre is moved or double counted by the choice of boundary. A trip boundary is created exactly where the state changes; stops that do not change the state do not split trips.

This is the "ride to the restaurant is empty, the ride from it to the customer is carrying food" model. It is an **assumption**, and the doc says so: it matches a one-order-at-a-time rider and mislabels stacked orders (§6.4).

### 6.4 Edge cases and fallbacks

| Situation | Engine behaviour | Flag |
|---|---|---|
| Traffic lights (30-90 s, up to about 2 min at big intersections) | Below `stopMinDwellMs`: not a stop | none |
| Long red light or queue of 120-179 s | A `low`-confidence stop; recorded, never changes the estimate | none |
| Queue creep that stays within 40 m for 3 minutes | Looks like a real stop and can flip the state. A known false-positive source, measured in Spike A (E9); fixed by an `other` label | none |
| Restaurant wait, hand-over at a door | The case the model is built for. Merge rule joins the walk to the door | none |
| Stacked orders (pick up two, drop two) | Flips at the first pickup (active), at the first dropoff (deadhead, wrong: still carrying the second order), flips again. The estimate under-states active miles | none. The driver fixes it with labels on the web (`pickup`, `pickup`, `dropoff`, `dropoff`) |
| Break, gas, home | At 30 minutes or more: `long_stop`, no flip. Shorter ones flip wrongly | `long_stop` (info) |
| Sitting at the start location | Start guard: no flip | none |
| Stop at the end of the shift | Recorded; nothing follows, so it cannot change any trip | none |
| GPS asleep during the stop | Wake-up rule keeps the dwell honest | none |
| A tunnel or killed service during a dwell | A gap (§7), not a stop: the next fix is far from the anchor | `gap_counted` as before |
| **No stop changed the estimate** (zero stops, or none long enough) | The **whole-shift segmenter** is used: one `active` trip, purpose `Business driving`. Otherwise the whole shift would read as deadhead | `no_stops_detected` |
| Wrong guess about the first stop of a shift that really starts with a drop-off | Estimate inverted for the whole shift | none. Label any one stop and the rest follows (§6.6) |

The estimate can be wrong in both directions, which is why it is an estimate. The rule that matters: **it can never change `total_m`**.

### 6.5 Confidence

Per stop, from dwell time only: `low` (120-179 s), `medium` (180-599 s), `high` (600 s or more). Confidence says how likely a **real stop** happened, not whether it was a pickup. Only `medium` and `high` stops flip the unlabelled estimate. The shift also gets a coarse summary for the web: the share of the split that rests on unlabelled `medium` stops versus labelled ones. No number is shown as exact.

### 6.6 Labels (web only)

A label is `{ stopKey, role, platform?, place?, payoutCents?, tipCents?, notes? }` (`07` §2.8). The engine reads only `role`. The server applies labels when it runs the engine (`stopLabels` input); the phone never has labels, because labels can only exist after the server has the shift and its stops. Consequently:

- The phone's run at shift end uses **no labels**, and the server's first run at `shift.end` also has none, so they compare cleanly (`15` §7).
- When a label later changes the server's result, the phone learns it through the change feed (`15` §6.5). Once the server has confirmed a shift, **the phone never re-runs the engine on it**: it shows the server's rows, and a trip edit made on the phone is applied to the local row and confirmed by the next pull.
- The labelled `stopKey` is stable while the points and `algorithmVersion` are unchanged. If a recompute with changed inputs removes the stop, the label is kept and returned as `label_orphaned`, never dropped or re-attached by guesswork.

### 6.7 Driver edits survive recomputation (trip overrides)

A reclassification to `personal` or another trip edit is stored as an override keyed by `trip_key`, which is `<shift client_id>:<segment start epoch ms>:<original_kind>` (the same string on phone and server; `15` §8.3 stores it). After a recompute the engine re-applies an override to the trip with the same `trip_key`. If no such trip exists any more, the edit is **not applied, not silently dropped, and not re-attached by guesswork**: it is returned as `override_orphaned`. **A new source of orphans under 1.5b:** labelling stops on the web can change where the estimate flips, which moves trip boundaries and `original_kind`. The web labelling screen warns when a shift has trip overrides ("you have edited trips on this shift; labelling may unlink those edits"), and any orphaned override is reported on the shift.

### 6.8 Not in v1

- **No pause/resume.** Comma has a pause (`pausedSeconds`). `07` has no pause concept and distance runs for the whole shift. A rider who stops for personal time ends the shift or reclassifies the segment to personal.
- **No place matching.** A stop is not matched to a restaurant or an address (that needs map data; see §14). The driver can type a `place` on the web.
- **No notification or platform integration** to learn about orders. Screen reading, accessibility services and platform credentials are out of scope (`01` §3.2); reading other apps' notifications is a possible later optional module, unverified for Google Play policy, and not a v1 dependency.
- **No machine-learned stop classification.** Duration, location and the alternation model are enough to measure first (§12).

---

## 7. Gaps, interruptions and unfinished shifts

### 7.1 What a gap is

A **gap** is an accepted segment where `dt > 90 s` **and** the chord is `>= 100 m`. Those two conditions matter: after a long stop GPS is off by design (C7), so a long `dt` with almost no movement is a normal rest and is **not** a gap. A long `dt` with real displacement means the rider moved while nothing was recording: a tunnel or underpass, an urban canyon, a killed service, a dead battery, a phone left in a bag.

### 7.2 What the engine does

| Question | Decision |
|---|---|
| Count the missing distance? | **Count the straight chord between the two fixes, and nothing else.** It is a lower bound of the true path. It is already what stage 3 does, so a gap adds no special case to the number. |
| Interpolate a path? | **Never.** No invented points, no extrapolation, no map-based fill. |
| Invent distance for the gap? | **Never.** |
| Hide it? | **No.** Flag it. |
| Speed spike across a gap? | Dropped by the normal 42 m/s rule. The flag records `gap_dropped`. |

### 7.3 Flags and the driver's remedy

- `gap_counted`: gap duration, chord metres, start and end time. Shown on the shift detail screen and in exports as a data-quality note.
- `gap_large`: chord over 5 km or `dt` over 10 min. The shift detail screen asks the driver to look at it. The remedy for **missing** miles is a **manual trip** (07 rule 8), which exports mark as manual. The remedy for **unwanted** miles is a `personal` reclassification.
- `tracking_interrupted`: when the app's recovery path (`09` §5.1 item 6) restarts or recovers a killed service, it writes `{fromMs: last fix time, toMs: recovery time}` as an `interruption`. The engine copies it into a flag so the cause is recorded, not guessed from the gap.

### 7.4 Shift that never ended (dead battery, crash)

On the next app open the app offers **End shift at the last fix time (hh:mm)**, not at the current time. The default `endedAt` is the `recordedAt` of the last accepted fix, with flag `shift_auto_closed`. Ending it "now" would add hours of fake shift time and a false stop at the end of the track.

---

## 8. Flags (the audit trail of data quality)

Flags are facts about the data, never judgements, and are stored with the shift (`07` change in §19). They never alter a number.

| Code | Meaning |
|---|---|
| `gap_counted`, `gap_large`, `gap_dropped` | Signal gaps (§7) |
| `tracking_interrupted` | Service stopped or restarted (§7.3) |
| `shift_auto_closed` | Shift ended at the last fix because the driver never ended it |
| `no_stops_detected` | The stop-based segmenter found no stop that changed the estimate, so the whole-shift fallback was used (§6.4) |
| `long_stop` | A stop of 30 minutes or more; it did not change the estimate (§6.2) |
| `label_orphaned` | A web stop label no longer matches a stop (§6.6) |
| `poor_accuracy_share` | More than 30% of fixes were over 50 m accuracy |
| `low_fix_density` | Fewer than one accepted fix per 5 minutes of shift on average |
| `clock_skew` | Phone clock differs from GNSS time by over 2 minutes (§10) |
| `override_orphaned` | A driver edit no longer matches a trip (§6.4) |
| `manual_trip_present` | At least one manual trip is included in the totals |
| `calc_mismatch` | Server result differs from the phone's (set by the server, §9.4) |

`stats` carries the counters (`non_positive_dt`, `speed_spike`, `within_gate`, `low_accuracy`, `fixes_in`, `fixes_used`, `gap_m`) so a question like "why is this shift 0.3 km shorter than my odometer" has an answer.

---

## 9. Phone and server must agree exactly

### 9.1 Why it can go wrong, and the rule

The same source file running on Hermes and on V8/Node can differ in the last bit of `sin`, `cos` and `atan2`. Floating-point sums also depend on order. The engine removes both risks by design:

1. **Integer inputs only.** Coordinates are `E7` integers, times are integer ms, accuracy whole metres. The engine converts to radians internally and nowhere else.
2. **Round once per segment, then work in integers.** Each segment's haversine distance is rounded to the nearest **decimetre**. Every threshold test uses these integers (§5.3). Totals are exact integer sums, and output metres are `round(sum_dm / 10)` once.
3. **Fixed order everywhere:** sort by `(recordedAt, seq)`, trips ordered by `startedAt`, flags ordered by `(code, time)`. No iteration over unordered maps.
4. **No platform data:** no locale, no timezone, no clock.
5. **Fixed constants:** R = 6,371,000 m; the formula is written out in the package, not taken from a library.

Residual risk: a distance within about 1e-12 m of a half-decimetre boundary could round differently across engines. The chance is about 1 in 10^11 per segment and the effect is 0.1 m. The conformance test (§10.1) is what proves, not assumes, that it does not happen.

### 9.2 Input digest

`inputDigest` is a 64-bit FNV-1a hash over a canonical text form of the input (sorted fixes `seq,recordedAt,latE7,lonE7,accuracyM`, then the segmenter, then stop labels `stopKey,role`, then interruptions and edits). It is a consistency check, not security. It tells two failures apart:

| Digest | Totals | Meaning |
|---|---|---|
| equal | equal | Normal. |
| **different** | different | The server had different inputs: late points, or a stop label or trip edit made on the web. Expected and explained. |
| **equal** | **different** | The two engines disagree on the same input: an engine bug or a version mismatch. Never expected. |

### 9.3 What the phone sends

With `POST /shifts/{ref}/end` the phone sends its result summary as `phone_result`: `calc_version` (this engine's `algorithmVersion`), `segmenter` (the value captured at shift start), `input_digest`, `total_m`, `active_m`, `deadhead_m`, `personal_m`, `trips_count`, plus the `manifest` of its points (`first_seq`, `last_seq`, `point_count`) and the `interruptions` array of §7.3. All are additive to the frozen phone contract (`08` §8), as new optional fields. A later trip edit travels as a `trip.override` (`15` §8.3) and the server recomputes with it, so no second result is sent.

### 9.4 What the server does

When the shift's points have arrived, the server runs `processShift` on **its** stored inputs. **The server's result is authoritative and is what is stored.** It compares with `phone_result`:
- same digest, same totals → store, `recon_status = match`, `calc_mismatch = false`.
- different digest → store; `recon_status = differs` with the reason codes of `15` §7.3 (`points_missing`, `late_points`, `edited_on_web`, `calc_version`). This is expected and explained, and sets no `calc_mismatch`.
- same digest, different totals → store, set `calc_mismatch = true`, raise flag `calc_mismatch`, `recon_status = differs` with reason `engine_disagreement`, and log both results. The driver sees the server number; the phone corrects itself on the next sync.

Comparison is **exact**: integer metres, no tolerance. `15`'s old 10 m / 0.1% safety margin is removed because the engine is deterministic by construction (§9.1) and §10.1 proves it; a tolerance would hide exactly the engine bug the digest is there to find.

### 9.5 What the driver sees

The phone shows its own result immediately, labelled **not yet confirmed**. After sync it changes to **confirmed**, or shows what changed and why. The phone never keeps showing a number the server has superseded.

### 9.6 Server newer than phone

The server returns its `engine_version` in `GET /settings`. If it is higher than the phone's, the phone still shows its own result until sync, then replaces it. The phone always supports *producing* results with the version it shipped with. Section 11 covers recomputing old shifts.

---

## 10. Tests

### 10.1 Cross-engine conformance (the guard for §9)

The same fixture inputs run through `processShift` under **Node 22 (CI)** and **Hermes on the owner's Galaxy S24 Ultra**. The output JSON must be **byte-identical**. This runs in CI for Node and as a Spike A task on the device. If it ever differs, the fallback is to replace the haversine's `sin/cos/atan2` with a small deterministic implementation inside the package, and bump `algorithmVersion`.

### 10.2 What to use as fixtures, honestly

The brief was to use Comma's existing shift data. **That is not possible for raw data**: Comma deletes raw points after each shift (C6), has no stored accuracy or speed (C3), and has no test fixtures (C9). What exists is each shift's simplified `routePath` and its totals. So the fixtures are:

1. **Synthetic rides with known truth (committed to the repo).** A generator with fixed seeds produces: a straight line; a city grid with 90-degree turns; a closed loop; stop-and-go with 3-minute waits; a delivery run with two real stops (pickup, dropoff), a red light, a queue creep and a 40-minute break; a stop whose GPS slept; a shift that starts with a 4-minute wait; a GPS spike; a tunnel gap; out-of-order and duplicate fixes; fixes with accuracy tails; a 45-minute parked cloud of jitter. Each has an analytic ground-truth path length and an expected output, committed as JSON.
2. **Comma sanity check (not exact).** For a handful of the owner's past Comma shifts, export `routePath` and the stored totals, and compare the haversine length of the 10 m-simplified route with the stored total. They should agree within the bias that 10 m simplification introduces. This catches a gross engine error against real data; it is not a golden test.
3. **Parallel ride (Spike A day 0, already in `12`).** Run Comma's tracker and the MileWage tracker on the same ride. Comma's total is the comparison. Because the engine reproduces Comma's accept rules (§5.3), totals should agree to within the effect of the 50 m accuracy filter and the sampling-input difference, which the run quantifies.
4. **Measured loops (the real golden data).** Ride a closed loop of known length (measured on a map, primary truth) with the new tracker, keeping the raw fixes. The scooter's odometer is a cross-check only, not truth: scooter odometers are not calibrated instruments.
5. **Stop fixtures:** every synthetic ride with stops has committed expected `stops` (keys, dwell, confidence, `estRole`) and the expected estimated split; a label fixture checks the state machine with `pickup`, `dropoff` and `other`; one fixture proves `total_m` is identical with `segmenter = 'stops'` and `'whole_shift'`.
6. **Property tests** (run on every fixture and on random input): shuffling the input changes nothing; duplicating fixes changes nothing; `total = active + deadhead + personal`; adding fixes inside 20 m of the anchor changes nothing; the sum of trip distances equals `totalM`; a result never depends on the clock; `total_m` is identical under both segmenters; adding a label never changes `total_m`.

### 10.3 Performance bar

`processShift` on 5,000 fixes (about 14 hours at one fix per 10 s) runs in under 200 ms on the S24 Ultra and under 50 ms on Node. Both measured, not assumed. A shift of a normal day is about 2,000-3,000 fixes.

---

## 11. Algorithm version and recomputing old shifts

- `algorithmVersion` is an integer constant in the package, stored as `shifts.calc_version` (`07` §2.3). **Bump it whenever the output for any input could change**: a threshold, a rule, rounding, a stage. Pure refactors do not bump it. A test fails if the committed fixture outputs change without a bump.
- **Phone and server may ship different versions.** The server's result wins on upload (§9.4).
- **Finalized shifts are never recomputed automatically**, because they are the driver's tax record. A newer algorithm can only produce a **comparison report**: `milewage-cli recalc --dry-run [--since DATE]` prints, per shift, old and new totals and the difference, and changes nothing. Applying a new version to a finalized shift requires the driver to reopen it deliberately.
- Non-finalized shifts recompute on request (`POST /shifts/{ref}/recalculate`, `08` §3), on late points (`08` §5 step 6), and on edits.
- **Recompute needs raw fixes.** After the raw retention window (`07` §4.2, default 90 days) a shift keeps its stored trips and totals but is **not recomputable**, and the UI says so. Anyone who wants recomputation to stay possible raises `raw_retention_days`.
- **Experiments do not ship as a runtime toggle.** A winning experiment becomes the next `algorithmVersion`. There is no shadow-run infrastructure on the server (§17).

---

## 12. Accuracy improvements as measured experiments

None of these are in v1. Each runs in the Spike A harness, over recorded raw rides, and is adopted only if it meets its bar. This matches the instruction to start from Comma's proven values and change one only with evidence.

**Measurement protocol (once):**
1. Choose **3 closed loops** of known length measured on a map: one residential grid, one arterial with long lights, one downtown with tall buildings. Toronto, scooter, phone on the Quad Lock, helmet on.
2. Ride each loop **at least twice on two different days**, with a *dense recording* (interval 1 s, displacement 0) by a separate recorder (the Spike A rig in "dense" mode, not a second app), so coarser cadences and filters can be **simulated offline by decimating the same recording**. This tests cadence and filters on identical data. Battery cannot be simulated; it is measured on separate shifts.
3. Error = `|engine total − map length| / map length`. Primary truth is the map; the scooter odometer is a cross-check.
4. Baseline = the adopted v1 values. Every candidate is compared with baseline on the same recordings.

**Adoption bar for any candidate:** median absolute error improves by **at least 1 percentage point** (for example 3.0% → 2.0%) on at least 5 of 6 rides, the worst ride does not get worse, no stage becomes harder to explain to an auditor, and (where relevant) battery stays at or under 3.5%/h. Otherwise baseline stays. Error is judged against map length, so "closer to the odometer" is not a win.

| ID | Candidate | Measures | Notes |
|---|---|---|---|
| **E1** | Cadence/displacement: 10 s/20 m (baseline) vs 5 s/10 m vs 3 s/5 m | Distance error, fixes per hour, battery %/h (separate shifts) | Corner-cutting on grid streets is the suspected main bias. This is the likeliest real gain. |
| **E2** | Accuracy cut: 50 m (baseline) vs 35 m vs 25 m | Error, share of fixes dropped, number of gaps created | Tighter cuts remove bad fixes but make chords longer where fixes are thin. |
| **E3** | Accuracy-aware stationary gate: `max(20 m, 1.0 × accuracy)` instead of fixed 20 m; optional use of reported speed (`speedDmps` near 0 with a jump over 20 m is likely jitter) | Phantom metres in the 45-minute parked test; error on moving loops | Targets drift at stops in tall-building areas. Doppler speed is stored but unused until this shows a gain. |
| **E4** | Corner correction: any geometric smoothing of the accepted track | Error vs map, explainability | **Presumed rejected unless E1 cannot close the gap.** Tax distance must stay explainable as "the sum of straight segments between recorded fixes". |
| **E5** | Spike cut 42 m/s vs 30 m/s (108 km/h) | Spikes caught, any real distance wrongly dropped | A 125cc scooter will not exceed about 100 km/h, so a tighter cut might catch more glitches. |
| **E6** | Gap thresholds (90 s / 100 m) | Number and size of real gaps in the rides | Tune flags only; distance is unaffected. |
| **E7** | Activity Transition on a scooter | Whether IN_VEHICLE/other fires reliably, GPS-off false positives while riding | Comma's gating assumes it works for a car; a scooter and a vibrating mount are untested. A false STILL would create gaps. |
| **E8** | Stage budget | `processShift` time on the S24 Ultra for 5,000 fixes | Pass bar in §10.3. |
| **E9** | **Stop detection accuracy** (1.5b): `stopRadiusDm` 400 vs 300 vs 600, `stopMinDwellMs` 120 s vs 90 s vs 150 s, merge and wake rules | Recall of real pickup/dropoff stops, false stops per 10 real stops, queue-creep false positives | Ground truth: the owner reads the delivery platform's own order history after the shift (times, restaurant and address names), with no integration. See the protocol below |
| **E10** | **Estimate quality**: `stopToggleDwellMs` 180 s vs 150 s vs 240 s; the alternation model | Estimated `active_m` against the active distance implied by the ground-truth orders | Stacked orders measured separately |
| **E11** | Stop-label effort | Time to label one shift on the web; share of stops needing a correction | Tells whether the estimate is good enough that most drivers never label |
| **E12** | Stop key stability | Same recording, parameters unchanged: keys identical on phone and server; keys after a parameter change (expected orphans) | Guards `label_orphaned` |

**Stop-detection protocol (E9-E12).** Over at least **3 normal delivery shifts** containing at least **30 real pickup/dropoff stops**, the owner writes down nothing during the ride. After each shift they compare the shift's detected stops on the web with the platform's order history and mark each detected stop as a real pickup, a real dropoff, or a false stop, and note any real stop that was missed. **Pass bars (new, change them before a run):** detects at least 90% of real stops; no more than 1 false stop per 10 real ones; the estimated `active_m` is within 15% of the ground-truth `active_m` on average over the shifts. If E9/E10 fail, the fallback is the setting off (whole-shift totals), which costs nothing for tax; the parameters are then changed by a new `algorithmVersion`.

Not proposed: Kalman filters, map-matched distance (§14), machine-learned filtering. No evidence suggests the baseline needs them.

---

## 13. Riding in Toronto on a scooter: what that changes

- **Speeds:** urban riding is mostly 0-60 km/h, peak about 90-100. The 42 m/s spike cut is far above that; E5 may tighten it.
- **Frequent stops:** red lights are 30-90 s, shorter than the 150 s stillness timeout and the 120 s stop threshold, so GPS stays on, the route is not shredded and a light is not a stop. Waits at restaurants run minutes and GPS sleeps (C7); the wake-up rule (§6.2) keeps their dwell honest, the first fix after wake-up is often poor, which the 50 m filter handles, and the anchor stays at the stop. Queue creep and double-parked hand-overs are the likely false positives (E9).
- **Downtown multipath:** tall buildings give accuracy tails and short position jumps. This is why E2 and E3 exist and why `poor_accuracy_share` is a flag.
- **Mount and vibration:** the Quad Lock vibration dampener helps the phone, but whether Activity Transition still reports movement (E7) is untested.
- **Units and rules:** the owner is in Toronto, so km and CRA come first. The engine is unit-free; conversion happens only at display (`04`).
- **Vehicle type:** `07` §2.2 already has `motorcycle` (the HMRC class), which covers a 125cc scooter. Only the UI label and the rate class need confirming (§19).

What the engine needs from `15`, which now specifies it: durable local tables for the shift, its stops and trips, its overrides, its flags and its interruptions (`15` §2.2); raw fixes kept on the phone until the server confirms them (`15` §3.2); the results kept as a local read copy; the lost-phone warning (`15` §9.1).

---

## 14. Map matching: not in v1

Distance is the sum of straight segments between recorded fixes. Snapping the track to the road network is **not** part of any total, in v1 or later, because the raw track is the evidence an auditor can understand.

A **display-only** route snap may arrive later as an optional module: it changes how a route is drawn, never a stored distance. Comma's repository already has `scripts/start-valhalla.sh` and `scripts/test-valhalla-matching.sh` (a Valhalla container serving US and Canada tiles). Those scripts exist as prior art; what the data costs in disk and memory was **not** measured here, and a matcher of that size cannot live inside the 150 MB server budget (`10` §14), so it would be a separate optional container. No interface for it is defined now (§17).

---

## 15. Clock and timezone (phones offline for weeks)

| Item | Rule |
|---|---|
| Fix time | The fix's own GNSS time (`Location.getTime()`), which does not follow the phone's clock setting (`08` §9 item 2). |
| Shift and edit times | Stamped at capture with the GNSS-corrected clock (`now + gnss_offset_ms`, `15` §10). The stored value is never rewritten later by the server. If no fix is under 10 minutes old, the raw phone clock is used. |
| Detecting a bad clock offline | On every fresh live fix the app compares `Date.now()` with `fix.recordedAt` (the same `gnss_offset_ms` of `15` §10). A median difference over 2 minutes sets flag `clock_skew`, with a warning on the phone. This needs no server. The flag records that a correction was applied, not that a number is wrong. |
| Correcting it | **Corrected once, at capture, on the phone** (`15` §10). Consistent with `08` §9: the server never rewrites a client timestamp it received. The driver should still fix the clock. |
| `local_date` | Computed once at shift creation from the IANA timezone in `settings` (a cached read-only copy on the phone), **never from the phone's current timezone**, so phone and server agree. It is not part of the engine's output. The server recomputes it and its value wins. |
| Monotonic clock | Detecting a mid-shift wall-clock jump with `elapsedRealtime` is possible but **deferred**. It is only worth adding if Spike A shows jumps, and it would be a local column, not a wire change. |

---

## 16. Decisions

| # | Decision | Chosen | Why | Rejected |
|---|---|---|---|---|
| D1 | Where distance is computed | One shared engine, run on phone and server | Offline weeks (1.5a); one implementation to test | Phone-only (no audit); server-only (nothing offline); two implementations (drift) |
| D2 | Native tracker role | Record only, raw fixes with accuracy and speed | One place for thresholds; recomputable | Comma's native filtering and running total |
| D3 | Starting values | Comma's: 10 s / 20 m / 42 m/s / 20 m gate / R = 6,371,000 | Proven for the owner; no evidence yet for others | 5 s / 10 m from `09` §6 until E1 |
| D4 | Accuracy filter | 50 m hard cut | Loosest agreed value; fixes still stored | 25 m (web) as default; none |
| D5 | Stationary guard | 20 m from last accepted fix | Superset of the 12 m rule; proven | Both rules together |
| D6 | Active/deadhead | **Estimated** from auto-detected stops (1.5b); labels on the web only; whole-shift when the setting is off or no stop qualifies | No taps while riding; works offline; `total_m` never depends on it | Per-order taps on the phone; Comma's speed rule; "before first order" rule |
| D7 | Gaps | Count the chord, never interpolate, flag, manual-trip remedy | Lower bound, honest | Interpolation; ignoring the gap; auto-fill |
| D8 | Unfinished shift | End at last fix time | Avoids fake hours | End "now" |
| D9 | Determinism | Integer inputs, per-segment decimetre rounding, fixed ordering | Hermes and Node must match | Float sums |
| D10 | Disagreement | Server authoritative; digest separates cause; `calc_mismatch` flagged | Silent overwrite is forbidden by 1.5a | Phone wins; silent overwrite |
| D11 | Finalized shifts | Never auto-recomputed; dry-run report only | Tax record | Automatic migration |
| D12 | Route simplification | Own RDP, 10 m display, never used for totals | No dependency drift | `simplify-js`; totals from the simplified route |
| D13 | Live distance | Engine accumulator on the phone | One implementation | Native running total |
| D14 | Pause/resume, place matching, map matching, clock-jump detection, ML stop classification | Not in v1 | No evidence, no driver problem yet | Building them now |
| D16 | Stop parameters | Constants versioned with `algorithmVersion`: radius 40 m, min dwell 120 s, flip dwell 180 s, break 30 min | A guess to be measured (E9, E10); reproducibility | User settings; learned parameters |
| D17 | Phone after server confirmation | Never re-runs the engine on a confirmed shift; shows server rows | Labels exist only on the server; avoids phone/server drift | Phone re-derives with copied labels |
| D15 | Parameters | Constants versioned with `algorithmVersion` | Reproducibility | User/server settings, feature flags |

---

## 17. Modularity (README §1.3)

| Module | Interface | Depends on | Toggle | Removal |
|---|---|---|---|---|
| **track-engine** (shared package) | `processShift`, `createLiveAccumulator` | nothing | The `tracking` module on/off decides whether any host calls it | Without it, no auto trips; the logbook runs on manual trips |
| **Segmenter slot** | `segment(acceptedSegments, stops, stopLabels) → trips` | engine stages 1-5 | Stop-based when `settings.stops_enabled` was on at shift start; whole-shift otherwise or when no stop qualifies (`08` §16.3) | Whole-shift takes over, no other change |
| **Stops (stage 5)** | `detectStops(qualifiedFixes) → Stop[]` | engine stages 1-2 | The `stops` setting | Skipped; `stops` empty |
| **Tracker (native)** | `09` §5.1 interface | none | `tracking` flag (`09` §5.5a) | Not started |
| **Flags** | `Flag[]` in the result | engine | Always produced; exports choose whether to print a data-quality note | An export can omit them |
| **Experiments (E1-E12)** | New `algorithmVersion` | engine | Not a runtime toggle | A losing experiment is deleted from the harness |

Refused as slop (README §1.3 rule 7): a plugin loader for stages, runtime or per-user thresholds, a feature-flag service for the algorithm, server-side shadow-run tables, a `RouteSnapper` interface before any snapper exists, a generic "calculation strategy" abstraction beyond the one real slot (the segmenter).

---

## 18. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Findings
> 1. **"Comma's proven algorithm" is partly folklore.** What is proven is the sampling, the speed cut, the 20 m anchor gate and haversine totals (C1-C2, C4). Its active/dead split is not proven and its docs, phone and web disagree about it. This document says so and does not copy it.
> 2. **Comma's data cannot be a golden fixture.** It deletes raw points and has no tests (C6, C9). The golden data has to be created: synthetic rides with analytic truth, and measured loops. Planning that around Comma shifts would have produced nothing.
> 3. **Deterministic across Hermes and Node is a claim until tested.** The design removes the known causes (§9) and §10.1 tests it on the real device. Until the device run passes, treat "phone and server agree" as unproven.
> 4. **Accuracy gains are unmeasured.** The sampling change from 10 s to 5 s was in the docs with no evidence. It is now an experiment with a pass bar. The likely gain is corner-cutting on grid streets; that is a hypothesis.
> 5. **Surface-area check.** Not built: a pause concept, place matching, map matching, clock-jump detection, Kalman smoothing, shadow runs, runtime thresholds. Each would be a response to a problem nobody has measured.
> 6. **Cuts made while writing:** the separate "dwell collapse" rule (replaced by the single 20 m gate); the native running total; `simplify-js`; `Date.now()` dependence; per-user thresholds.
> 7. **Risk accepted:** the engine under-counts slightly (straight segments, up to 19.9 m at shift end). It is the safe direction for a tax record and it is documented, but a driver comparing with a car odometer will see a small shortfall.
> 8. **Stops (1.5b): an estimate on a guess.** The alternation model, the 40 m / 120 s / 180 s constants and the claim that detection works while GPS sleeps are untested. They are measured in E9-E12 with a pass bar, and the setting off is a free fallback because tax totals never depend on stops. Known wrong cases (stacked orders, queue creep, a first stop that is a drop-off) are listed in §6.4, not hidden.
> 9. **Unverified here:** Hermes' behaviour of `Math` functions; Hermes `Intl` (not needed by the engine); Activity Transition on a scooter (E7); the S24 Ultra's processing time (§10.3). None was run.

---

## 19. Cross-Document Fixes

| Doc | Location | Change |
|---|---|---|
| `02` | §1 budgets and intro | Replace "buffers only what it must" with: the phone keeps raw fixes and results until the server confirms them, and a local read copy afterwards (details in `15`). The 15 MB per-week budget still holds: about 19k fixes/week at about 70 B each is about 1.3 MB; four weeks offline is about 5.4 MB plus results. |
| `02` | §2.2 sampling table | Cadence input becomes 10 s / 20 m (E1 may change it). Remove the "phantom-mile guard 1.5 km/h / 12 m" row; the 20 m accepted-fix gate lives in the engine (§5.3). The jitter row moves to the engine. |
| `02` | §3.2 | "Phone keeps no summaries" is wrong under 1.5a. Phone keeps shift results, trips and route as its local copy. |
| `02` | §5 item 2 | The phantom-mile mitigation is the 20 m gate in `14`, not the 1.5 km/h / 12 m rule. |
| `07` | §3 rule 2 | Replace the dwell collapse with the engine's 20 m accepted-fix gate (`14` §5.3). |
| `07` | §3 rules 4-5, §2.8 | Replaced by stop-based estimation, `stops`/`stop_labels` tables and `shifts.segmenter` (applied, 1.5b). |
| `07` | §3 intro | Say the function is `processShift` in `packages/shared/track-engine`, with the same output on phone and server. |
| `07` | §2.3 `shifts` | Add `phone_calc_version INTEGER`, `phone_total_m INTEGER`, `input_digest TEXT`, `calc_mismatch INTEGER NOT NULL DEFAULT 0`, `interruptions_json TEXT` (names unified with `15` X5; applied). |
| `07` | new table (core) | `shift_flags(id, user_id, shift_id, code, severity, detail TEXT, created_at)` with `ON DELETE CASCADE`. |
| `07` | §2.2 `vehicles` | No schema change: `kind` already allows `motorcycle`. Confirm the app labels it so a scooter is easy to pick, and that the Canadian rate class for a motorcycle is checked in `04`. |
| `07` | §2.3 `trips` | Document that driver edits are keyed by `(started_at, original_kind)` and that an unmatched edit is returned as `override_orphaned`. |
| `08` | `POST /shifts/{ref}/end` | Accept optional `phone_result`, `manifest` and `interruptions` (`§9.3`). Additive, so the frozen contract holds (applied). |
| `08` | `Shift` schema | Add `flags[]` and `calc_mismatch`. |
| `08` | `GET /settings` | Add `engine_version`. |
| `08` | `POST /shifts/{ref}/recalculate` | Return `409 shift_finalized` on a finalized shift. The dry-run report is CLI only. |
| `08` | §5 step 6 and §16.4 | Recompute runs the shared engine; publish `shift.updated` with the flags. |
| `09` | §5.1 item 4 and §5.2 | The native service stores **every** fix the provider delivers, with accuracy and speed, and applies no distance filter. It keeps no running total. Delete the `getActiveDistanceMeters` idea. |
| `09` | §6 | Replace the proposed sampling table with the engine split: cadence inputs here, thresholds in `14`. Remove the phantom row (moved to the engine). |
| `09` | §5.1 item 6 | The recovery path also writes an `interruption` record for the engine (`14` §7.3). |
| `09` | §7 | Add a task: Hermes vs Node conformance run (`14` §10.1), and Comma day-0 parallel ride. |
| `12` | Spike A | Add: the conformance run on the S24 Ultra, dense recording mode for E1-E7, the three measured loops. |
| `06` | 1.5a | Already points to `14`. No change. |
| README | Directory blueprint | Add `14-phone-processing-spec.md`. |
| `15` | written | Covers the local tables, retention until confirmed, the lost-phone warning and offline-edit reconciliation (§13). Its cross-document fixes are tracked in `15` §16 and applied per `11` §7. |

---

## 20. What the owner must supply

1. **Export from Comma:** `routePath` and the stored totals for a handful of past shifts (§10.2 item 2). Raw points do not exist.
2. **Three measured loops** in Toronto: a map-measured length for each (§12).
3. **A parallel ride** with Comma's tracker and the new tracker on the same trip (Spike A day 0).
4. **Stop ground truth (1.5b):** after at least 3 normal delivery shifts, compare the detected stops on the web with the delivery platform's own order history and mark each stop real or false (E9 protocol). Everything else here is decided.
