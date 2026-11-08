# 16 — Diagnostics Specification (testing, debugging, improving; owner's own server only)

**Lead Agents:** Agent 2 (Backend Architect) & Agent 1 (Mobile Systems)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION — decision 1.5c (2026-11-04, `06`). Plan document: no code is written by this document.  
**Build note (2026-11-08):** built; what was done and what differs is in [`progress.md`](./progress.md). Decision 1.5c is recorded in `06` section 2. No sign-off of this document itself is recorded in `06` section 6; it is an input to roadmap `17`, which the owner approved on 2026-11-04 (Gate 4).  
**Parent:** [`plans/milewage/README.md`](./README.md)  
**Inputs:** the Modularity Rule (README §1.3), schema [`07`](./07-database-schema-spec.md), API [`08`](./08-api-spec.md), tracker [`09`](./09-background-gps-decision.md), operations [`10`](./10-backup-restore-and-ops-spec.md), spikes [`12`](./12-gate3-spike-plan.md), engine [`14`](./14-phone-processing-spec.md), phone storage and sync [`15`](./15-offline-storage-and-sync-spec.md).

**Terminology.** In these plans "telemetry" (`/telemetry/batch`, `telemetry_points`) means the GPS breadcrumbs, which are the product's data. This document is about **diagnostics**: facts about how the app, the engine and the server behaved, used to test, debug and improve MileWage. The two are never mixed: diagnostics never contain a coordinate, and a breadcrumb is never a diagnostic event.

---

## 1. What this decides

1. Diagnostics are **built into the phone app, the server and the web app from the first build**, not added later. Every number a Gate 3 spike measures by hand (`12`) becomes an event the product itself records, so testing, regression checks and later improvement use the same measurements.
2. Everything goes **only to the driver's own server**. No third-party SDK, crash service, analytics service, push service, or outside endpoint is used, and nothing is sent anywhere except the paired server (README §1.2 principle 3, `01` §3.2).
3. A **hard privacy line**: diagnostics never contain coordinates, addresses, payouts, labels, or free text (§4). This is enforced by a field allowlist, not by good intentions, and is tested with canary values.
4. Diagnostics are a **toggleable module** (`diagnostics`, default on, level `basic`). A second module, **`capture`** (default off), records dense raw fixes plus annotations for tuning the algorithms and replaying them in a test harness (§8). Capture data is a different class from diagnostics and is kept apart.
5. The diagnostics store is a **separate SQLite file** (`diagnostics.db`), so it can never contend with the tax records, never bloat their backups, and can be deleted in one step (§7.1).
6. **Diagnostics never block the product.** They never take a lock the logbook needs, never cause an extra phone wakeup, never delay tax data on the wire, and never stop the server from starting.

---

## 2. Questions every event must answer

An event exists only if it answers a named question. Events that answer none are not collected (§15).

| Q | Question | Used by |
|:--:|---|---|
| Q1 | What build, device and OS produced this behaviour? | every bug report; A-spike results |
| Q2 | Did the OS or a permission stop tracking, and why did the process die? | A4, A6, A7 |
| Q3 | Was the tracking service alive the whole shift, and why did it restart? | A4, A6 |
| Q4 | Were fixes arriving, how good were they, and where were the gaps? | A2, A5, E6, E7 |
| Q5 | How much battery did tracking cost, and is it getting worse? | A1 |
| Q6 | Did uploads reach the server, how fast, and what went wrong? | A8, C1 to C9 |
| Q7 | Did phone and server agree, and if not, why? | A10, A11 |
| Q8 | Are the engine and the stop estimate behaving? | A12, A13, A14, E9 to E12 |
| Q9 | Is the server inside its budgets (RAM, event-loop lag, disk, errors)? | B1 to B5, B10 |
| Q10 | Did backup, migration and restore work? | B8, B9 |
| Q11 | What crashed? | all |
| Q12 | Is this record complete, or did the app have to drop events? | trust in all of the above |

---

## 3. What is collected

### 3.1 Event envelope

Defined once in the shared package (`packages/shared/diagnostics`): a registry mapping each `kind` to a typed schema. The phone, the server and the web client all import it.

```
{ kind, at, level: 'basic'|'verbose', src: 'phone_native'|'phone_js'|'server'|'web',
  seq?, shift?: <shift client_id>, cap?: <capture id>, v: <app version>, data: { ...typed fields... } }
```

`at` is epoch ms (phone events use the GNSS-corrected clock, `15` §10). `seq` is assigned by the producer store and is strictly increasing per `(device, src)`; it is what makes a retried upload idempotent (§6.4). Every `data` field is typed: an integer with bounds, a boolean, an enum, a fixed-length array of integers, or a **pattern-restricted string** (§4.2). There are no open-ended objects.

### 3.2 Event catalogue (v1)

"B" is `basic` (recorded at level basic and verbose), "V" is `verbose` only. Time windows are 10 minutes on the phone and 15 minutes on the server. No event is emitted per fix and none per request.

**Phone, native service (Kotlin)** (`src = phone_native`)

| Kind | Level | Fields | Answers |
|---|:--:|---|:--:|
| `service.event` | B | `event` (created, started, restarted, destroyed, task_removed, fgs_start_refused, permission_lost, recovered, still_gate_on, still_gate_off), `reason` (enum: user_stop, shift_end, task_removed, os_kill_inferred, start_not_allowed, permission, crash, unknown), `profile` (normal, capture) | Q2 Q3 |
| `track.window` | B | per 10-minute window: `fixes`, `acc_hist[4]` (≤10 m, ≤25 m, ≤50 m, >50 m), `interval_p50_ms`, `interval_max_ms`, `still_gated_s`, `battery_pct`, `charging`, `temp_dc`, `thermal` (0 to 6) | Q4 Q5 |
| `activity.transition` | V | `type` (STILL, IN_VEHICLE, ON_BICYCLE, WALKING, RUNNING, UNKNOWN), `edge` (enter, exit), `gating_acted` (bool) | Q4 (E7) |

Counters live in memory and are updated inside the existing location callback; a window is closed (one insert) by the first callback that arrives after its boundary. **No timer is used.**

**Phone, JS app** (`src = phone_js`)

| Kind | Level | Fields | Answers |
|---|:--:|---|:--:|
| `app.start` | B | `app_v`, `native_v`, `engine_v`, `api_v`, device `{make, model, android, sdk, oneui}`, `prev_exit` `{reason, importance, age_s}` from the OS's historical exit reasons (§3.4) | Q1 Q2 |
| `perm.state` | B | `fine`, `background` (all_time, while_in_use, denied), `activity_recognition`, `notifications`, `battery_opt_ignored`, `standby_bucket`, `power_save`; emitted at start and on any change | Q2 |
| `upload.window` | B | per 10 minutes: `attempts`, `ok`, `fail_net`, `fail_4xx`, `fail_5xx`, `fail_429`, `fail_507`, `bytes_gz`, `dur_p95_ms`, `pending_points`, `oldest_pending_s` | Q6 |
| `upload.drain` | B | end of a backlog drain: `shifts`, `points`, `batches`, `bytes_gz`, `wall_ms`, `ok` | Q6 (C8) |
| `upload.failure` | V | one failed request: `class` (enum), `status`, `bytes`, `dur_ms`, `attempt` | Q6 |
| `sync.state` | B | transition to `reachable`, `unreachable`, `unauthorized`, `revoked`, `wrong_instance`, `restored`, `api_too_old`; `since_s` | Q6 (C7, C9) |
| `sync.pull` | B | `applied`, `conflicts_logged`, `full_window` | Q7 |
| `settings.applied` | B | `level`, `stops_enabled`, module flags (bools), `engine_version` | Q8 (A9, A14) |
| `shift.summary` | B | at shift end: `duration_s`, `battery_start`, `battery_end`, `charging_seen`, `fixes`, `gap_count`, `service_restarts`, `engine_ms`, `capture` (bool) | Q4 Q5 |
| `storage.state` | B | on transition and daily: `free_mb_bucket`, `state` (normal, low, critical), `tracker_db_mb`, `app_db_mb`, `unsynced_shifts`, `pending_points`, `quarantine_rows` | Q12 (15 §3.3) |
| `crash` | B | `runtime` (js, native, server, web), `class`, `frames[≤15]`, `fatal`, `sig`, `msg?` (§4.3) | Q11 |
| `diag.self` | B | `dropped` `{ring_full, schema_reject, level_off, disk_low}`, `pending`, `ring_kb`, `cpu_ms_per_h`, `writes_per_h` | Q12 |

**Engine (runs on the phone and the server; the host records the event from the engine's own result, so the engine stays a pure function)** (`src` is the host)

| Kind | Level | Fields | Answers |
|---|:--:|---|:--:|
| `engine.run` | B | `host` (phone, server), `reason` (shift_end, late_points, label, recalc, upgrade), `calc_version`, `segmenter`, `input_digest`, `ms`, `stats` (`14` §8 counters), `flags[]` (codes only), `trips`, `stops`, `total_m`, `active_m`, `deadhead_m` | Q7 Q8 |
| `stops.stats` | B | `detected`, `by_conf[3]`, `dwell_hist[5]`, `merged`, `wake_used`, `fallback` | Q8 (E9) |
| `stop.detected` | V | `stop_key`, `dwell_s`, `conf`, `role_est`, `radius_max_dm` (no coordinates; `stop_key` is client id + epoch ms) | Q8 (A13) |

**Server** (`src = server`)

| Kind | Level | Fields | Answers |
|---|:--:|---|:--:|
| `server.start` | B | `app_v`, `schema_v`, `sqlite_v`, `node_v`, `arch`, `mem_limit_mb`, module flags, `unclean_shutdown` | Q1 Q9 (B6, B7, B12, B13) |
| `server.sample` | B | every 15 min: `rss_mb`, `heap_mb`, `lag_p95_ms`, `lag_max_ms`, `cpu_pct`, `db_bytes`, `wal_bytes`, `diag_db_bytes`, `disk_free_mb`, `disk_state` | Q9 (B1 to B4) |
| `api.window` | B | every 15 min with traffic, per route group (`telemetry`, `shifts`, `sync`, `stops`, `exports`, `diagnostics`, `other`): `n`, `s2xx`, `s4xx`, `s5xx`, `p50_ms`, `p95_ms`, `p99_ms`, `codes` (top 8 error codes with counts); plus ingest: `points_in`, `inserted`, `duplicates`, `rejected` by reason | Q6 Q9 |
| `recon.result` | B | on `shift.end`: `status`, `reasons[]`, `diff_m`, `digest_equal`, `phone_calc_v`, `server_calc_v` | Q7 |
| `backup.run` | B | `trigger`, `ok`, `ms`, `bytes`, `lag_max_ms` (event-loop stall during the copy); the verified record stays in `backup_runs` | Q10 (B5) |
| `migration.run`, `restore.run` | B | `from_v`, `to_v`, `ms`, `pre_backup_ok`, `ok` (restore: `counts_match`) | Q10 (B8, B9) |
| `disk.state` | B | transition between the `10` §11.3 states | Q9 Q12 |
| `capture.state` | B | `event` (created, started, ended, expired, purged), `profile`, `shifts_done` | Q8 |

**Web client** (`src = web`): errors only, as `crash` with `runtime = web`, `route` name (enum), no URL, no query string. No page timings, no clicks.

### 3.3 What the engine and the native module must not do

The engine takes no diagnostics dependency (`14` §17). The host calls `record(kind, data)` on a `DiagnosticsPort` after the engine returns. In Kotlin the same port is a `DiagSink` interface with two implementations: a writer and a no-op (§6.3). Nothing else in the codebase imports the diagnostics module.

### 3.4 Platform facts used (all from the app's own process, none needs a permission or another app)

- **Why the process died:** the Android historical process exit reasons API (`ActivityManager.getHistoricalProcessExitReasons`, Android 11+). *Unverified on One UI 6.1: whether it reports OEM kills usefully.* It is read once per app start, so it costs nothing while riding.
- **Battery level, charging, temperature:** the sticky `ACTION_BATTERY_CHANGED` intent read at window close (no receiver, no wakeup).
- **Thermal state, power-save mode, app standby bucket, battery-optimisation exemption:** read at window close and at `perm.state` time. *Unverified: that the standby bucket for the app's own package needs no usage-stats permission.*
- **Device model, Android release and SDK:** `Build.*`. **One UI version:** best effort from a system property; null when unavailable. *Unverified.*

---

## 4. What is never collected, and how that is enforced

### 4.1 Never collected in diagnostics

| Class | Examples | Where it can still appear |
|---|---|---|
| Location | latitude, longitude, `*_e7`, geohashes, bearings with positions, addresses, place names, route geometry, stop anchors | `telemetry_points`, `stops`, `route_archives`, and capture data (§8), none of which is diagnostics |
| Money | payouts, tips, earnings, deduction values | `stop_labels` |
| Labels and free text | stop labels, trip purposes, notes, vehicle names, device names given by the driver | their own tables |
| Credentials and addressing | tokens, passwords, cookies, recovery key, server URL or hostname, tailnet name, IP addresses, headers | nowhere in diagnostics |
| Other apps | installed-app lists, other apps' notifications, screen content | never collected anywhere |
| Odometer values | readings | `odometer_readings` |

Distances and durations of shifts (`total_m`, `duration_s`) *are* allowed: they are the quantities being debugged, and they carry no position.

### 4.2 Enforcement: an allowlist, not a denylist

1. **Typed fields only.** Each kind's schema lists every field. A field not in the schema is rejected. Numbers have bounds. Strings are allowed only for the fields below, each with a regular expression, and everything else must be an enum.

   | String field | Pattern |
   |---|---|
   | `class`, `frames[]` entries | `^[A-Za-z0-9_.$<>@/:-]{1,120}$` (code identifiers and `file:line`) |
   | `*_v` versions, `sig`, `input_digest` | `^[0-9A-Za-z._+-]{1,40}$` |
   | device `make`, `model` | `^[A-Za-z0-9 ._+-]{1,40}$` |
   | `stop_key` | `^[0-9a-f-]{36}:[0-9]{10,13}:stop$` |
   | `msg` (crash only) | printable ASCII, at most 120 characters, and only under §4.3 |

2. **Coordinate belt and braces.** Any string field that matches `-?[0-9]{1,3}\.[0-9]{4,}` or a 9-digit integer-looking token is rejected, whatever its field.
3. **Three places check:** the producer (phone or server) before it stores an event, the server at ingest (the same shared schema, so a buggy or old phone cannot smuggle a field in), and the debug-bundle exporter (§10.2). A rejected event is counted in `diag.self.dropped.schema_reject`; its content is not logged.
4. **Logs are covered too.** `10` §11.2 already forbids logging coordinates, tokens or bodies. A CI check rejects any `Log.*` call in the Kotlin module, or any `console.*` call in the diagnostics paths, whose arguments mention `lat`, `lon`, `location`, `address`, `payout` or `token`. *Comma's module was grepped for `Log.` calls (first 30 lines): none interpolates a location. A full audit of the copied module is a build task.*

### 4.3 Crash messages

Exception messages are where leaks hide (a SQL error that prints a bound value, a validation error that prints the input). Rule: a crash event carries `class` and `frames` always; it carries `msg` **only if `class` is on an allowlist of our own typed error classes, SQLite error codes, and network error classes**, and then only the redacted first 120 printable characters. For any other class the message is withheld and the event says so (`msg` absent). No minidumps, no heap dumps, no logcat capture, no screenshots.

### 4.4 Tests that prove it

| Test | What it does |
|---|---|
| Canary unit test | Build every event kind from a context object stuffed with canaries (`43.6532`, `-79.3832`, `436532000`, `123 CANARY ST`, payout `1234` and `12.34`, `CANARY_NOTE`, `CANARY_BIKE`, a hostname `canary.ts.net`, tokens beginning `mwd_`, `mwp_`, `mw_session`). Assert none appears in the serialised event. |
| Fuzz | Random strings, including coordinate-like ones, into every string field. Each must be rejected or match its pattern. |
| API integration | Run the API test suite with canary-bearing data, then scan every `diagnostics.db` table for the canary substrings: zero hits. |
| Bundle test | Generate a bundle from that database and scan its bytes: zero hits (§10.2). |
| Native test | Throw exceptions whose messages carry canaries through `DiagSink`: the message is withheld unless the class is allowlisted, and then redacted. |

---

## 5. Levels

| Level | Records | Cost note |
|---|---|---|
| `off` | Nothing. Unsent local rows are deleted. The server records nothing about this device. | Zero. |
| `basic` (**default**) | All kinds marked B. | Within the budgets in §6.2. |
| `verbose` | Basic plus kinds marked V. | Measured separately (A15). **Reverts to basic automatically after 7 days** so it cannot be left on by accident. |

- **Who sets it:** the driver, on the web (Settings, Diagnostics). It is `settings.diagnostics_level` on the server (`07` §2.1). `verbose` also stores `diagnostics_verbose_until`.
- **How the phone learns it:** `GET /settings` (`08`) at pairing, at app start and after each sync drain. The phone keeps the last known level and enforces `verbose_until` with the GNSS-corrected clock, so a phone that is offline for weeks behaves correctly.
- **Module off:** with `modules.diagnostics = false` the phone behaves as `off`, the ingest route returns `404`, and the web hides every diagnostics screen.
- **Capture is independent of level** (§8) but requires the module.

---

## 6. Phone design

### 6.1 Where events live

| Store | File | Written by | Holds |
|---|---|---|---|
| `diag_native` | `tracker.db` (native-owned, `09` §5.1 item 4) | Kotlin | `service.event`, `track.window`, `activity.transition`, native `crash` |
| `diag_events`, `diag_state` | `app.db` (JS-owned, `15` §2.2) | JS | everything else |
| `capture_fixes`, `diag_config` | `tracker.db` | Kotlin | dense fixes while a capture session runs (§8); the last known level and capture config, so the service behaves correctly while JS is dead |

```sql
-- tracker.db (native)
CREATE TABLE diag_native (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  at              INTEGER NOT NULL,
  level           TEXT    NOT NULL CHECK (level IN ('basic','verbose')),
  kind            TEXT    NOT NULL,
  shift_client_id TEXT,
  data            TEXT    NOT NULL,           -- JSON validated against the shared schema
  uploaded_at     INTEGER
);
CREATE TABLE diag_config (id INTEGER PRIMARY KEY CHECK (id = 1), level TEXT NOT NULL, level_until INTEGER, capture_json TEXT);
CREATE TABLE capture_fixes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, capture_id INTEGER NOT NULL, shift_client_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL, lat_e7 INTEGER NOT NULL, lon_e7 INTEGER NOT NULL, accuracy_m INTEGER NOT NULL,
  speed_dmps INTEGER, bearing_deg INTEGER, altitude_m INTEGER, uploaded_at INTEGER
);

-- app.db (JS)
CREATE TABLE diag_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('basic','verbose')), kind TEXT NOT NULL,
  shift_client_id TEXT, data TEXT NOT NULL, uploaded_at INTEGER
);
CREATE TABLE diag_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- level, level_until, dropped_json, capture_json
```

The two diagnostics tables sit in the files that already exist. There is no third database on the phone.

### 6.2 Cost budget (measured in Spike A as A15)

| Budget | Value | How it is kept |
|---|---|---|
| Extra wakeups, timers, alarms, jobs, wake locks | **Zero** | Events are recorded only from callbacks that already run (location callback, service lifecycle, app foreground, upload tick). A code audit item and a `dumpsys alarm` / `dumpsys jobscheduler` comparison with diagnostics off |
| Extra network requests | **Zero** | Events ride the existing outbox (§6.4) |
| CPU spent in diagnostics code | **< 0.5 s per hour** at basic **(new)** | Counters in memory; one batched insert per window; self-measured and reported in `diag.self.cpu_ms_per_h` |
| Writes | **≤ 30 per hour** at basic **(new)** | About 12 window inserts plus a few lifecycle events |
| Local storage | **≤ 3 MB** at basic, **≤ 8 MB** at verbose | Caps below |
| Wire size | about **6 KB gzipped per 6-hour shift** at basic *(estimate)* | About 87 events per shift (36 `track.window`, 36 `upload.window`, about 15 others) |

Battery difference between diagnostics off and basic is *recorded* in the ride data but not gated: shift-to-shift battery noise is far larger than the effect, so the gate is the CPU and wakeup budgets above.

### 6.3 Caps and what is dropped

| Store | Cap | Weeks offline it covers |
|---|---|---|
| `diag_events` basic | 8,000 rows or 3 MB | about 90 shifts, roughly 15 weeks |
| `diag_events` verbose | 20,000 rows or 8 MB | about 5 weeks |
| `diag_native` | 2,000 rows or 0.5 MB | the native kinds only; `track.window` rows are the bulk |

Drop order when a cap is reached, oldest first within each step: (1) rows already uploaded, (2) `verbose` rows, (3) `track.window`, `upload.window`, `sync.pull`, `storage.state`, (4) other rows **except protected kinds** (`crash`, `app.start`, `service.event`, `engine.run`, `shift.summary`, `diag.self`), (5) protected kinds, oldest first, only if they alone exceed the cap. Every drop increments `dropped_json[reason]`, reported in `diag.self`, so an incomplete record says it is incomplete (Q12).

Low phone storage (`15` §3.4): below 200 MB free, `verbose` stops; below 50 MB only `crash`, `service.event` and `app.start` are recorded; below 20 MB nothing. **Diagnostics never evict, delay or compete with a `PENDING` point.**

### 6.4 Upload: piggyback on the outbox

- New outbox kinds `diag.batch` and `capture.batch` (`15` §2.2). Body: `{ "events": [ ... ] }`, at most 200 events, gzip. Idempotent on `(device, src, seq)` on the server.
- **Priority is the lowest.** Order inside a sync run: telemetry and shift items first (`15` §6.2 steps 1 to 5), then `GET /sync/changes`, then `diag.batch`, then `capture.batch`. Diagnostics are sent only when no telemetry older than the current `upload_hint_s` is pending, and **a backlog of diagnostics can never delay tax data.**
- `uploaded_at` is set on a `200`; uploaded rows are deleted at once (the phone has no event viewer). A `422` on one event drops that event and counts it; a `507` or `503` is retryable (`10` §11.3).
- A crash is written at the moment it happens and uploaded at the next sync, never by a special path.
- Weeks offline are covered by §6.3. A 12-week backlog of diagnostics is about 0.5 MB gzipped; it drains after the shifts.

### 6.5 What the driver sees on the phone

Settings, Diagnostics (read-only): current level (changed on the web), events waiting, last upload, and, if a capture session is active, a banner with its expiry and a **Stop capture** button. While capture records, the foreground notification says so. There is no event viewer on the phone (`05` §2).

---

## 7. Server design

### 7.1 A separate file: `diagnostics.db`

| Reason | Detail |
|---|---|
| No contention with tax data | Its own connection and its own single writer. `10` §3.1's single-writer rule is per database file, so diagnostics writes never restart a `milewage.db` backup (*unverified; tested in B16*). |
| Backups stay small and safe | `diagnostics.db` is **not backed up** (`10` §3). Restoring a backup never touches it. Capture data would otherwise add up to 200 MB of location data to every nightly backup. |
| It can never block startup | A missing, corrupt, or newer-schema `diagnostics.db` is **renamed aside and recreated**, with a `server.start` note. This is the opposite of the main database's "refuse to start" rule, on purpose (`07` §6): diagnostics are disposable. |
| One-step removal | Deleting the file and the module registration removes the feature. |
| Cross-file references are soft | `device_id` and `shift_client_id` are plain values with no foreign key, so diagnostics can never block a delete of a shift or a device. |

Own migration folder (`diagnostics/`), Drizzle Kit, applied at start under the same file lock as `07` §6.

```sql
-- diagnostics.db — module `diagnostics`
CREATE TABLE diag_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,                       -- no FK: separate file
  src         TEXT    NOT NULL CHECK (src IN ('phone_native','phone_js','server','web')),
  device_id   INTEGER,                                -- soft reference to devices.id; NULL for server and web
  seq         INTEGER,                                -- per (device_id, src), phones only
  at          INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  level       TEXT    NOT NULL CHECK (level IN ('basic','verbose')),
  kind        TEXT    NOT NULL,
  shift_client_id TEXT,
  capture_id  INTEGER,
  app_v       TEXT,
  data        TEXT    NOT NULL,                       -- JSON, validated against the shared schema
  expires_at  INTEGER NOT NULL                        -- set at insert: basic +90 d, verbose +14 d, crash and engine disagreement +365 d
);
CREATE UNIQUE INDEX idx_diag_phone_seq ON diag_events(device_id, src, seq) WHERE seq IS NOT NULL;
CREATE INDEX idx_diag_kind_time ON diag_events(kind, at);
CREATE INDEX idx_diag_shift     ON diag_events(shift_client_id, at) WHERE shift_client_id IS NOT NULL;
CREATE INDEX idx_diag_expiry    ON diag_events(expires_at);

CREATE TABLE diag_daily (                             -- trend rollup so old raw events can expire
  day TEXT NOT NULL, device_id INTEGER NOT NULL DEFAULT 0, metric TEXT NOT NULL,
  n INTEGER NOT NULL, sum REAL NOT NULL, max REAL NOT NULL,
  PRIMARY KEY (day, device_id, metric)
);
-- metric is one of a fixed list in the shared package: battery_pct_per_h, fixes_per_h, gap_s_moving,
-- service_restarts, upload_fail_pct, engine_ms, recon_diff_m, rss_mb_max, lag_p95_ms_max, api_5xx

-- diagnostics.db — module `capture` (default off)
CREATE TABLE capture_sessions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, device_id INTEGER NOT NULL,
  profile TEXT NOT NULL CHECK (profile IN ('dense')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER,
  max_shifts INTEGER NOT NULL, shifts_done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE capture_fixes (
  capture_id INTEGER NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, shift_client_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
  lat_e7 INTEGER NOT NULL, lon_e7 INTEGER NOT NULL, accuracy_m INTEGER NOT NULL,
  speed_dmps INTEGER, bearing_deg INTEGER, altitude_m INTEGER,
  PRIMARY KEY (capture_id, seq)
) WITHOUT ROWID;
CREATE TABLE capture_annotations (
  capture_id INTEGER NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('real_stop','false_stop','missed_stop','event','note')),
  shift_client_id TEXT, stop_key TEXT, text TEXT,
  PRIMARY KEY (capture_id, client_id)
);
```

Settings live in the main database: `settings.diagnostics_level` (`basic` by default) and `diagnostics_verbose_until` (`07` §2.1).

### 7.2 Ingest, retention, size

| Topic | Decision |
|---|---|
| Ingest | `POST /diagnostics/events` (`08`). Device bearer only for `phone_*` sources; web session only for `web`. At most 200 events, 256 KiB compressed, 1 MiB decompressed. Each event is validated; rejects are listed by index in the response and never fail the batch. Rate limit 30 per minute per device. |
| Server's own events | Written in-process through the `DiagnosticsPort` (a no-op when the module is off). Paused while the disk state is `writes_blocked`; the counts are reported as `diag.self` when it recovers. |
| Retention | Raw events by `expires_at`: basic 90 days, verbose 14 days, `crash` and engine-disagreement 365 days. Rollups (`diag_daily`) 2 years. Capture data 30 days after the session ends (§8). A nightly job prunes in batches of at most 5,000 rows per transaction, so the writer is never held long, and runs incremental vacuum afterwards. |
| Size caps | Events table 100 MB; capture 200 MB in total. Over a cap: prune `verbose` first, then the oldest basic windows. New capture sessions are refused over the cap. |
| Low disk (`10` §11.3) | Below 1 GB or 10% free: `verbose` events are accepted and discarded (`200` with `diag.self.dropped.disk_low`), new capture sessions are refused, capture data older than 7 days is pruned. Below 200 MB: every mutating route, ingest included, returns `507` and the phone keeps buffering. |
| Estimated steady state | About 7 to 10 MB of events at basic (about 36 KB per shift with indexes, plus server samples and API windows), against the 100 MB cap *(estimate, B16)*. |

### 7.3 Server-side measurements

The server records `server.sample` every 15 minutes using Node's own `perf_hooks` event-loop-delay histogram, `process.memoryUsage()`, `process.cpuUsage()` and file sizes. No agent, no `/proc` scraping, no extra container. Caddy's memory is not visible to the API and is still measured by `docker stats` in Spike B.

---

## 8. Capture sessions (module `capture`, default off)

**The question it answers:** how do we tune and test the engine (stop detection, sampling, the accuracy filter) on the owner's real rides, and keep those rides as repeatable test data (`14` §10.2, §12)?

### 8.1 What a capture session is

An owner-started, time-boxed recording of **every fix the GPS delivers at a dense cadence (1 s, 0 m)** plus **annotations** the owner adds on the web afterwards ("this was a real pickup", "false stop", "missed stop"). It replaces the "dense recording mode" the A-rig would otherwise need (`12` §6).

### 8.2 Rules

| Rule | Detail |
|---|---|
| Owner-controlled | Created, ended and deleted only from the web, by a session. A phone cannot start one. |
| Clearly marked | While active: a persistent banner on the phone with the expiry and a local **Stop capture** button, a different foreground-notification text, and a web banner. |
| Expiry | At most 168 hours or 5 shifts, whichever first, and one active session per device. The phone enforces the expiry itself from the stored `expires_at`, so a phone that cannot reach the server still stops recording. |
| Separate from diagnostics | Its own tables, its own retention (30 days after the session ends), never in the debug bundle unless explicitly ticked (§10.2). It **does** contain coordinates and the owner's free-text notes, and the screens say so. |
| Does not touch the logbook | Dense fixes go to `capture_fixes`. The production buffer (`telemetry_buffer`) is written exactly as in normal mode (cadence emulation, §8.3), so a captured shift's totals use the same input as an uncaptured one. |
| Flagged | A shift recorded during a capture session gets the info flag `capture_session` (a `shift_flags` row, `07` §2.7) so any difference can be attributed. |
| Battery | Dense GPS costs more than the normal cadence. Creating a session says so. Battery figures from captured shifts are tagged `capture` and excluded from the A1 comparison. |

### 8.3 How the dense stream is produced

`start(shiftClientId, cadenceConfig)` (`09` §5.1 item 5) already takes a cadence configuration from JS. A capture session adds a `captureConfig` (`{ captureId, intervalMs: 1000, displacementM: 0 }`). The service then:

1. requests location at the dense cadence;
2. writes **every** fix to `capture_fixes`;
3. writes a fix to `telemetry_buffer` only if it satisfies the production cadence (at least 10 s since the last written fix **and** at least 20 m away, as the provider's own interval and displacement settings are documented to behave).

Step 3 is the one exception to "the service applies no filter" (`09` §5.1 item 4). It is a three-line gate, active in capture mode only, with a unit test. *Unverified: that this matches the provider's own gating. The `capture_session` flag is the compensating control.*

### 8.4 Replay and the test harness

- `GET /diagnostics/capture-sessions/{id}/replay` returns NDJSON: `{"t":"meta",...}`, then `{"t":"fix",...}` lines, then `{"t":"annotation",...}` lines, then `{"t":"shift",...}` lines with the engine's recorded result.
- **Two modes.** `exact` returns real coordinates and is for the owner's own harness (conformance fixtures, `14` §10.1). `anonymized` (**the default**) converts every fix to metres east and north of the first fix (equirectangular at that latitude), re-embeds them at latitude 0, longitude 0, and replaces times with offsets from the first fix. Distances and shapes survive to well under 0.1% over a shift, which is enough to tune cadence, gates and stop parameters (E1 to E12) and to share a reproduction, but not to learn where the owner rides. Anonymized files are not used as byte-exact conformance fixtures.
- The harness lives in the shared package as a test tool: it feeds a replay into `processShift`, can decimate the dense stream to any cadence (`14` §12 protocol), and diffs results. Anonymized replays can be committed to the repository as golden fixtures. That answers the finding in `14` §2 that Comma left no fixtures.

---

## 9. How the spikes and later regression use it

The Gate 3 rigs are throwaway and keep their own scripts. They must still **record the same event kinds** for the events that already exist in the rig (§9.3), so the schema is proven before the product is built. In the product, each measurement below is read from the named event.

### 9.1 Spike A and C (`12` §6)

| Measurement | Event(s) that provide it |
|---|---|
| A1 battery | `track.window.battery_pct` and `charging`, `shift.summary.battery_start`/`battery_end`; `capture` shifts excluded |
| A2 gaps | `track.window.interval_max_ms`, `gap_*` flags in `engine.run.flags`, `service.event` (to separate a kill from poor fixes) |
| A3 distance | `engine.run.total_m` against the scooter odometer (the odometer reading stays in `odometer_readings`) |
| A4 survival | `service.event` (`task_removed`, `destroyed`, `recovered`), `app.start.prev_exit` |
| A5 stillness | `track.window.still_gated_s`, `service.event` `still_gate_on/off`, `engine.run.stats.within_gate` |
| A6 restart | `service.event.restarted`/`recovered`, `perm.state.background`, `app.start.prev_exit` |
| A7 start from background | `service.event` `fgs_start_refused` with `reason = start_not_allowed` |
| A8 batch replay | server `api.window.ingest.duplicates` |
| A9 module flag | `settings.applied` |
| A10 conformance | `engine.run.input_digest` and totals on both hosts; `recon.result.digest_equal` (the fixture diff itself stays a harness job) |
| A11 parallel ride | `engine.run` totals against Comma's number (entered by hand in the results file) |
| A12 engine speed | `engine.run.ms` (host phone and host server) |
| A13 stop accuracy | `stops.stats`, `stop.detected` (verbose), and capture annotations (§8) |
| A14 toggle | `settings.applied.stops_enabled`, `engine.run.segmenter` |
| C1 to C4, C6 | `upload.window`, `sync.state`, `api.window.ingest` (inserted, duplicates, rejected) |
| C7 revoke | `sync.state = revoked`, `upload.window.fail_4xx` |
| C8 backlog drain | `upload.drain` (points, bytes, wall time) |
| C9 wrong server | `sync.state = wrong_instance` |
| **A15 (new)** | Diagnostics' own cost: `diag.self.cpu_ms_per_h`, `writes_per_h`; the wakeup audit (§6.2) |

### 9.2 Spike B (`10` §15)

| Test | Event(s) |
|---|---|
| B1 idle footprint, B3 stress, B4 reader | `server.sample` (`rss_mb`, `cpu_pct`, `lag_*`), `api.window` p95/p99 |
| B5 backup under load | `backup.run.lag_max_ms` |
| B6, B7 crash and power pull | `server.start.unclean_shutdown`, then the integrity result |
| B8, B9 restore, migration | `restore.run`, `migration.run` |
| B10 low disk | `disk.state` |
| B12, B13 | `server.start` (`sqlite_v`, module flags) |
| **B16 (new)** | Diagnostics under load: ingest at 50 events/s alongside B3; `milewage.db` backup unaffected; `lag_*` with the module on versus off |
| **B17 (new)** | Idle RSS with the module on versus off; the cost should be within **5 MB** *(estimate)* |

### 9.3 What the A-rig and B-rig implement now (kept small)

The A-rig emits `app.start`, `service.event`, `track.window`, `upload.window`, `shift.summary`, `engine.run` and `crash`, and posts them to a stub `POST /diagnostics/events` on the B-rig that validates against the shared schema and stores them. That is the whole diagnostics scope inside Gate 3; the web views, rollups, capture and the bundle are product work.

### 9.4 Regression after launch

The spike thresholds become standing checks in the Health view (§10.1), so a release that makes tracking worse shows up as a colour change instead of a feeling. Anonymized capture replays committed as golden fixtures run in CI against `processShift` on every change to the engine.

---

## 10. Web debug view

Module `diagnostics`, screen group "Diagnostics" (`05` §3.3). Tables and one timeline strip only. No chart library, no dashboard tiles (the `05` §4 rule on slop dashboards applies).

### 10.1 Health

Per paired device, the last 7 shifts, as a **checklist with a traffic light per check and a 0 to 100 score** (green earns the full weight, amber half, red none). Every number shown is explained by its check; the score is a sort key and a summary, not a verdict.

| # | Check | Weight | Green | Amber | Red | Source |
|:--:|---|:--:|---|---|---|---|
| H1 | Coverage: moving time in unexplained gaps | 25 | < 1% | < 3% | ≥ 3% | `gap_*` flags, `track.window` |
| H2 | Service stability: unplanned restarts or kills | 20 | 0 | 1 | ≥ 2 | `service.event` |
| H3 | Fix quality: share of fixes ≤ 25 m accuracy | 10 | ≥ 85% | ≥ 70% | < 70% | `track.window.acc_hist` |
| H4 | Uploads: failure rate, and backlog drained within 15 min of shift end | 15 | < 2% and drained | < 10% | otherwise | `upload.window` |
| H5 | Permissions and OS state: "Allow all the time", not battery-restricted | 10 | all good | background not granted, or restricted bucket | location permission lost mid-shift | `perm.state` |
| H6 | Agreement: phone and server results | 10 | match | differs, explained by late points or edits | engine disagreement | `recon.result` |
| H7 | Battery against the device's own median of its last 10 non-capture shifts | 10 | ≤ +20% | ≤ +50% | worse | `shift.summary` |

Server checks (same colours, no score): **S1** RSS within the `10` §14 budget over 24 h; **S2** event-loop lag p95 ≤ 50 ms and max < 1,000 ms (the B5 bar); **S3** last verified backup less than 26 h old; **S4** disk state `ok`; **S5** server 5xx share < 0.5% over 24 h. All thresholds are **(new)** except those cited from `10`, and are constants in the shared package.

### 10.2 Timeline, errors, export

- **Shift timeline:** for one shift, the events as lanes (service, windows, uploads, engine, sync) merged with the shift's flags (`GET /shifts/{ref}`), so "why is this shift short" reads top to bottom.
- **Errors:** crashes grouped by `sig` (hash of class plus the top 3 frames): count, first and last seen, app version, device model.
- **Server:** the latest `server.sample` and `api.window` figures as a small table, plus the S-checks.
- **Capture sessions:** create, end, delete, download replay, and the annotation table for labelling real/false/missed stops (the E9 protocol).
- **Debug bundle** (`GET /diagnostics/bundle`, button "Download debug bundle"): a single gzipped JSON document the owner can attach to a bug report or give to a developer. Its content:
  - versions (app, engine, schema, SQLite, Node), device make, model, Android and SDK, module flags;
  - the Health result and the S-checks;
  - per shift: duration, `total_m`, `active_m`, `deadhead_m`, `segmenter`, `calc_version`, `recon` status, flag **codes** (no `detail`);
  - the diagnostics events for the chosen range, **re-validated against the schema** (anything that fails is excluded and counted);
  - **relative times only** (seconds from the first event), **pseudonymous ids** (`D1`, `S1`), and **no** dates, country, timezone, currency, usernames, device names, server address, odometer values, labels or capture data;
  - capture data only if the owner ticks "Include capture session N", with a warning, and then in `anonymized` mode.

---

## 11. Modularity (README §1.3)

| Module | Interface | Depends on | Toggle (default) | When off | Removal path |
|---|---|---|---|---|---|
| **diagnostics** (server + phone + web) | `DiagnosticsPort.record(kind, data)`; routes `POST/GET /diagnostics/events`, `GET /diagnostics/health`, `GET /diagnostics/bundle`; event kinds registry in the shared package | core | `modules.diagnostics` (**on**) and `settings.diagnostics_level` (**basic**) | No server events, ingest returns 404, the phone behaves as level `off` and clears its rings, no web screens. The product runs unchanged. | Remove the registration and delete `diagnostics.db`. The phone sink becomes a no-op. |
| **capture** | `captureConfig` into the tracker's `start()`; routes under `/diagnostics/capture-sessions` | diagnostics, tracking, devices | `modules.capture` (**off**) | No sessions, no dense stream, no replay. | Remove the registration and drop the capture tables. |
| **debug bundle** | `GET /diagnostics/bundle` | diagnostics | `diagnostics.bundle` (**on**) | The button disappears. | Delete the route. |
| **Redaction/allowlist** | The shared event schemas | none | **Not toggleable.** It is what makes the module safe to ship. | n/a | n/a |

**Seams kept:** `DiagnosticsPort` (server and JS) and `DiagSink` (Kotlin) each have a real second implementation, a no-op, which is exactly the toggle. The event registry is data: a new kind is one schema entry, no interface. **Seams refused as slop:** a pluggable exporter interface (OpenTelemetry, OTLP, Prometheus `/metrics`, Sentry, any hosted service), because the owner's rule is own server only; a log-shipping pipeline; a sampling or feature-flag service for events; per-event consent prompts; a remote-config system beyond the one `level` setting; a metrics database separate from `diagnostics.db`. A `/metrics` endpoint for a homelab Grafana is a plausible later *module*; nothing in v1 needs it.

---

## 12. Decisions

| # | Decision | Chosen | Why | Rejected |
|---|---|---|---|---|
| D1 | Name | "Diagnostics", distinct from GPS "telemetry" | The plans already use "telemetry" for breadcrumbs | One overloaded term |
| D2 | Destination | The paired server only; no third-party SDK or service | README out-of-scope list; privacy | Sentry, Firebase Crashlytics, OTLP, hosted logging |
| D3 | Store | Separate `diagnostics.db` | No contention, small backups, never blocks startup, one-step removal | Tables in `milewage.db` |
| D4 | Privacy mechanism | Typed allowlist checked in three places, plus canary tests | A denylist misses what nobody thought of | Redaction by pattern alone |
| D5 | Levels | `off` / `basic` (default) / `verbose` (auto-reverts in 7 days) | Always-on cheap default; deep mode that cannot be forgotten | Always verbose; per-kind switches |
| D6 | Aggregation | 10-minute (phone) and 15-minute (server) windows | Few rows, no per-fix cost, enough for every named question | Per-fix and per-request events |
| D7 | Transport | Existing outbox, lowest priority, no extra wakeups or requests | Battery and tax data come first | A separate upload worker |
| D8 | Where the level is set | On the server (web), read by the phone, enforced locally with the GNSS clock | One place to control; works offline | A phone-local switch |
| D9 | Crash content | Class, frames, signature, message only for allowlisted classes | Messages are where leaks hide | Full messages; minidumps; logcat |
| D10 | Capture | Separate module, default off, own tables, time-boxed, flagged shifts | Tuning needs coordinates; diagnostics must stay clean | Dense mode inside normal diagnostics |
| D11 | Capture and the logbook | Dense stream beside the production buffer; cadence emulation in capture mode | Captured shifts keep real totals | Dense data feeding the logbook |
| D12 | Replay export | `anonymized` by default, `exact` for the local harness | Shareable reproductions without location | Exact only |
| D13 | Retention | Basic 90 d, verbose 14 d, crashes 365 d, rollups 2 y, capture 30 d after end; caps 100 MB and 200 MB | Matches review habits; bounded | Keep forever |
| D14 | Backups | `diagnostics.db` not backed up | Disposable; keeps tax backups small | Include it |
| D15 | Startup | A bad `diagnostics.db` is renamed aside and recreated | Diagnostics must never stop the server | Refuse to start (the main DB rule) |
| D16 | Health | Seven weighted checks with traffic lights and a 0 to 100 score; five server checks | Explainable, and the numbers come from the spikes | A single opaque score; charts |
| D17 | Engine | Stays pure; the host records events from the result | Keeps `14` §17 intact | Instrumentation inside the engine |
| D18 | Bundle | Relative times, pseudonymous ids, re-validated, no capture unless ticked | Safe to hand to a developer | Raw export |

---

## 13. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Findings and mitigations
> 1. **Is it grounded in a driver or builder problem?** Yes: every kind carries a question from §2, and §9 maps each spike measurement to a kind. Without it the owner would rebuild the same logging by hand for each spike and then again after launch.
> 2. **Vanity metrics cut.** Not collected: per-fix events, per-request logs, screen views, button taps, session lengths, retention or funnel figures, network type or carrier, IP addresses, web page timings, FPS or per-screen memory, installed apps. None answers Q1 to Q12.
> 3. **Pointless-boundary check.** No exporter plugin interface, no remote config, no event bus beyond the existing one, no separate metrics store. Seams exist only where a real second implementation exists (no-op sink, capture module).
> 4. **Missing-boundary check.** Diagnostics, capture and the bundle each toggle independently; the engine, the tracker and the logbook import nothing from them; deleting `diagnostics.db` is the whole removal.
> 5. **Biggest risk: a leak through free text.** Exception messages and library errors can carry bound values. Mitigated by the allowlist, the withheld-message rule (§4.3) and canary tests, but a new library that throws a surprising class is exactly what an allowlist of classes handles by *withholding*. Weakest remaining point: `frames` could in principle contain a file path with a user name on a non-Android host (the web or server); the pattern excludes spaces and `~`, and the exporter re-checks.
> 6. **Second risk: diagnostics hurting the thing they measure.** Budgets (§6.2) are numbers, not intentions: zero timers, zero requests, under 0.5 s CPU per hour. A15 checks them. If the budgets fail, the fallback is `off` by default (one constant).
> 7. **Health score weights are a guess.** They are labelled **(new)**, shown with their checks, and constants in one place. A score that disagrees with the owner's feel is a prompt to change a weight, not to trust the number.
> 8. **Capture is the most sensitive feature.** It holds exact coordinates. Mitigations: default off, time-boxed, owner-only, visible on the phone, separate tables, anonymized replay by default, not in backups, not in the bundle unless ticked.
> 9. **Estimates, not measurements.** All sizes in §6.2 and §7.2 are estimates until Spike A and B record them.
> 10. **Scope check against Gate 3.** The Gate 3 addition is small (§9.3): seven event kinds in the A-rig, one stub route in the B-rig, A15, B16, B17. Everything else is product work.

---

## 14. Unverified items

| # | Item | Checked by |
|:--:|---|---|
| U1 | The historical process-exit-reasons API gives useful reasons for OEM kills on One UI 6.1, and keeps enough history | Spike A (A4, A6): compare `app.start.prev_exit` with what `adb` shows after a kill |
| U2 | The app's own standby bucket is readable without a usage-stats permission | Spike A rig build |
| U3 | One UI version can be read from a system property; otherwise null | Spike A rig build |
| U4 | Reading the sticky battery intent at window close causes no wakeup and no receiver | A15 audit and `dumpsys` comparison |
| U5 | Cadence emulation in capture mode matches the provider's own interval and displacement behaviour | A capture-session ride against a normal ride; the `capture_session` flag marks the difference |
| U6 | A second SQLite file with its own writer never restarts a `milewage.db` online backup | B16 |
| U7 | `perf_hooks` event-loop-delay monitoring overhead and accuracy on Node 22.22 in the 1 vCPU VM | B17 and B16 |
| U8 | Size estimates: about 87 events and 6 KB gzipped per shift, 7 to 10 MB steady state on the server, 3 MB on the phone | A15, B16, C8 |
| U9 | The equirectangular anonymization keeps distances within 0.1% over a shift | A unit test against the haversine on recorded rides |
| U10 | The coordinate-pattern guard does not reject legitimate fields (a version string like `1.2345.6`) | Fuzz and unit tests; patterns are anchored per field |

---

## 15. Cross-document edits (applied 2026-11-04)

| Doc | Change |
|---|---|
| `06` | Item 1.5c recorded |
| `07` | `settings.diagnostics_level`, `diagnostics_verbose_until`; §1 conventions note a second, optional file; §1.1 modules `diagnostics`, `capture`; new §2.9 pointer to `diagnostics.db`; decision D22; audit item 11 |
| `08` | 12 operations in 8 new paths (49 → 61 operations, 39 → 47 paths); `Modules`, `Settings`, `SettingsPatch`, `SystemStatus` fields; scope and rate-limit rows; modules `diagnostics` and `capture`; `DiagnosticsPort` seam |
| `09` | New §5.9 (diagnostics hooks, `DiagSink`, capture mode); module API gains `readDiag`, `markDiagUploaded`, `setDiagConfig`, and `captureConfig`; Spike A gains A15 |
| `10` | `diagnostics.db` in the volume layout; backup and restore exclusions; disk-state behaviour for diagnostics; RSS note; tests B16 and B17; decision and audit lines |
| `12` | Spike A: minimal event set in the rig, A15, mapping to events; Spike B: B16, B17 |
| `15` | Outbox kinds `diag.batch` and `capture.batch`; priority order; storage and low-storage rules; privacy row; modularity row; decision D24 |
| `05` | Phone Settings, Diagnostics row and capture banner; web Diagnostics screens; modularity rows |
| `01` | One in-scope line: diagnostics to the owner's own server |
| README | Blueprint line; terminology note; module list |
| `11` | §10: changes from 1.5c, audit and open defaults |
