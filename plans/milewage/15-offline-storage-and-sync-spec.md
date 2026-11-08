# 15 — Phone Offline Storage & Sync Specification

**Lead Agents:** Agent 1 (Mobile Systems) & Agent 2 (Backend Architect)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION (post-Gate 3, decision 1.5a) — decisions made, awaiting Human review  
**Build note (2026-11-08):** built; what was done and what differs is in [`progress.md`](./progress.md). Decision 1.5a is recorded in `06` section 2. No sign-off of this document itself is recorded in `06` section 6; it is an input to roadmap `17`, which the owner approved on 2026-11-04 (Gate 4).  
**Parent:** [`plans/milewage/README.md`](./README.md)  
**Inputs:** decision 1.5a in [`06`](./06-human-in-the-loop-review-gates.md); schema [`07`](./07-database-schema-spec.md); API [`08`](./08-api-spec.md); phone engine [`09`](./09-background-gps-decision.md); buffer [`02`](./02-mobile-architecture-plan.md); backup and restore [`10`](./10-backup-restore-and-ops-spec.md). Comma (read only): `docs/architecture/database.md`, `src/database/schema.ts`, `src/services/sync/mergeRules.ts`.  
**Companion:** [`14`](./14-phone-processing-spec.md) (shared processing module). This document says *where* the module runs and *what is stored and sent*; it does not repeat the algorithm. Where `14` defines an identity, a flag or a version rule, `14` wins. Reconciled on 2026-11-04 (`11` §7): the assumptions once marked "needs 14" are now `14` §6.4 (`trip_key`), §9 (exact integer comparison, `input_digest`) and §11 (`calc_version`).

This document is a specification, not code.

---

## 1. What Changed and What Did Not

Decision 1.5b (2026-11-04) removed per-delivery taps: the phone has only start/end shift, and stops are auto-detected by the same engine on the phone and the server. The phone has **no delivery or stop entry, no delivery table and no order sync path**; labelling is web-only. Decision 1.5a: the phone is a working local app. A driver may not reach the server for a week or more, and in that time the app must still show shifts, trips and totals (and, with stops on, the estimated active/deadhead split). The server remains the final source of truth.

| Topic | Before (`02`, `08` §4) | Now |
|---|---|---|
| Totals while offline | None. The server computes them at shift end | The phone runs the shared processing module (`14`) at shift end and shows the result immediately |
| Raw points after upload | Deleted once acknowledged | Kept for a retention window (default 14 days) after server confirmation, then evicted |
| Phone history | Only what the server has not acknowledged | All shifts, trips and odometer readings it has seen (plus the detected stops of each shift, read-only), plus simplified routes for 90 days |
| Data coming back from the server | Never (the phone has no read-back) | A change feed (`GET /sync/changes`) brings web edits, recomputed totals and deletions to the phone |
| Disagreement between phone and server totals | Not possible | Detected at shift end, flagged, shown to the driver as a diff (§7) |
| Who is authoritative | Server | **Unchanged: the server.** The phone's numbers are labelled "Calculated on phone" until the server confirms them |

Unchanged on purpose: single user (1.4), device credentials and scopes (`08` §2), idempotent identities `(device_id, seq)` and `client_id` (`07` §1), the frozen phone contract (`08` §8), module toggles (README §1.3), and **no Google or third-party push or backup service**.

---

## 2. Phone Storage Layout

Two SQLite files, because the native tracker must not share a write lock with the JS app (`09` §5.1 item 4).

| File | Owner | Holds |
|---|---|---|
| `tracker.db` | Kotlin native module | `telemetry_buffer`, `telemetry_quarantine` (`02` §3.1, with the two additions in §2.1), and the diagnostics tables `diag_native`, `diag_config`, `capture_fixes` (`16` §6.1) |
| `app.db` | JS app (`expo-sqlite`, Drizzle) | Everything else in §2.2, plus `diag_events` and `diag_state` (`16` §6.1) |

Both live in the app's private storage. Neither is exposed to other apps, and both are excluded from Android backup (§12).

### 2.1 `tracker.db` additions

`02` §3.1 defines `telemetry_buffer`. Two changes:

```sql
ALTER TABLE telemetry_buffer ADD COLUMN uploaded_at INTEGER;   -- epoch ms of the server acknowledgement; NULL while PENDING
CREATE INDEX idx_telemetry_evict ON telemetry_buffer(sync_status, uploaded_at);
```

The tracker interface (`09` §5.1 item 5) gains one method: `evictUploaded(olderThanMs)`, which deletes only rows with `sync_status = 'UPLOADED'` and `uploaded_at < olderThanMs`. **It can never delete a PENDING row.** `markUploaded(seqs)` now sets `uploaded_at` instead of deleting.

### 2.2 `app.db` tables, mapped to `07`

Local primary keys are the UUID `client_id` the phone generated (or, for server-originated rows, a deterministic key). `server_id` is filled when the server first acknowledges or returns the row. This is how local and server ids line up: **the server integer `id` is never needed offline, and `{ref}` in `08` §1 accepts the UUID.**

```sql
-- Mirror of the server's non-secret view of the instance.
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- keys: server_url, instance_id, restore_gen, device_id, api_version, changes_cursor,
--       last_sync_at, last_skew_ms, gnss_offset_ms, modules_json, paired_at

CREATE TABLE settings_cache (            -- one row; GET /settings (07 settings)
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  country       TEXT NOT NULL, distance_unit TEXT NOT NULL, currency TEXT NOT NULL,
  timezone      TEXT NOT NULL, stops_enabled INTEGER NOT NULL DEFAULT 1, modules_json TEXT NOT NULL, fetched_at INTEGER NOT NULL
);

CREATE TABLE vehicles (                  -- read-only cache of 07 vehicles (devices cannot create vehicles, 08 §2.2)
  server_id   INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  archived_at INTEGER
);

CREATE TABLE shifts (                    -- 07 shifts
  client_id       TEXT PRIMARY KEY,
  server_id       INTEGER UNIQUE,
  vehicle_id      INTEGER NOT NULL,                    -- server vehicle id
  status          TEXT NOT NULL CHECK (status IN ('active','ended','finalized')),
  segmenter       TEXT NOT NULL CHECK (segmenter IN ('stops','whole_shift')),   -- captured from settings_cache.stops_enabled at shift start; sent in shift.create and phone_result (14 §6.1)
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  local_date      TEXT NOT NULL,                       -- in settings.timezone, never the device zone
  total_m INTEGER, active_m INTEGER, deadhead_m INTEGER, personal_m INTEGER,
  calc_version    INTEGER,
  input_digest    TEXT,                                -- 14 §9.2; sent in phone_result
  flags_json      TEXT,                                -- 14 §8 flags from the local run (display only; the server's flags win)
  interruptions_json TEXT,                             -- 14 §7.3, written by the app's recovery path, sent with shift.end
  calc_source     TEXT NOT NULL DEFAULT 'phone' CHECK (calc_source IN ('phone','server')),
  server_total_m  INTEGER,                             -- set when the server's result is known
  recon_status    TEXT NOT NULL DEFAULT 'pending' CHECK (recon_status IN ('pending','match','differs','phone_missing')),
  recon_reasons   TEXT,                                -- JSON array of reason codes (§7)
  first_seq INTEGER, last_seq INTEGER, point_count INTEGER,   -- manifest of this shift's points in tracker.db
  route_geojson   TEXT,                                -- simplified route from the processing module; kept 90 days
  notes           TEXT,
  updated_at      INTEGER NOT NULL,
  sync_state      TEXT NOT NULL DEFAULT 'local' CHECK (sync_state IN ('local','syncing','on_server','needs_attention'))
);
CREATE INDEX idx_shifts_started ON shifts(started_at);
CREATE INDEX idx_shifts_sync ON shifts(sync_state);

CREATE TABLE stops (                     -- 07 stops, DERIVED by the engine; read-only on the phone (empty when stops_enabled is off)
  stop_key     TEXT PRIMARY KEY,                       -- <shift client_id>:<anchor fix ms>:stop (14 §6.2)
  shift_client_id TEXT NOT NULL REFERENCES shifts(client_id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, dwell_s INTEGER NOT NULL,
  lat_e7 INTEGER NOT NULL, lon_e7 INTEGER NOT NULL,
  confidence   TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  est_role     TEXT NOT NULL CHECK (est_role IN ('pickup','dropoff','none')),
  role         TEXT NOT NULL CHECK (role IN ('pickup','dropoff','other','none'))   -- the server's role once confirmed (a web label may differ from est_role)
);
CREATE INDEX idx_stops_shift ON stops(shift_client_id, started_at);

CREATE TABLE trips (                     -- 07 trips
  trip_key    TEXT PRIMARY KEY,                        -- auto trips: <shift client_id>:<segment start epoch ms>:<original_kind> (14 §6.4); a UUID for manual trips
  server_id   INTEGER UNIQUE,
  shift_client_id TEXT NOT NULL REFERENCES shifts(client_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('active','deadhead','personal')),
  original_kind TEXT NOT NULL CHECK (original_kind IN ('active','deadhead')),
  source      TEXT NOT NULL CHECK (source IN ('auto','manual')),
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  start_lat_e7 INTEGER, start_lon_e7 INTEGER, end_lat_e7 INTEGER, end_lon_e7 INTEGER,
  distance_m  INTEGER NOT NULL,
  purpose     TEXT NOT NULL,
  edited_at   INTEGER,                                 -- driver edit time; the LWW clock for the override (§8)
  sync_state  TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX idx_trips_shift ON trips(shift_client_id, started_at);

CREATE TABLE odometer_readings (         -- 07 odometer_readings, shift readings only (year readings are web-only, 08 §3)
  shift_client_id TEXT NOT NULL REFERENCES shifts(client_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('shift_start','shift_end')),
  reading_m   INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  sync_state  TEXT NOT NULL DEFAULT 'local',
  PRIMARY KEY (shift_client_id, kind)
);

CREATE TABLE outbox (                    -- 08 §4.1 outbox, extended
  id         INTEGER PRIMARY KEY AUTOINCREMENT,        -- FIFO order
  kind       TEXT NOT NULL CHECK (kind IN
             ('shift.create','shift.patch','odometer.put','trip.override','trip.manual','shift.end','diag.batch','capture.batch')),
  entity_key TEXT NOT NULL,                            -- client_id / trip_key / "shift:kind" the item is about
  body       TEXT NOT NULL,                            -- the exact API v1 request body (08 §8 frozen shape)
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','parked','done'))
);
CREATE INDEX idx_outbox_pending ON outbox(status, id);

CREATE TABLE conflict_log (              -- Comma's syncOverwriteLog idea: a number changed elsewhere is never lost silently
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  entity     TEXT NOT NULL,                            -- 'shift' | 'trip' | 'odometer'
  entity_key TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('superseded_by_server','deleted_on_server','recon_diff','points_missing','calc_version')),
  local_json TEXT NOT NULL,
  server_json TEXT,
  seen       INTEGER NOT NULL DEFAULT 0                -- 0 until the driver opens it
);
```

`diag.batch` and `capture.batch` (decision 1.5c, `16` §6.4) carry diagnostics events and dense capture fixes built from `diag_events`, `diag_native` and `capture_fixes` (`16` §6.1, which also holds the DDL of those tables; they are not part of the logbook mapping in §2.3). They are never coalesced and have the lowest priority (§6.2 step 7).

Stored request bodies in `outbox.body` are the API `v1` shapes, which `08` §8 freezes for the life of `v1`. So **an outbox item written by any app version can be sent by any later version with no payload migration** (§11).

### 2.3 Mapping summary

| Concept | Phone local key | Server key (`07`) | Link |
|---|---|---|---|
| Shift | `shifts.client_id` | `shifts.id`, `UNIQUE(user_id, client_id)` | `{ref}` accepts either (`08` §1) |
| Stop | `stops.stop_key` (derived, read-only) | `stops.stop_key`, `UNIQUE(shift_id, stop_key)` | deterministic (`14` §6.2); never uploaded as an entity |
| Telemetry point | `(seq)` in `tracker.db` | `UNIQUE(device_id, seq)` | `device_id` from the credential |
| Auto trip | `trips.trip_key` | `trips.trip_key` (new column, §16 X6) | deterministic (`14` §6.4) |
| Manual trip | `trips.trip_key` (UUID) | `trips.client_id` (new column) | `PUT /trips/{client_id}` |
| Trip edit | `trips.edited_at` + outbox `trip.override` | `trip_overrides` row (new table) | keyed by `(shift, trip_key)` |
| Odometer | `(shift_client_id, kind)` | `UNIQUE(shift_id, kind)` | `PUT /shifts/{ref}/odometer/{kind}` |
| Vehicle, settings | `vehicles.server_id`, `settings_cache` | `vehicles.id`, `settings` | pulled, read only |

---

## 3. Storage Sizing and Retention

### 3.1 What each item costs

Assumptions from `07` §5: 250 shifts per year, about **3,900 points per 6-hour shift** (975,000 ÷ 250). That figure assumed a 4-second cadence; at the adopted 10 s / 20 m cadence (`14` §4) a shift stores roughly 2,000-3,000 fixes (`14` §10.3), so every size below is an **upper bound**. On the phone a point costs about 60 bytes of data plus about 20 bytes of index in `tracker.db`.

| Item | Size | Source |
|---|---|---|
| Raw points per shift | ≈ **0.3 MB** (3,900 × ~80 B) | estimate; measured in Spike A/B |
| Simplified route per shift | ≤ 35 KB (upper bound) | `07` §5 sized the 5 m archive; the phone's display route uses the 10 m tolerance of `14` §5.5, so it is smaller |
| Shift + trips + stops + odometer per shift | ≈ 8 KB | `07` §5 (≈ 1.8 MB per year) |
| Gzipped upload per shift | ≈ 0.10–0.15 MB | estimate (≈ 30 B per point on the wire); measured in Spike B |

### 3.2 Retention rules

| Data | Kept | Evicted when |
|---|---|---|
| Raw points **not yet acknowledged** | **Forever** | Never. No age, size or storage rule may delete a `PENDING` point. |
| Raw points, acknowledged | **14 days** after `uploaded_at` (app constant `LOCAL_RAW_DAYS`; no settings screen) | Age, and only if the owning shift's `recon_status` is `match` or the driver has opened the diff (§7), and `restore_gen` is unchanged since the acknowledgement (§9.3) |
| Simplified route (`shifts.route_geojson`) | 90 days after the shift ends | Age. Older shifts show totals and trips; the route is on the web |
| `shifts`, `trips`, `stops`, `odometer_readings` | Forever | Never automatically (≈ 1.8 MB per year). Manual "Remove old history from this phone" is allowed for `on_server` shifts only |
| `telemetry_quarantine` | 30 days (`08` §4.3) | Age |
| `conflict_log` | Until the driver has seen it and 90 days have passed | Age + `seen = 1` |
| `outbox` rows with `status = 'done'` | Deleted immediately | — |
| `diag_events`, `diag_native` | By the caps and drop order in `16` §6.3 (basic 8,000 rows or 3 MB; verbose 20,000 rows or 8 MB; native 2,000 rows). Uploaded rows are deleted at once | The drop order. **Never evicts, delays or competes with a `PENDING` point** |
| `capture_fixes` | Until acknowledged, then deleted; the session's expiry stops recording (`16` §8) | Acknowledgement, expiry or the driver tapping Stop capture |

The 14-day point window matches the 14-day device read window (`08` §2.2) on purpose: a phone that is re-paired or reinstalled can only pull 14 days back, so keeping raw points for 14 days means everything the phone could re-send is also the most the phone is expected to hold.

### 3.3 Budget (replaces `02` §1's "15 MB per week")

| Case | Budget |
|---|---|
| Steady state, fully synced, 1 year of history | ≤ **12 MB** |
| Each unsynced shift | + ≤ **0.35 MB** |
| 4 weeks offline (≈ 24 shifts) | ≈ 8 MB extra, ≈ **20 MB** total |
| 12 weeks offline (≈ 72 shifts) | ≈ 25 MB extra, ≈ **37 MB** total |
| Diagnostics ring, level basic (`16` §6.3) | ≤ **3 MB** (verbose ≤ 8 MB); not included in the figures above |

There is no cap on unsynced data. The numbers are small enough that a cap would only add a way to lose tax records.

### 3.4 Low-storage behaviour

Free device storage is checked at app start, at shift start, and every 15 minutes during a shift.

| Free space | Behaviour |
|---|---|
| ≥ 200 MB | Normal |
| < 200 MB | Banner: "Phone storage is low. Free some space so MileWage can keep recording." Eviction of acknowledged points runs immediately (it may free space). Nothing else changes |
| < 50 MB | Persistent notification and a blocking-but-dismissable dialog at shift start. Tracking still starts |
| Write fails (`SQLITE_FULL`) | The native service **stops loudly**: it posts a high-priority notification "MileWage stopped recording: phone storage full" and keeps the last good point count. It never silently discards points |

Acknowledged points and routes are the only thing eviction ever frees. If that is not enough, the driver must free space themselves. Diagnostics follow `16` §6.3 here: verbose stops below 200 MB free, only crash, service and start events are kept below 50 MB, and nothing is recorded below 20 MB. Diagnostics never touch a `PENDING` point.

---

## 4. What the Driver Sees Offline

Everything below works with no connection.

| Screen | Offline behaviour |
|---|---|
| Active shift | **Start and end only** (no pause in v1, `14` §6.8); odometer entry. No order or stop buttons (1.5b). Live distance (the engine's live accumulator, `14` §3) and time from the local DB |
| Shift list and detail | All local shifts, newest first, with totals and trips. With stops on, the detail shows the estimated active/deadhead split marked "estimated" and the detected stops as read-only markers on the route; labelling happens only on the web |
| Trip editing | Reclassify (`active`/`deadhead`/`personal`) and edit purpose. Distance is not editable (`07` §3 rule 8). Manual trips can be added |
| Route | A polyline on a plain background with start/end markers and a scale bar. The basemap is OpenFreeMap (decision 1.11, `05` §3.2), so there is **no basemap offline in v1**: without internet the route is drawn on the plain background. An optional tile cache is not planned |
| Period totals (week, month) | Include unsynced shifts, with a caption "includes 3 shifts not yet on the server" |
| Settings, vehicles | The cached copy, read only. Changing them needs the web |

What needs the server: first pairing, exports, the full history (the phone holds what it has seen), recovery after a reinstall, and anything under Settings.

### 4.1 Sync status markers

Every shift and trip row shows a small marker. States come from `sync_state`:

| Marker | State | Meaning |
|---|---|---|
| Hollow dot, "On phone only" | `local` | Not yet sent. This is the data-loss exposure (§9) |
| Spinner | `syncing` | A request for it is in flight |
| Check, "On server" | `on_server` | Acknowledged **and** reconciled (§7) |
| Check with a small diff badge | `on_server` with `recon_status = 'differs'` | On the server, but the server's total differs from the phone's; tap for the diff |
| Warning triangle | `needs_attention` | Parked or quarantined items, a conflict, or a wrong-server/revoked state |

**A shift is `on_server` only when:** its create and end were acknowledged, every point in its manifest is `UPLOADED` or quarantined, its trips are acknowledged, and the end response carried a reconciliation result. Until then it is `local` or `syncing`.

### 4.2 Totals labelling

A shift's totals show one of two captions:
- **"Calculated on phone"**: `calc_source = 'phone'`. Shown from shift end until the server answers.
- **"Confirmed by server"**: `calc_source = 'server'`. If they differ, the number shown is the server's (§7).

### 4.3 The global sync banner

One banner on the home screen, driven by counts:

> **Not yet on server:** 5 shifts · 18,400 points · oldest 6 days ago  `[Sync now]`

With a progress bar once a sync is running (§6.4), and these colour states for the existing indicator (`02` §2.1): **green** nothing pending, **yellow** pending and the server unreachable or syncing, **red** needs attention (revoked, wrong server, parked items, storage full).

### 4.4 Unsynced reminders

A local notification when the oldest unsynced item is older than **3 days** ("5 shifts are only on this phone. Open MileWage when you reach your server."), repeated daily, with a stronger wording after **7 days**. It is a local notification only; there is no push service. The thresholds are app constants (3 and 7 days), not settings. The reminder is the `unsynced_reminders` toggle (§13).

---

## 5. Processing on the Phone

At shift end the app runs the shared processing module (`14`) over the shift's points from `tracker.db` and the shift's `segmenter`, and writes the shift totals, `trips`, `stops` (when stops are on), `route_geojson` and `calc_version` locally. There are no phone-entered orders to include, and no stop labels (those exist only on the server). Then it queues the `shift.end` request with the **manifest** and **phone result** (§6.1).

Rules owned by this document:
- A shift the driver never ended (dead battery, crash) is offered "End shift at the last fix time", not "now" (`14` §7.4), flagged `shift_auto_closed`.
- The module is imported from the shared package, not copied. The server runs the **same module** at shift end and on late points (`08` §5 step 6).
- The processing is a pure function of its inputs plus `calc_version`. Local results are stamped with the module's `calc_version`.
- Totals are **not recomputed automatically** when the app is upgraded to a newer `calc_version`. The stamp stays with the shift. A driver can recompute a shift that is still `local` from its detail screen while the raw points are still on the phone. **Once the server has confirmed a shift, the phone never re-runs the engine on it** (`14` §6.6): it shows the server's rows, because web labels can change the result and exist only on the server. The server recomputes on request only (`07` §6).
- If the processing step throws, the shift still ends and uploads. It is marked `recon_status = 'pending'` with no phone totals, and the server computes them. The phone shows "Totals will appear after sync".

---

## 6. Sync Protocol for a Backlog

Built on the contract in `08` §4–5. This section only adds what a multi-week backlog needs.

### 6.1 Shift end carries a manifest and the phone's result

`POST /shifts/{ref}/end` gains (additive, `v1`-compatible):

```json
{
  "ended_at": 1793720000000,
  "manifest": { "first_seq": 10482, "last_seq": 14391, "point_count": 3910 },
  "phone_result": { "calc_version": 3, "segmenter": "stops", "input_digest": "9f2c41d07ab3e855", "total_m": 41234, "active_m": 30110, "deadhead_m": 11124, "personal_m": 0, "trips_count": 14 },
  "interruptions": [ { "from_ms": 1793711000000, "to_ms": 1793711240000 } ]
}
```

The response gains `recon` (applied in `08` §4.4): `{ "status": "match" | "differs" | "phone_missing", "server_total_m": ..., "diff_m": ..., "reasons": ["points_missing", ...] }`. The server compares `manifest.point_count` with the points it stored for the shift's seq range, runs the shared module, and compares totals (§7). All three fields are optional so older phones keep working. `phone_result` is the one result object (`14` §9.3 uses the same name and fields).

### 6.2 Ordering

1. **Handshake:** `GET /settings`. Reads `modules`, `X-MileWage-Api`, `X-MileWage-Instance`, `X-MileWage-Restore-Gen`, and the clock skew (`08` §9). A mismatch in instance or restore generation stops here (§9).
2. **Shifts oldest first.** For each shift in `started_at` order: `shift.create` (and its odometer items) → **all of its telemetry batches in `seq` order** → `shift.end`.
3. **`shift.end` carries a barrier.** It is not sent until every point of its manifest is `UPLOADED` or quarantined. This avoids the server recomputing the shift after each late batch (`08` §5 step 6 debounce) and makes the manifest comparison meaningful.
4. **Everything else** in the outbox (`odometer.put`, `trip.override`, `trip.manual`, `shift.patch`) is sent FIFO relative to its own shift, with **coalescing**: a pending `odometer.put` is replaced by the newer one for the same `(shift, kind)` (the PUT is a full-state upsert, so this is safe), likewise `trip.override` per `trip_key`. `shift.end` and `shift.create` are never coalesced.
5. **Active shift has priority.** After each backlog request, if the live shift has pending points older than the current `upload_hint_s`, they go next. A driver on a shift keeps a live map on the web while the backlog drains.
6. **Pull last:** `GET /sync/changes` (§6.5).
7. **Diagnostics last:** `diag.batch`, then `capture.batch` (`16` §6.4). They are sent only when no telemetry older than `upload_hint_s` is pending, so a diagnostics backlog can never delay tax data.

One request in flight at a time (`08` §4.1). Order within a shift is by design, not by timing.

### 6.3 Batch size and rate

`08` §5 caps a batch at 200 points and `08` §7.4 allows 60 telemetry requests per minute. A 4-week backlog is about 94,000 points: at 200 per request that is about 470 requests, or **8 minutes** at the limit. That is acceptable, but a larger batch removes the problem:

- **API change (applied in `08` §5, §7.3):** raise the hard maximum to **500 points** per batch (≈ 80–100 KB decompressed, well under the 1 MiB limit). Normal live uploads stay at ≤ 100. Backlog mode uses **500**.
- With 500: 94,000 points ≈ 190 requests ≈ **3–4 minutes**. A 12-week backlog (≈ 280,000 points) ≈ 560 requests ≈ **10 minutes**.
- The limit of 60 per minute, burst 30, stays. The worker sleeps on `429` per `Retry-After`.

### 6.4 Progress, cancel, resume

- **Determinate progress.** The phone knows its pending point count and outbox size up front. The banner shows `points sent / points pending`, shifts completed, and an estimate from the recent rate.
- **Cancel** stops the worker. Nothing needs cleaning up: each batch is atomic on the server (`08` §5 step 5) and each outbox item is idempotent.
- **Resume** is automatic. State lives in the DBs, not in a "sync session": whatever is `PENDING` or in the outbox is the remaining work. The app can be killed mid-request; the next run resends it, and the server answers `duplicates` for anything already stored.
- **Trigger points:** app foreground, network regained, Wi-Fi connected, `[Sync now]`, and a timer while a shift is active (`08` §4.2 rule 5). A background `WorkManager` run is not planned for v1; the foreground service already keeps the process alive during a shift, and after a shift the next app open drains the rest.

### 6.5 Pull: `GET /sync/changes`

New route, module `sync` (§13). The phone needs a way to receive web edits, server recomputes and deletions.

```
GET /api/v1/sync/changes?after=<cursor>&limit=200
→ 200 { "changes": [ { "seq": 9041, "entity": "shift"|"trip"|"odometer"|"vehicle"|"settings"|"override",
                       "op": "upsert"|"delete", "key": "<client_id|trip_key|id>", "data": { ...entity... } } ],
        "next_cursor": 9044, "has_more": false }
→ 410 cursor_expired   (the phone's cursor predates the server's pruned log)
```

- **Cursor** is a monotonically increasing `change_log.seq` (§16 X8). The first pull after pairing uses `after=0` and receives the 14-day window (`08` §2.2).
- **Scope** is the device read window (`08` §2.2), refined in §16 X17: a shift is visible if it started in the last 14 days *or* this device wrote to it in the last 14 days. A phone that uploads a 3-week-old shift can read it back to reconcile.
- **Apply rules** are §7 and §8. Every applied change that overwrites a local value with unsynced edits writes `conflict_log` first.
- **`410 cursor_expired`** means the server pruned its log (kept 30 days). The phone does a full window pull and upserts by key; nothing is deleted locally except what the server explicitly lists as deleted in that pull.
- **Cadence:** after every successful drain, on app foreground, and at most every 5 minutes while the app is open and online. There is no push channel.
- **Without the `sync` module** the phone is upload-only: it still keeps and shows its own numbers, but shifts stay "Calculated on phone", and reconciliation happens only through the `shift.end` response.

### 6.6 Network and cost

- **Data use:** about 0.1–0.15 MB per shift on the wire (estimate, §3.1). A 4-week backlog is about 3 MB; 12 weeks about 9 MB.
- **Diagnostics** add about 6 KB gzipped per 6-hour shift at level basic (`16` §6.2, estimate), sent after everything else. A capture session adds about 0.65 MB per shift (`16` §8).
- **No Wi-Fi-only setting and no large-backlog prompt** (cut in the 14/15 audit): a 12-week backlog is about 9 MB, which does not justify a setting, a code path or a dialog. Revisit only if measured wire size per shift (Spike C8) is far above the estimate.
- **Transport:** requests go through whatever route the server URL gives (Tailscale or WireGuard, `10` §8). If the tunnel is down, the server is "unreachable" (§9.4), not an error.

---

## 7. Reconciliation: Phone vs Server

**The server's numbers win, always.** It has every uploaded point and the authoritative `calc_version`. The phone's numbers are shown only until the server answers, and never overwrite the server.

### 7.1 When it happens

1. **At `shift.end`** (response `recon`, §6.1).
2. **Later**, through `GET /sync/changes`, when the server recomputes (late points, a stop label or trip edit made on the web, `calc_version` change, a driver-requested recalculate).

### 7.2 Comparison

`match` if the server's integer `total_m` equals the phone's, **exactly**. `14` §9.1 removes the floating-point differences between Hermes and Node by rounding each segment to a decimetre, and `14` §10.1 proves it on the real device, so no tolerance is used: a margin would hide the one case (`engine_disagreement`, below) the check exists to catch. Otherwise `differs`.

### 7.3 Reason codes (server computes, phone displays)

| Code | Meaning |
|---|---|
| `points_missing` | The server stored fewer points than `manifest.point_count` (a quarantined point, or a gap in upload). Actionable: some points never arrived |
| `calc_version` | Phone and server used different module versions (`phone_result.calc_version` ≠ the server's) |
| `edited_on_web` | A stop label, trip override or manual trip was changed on the web after the phone's calculation (labels cannot exist before the server has the shift, so this reason applies to later recomputes, not to the first `shift.end` comparison) |
| `late_points` | Points arrived after the shift ended and changed the result |
| `engine_disagreement` | Same `input_digest`, same `calc_version`, different totals. An engine bug; also sets the shift flag `calc_mismatch` (`14` §9.4). Never expected |
| `unknown` | None of the above explains it. Logged server-side for investigation |

How the server picks: first compare `input_digest` (`14` §9.2). Equal digest and totals → `match`. Equal digest, different totals → `engine_disagreement`. Different digest → work out the cause in this order: `points_missing` (manifest count vs stored), `calc_version`, `edited_on_web`, `late_points`, else `unknown`.

### 7.4 What the driver sees

Shift detail shows, when `recon_status = 'differs'`:

> **Server confirmed 41.2 km. Your phone showed 41.8 km (0.6 km difference).** Reason: 14 points did not reach the server.  `[Details]`

`[Details]` lists both totals, the reason codes, and for `points_missing` the quarantined points count (from `telemetry_quarantine`). The shift's displayed total becomes the server's, `calc_source = 'server'`. A `conflict_log` row (`recon_diff`) keeps both versions. It stays until the driver opens it, then is purged on the normal schedule (§3.2). Nothing is overwritten silently.

On the web (server side, §16 X5): the shift shows a "Phone calculated a different total" badge until it is finalized or recalculated.

---

## 8. Offline Edits and Conflicts

Only two actors edit: the phone, and the web. There are no peer-to-peer or multi-writer replication problems beyond that. A second paired phone is the same kind of actor as the first (§10).

### 8.1 What a phone can edit offline

Shift `notes` and `vehicle_id`, shift odometer readings, trip `kind`/`purpose` (via overrides), manual trips. A phone **cannot** edit a finalized shift (`409 shift_finalized`, `08` §4.3), change settings or vehicles, delete any server row, or edit `distance_m` of an auto trip (`07` §3 rule 8).

### 8.2 Rule: row-level last-writer-wins on the edit time, with an audit trail

Copied in spirit from Comma's `decideMerge` (strict `>` wins) and `syncOverwriteLog`, adjusted for a server-authoritative design:

| Entity | Clock | Behaviour on upload |
|---|---|---|
| Shift (notes, vehicle) | `updated_at` (phone's GNSS-corrected edit time, §10) vs the server row's `updated_at` | Incoming strictly newer → applied. Otherwise → **not applied**: `200` with the current row and the header `X-MileWage-Applied: false` (`08` §4.4). **Ties: server wins** |
| Stop label | Web only; no phone writer, so no conflict path | n/a |
| Odometer reading | `recorded_at` | Same |
| Trip override | `edited_at` | Same, per `(shift, trip_key)` |
| Manual trip | `edited_at` | Same, per `client_id` |

When the server answers with `X-MileWage-Applied: false`, the phone adopts the server row, writes the phone's version to `conflict_log` with reason `superseded_by_server`, and marks the item `needs_attention` only if the driver has not seen it yet. When the phone's edit wins, the server records the overwritten value in its own overwrite log (§16 X9, one small table) so a web edit lost to a stale phone is also recoverable. Nothing is silently dropped on either side.

**Why last-writer-wins on the edit time, not on arrival time:** a phone offline for a week uploads its edits long after the web user's later correction. Comparing edit times (with the clock fixes in §10) means the stale edit loses, which is the correct outcome. Arrival-time LWW would let a week-old phone edit overwrite yesterday's web fix.

**Why row-level, not field-level:** entities are tiny, edits are rare, and a field-level merge needs a per-field history on both sides. The audit log makes the rare loss visible and recoverable. If real use shows frequent collisions, field-level merge can be added behind the same `applied` contract.

### 8.3 Trip edits survive recomputation

The server recomputes trips from points and stop labels (`07` §3). If a driver's edit were stored on the derived row, a recompute would erase it. So:
- Edits are stored as **overrides** keyed by `(shift, trip_key)` in a separate table (`trip_overrides`, §16 X7) and **applied on top of** every derivation.
- `trip_key` is deterministic (`14` §6.4): `<shift client_id>:<segment start epoch ms>:<original_kind>`. The same inputs give the same key on phone and server.
- If a recompute changes a segment start so an override's key no longer exists (a stop label moved the estimate's flip point, or the shift start was edited), the server keeps the override as **orphaned** and reports it, as the engine does (`14` §6.4, flag `override_orphaned`), in the change feed. There is **no fuzzy re-attachment**: guessing which segment an edit belonged to is exactly the silent change this design refuses. The phone shows "One of your edits could not be applied" with the old value. It is never silently dropped.

### 8.4 Deletes (tombstones)

- The phone **never deletes server data**. A driver can discard a shift locally only if it was **never uploaded** and has fewer than 20 points; the app confirms.
- The web can delete manual trips and (purge) shifts, and clear stop labels (which changes trips, not a deletion on the phone). These appear in the change feed as `op: "delete"` and the phone removes its copy.
- A delete that arrives for an entity with **unsynced local edits**: the server's delete wins; the local version goes to `conflict_log` with `deleted_on_server`; the item is not re-uploaded.
- `change_log` rows are the tombstones (§16 X8). They are kept 30 days.

---

## 9. When Things Go Wrong

### 9.1 Phone lost, stolen, wiped or reinstalled before sync

**Whatever is `local` is gone.** The server cannot recover it. The spec does not pretend otherwise.

What the app does about it:
- The `Not yet on server` banner and the per-row markers (§4) make the exposure visible all the time.
- The unsynced reminders (§4.4), 3 days then daily, 7 days stronger.
- **Unpair or sign-out is blocked while data is unsynced.** The driver must type "I understand" and the dialog lists what will be lost.
- After a reinstall and re-pair, the phone pulls the last 14 days (`08` §2.2); older history is on the web.
- A stolen phone is revoked from the web (`08` §2.4). The thief's access is the 14-day window and the credential in Keystore-backed storage; the unsynced data on the phone is as exposed as the phone itself (§12).

**Optional module `local_export` (default off, v1.1):** "Save unsynced data to a file" writes a gzip NDJSON bundle of the unsynced shifts, trips and points, in the same shapes as the upload API. The driver stores it wherever they like (a laptop, a USB stick, a cloud drive they trust). The web has a restore route (`POST /sync/bundle`, §14) that feeds the bundle through the **same idempotent ingest paths** (`client_id`, `(device_id, seq)`), so no new merge logic exists. The bundle is encrypted with `age` passphrase mode (the driver picks a passphrase; `10` §4's package). Not v1: it adds a UI, a route and an encryption flow, while the reminders and the blocked sign-out cover most of the risk cheaply.

### 9.2 Multiple devices

- Several phones can be paired (`08` §2.4); each has its own `device_id` and `seq` namespace.
- **One active shift per user** (`07` `idx_shifts_one_active`). A second phone starting a shift gets `409 shift_already_active`; it adopts the existing shift (`08` §4.3). Only one phone should track a shift at a time.
- Two phones can edit the same shift or trip; §8.2 resolves it.
- **Overlap.** If a late upload makes two shifts' time windows overlap, the server keeps both (never drops data) and sets `shifts.overlaps_shift_id` on the later-created one. Overlapping shifts double-count distance, so the web shows a "Possible overlap" badge and the CSV/PDF exports print a warning until the driver resolves it (deletes one or edits the end time). The phone shows the same badge from the change feed.

### 9.3 Server restored from an older backup

A restore (`10` §7) can leave the server **behind** what the phone has already evicted as "confirmed". Two protections:
- The server keeps `instance.restore_generation`, incremented on every restore. It is returned in `X-MileWage-Restore-Gen` on every response, with `X-MileWage-Instance` (a random id created at setup, preserved by backups).
- When the phone sees a **higher restore generation** than it stored, it sets every `on_server` row it still holds back to `local`, resets `uploaded_at = NULL` and `sync_status = 'PENDING'` for the points still in `tracker.db` (≤ 14 days), and resends. Everything is idempotent (`duplicates` come back for what the restore kept). Shifts, trips, stops and odometer readings are kept on the phone forever (§3.2), so they can all be re-sent. **Points older than the retention window, and routes older than 90 days, cannot be.** This limit is stated to the driver: "The server was restored from a backup. MileWage is re-sending the last 14 days from your phone."
- Eviction never runs while `restore_generation` on the server differs from the one stored with the acknowledgement (§3.2).

### 9.4 Connection and identity states

The phone distinguishes four states and acts differently. The user-visible wording follows.

| State | How detected | Phone action | Message |
|---|---|---|---|
| **Unreachable** | DNS/connect/TLS failure, timeout, `5xx`, `503`, `507` | Keep everything; retry with backoff (`08` §4.2 rule 7) | Yellow: "Offline. Saved on your phone." |
| **Wrong server** | Response has a different `X-MileWage-Instance` than stored at pairing | **Stop all uploads and pulls.** Keep everything | Red: "This address now points to a different MileWage server than the one this phone was paired with. Nothing was sent." Actions: [Check the address] [Re-pair to the new server] |
| **Revoked** | `401 device_revoked` | Stop uploads; keep buffer and outbox (`08` §4.3) | Red: "This phone was removed from your server. Re-pair to send your saved data." After re-pairing to the **same** instance, upload resumes under the new credential |
| **Bad credential** | other `401` | Stop; keep data | Red: "Sign-in problem. Re-pair this phone." |

"Re-pair to a different instance" asks for explicit confirmation: the unsynced data would be uploaded to that new server. The default action is to keep the data and not send it.

A response without `X-MileWage-Api`/`X-MileWage-Instance` (not a MileWage server, a captive portal, a proxy error page) is treated as **unreachable**, not as wrong server.

---

## 10. Clocks

The phone can be offline for weeks, so `08` §9's skew warning (which needs a server response) cannot help while offline. Two additions:

1. **GNSS-corrected event times.** The native service records `gnss_offset_ms = fix_time − System.currentTimeMillis()` on every fix and exposes the latest value. Shift start/end, odometer `recorded_at` and every `updated_at`/`edited_at` are stamped `now + gnss_offset_ms` whenever the latest fix is under 10 minutes old (always true during a shift). Otherwise the raw clock is used and the row is marked in the device log. This removes the largest weakness in `08` §9 (shift and edit times using an untrustworthy phone clock) and makes the LWW comparisons in §8.2 meaningful across devices.
2. **Skew flag.** The same offset drives the engine's `clock_skew` flag when its median passes 2 minutes (`14` §15), so a corrected stamp is still visible as one.
3. **Skew on sync.** The existing `X-Client-Time`/`X-Server-Time` check still runs. If `|skew| > 2 min` at sync time, the phone warns, and the server uses `edited_at − skew` for LWW comparisons on edits from that request.

Timezone: `local_date` and period boundaries always use `settings.timezone` from the server, **never the device timezone**, so travelling or a wrong device zone cannot move a shift to another day.

---

## 11. App Upgrades With Unsynced Data

| Topic | Rule |
|---|---|
| `app.db` migrations | Drizzle SQL, forward only, applied at app start inside a transaction. If unsynced rows exist, the app first copies `app.db` and `tracker.db` to `pre-migration/` (keeps the last 2) |
| `tracker.db` migrations | Owned by the Kotlin module via `PRAGMA user_version`. **Additive only**: columns may be added, `seq`, `recorded_at` and the coordinate columns are never changed or dropped, so an old buffer is always uploadable (the frozen contract, `08` §8) |
| Outbox payloads | Stored as final `v1` request bodies, which are frozen for the life of `v1`, so no payload migration is ever needed |
| Phone totals | Not recomputed on upgrade (§5). The stamped `calc_version` stays |
| Downgrade | If `user_version` is higher than the app knows, the app refuses to open the data and says so, instead of guessing. Same rule as the server (`07` §6) |
| Failed migration | Roll back, restore from `pre-migration/`, keep running the previous behaviour read-only, show an error. The unsynced data is never discarded |
| `v1` → `v2` API (not planned) | The phone must drain its backlog against `v1` before switching. The server serves `v1` for ≥ 12 months (`08` §8) |

Test obligation: upgrade from every released app version with an unsynced backlog and verify every unsynced item uploads after the upgrade.

---

## 12. Privacy of Data at Rest on the Phone

| Area | Decision |
|---|---|
| Location of data | App-private storage; not readable by other apps without root |
| Android backup | `allowBackup="false"` and `dataExtractionRules` exclude both DBs, so location history is never copied to a cloud backup or a device transfer without the driver's knowledge. Trade-off: moving to a new phone means re-pairing and pulling 14 days; unsynced data does not follow |
| Encryption at rest | **No SQLCipher in v1.** Android file-based encryption already protects app storage when the device is locked, and SQLCipher would have to be integrated into the Kotlin module as well as the JS app, adding a native dependency, a key to protect, and CPU on the hot path. Revisit if a rooted-device or lost-unlocked-phone threat model becomes a stated requirement |
| Credentials | Device token in Keystore-backed storage (`08` §2.4), never in the DBs |
| App lock | **Not in v1** (cut in the 14/15 audit): no Gate 1 driver problem asks for it. If wanted later it is a gate component around the root navigator, reusing Comma's `expo-local-authentication` approach; it protects the UI, not the files |
| Logs and diagnostics | Never write coordinates, tokens or labels to logs (matches `08` §10). Diagnostics events (`16`) are an allowlist of typed fields: counts, versions, state names and error codes only, never a coordinate, address, payout, label or free text. Capture sessions (`16` §8) are the one deliberate exception: owner-started, time-boxed, flagged and visible on the phone |
| Notifications | Text never contains addresses or coordinates |
| Quarantine and conflict log | Hold coordinates and are subject to the same storage rules; deleted on the schedules in §3.2 |

---

## 13. Modularity (README §1.3)

| Module | Interface | Depends on | Toggle (default) | When off | Removal path |
|---|---|---|---|---|---|
| **sync** (server `GET /sync/changes` and the phone's pull) | `GET /sync/changes`; the `X-MileWage-Applied` header and the `recon` response field | core, devices | `modules.sync` (**on**) | Phone is upload-only. Its own numbers stay labelled "Calculated on phone"; no web-edit push, no diffs after shift end; the change-log table is not written | Drop the registration. `change_log` stays empty |
| **unsynced_reminders** (phone) | Local notification scheduler | none | `unsynced_reminders` (**on**), thresholds 3 and 7 days are constants | No reminders; banner and markers remain | Delete the scheduler |
| **local_export** (phone + server `POST /sync/bundle`) | Bundle = the upload API shapes, gzipped NDJSON, `age` passphrase | devices, tracking | `modules.local_export` (**off**; v1.1) | No export button, no restore route | Delete the screen and the route |
| **offline processing** (the shared module `14`) | Pure function in the shared package | none | Always on (not a toggle: the phone cannot show totals without it) | — | — |
| **diagnostics** (phone side) | `DiagSink` (Kotlin), `DiagnosticsPort` (JS); outbox kinds `diag.batch`, `capture.batch` | none | `modules.diagnostics` (**on**), level set on the server (`16` §5) | The phone records and sends nothing and clears its rings | Delete the sink implementations; the no-op stays |

Seams kept: the tracker interface (`09` §5.1) gained `evictUploaded`, which an iOS module can implement identically. The change feed's `entity` list is data, so a new synced entity (for example a future optional module's table) adds a case, not an interface.

Seams refused as slop: a generic sync engine with per-table adapters; vector clocks or CRDTs; a `SyncStrategy` interface (one strategy ships); a pluggable conflict-resolver registry; push notifications; background sync workers for v1.

---

## 14. Decisions

| # | Decision | Chosen | Why | Rejected |
|---|---|---|---|---|
| D1 | Phone storage | Two files: native `tracker.db` and JS `app.db` | No shared write lock with the hot path (`09`) | One shared DB (Comma's way) |
| D2 | Local ids | `client_id` UUID as local key plus nullable `server_id` | Works fully offline; `{ref}` already accepts both | Server ids required before use |
| D3 | Raw points after upload | Kept 14 days (`LOCAL_RAW_DAYS` constant), then evicted | Offline replay, recalculation, restore re-send; matches the device read window | Delete on ack (`02`); keep forever |
| D4 | History on the phone | Shifts/trips/stops/odometer forever (≈ 1.8 MB/yr); routes 90 days | Tiny, and lets the phone repopulate a restored server | Cap by age; only 14 days |
| D5 | Unsynced data | Never evicted, no size cap | A cap would be a way to lose tax records; the volumes are small (§3.3) | A configurable cap |
| D6 | Totals offline | Phone runs the shared module at shift end | The point of 1.5a; same code on server | Show nothing until synced |
| D7 | Authority | Server numbers always win; mismatches are flagged, not overwritten silently | Tax-record integrity; Comma's "never lose a changed number" lesson | Phone wins; manual merge |
| D8 | Reconciliation carrier | Manifest and phone result on `shift.end`; later through the change feed | One extra round trip is not needed | A separate "verify" endpoint |
| D9 | Pull mechanism | `GET /sync/changes` with a `change_log` cursor | Needed for web edits, recomputes and deletes; no push service needed | Poll `GET /shifts` and diff; push (FCM) |
| D10 | Backlog order | Oldest shift first; create → points → end; `end` barrier on its points | No recompute storm; meaningful manifest check | Send in strict time order of mutations |
| D11 | Batch size | Hard maximum 500; live uploads ≤ 100 | 12 weeks drains in ≈ 10 min instead of ≈ 24 min | 200 (`08` today) |
| D12 | Conflict rule | Row-level last-writer-wins on edit time, server wins ties, audit log both ways | Simple; stale offline edits correctly lose; nothing silent | Arrival-time LWW; field-level merge; CRDTs |
| D13 | Trip edits | Stored as overrides separate from derived trips, keyed by `trip_key` | Recompute can no longer erase an edit | Edit the derived row |
| D14 | Deletes | Phone never deletes server rows; web deletes arrive as tombstones; server delete wins | Matches `08` scopes; avoids resurrecting data | Phone can delete |
| D15 | Wrong server | `X-MileWage-Instance` header; mismatch stops all sync | A reused IP/domain must not receive a driver's location history | Trust the URL |
| D16 | Restored server | `restore_generation`; phone re-sends retained data | Closes the "phone evicted what the server lost" hole | Ignore |
| D17 | Event clock | GNSS-corrected times for all phone-stamped events | Fixes offline clock drift that `08` §9 could not detect | Raw phone clock + warning on sync |
| D18 | Totals on upgrade | Not recomputed automatically | A silent change to tax mileage is worse than a stale number (`07` §6) | Recompute everything |
| D19 | Lost phone | Make exposure visible; block unpair while unsynced; reminders; optional export v1.1 | Cheap, honest; no backup service to depend on | Android cloud backup; remote wipe |
| D20 | Encryption at rest | Android FBE; no SQLCipher in v1 | Avoids a native dependency and hot-path cost | SQLCipher |
| D21 | Overlapping shifts | Keep both, flag, warn on exports | Never drop data, never silently double count | Reject the second; auto-merge |
| D22 | Offline map | Plain polyline, no basemap | The basemap is a server file (`05`); tile cache adds scope | Tile cache in v1 |
| D23 | Background sync | None in v1 (foreground service during shifts; drain on next open) | Avoids WorkManager complexity and battery questions | WorkManager periodic sync |
| D24 | Diagnostics on the phone | Rings in the two existing databases, sent through the outbox at the lowest priority, no extra wakeups or requests | Tax data and battery come first; works for weeks offline (`16` D5 to D8) | A separate diagnostics database or upload worker on the phone |

---

## 15. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Findings and mitigations
> 1. **Does each addition serve a driver problem?** Yes. Offline totals and history (1.5a), the diff view (trust in tax numbers), the unsynced banner and reminders (data-loss risk), the wrong-server check (location privacy), restore generation (a real failure of the 14-day eviction rule). No analytics, no sync dashboard, no conflict UI beyond the diff and a list.
> 2. **Largest new surface:** the change feed and four new server columns/tables (listed as X5–X10 in §16). Justified because without a read-back path the phone can never learn the server's recomputed totals or web edits. It is a module (`sync`), so the system degrades to upload-only if it is switched off.
> 3. **Complexity to watch:** the override model for trip edits (D13) and `trip_key` stability. `14` §6.4 now defines the key and the orphan rule, so the dependency is met on paper; whether orphans are really rare is checked in Spike A.
> 4. **Clock handling:** GNSS-corrected stamps (D17) assume a recent fix. A shift started indoors with no fix yet falls back to the raw clock for that one event. Acceptable, and recorded.
> 5. **Estimates, not measurements:** 0.3 MB per shift on the phone, 0.1–0.15 MB per shift on the wire, drain times, and the 12 MB steady-state budget. Spike B/C must measure them (`12`).
> 6. **Unverified here:** Android storage-pressure behaviour of `expo-sqlite` under `SQLITE_FULL`; whether Hermes and V8 produce identical haversine results after integer rounding (no tolerance is used, so `14` §10.1 must pass byte-identical on the S24 Ultra); behaviour of `allowBackup="false"` with data-extraction rules on the owner's One UI 6.1+ device.
> 7. **Over-engineering check:** field-level merge, CRDTs, push, background sync, tile cache and SQLCipher were all considered and refused with reasons in §13 and §14. `local_export` is specified but deferred.
> 8. **Under-engineering check:** the restore-generation rule and the wrong-server check look rare but protect against silent data loss and silent disclosure; both cost one header each.
> 9. **Test obligations created (specification only):**
>    - Simulate 4 and 12 weeks offline (24 and 72 shifts), then drain; verify counts, `duplicates`, manifest match and timing.
>    - Kill the app mid-batch and mid-`shift.end`; verify resume with no loss or duplication.
>    - Revoke the device mid-backlog; verify data kept and resumed after re-pair.
>    - Restore the server from an older backup; verify the phone re-sends its retained data and eviction is blocked.
>    - Point the URL at a different instance; verify nothing is sent.
>    - Edit the same shift's notes on the web and the phone with edit times on both sides of the web edit; verify LWW, the audit rows and the tie rule.
>    - Purge a shift on the web while the phone has an unsynced edit to it; verify `deleted_on_server`.
   - Label stops on the web after sync; verify the phone shows the server's recomputed trips, does not re-run its engine, and reports an orphaned trip override instead of dropping it.
>    - Recompute with a changed segment boundary; verify an orphaned override is reported, not dropped.
>    - Phone clock 10 minutes wrong while offline for a week; verify the GNSS-corrected times.
>    - Upgrade the app with a backlog; verify every item uploads.
>    - `SQLITE_FULL`: verify the loud stop and no silent loss.
>    - `sync` and `local_export` modules off: verify the phone still uploads and the server returns `404` for their routes.

---

## 16. Cross-Document Fixes

These are the changes the owning documents needed. They were applied on 2026-11-04 in the 14/15 reconciliation; see `11` §7 for the list of what changed.

| # | File | Needs | Because |
|---|---|---|---|
| X1 | `02` §1 | Replace "15 MB per week" and "buffers only what it must" with the budgets in §3.3 and the 1.5a wording | The phone is a working local app |
| X2 | `02` §3.1 | Add `uploaded_at` and the eviction index to `telemetry_buffer` (§2.1) | Acknowledged points are kept 14 days |
| X3 | `02` §3.2 | Remove "Points are deleted from the phone only after the server confirms them / keeps no summaries"; replace with eviction rules from §3.2 | Contradicts 1.5a |
| X4 | `02` §2.1 | Sync indicator: add the red state and the "Not yet on server" counts (§4.3) | New states |
| X5 | `07` §2.3 `shifts` | Add `updated_at`, `recon_status`, `recon_reasons`, `phone_total_m`, `phone_calc_version`, `input_digest`, `calc_mismatch`, `interruptions_json`, `device_touched_at`, `overlaps_shift_id` (merged with `14` §19) | §7, §8, §9.2, device read window |
| X6 | `07` §2.3 `trips` | Add `trip_key TEXT` (unique per user) and `client_id TEXT` (manual trips, unique per user) | §8.3 |
| X7 | `07` new table | `trip_overrides(user_id, shift_id, trip_key, kind, purpose, edited_at, device_id, PRIMARY KEY(shift_id, trip_key))`, module `tracking` | §8.3 |
| X8 | `07` new table | `change_log(seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id, entity TEXT, key TEXT, op TEXT, at INTEGER)`, pruned at 30 days, module `sync` | §6.5 |
| X9 | `07` new table | `overwrite_log(id, at, entity, key, superseded_json, by_device_id)`, small, module `sync` | §8.2 |
| X10 | `07` new table | `instance(id = 1, instance_id TEXT, restore_generation INTEGER)`, created at setup | §9.3, §9.4 |
| X11 | `07` §1.1 | Add the `sync` module and its tables to the ownership table | README §1.3 |
| X12 | `08` §4.2 rule 6 and §4.1 | Points are not deleted on acknowledgement; they are marked `UPLOADED`; add the `shift.end` barrier and the coalescing rules (§6.2) | 1.5a |
| X13 | `08` §3, §13 | New routes `GET /sync/changes`, `PUT /trips/{client_id}`, `PUT /shifts/{ref}/trip-overrides/{trip_key}`, `POST /sync/bundle` (v1.1) with their OpenAPI schemas and module assignment | §6.5, §8, §9.1 |
| X14 | `08` `POST /shifts/{ref}/end` | Add `manifest` and `phone_result` request fields and the `recon` response field (§6.1) | §7 |
| X15 | `08` §5, §7.3 | Raise telemetry maximum to 500 points per batch; keep the phone's live batch at ≤ 100 | §6.3 |
| X16 | `08` `PATCH /shifts`, odometer, trips | Accept the client `updated_at`/`edited_at`; answer with the current row and the `X-MileWage-Applied` header (a header, not a body field, so no response shape changes) | §8.2 |
| X17 | `08` §2.2 | Device read window: "shift started in the last 14 days **or** this device wrote to it in the last 14 days" | §6.5 |
| X18 | `08` §1 or §8 | Every response carries `X-MileWage-Instance` and `X-MileWage-Restore-Gen` | §9.3, §9.4 |
| X19 | `08` §9 | Note that the phone stamps events with GNSS-corrected time (§10) | Removes the stated weakness |
| X20 | `08` §16.2, §16.3 | Add the `sync` and `local_export` modules and the `modules` flags in `GET /settings` | README §1.3 |
| X21 | `09` §5.1 item 5 | Add `evictUploaded(olderThanMs)`; `markUploaded` no longer deletes; the native service exposes `gnss_offset_ms` | §2.1, §10 |
| X22 | `09` §5.4 | JS upload worker: add backlog mode (500-point batches, shift-ordered, barrier), progress and cancel | §6 |
| X23 | `10` §7 (restore) | Restore increments `instance.restore_generation` and preserves `instance_id`; the post-restore verification mentions the phone re-send | §9.3 |
| X24 | `10` §6 (backups) | The backup now includes the `change_log`, `overwrite_log`, `trip_overrides` and `instance` tables (no change in method) | New tables |
| X25 | `12` (Gate 3 plan) | Add a synthetic 4-week and 12-week backlog drain to Spike B/C, and measure per-shift storage and wire size | §3.1, §6.3 |
| X26 | `06` | Record `15` against decision 1.5a; add the open Human questions below to Gate 3/4 | Governance |
| X27 | `14` | Provided: deterministic `trip_key` (§6.4), integer-decimetre segments (§9.1), a stable `calc_version` (§11), and a pure function usable on phone and server (§3). Met on 2026-11-04 | §5, §7.2, §8.3 |
| X28 | `16` | Provided: outbox kinds `diag.batch` and `capture.batch`, the phone rings and their caps, and the lowest-priority rule (applied here, 1.5c) | `16` §6 |

### Questions for the Human (the few that are genuinely theirs)

1. **Unsynced reminder wording and timing** (3 days, then daily) is a default. Change it?
2. **Lost phone:** is "make the exposure visible and remind" enough for v1, with `local_export` in v1.1, or is the export needed first?
3. **Offline basemap:** accept a plain route line with no map offline in v1?
