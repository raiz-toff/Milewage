# 07 — Database Schema Specification (SQLite)

**Lead Agents:** Agent 2 (Backend Architect) & Agent 3 (Standards & Compliance)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION (Gate 2) — decisions made, awaiting Human sign-off. Updated 2026-11-04 for decision 1.5b (no phone delivery taps; auto-detected stops, web-only labelling, `stops` module replaces `deliveries`) and 1.5c (settings columns for diagnostics; the diagnostics store is a separate file, §2.9).  
**Parent:** [`plans/milewage/README.md`](./README.md)  
**Inputs:** Gate 1 decisions 1.1–1.8 in [`06`](./06-human-in-the-loop-review-gates.md); stack in [`03`](./03-self-hosted-docker-architecture-plan.md); phone buffer in [`02`](./02-mobile-architecture-plan.md); compliance in [`04`](./04-data-standards-and-handovers-plan.md).

This document is a specification, not code. The DDL below defines what the Drizzle schema and its first migration must produce.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Engine | SQLite, one main file (`/app/data/milewage.db`) for the logbook, plus one optional, separate, disposable file (`/app/data/diagnostics.db`) owned by the `diagnostics` module (§2.9, `16`). `PRAGMA journal_mode=WAL; foreign_keys=ON; synchronous=NORMAL; busy_timeout=5000;` on every connection. One write connection, any number of readers. |
| Tenancy (1.4) | Single user per instance. **Every table carries `user_id`** (FK to `users`) so multi-user is an added feature, not a rewrite. The API never accepts `user_id` from a client. |
| Primary keys | `INTEGER PRIMARY KEY` (server-assigned). Rows created offline on the phone also carry a `client_id TEXT` (UUID) with `UNIQUE(user_id, client_id)`, so a retried upload upserts instead of duplicating. |
| Timestamps | `INTEGER` milliseconds since the Unix epoch, **UTC**, in columns ending `_at`. Local calendar dates are never derived on the fly: `shifts.local_date` is stored once, using the timezone in `settings`. |
| Distance | `INTEGER` **metres**. Display units (km/mi) come from `settings.distance_unit`. |
| Money | `INTEGER` **cents** in the single currency in `settings.currency`. No per-row currency column. |
| Coordinates | `INTEGER` degrees × 10⁷ (`lat_e7`, `lon_e7`). About 1 cm resolution, 4 bytes each in SQLite instead of 8 for `REAL`, and exact equality for dedup. |
| Enums | `TEXT` with `CHECK (... IN (...))`. |
| Deletes | Child rows of a shift (`telemetry_points`, `trips`, `route_archives`) use `ON DELETE CASCADE`. Everything else is `RESTRICT`. |

### 1.1 Module ownership (README §1.3)

Tables are grouped by the API module that owns them (`08` §16). Each module has its own migration folder. **A disabled module's migrations still run**, so its tables exist but stay empty, and turning the module on later needs no migration.

| Module | Tables | Notes |
|---|---|---|
| **core** (not toggleable) | `users`, `settings`, `web_sessions`, `vehicles`, `odometer_readings`, `shifts`, `trips`, `shift_flags`, `instance` | The logbook and authentication. `shifts.segmenter` records, per shift, whether the stop-based estimate was on (§2.3). `shift_flags` holds the data-quality flags of `14` §8; `instance` holds the install id and restore generation (§2.7). |
| **devices** | `devices`, `pairing_tokens` | Phone pairing. Empty when the module is off. |
| **tracking** | `telemetry_points`, `route_archives`, `trip_overrides`; the setting `settings.raw_retention_days` | Ignored when tracking is off. |
| **sync** | `change_log`, `overwrite_log` | The pull path for the phone (`15` §6.5). Empty when the module is off; the phone is then upload-only. |
| **stops** (runtime toggle, `settings.stops_enabled`, default on) | `stops`, `stop_labels` | Auto-detected stops and the driver's optional web-only labels (§2.8). Depends on `tracking` (stops are derived from points). Empty when off; existing rows are kept, not deleted, when the setting is turned off. |
| **backup** (engine not toggleable) | `backup_runs`; the settings `offsite_last_download_at`, `offsite_synced_elsewhere_at` | The engine runs regardless; the download button and reminder are switchable (`08` §16.2). |
| **diagnostics** (default on) | `settings.diagnostics_level`, `settings.diagnostics_verbose_until` (in `milewage.db`); every other table in the **separate file** `diagnostics.db` (§2.9) | Built-in diagnostics (`16`). Its tables are not in `milewage.db`, not backed up, and have no foreign keys to it. Empty or absent when the module is off. |
| **capture** (default off) | tables in `diagnostics.db` (§2.9) | Dense raw fixes and annotations for tuning and replay (`16` §8). Depends on `diagnostics` and `tracking`. |

---

## 2. Tables

### 2.1 Identity and devices

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,              -- scrypt via node:crypto (10 §9)
  created_at    INTEGER NOT NULL
);
-- Single-user is enforced in the application: the setup endpoint works only while users is empty.

CREATE TABLE settings (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id),
  country            TEXT    NOT NULL CHECK (length(country) = 2),   -- ISO 3166-1 alpha-2; the API validates it against the registered country packs (08 §16.3). An unregistered country gets the generic PDF and a null deduction
  distance_unit      TEXT    NOT NULL CHECK (distance_unit IN ('km','mi')),
  currency           TEXT    NOT NULL CHECK (length(currency) = 3),  -- ISO 4217
  timezone           TEXT    NOT NULL,                               -- IANA, e.g. 'America/Chicago'
  raw_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (raw_retention_days >= 7),  -- tracking module only
  stops_enabled      INTEGER NOT NULL DEFAULT 1 CHECK (stops_enabled IN (0,1)),    -- stops module: the driver-facing toggle (1.5b). Read by the web client and the phone via GET /settings; captured per shift in shifts.segmenter
  diagnostics_level  TEXT    NOT NULL DEFAULT 'basic' CHECK (diagnostics_level IN ('off','basic','verbose')),   -- diagnostics module (16 §5): set from the web, read by the phone via GET /settings
  diagnostics_verbose_until INTEGER,                                     -- verbose reverts to basic after this time (7 days after it was set)
  offsite_last_download_at    INTEGER,                                   -- backup module: last 'Download backup'
  offsite_synced_elsewhere_at INTEGER,                                   -- backup module: driver tapped 'synced elsewhere'
  updated_at         INTEGER NOT NULL
);

-- devices module
CREATE TABLE devices (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  name         TEXT    NOT NULL,                                     -- e.g. 'Pixel 8'
  platform     TEXT    NOT NULL CHECK (platform IN ('android','ios')),
  token_hash   TEXT    NOT NULL UNIQUE,                              -- SHA-256 of a random 32-byte credential; plaintext never stored
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);

-- devices module
CREATE TABLE pairing_tokens (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,                                       -- created_at + 10 minutes
  used_at    INTEGER
);
```

```sql
CREATE TABLE web_sessions (
  id_hash      TEXT    PRIMARY KEY,                                      -- SHA-256 of the opaque cookie value
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,                                         -- sliding 30 days
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE backup_runs (                                              -- backup module
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  trigger      TEXT    NOT NULL CHECK (trigger IN ('nightly','shift_end','manual','pre_migration','pre_restore')),
  file_name    TEXT    NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT    NOT NULL,
  integrity_ok INTEGER NOT NULL CHECK (integrity_ok IN (0,1))
);
```

Web sessions are opaque random cookie values (`HttpOnly; Secure; SameSite=Strict`) stored hashed in `web_sessions`, so a logout or a rotation deletes rows and takes effect instantly. There is no signing secret and no `JWT_SECRET` (`10` §9, `08` §2.1).

A reinstalled or re-paired phone gets a **new `devices` row**, so its point sequence restarts at 1 without colliding.

### 2.2 Vehicles and odometer

```sql
CREATE TABLE vehicles (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('car','motorcycle','van','bicycle')),  -- matches HMRC classes
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE odometer_readings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('shift_start','shift_end','year_start','year_end')),
  reading_m   INTEGER NOT NULL CHECK (reading_m >= 0),              -- the dash reading, converted to metres
  recorded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_odo_shift_kind ON odometer_readings(shift_id, kind) WHERE shift_id IS NOT NULL;
CREATE INDEX idx_odo_vehicle_time ON odometer_readings(vehicle_id, recorded_at);
```

**Odometer decision:** one table is the only place readings live. Per-shift readings (`shift_start`, `shift_end`) are optional and entered at the start and end of a shift. `year_start` / `year_end` serve the CRA requirement of an odometer reading at the start and end of each fiscal year. The GPS-vs-odometer cross-check from `04` is a query, not stored data. `shifts` has no odometer columns.

### 2.3 Shifts and trips

```sql
CREATE TABLE shifts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  client_id     TEXT    NOT NULL,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id),
  status        TEXT    NOT NULL CHECK (status IN ('active','ended','finalized')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  local_date    TEXT    NOT NULL,                   -- 'YYYY-MM-DD' in settings.timezone at started_at
  total_m       INTEGER,                            -- business metres = active_m + deadhead_m
  active_m      INTEGER,                            -- ESTIMATED when segmenter = 'stops' (14 §6); the whole shift when 'whole_shift'
  deadhead_m    INTEGER,                            -- ESTIMATED when segmenter = 'stops'; 0 when 'whole_shift'
  personal_m    INTEGER,                            -- segments the driver reclassified as personal
  segmenter     TEXT    NOT NULL CHECK (segmenter IN ('stops','whole_shift')),  -- captured at shift start from settings.stops_enabled ('stops' when on); both engines use this value, so a later toggle never changes an existing shift (14 §6)
  calc_version  INTEGER,                            -- version of the distance algorithm that produced the totals (14 §11)
  calculated_at INTEGER,
  notes         TEXT,
  updated_at    INTEGER NOT NULL,                   -- last edit time; the last-writer-wins clock (15 §8.2)
  recon_status  TEXT    NOT NULL DEFAULT 'pending' CHECK (recon_status IN ('pending','match','differs','phone_missing')),
  recon_reasons TEXT,                               -- JSON array of reason codes, 15 §7.3
  phone_total_m INTEGER,                            -- the phone's result at shift end (phone_result, 14 §9.3)
  phone_calc_version INTEGER,
  input_digest  TEXT,                               -- 14 §9.2, from the phone's result
  calc_mismatch INTEGER NOT NULL DEFAULT 0,         -- 1 only for engine_disagreement (14 §9.4)
  interruptions_json TEXT,                          -- tracker stop/restart facts from the phone, an engine input (14 §7.3)
  device_touched_at INTEGER,                        -- last time a device wrote to this shift; widens that device's read window (15 §6.5)
  overlaps_shift_id INTEGER REFERENCES shifts(id),  -- set when a late upload makes two shifts overlap (15 §9.2)
  UNIQUE (user_id, client_id)
);
CREATE UNIQUE INDEX idx_shifts_one_active ON shifts(user_id) WHERE status = 'active';
CREATE INDEX idx_shifts_user_started ON shifts(user_id, started_at);
CREATE INDEX idx_shifts_user_date ON shifts(user_id, local_date);

CREATE TABLE trips (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  shift_id      INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  trip_key      TEXT    NOT NULL,                     -- auto: '<shift client_id>:<segment start ms>:<original_kind>' (14 §6.4); manual: its client_id
  client_id     TEXT,                                 -- manual trips only (offline-created); the PUT /trips/{client_id} key
  kind          TEXT    NOT NULL CHECK (kind IN ('active','deadhead','personal')),
  original_kind TEXT    NOT NULL CHECK (original_kind IN ('active','deadhead')),
  source        TEXT    NOT NULL CHECK (source IN ('auto','manual')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  start_lat_e7  INTEGER, start_lon_e7 INTEGER,
  end_lat_e7    INTEGER, end_lon_e7   INTEGER,
  distance_m    INTEGER NOT NULL CHECK (distance_m >= 0),
  purpose       TEXT    NOT NULL,
  edited_at     INTEGER
);
CREATE INDEX idx_trips_shift ON trips(shift_id, started_at);
CREATE INDEX idx_trips_user_started ON trips(user_id, started_at);
CREATE UNIQUE INDEX idx_trips_key ON trips(user_id, trip_key);
CREATE UNIQUE INDEX idx_trips_client ON trips(user_id, client_id) WHERE client_id IS NOT NULL;
```

`trips` is the table a tax authority reads: one row per segment with date, start and end, purpose, and distance. It is **derived** from telemetry points (and, when `segmenter = 'stops'`, the detected stops) when a shift ends, then editable by the driver. Trip `kind` is an **estimate** when `segmenter = 'stops'` (`14` §6); total business distance never depends on it.

**Driver edits are not stored on the derived row.** A reclassification or purpose edit of an auto trip is a `trip_overrides` row (§2.7) keyed by `trip_key`, applied on top of every derivation, so a recompute cannot erase it. If a recompute leaves an override with no matching `trip_key`, it is kept and reported as `override_orphaned` (`14` §6.4), never dropped and never re-attached by guesswork. `kind`, `purpose` and `edited_at` on `trips` are the result of applying the override.

### 2.7 Overrides, flags, change log, instance

```sql
-- tracking module
CREATE TABLE trip_overrides (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  shift_id  INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  trip_key  TEXT    NOT NULL,
  kind      TEXT    NOT NULL CHECK (kind IN ('active','deadhead','personal')),
  purpose   TEXT    NOT NULL,
  edited_at INTEGER NOT NULL,                       -- the driver's edit time (GNSS-corrected on the phone, 15 §10)
  device_id INTEGER REFERENCES devices(id),         -- NULL when made on the web
  PRIMARY KEY (shift_id, trip_key)
);

-- core: data-quality facts about a shift (14 §8). They never change a number.
CREATE TABLE shift_flags (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,                      -- gap_counted, gap_large, clock_skew, calc_mismatch, override_orphaned, ...
  severity   TEXT    NOT NULL CHECK (severity IN ('info','review')),
  detail     TEXT,                                  -- JSON: times, metres, counts
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_shift_flags_shift ON shift_flags(shift_id);

-- sync module: what the phone pulls (15 §6.5). Rows are also the tombstones for deletes. Pruned after 30 days.
CREATE TABLE change_log (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity  TEXT    NOT NULL,                         -- shift | trip | odometer | vehicle | settings | override
  key     TEXT    NOT NULL,                         -- client_id, trip_key or id
  op      TEXT    NOT NULL CHECK (op IN ('upsert','delete')),
  at      INTEGER NOT NULL
);

-- sync module: a value overwritten by a newer edit is never lost silently (15 §8.2)
CREATE TABLE overwrite_log (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  at              INTEGER NOT NULL,
  entity          TEXT    NOT NULL,
  key             TEXT    NOT NULL,
  superseded_json TEXT    NOT NULL,
  by_device_id    INTEGER REFERENCES devices(id)
);

-- core: one row, created at first-run setup and preserved by backups (15 §9.3, §9.4)
CREATE TABLE instance (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  instance_id        TEXT    NOT NULL,              -- random, sent in X-MileWage-Instance
  restore_generation INTEGER NOT NULL DEFAULT 0     -- +1 on every restore, sent in X-MileWage-Restore-Gen
);
```

`change_log` and `overwrite_log` are written only when the `sync` module is on. `shift_flags` replaces a flags column so a flag can carry detail and be queried; it is core because the logbook export prints data-quality notes whether or not tracking is on.

### 2.4 Platform tag

`stop_labels.platform` is a lowercase slug, validated by the application against a registry in the shared package, not by a database table or enum: `doordash`, `ubereats`, `grubhub`, `instacart`, `amazon_flex`, `shipt`, `spark`, `uber`, `lyft`, `other`. A driver may also enter a custom slug matching `[a-z0-9_]{1,32}`. The platform is optional and entered only on the web, on a labelled stop, because a driver can run several apps in one shift. Unlabelled stops and deadhead segments carry no platform.

### 2.5 Telemetry

```sql
-- tracking module
CREATE TABLE telemetry_points (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  device_id   INTEGER NOT NULL REFERENCES devices(id),
  seq         INTEGER NOT NULL,                   -- assigned by the phone, strictly increasing per device
  shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  recorded_at INTEGER NOT NULL,
  lat_e7      INTEGER NOT NULL CHECK (lat_e7 BETWEEN -900000000  AND 900000000),
  lon_e7      INTEGER NOT NULL CHECK (lon_e7 BETWEEN -1800000000 AND 1800000000),
  accuracy_m  INTEGER NOT NULL,
  speed_dmps  INTEGER,                            -- decimetres per second
  bearing_deg INTEGER,
  altitude_m  INTEGER,
  UNIQUE (device_id, seq)
);
CREATE INDEX idx_points_shift_time ON telemetry_points(shift_id, recorded_at);
```

**Idempotent point IDs:** the identity of a point is `(device_id, seq)`. `INSERT ... ON CONFLICT (device_id, seq) DO NOTHING` makes any retried or partially acknowledged batch safe, and the response reports `inserted` vs `duplicates`. The phone increments `seq` in its local buffer when it records the point, before any network call.

**Fields deliberately not stored on the server**, though `02`'s phone buffer lists them:
- `battery_level`: not needed for any driver outcome; the phone can keep it for local diagnostics.
- `delivery_id` per point: active/deadhead attribution is derived from the detected stops (§3), so a stop label edited on the web changes attribution without rewriting thousands of rows.

### 2.6 Route archive

```sql
-- tracking module
CREATE TABLE route_archives (
  shift_id         INTEGER PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  geometry         TEXT    NOT NULL,              -- GeoJSON LineString; properties.times = epoch seconds per vertex
  raw_point_count  INTEGER NOT NULL,
  kept_point_count INTEGER NOT NULL,
  tolerance_m      INTEGER NOT NULL,              -- Douglas-Peucker tolerance used
  archived_at      INTEGER NOT NULL
);
```

GeoJSON was chosen over a custom blob so the archive is directly exportable to the standard formats in `04` without a decoder.

### 2.8 Stops and stop labels (stops module)

```sql
-- stops module. DERIVED by the shared engine (14 §6) at shift end and on every recompute; never written by a client.
CREATE TABLE stops (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  stop_key   TEXT    NOT NULL,                 -- '<shift client_id>:<first fix recorded_at ms>:stop' (14 §6.2); same string on phone and server
  started_at INTEGER NOT NULL,                 -- first fix of the dwell cluster
  ended_at   INTEGER NOT NULL,                 -- departure: last cluster fix (including a wake-up fix)
  dwell_s    INTEGER NOT NULL CHECK (dwell_s >= 0),
  lat_e7     INTEGER NOT NULL, lon_e7 INTEGER NOT NULL,        -- the anchor fix
  confidence TEXT    NOT NULL CHECK (confidence IN ('low','medium','high')),   -- from dwell time (14 §6.5)
  est_role   TEXT    NOT NULL CHECK (est_role IN ('pickup','dropoff','none')), -- the engine's estimate; 'none' = recorded but does not change the estimate
  role       TEXT    NOT NULL CHECK (role IN ('pickup','dropoff','other','none')),  -- the role actually used: the driver's label if any, else est_role
  UNIQUE (shift_id, stop_key)
);
CREATE INDEX idx_stops_shift ON stops(shift_id, started_at);

-- stops module. The driver's OPTIONAL labels, entered only in the web app, after the fact. Stored apart from the derived
-- stop (like trip_overrides) so a recompute cannot erase them.
CREATE TABLE stop_labels (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  shift_id     INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  stop_key     TEXT    NOT NULL,
  role         TEXT    NOT NULL CHECK (role IN ('pickup','dropoff','other')),
  platform     TEXT,                                    -- registry slug (§2.4); optional
  place        TEXT,                                    -- the driver's own name for the place; optional (customer data, 07 §7.3)
  payout_cents INTEGER NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  tip_cents    INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  notes        TEXT,
  edited_at    INTEGER NOT NULL,
  PRIMARY KEY (shift_id, stop_key)
);
```

- **Web only.** The phone never creates or edits stops or labels (decision 1.5b). The phone computes stops locally with the same engine (so it can show the estimated split offline) but does not upload them as entities: the server derives its own from the uploaded points, and `shift.end` carries the digest of the phone's result (`15` §7).
- **Labels are optional and money fields are optional.** `payout_cents` and `tip_cents` belong to a label, usually on the dropoff stop. `GET /summary` earnings and the shift-level CSV columns (`04` §2.3) are sums over labels and are `null` or blank when no payouts were labelled.
- **Orphans.** If a recompute leaves a label whose `stop_key` no longer exists (the detection parameters changed, or the points changed), the label is kept and reported as `label_orphaned`; it is never dropped and never re-attached by guesswork (same rule as `trip_overrides`, `14` §6.7).
- **Turning the setting off** stops the engine from using stops for new shifts and hides the routes and screens. It does not delete `stops` or `stop_labels`, and it does not change existing shifts (`shifts.segmenter` is fixed at shift start). A driver who wants a past shift recalculated without stops uses `recalculate` on a non-finalized shift, which re-reads `shifts.segmenter`, never the current setting.

### 2.9 Diagnostics store (separate file, modules `diagnostics` and `capture`)

Diagnostics (decision 1.5c) live in **`/app/data/diagnostics.db`**, a second SQLite file with its own connection, its own migrations and its own writer. It holds `diag_events`, `diag_daily`, `capture_sessions`, `capture_fixes` and `capture_annotations`; the DDL is in `16` §7.1. Rules that follow from keeping it apart:

- **No foreign key crosses the file boundary.** Diagnostics refer to devices and shifts by plain values (`device_id`, `shift_client_id`), so diagnostics can never block a delete or a restore.
- **Not backed up, not restored** (`10` §3, §7). Backups stay small and contain no capture coordinates.
- **Never blocks startup.** A missing, corrupt or newer-schema file is renamed aside and recreated, the opposite of §6's rule for the main database, on purpose.
- **Not counted in the sizes of §5.** Estimated steady state is 7 to 10 MB of events (hard cap 100 MB) plus capture data (hard cap 200 MB), see `16` §7.2.
- A shift recorded during a capture session carries an info `shift_flags` row with code `capture_session` (§2.7).

---

## 3. Mileage Rules (what the totals mean)

All of this runs when a shift ends and again whenever a trip override, a stop label or a late point arrives. It is the function `processShift` in `packages/shared/track-engine` (`14`), which runs identically on the phone and on the server; the server's result is the one stored. It is a pure function of `telemetry_points`, the shift's `segmenter`, its start and end, its interruptions, the driver's stop labels (web only) and trip overrides, and its output is stamped with `calc_version`. The thresholds below are the engine's constants (`14` §4-5); this section says what the totals mean, `14` says exactly how they are computed.

**Segmenter (swappable slot, `08` §16.3).** Steps 4–5 depend on `shifts.segmenter`, captured at shift start from `settings.stops_enabled`. With `'stops'` (the default) the *stop-based segmenter* applies: stops are auto-detected from the points (`14` §6.2) and the active/deadhead split is **estimated** from the stop pattern (`14` §6.3). With `'whole_shift'` the built-in *whole-shift segmenter* applies: the shift is one `active` segment, `deadhead_m` is 0, and its trip has the purpose `Business driving`. The segmenter also falls back to whole-shift, with flag `no_stops_detected`, when stops are on but none changed the estimate (`14` §6.4). Everything else below is the same either way. **Total business distance is identical under both segmenters.** When `tracking` is off there are no points, so no auto trips are derived and the driver adds manual trips (rule 8).

1. **Input points:** points of the shift with `accuracy_m <= 50`, ordered by `(recorded_at, seq)`, duplicates by `seq` dropped.
2. **Stationary gate** (replaces the earlier dwell collapse, `14` §5.3): a fix less than 20 m from the **last accepted** fix adds no distance and does not move the anchor, so slow creeping accumulates against the same anchor and is counted once it reaches 20 m. A fix implying more than 42 m/s is dropped as a spike.
3. **Distance:** haversine sum (R = 6,371,000 m) between consecutive accepted fixes, each segment rounded to a decimetre and the total to a metre, so phone and server agree exactly (`14` §9).
4. **Stops (stop-based segmenter only):** dwell clusters of the qualified fixes (`14` §6.2), at least 120 s long, are recorded as stops with a confidence from their dwell time. Detection is deterministic and runs on the phone and on the server.
5. **Segmenting:** the estimate starts as **deadhead**. A stop long enough to count (180 s to under 30 min, not at the shift start) flips it: deadhead to active at a pickup, active to deadhead at a dropoff. A driver's web label overrides the flip (`pickup` sets active, `dropoff` sets deadhead, `other` changes nothing). A segment takes the state in force at its end time; the state changes from a stop's departure. Stacked orders are a known blind spot of the estimate and are fixed by labelling, never by the engine guessing (`14` §6.4).
6. **Both kinds are business miles:** `total_m = active_m + deadhead_m`. The two are reported separately because drivers want the split (`01`), and both are deductible. Under the stop-based segmenter the split is an **estimate** and is labelled so in every screen and export (`05`); the tax figure is `total_m`, which never depends on stops.
7. **Outside a shift nothing is recorded**, so there is no personal driving in the data unless the driver reclassifies a segment. Reclassifying moves its metres to `personal_m` and removes them from `total_m`. The row keeps `original_kind` and `edited_at`.
8. **No distance override.** A driver can change `kind` and `purpose` but not `distance_m` on an `auto` trip. A trip the phone failed to record can be added as `source = 'manual'`, with distance typed in. Exports mark manual rows so an auditor can tell them apart.
9. **Default purpose text:** `Delivery (estimated)` for active and `Between deliveries (estimated)` for deadhead (stop-based segmenter; `Delivery - <platform>` when the stop that opened the active segment has a labelled platform), or `Business driving` (whole-shift segmenter). The driver may edit it.

The deduction value is **never stored**. It is computed at read time from `total_m` and the rates in the country registry for the shift's year, so a rate correction cannot leave stale numbers in the database.

---

## 4. Retention, Archive and Tax Evidence

### 4.1 What the regulators ask for

| Authority | Elements per record | Retention | Source |
|---|---|---|---|
| IRS (US, Pub. 463) | Mileage for each business use, date, destination, business purpose, and total miles for the year; a written or computer record kept at or near the time of travel. Odometer readings are not required by Pub. 463. | 3 years from the date the return is filed (Pub. 463). 6 years appears only as adviser guidance | [IRS Pub. 463](https://www.irs.gov/pub/irs-pdf/p463.pdf), [Beancount Pub. 463 guide](https://beancount.io/blog/2026/08/22/mileage-log-irs-audit-publication-463-requirements-guide), [Driversnote](https://www.driversnote.com/irs-mileage-guide/mileage-log-requirements), [SparkReceipt](https://sparkreceipt.com/blog/irs-mileage-log-requirements/) |
| CRA (Canada) | Date, destination, purpose, km per trip; odometer at start and end of each fiscal year | 6 years from the end of the last tax year they relate to | [CRA: motor vehicle expenses](https://www.canada.ca/en/revenue-agency/services/tax/businesses/small-businesses-self-employed-income/business-income-tax-reporting/business-expenses/motor-vehicle-expenses.html), [SparkReceipt (CA)](https://sparkreceipt.com/en-ca/blog/vehicle-expenses-cra/), [MileIQ CA](https://mileiq.com/en-ca/blog-en-ca/cra-mileage-log), [CRA: documenting vehicle use](https://www.canada.ca/en/revenue-agency/services/what-s-new/documenting-use-a-vehicle.html) |
| HMRC (UK) | HMRC requires a contemporaneous record of business mileage (BIM75005). No primary page lists required fields; MileWage's fields (date, reason, miles, vehicle type) are a superset, not an HMRC-prescribed list | Sole traders: at least 5 years after the 31 January submission deadline | [GOV.UK: how long to keep records](https://www.gov.uk/self-employed-records/how-long-to-keep-your-records), [BIM75005](https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim75005), [Pie.tax](https://www.pie.tax/tax-pible/how-to-keep-mileage-records-that-satisfy-hmrc-without-the-hassle), [Protax](https://www.protax.org.uk/?p=2210) |

**Source quality note:** the first draft used secondary sources only. Spike S0 (2026-11-03) re-checked the IRS and CRA elements and retention against primary-domain search excerpts and the HMRC retention period against GOV.UK; the HMRC field list remains unverified. A search for Rev. Proc. 2019-46 returned nothing usable, so nothing in this spec depends on its text. One source says the CRA states that the Income Tax Act sets no specific documentary format for vehicle use, which is consistent with the elements above being practice rather than a fixed form. A short human skim of IRS Pub. 463, the CRA motor vehicle page and sqlite.org `wal.html` is still recommended before Gate 4. The spec is built to survive that check because the retention rule below is longer than every figure found.

**CRA base-year note (S0):** the CRA allows a full 12-month logbook to serve as a base year, after which a 3-month sample can be used while vehicle use stays within 10% of the base year. This is why `year_start` / `year_end` odometer readings are stored separately from shift readings; a base-year or sample-period mode is not in v1.

### 4.2 Rules

| Data | Rule |
|---|---|
| `shifts`, `trips`, `stops`, `stop_labels`, `odometer_readings`, `route_archives`, `vehicles`, `settings` | **Never deleted automatically.** They are the evidence and cost almost nothing. A manual purge is allowed, and warns when the data is under 7 years old (longer than every retention figure above). |
| `telemetry_points` | Kept for `settings.raw_retention_days` (default **90**, minimum 7), then replaced by a `route_archives` row. |
| Ordering | A shift's raw points are purged only when (a) its `status` is `finalized` (the driver has reviewed it), (b) its totals were computed with the current `calc_version`, and (c) the archive row was written and verified in the same transaction. An unfinalized shift older than the window is archived anyway after 180 days, with a notice in the web UI. |
| Archive method | Douglas-Peucker with a 5 m tolerance, keeping the first and last point and the first and last fix of every detected stop. |
| Consequence | A GPX export of an archived shift contains the simplified route, not every breadcrumb. Totals and trips are unchanged. The export states this in its metadata. |

**Why 90 days, not 30 (as `03` says):** the evidence is the `trips`/`shifts` rows, not breadcrumbs. Raw points exist so a driver can fix a mistake and recompute. Thirty days is shorter than a typical review habit and saves almost nothing (§5). Ninety days gives a full quarter, which matches how drivers prepare estimated taxes, at a rolling cost of about 17 MB.

**GPS accuracy note:** the archive keeps the first and last fix of every detected stop specifically so that the stop locations (the "destinations") survive simplification. The `stops` table itself is permanent and carries each stop's anchor coordinates, so labelled and unlabelled destinations survive the archive regardless.

---

## 5. Size Estimates

Assumptions: 250 shifts per year, 6 hours each, 70% of the time moving at an average of one point per 4 s, idle heartbeat of one point per 60 s, about 30 detected stops per shift (pickups, dropoffs and waits).

| Item | Per row | Rows per year | Size per year |
|---|---|---|---|
| `telemetry_points` | ~70 bytes with both indexes (about 45 data, ~10 for the unique index, ~12 for the shift index) | 250 × (4.2 h × 900 + 1.8 h × 60) ≈ **975,000** | ≈ **68 MB raw** |
| Raw points held at any time (90 days) | | ≈ 240,000 | ≈ **17 MB rolling** |
| `route_archives` | ~35 KB JSON (≈ 1,200 kept vertices) | 250 | ≈ **9 MB** |
| `trips` | ~130 bytes | ≈ 250 × 35 = 8,750 | ≈ 1.1 MB |
| `stops` (+ `stop_labels`, optional) | ~110 bytes (+ ~90 bytes per label) | ≈ 7,500 | ≈ 0.8 MB (+ up to 0.7 MB if every stop is labelled) |
| `shifts` + `odometer_readings` | ~150 bytes | ≈ 250 + 500 | ≈ 0.1 MB |

- **Permanent growth ≈ 11 MB per year**, so about **55 MB after 5 years** plus the rolling 17 MB of raw points. A full 5-year database fits comfortably on any Raspberry Pi SD card, and the backups (~one file) stay small.
- **Cadence note (`14`):** the 975,000-points-per-year figure assumes a 4 s cadence. The adopted 10 s / 20 m cadence stores fewer, so these sizes are upper bounds. The sync tables are tiny: `change_log` is pruned at 30 days and `trip_overrides`/`shift_flags` hold a few rows per shift.
- **Correction to `03`:** its audit states raw points would use "10GB+ per driver per year". At the worst case of **1 point per second for 6 h × 250 shifts** (5.4 million points) the cost is about 380 MB per year, roughly 26 times less than the claim. Raw retention is therefore a privacy and tidiness decision, not a capacity emergency. This is why the archive rule keeps data in a verified, finalized state before deleting, rather than rushing to delete.

---

## 6. Migrations and Versioning

| Topic | Decision |
|---|---|
| Tool | **Drizzle Kit** generates plain SQL migration files from the TypeScript schema. They are committed to the repo and never edited after release. |
| When applied | At server start, before the HTTP listener opens, inside a transaction, under a file lock so two containers cannot migrate at once. |
| Safety net | If any migration is pending, the server first writes a verified backup into `/app/backups/pre-migration/` using the method in `10` §3.1 and §10. A failed migration rolls back and the server exits with a clear message, leaving the old file untouched. |
| Direction | **Forward only.** Rolling back means restoring a backup (see `10` §7). |
| Newer database | If the database records a migration the code does not know, the server refuses to start rather than guessing. |
| Data repair | Changes to the distance algorithm bump `calc_version`. A one-off job recomputes finalized shifts only on request, because a silent change to tax mileage is worse than a stale number. |
| API link | The OpenAPI document (next Gate 2 deliverable) is versioned separately under `/api/v1`. A schema migration never changes `v1` response shapes. |

---

## 7. Scope Decisions

### 7.1 Expenses are out of scope

Comma tracked expenses; MileWage does not.
- The vision doc (`01` §3.1) lists mileage logs, delivery tracking, and exports as in scope. Expenses appear nowhere in scope, requirements, or the export column list in `04` §2.3.
- The IRS standard mileage rate, which `04` is built around, replaces separate vehicle expenses such as fuel and repairs, so tracking them would invite double-counting.
- Anti-slop principle 2 (driver grounding) cannot be met without a clear driver problem, and receipt tracking is a different product.

If expenses are wanted later, they arrive as a new table in a new migration. Nothing here blocks that.

### 7.2 No ATO 12-week logbook table in v1

`00` and `04` mention Australia's logbook method. It needs a `logbook_periods` table. No Gate 1 decision names Australia as a launch country, so it is excluded from the first migration and added when ATO support is scheduled. `settings.country` already allows it.

### 7.3 Not stored

Customer names, phone numbers, full delivery addresses beyond the optional driver-typed `stop_labels.place`, payment details, platform credentials (`01` §3.2). `place` is optional, entered only on the web, and driver-owned because it can be customer location data. A detected stop's anchor coordinates are enough for the log.

---

## 8. Decisions

| # | Decision | Chosen | Why | Rejected |
|---|---|---|---|---|
| D1 | Coordinate storage | Integer degrees × 10⁷ | 4 bytes each, exact dedup | `REAL` (8 bytes), WKB/SpatiaLite geometry |
| D2 | Point identity | `UNIQUE(device_id, seq)` | Safe retries, no server round trip needed before upload | UUID per point (36 bytes × ~1M rows), content hash |
| D3 | Offline-created entities | Integer PK plus `client_id` UUID | Compact joins, idempotent upserts | UUID primary keys everywhere |
| D4 | Time | UTC epoch ms plus stored `local_date` | No timezone drift in reports | ISO text, local-time storage |
| D5 | Odometer | One `odometer_readings` table | Serves shift and fiscal-year readings once | Columns on `shifts` plus a separate yearly table |
| D6 | Active vs deadhead | **Estimated** from auto-detected stops (1.5b); whole-shift when the setting is off | No driver taps, works offline, total miles never depend on it | Per-order taps on the phone; `delivery_id` on every point; Comma's speed rule |
| D7 | Deduction value | Computed at read time | Rate corrections never leave stale data | Stored on `shifts` |
| D8 | Expenses | Out of scope | Not in vision; standard-rate method excludes them | Port Comma's expenses table |
| D9 | Raw point retention | 90 days default, configurable | Covers a quarter of review; negligible capacity effect | 30 days (`03`), keep forever |
| D10 | Archive format | GeoJSON LineString with times | Exports directly; no decoder | Encoded polyline, custom varint blob |
| D11 | Tax record deletion | Never automatic; warn under 7 years | Longer than every retention figure found | Auto-expire after 3, 5 or 6 years |
| D12 | Migrations | Drizzle Kit SQL, forward only, auto pre-migration backup | Simple and recoverable for non-technical hosts | Down migrations |
| D13 | Platform tag | Slug validated in code, on `stop_labels` (web, optional) | A shift can span platforms; new platforms need no migration | DB enum, `platforms` table, platform on `shifts` |
| D14 | Distance override | Not allowed on auto trips | Protects the contemporaneous-record argument | Free editing |
| D15 | ATO logbook | Deferred | No launch country requires it | Include `logbook_periods` now |
| D16 | Web sessions | Opaque cookie, hash stored in `web_sessions` | Instant revocation, no env secret (`10` §9) | Signed JWT cookie |
| D17 | Module ownership | Tables grouped by module, per-module migrations, no foreign key from a core table to an optional module's table; disabled modules' migrations still run | Toggling a module later needs no migration (README §1.3) | One flat schema; dropping tables when a module is disabled |
| D18 | Where totals are computed | One shared engine on phone and server; the server's result is stored (`14`) | The phone must show totals offline for weeks (1.5a) | Server-only totals |
| D19 | Driver edits to auto trips | `trip_overrides` keyed by `trip_key`, applied on every derivation | A recompute cannot erase an edit | Edit the derived row |
| D20 | Data-quality flags | `shift_flags` rows (code, severity, detail) | Queryable, carry detail, never alter a number | A JSON column on `shifts` |
| D21 | Stops | Derived `stops` + web-only `stop_labels`; `shifts.segmenter` fixed at shift start; one runtime setting `stops_enabled` | The toggle never rewrites existing shifts; labels survive recomputes; phone and server derive the same stops | Phone-created deliveries; a per-request toggle; deleting stops when the setting is off |
| D22 | Diagnostics store | A separate `diagnostics.db`; only two settings columns in `milewage.db` | No contention with the single write connection, small backups, never blocks startup, one-step removal (`16` D3) | Tables in `milewage.db`; backing diagnostics up |

---

## 9. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Findings and mitigations
> 1. **Does every table serve a driver outcome?** Yes (`stops`/`stop_labels` serve the estimated split and optional earnings), with one exception to watch. `pairing_tokens` and `devices` serve the QR pairing flow from `01`; `route_archives` serves audit-safe export. No table exists for analytics, charts, or "insights".
> 2. **Derived data drifting from source.** `trips` and the `shifts` totals are derived. Mitigation: `calc_version` on every computed shift, recompute by request only, and the dwell and accuracy thresholds fixed in §3 rather than configurable.
> 3. **A client claiming user_id or inventing IDs.** Mitigation: `user_id` never accepted from clients; `client_id` and `(device_id, seq)` are the only client-supplied identities and are scoped by the authenticated device.
> 4. **`idx_shifts_one_active`** prevents two simultaneously active shifts, which would double-count miles. A start call while one is active must return the existing shift (idempotent) or a conflict.
> 5. **Unverified compliance claims.** The retention and element tables rest on secondary sources (§4.1). Flagged for human verification against primary sources before Gate 4.
> 6. **Index cost.** Two indexes on the largest table is the minimum for retry-safety and per-shift reads. A third was considered for `recorded_at` alone and rejected: the live map reads the latest point of the active shift via `idx_points_shift_time`.
> 7. **Phone buffer mismatch.** `02`'s `telemetry_buffer` has `battery_level` and `delivery_id`, which this schema does not store. RESOLVED in the Gate 2 audit (`11`): `02` §3.1 now has `seq` and `shift_client_id` and no `battery_level` or `delivery_id`.
> 8. **`03` mismatches.** `03` states a 30-day downsample and a 10 GB per year growth figure. §4 and §5 supersede both. RESOLVED in the Gate 2 audit (`11`): `03` §6 no longer states either figure.
> 9. **Sync tables (14/15 reconciliation).** `change_log`, `overwrite_log` and `trip_overrides` exist only because the phone must pull web edits and keep its own edits across a recompute. `change_log` is the only table written on every change; it is pruned at 30 days and skipped entirely when `sync` is off. `instance` and `shift_flags` are core because the install id and the audit flags matter with every module off.
> 10. **Stops (1.5b).** `stops` is fully derived and could be recomputed from points, but is stored so the web can read, label and join it without running the engine per request; labels are the only driver-entered rows and are optional. The weakest claim is the quality of the estimate itself, which is why it is labelled "estimated" and measured in Spike A (`14` §12). Turning the setting off must never change a past shift: guarded by `shifts.segmenter`.
> 11. **Diagnostics (1.5c).** The cost to this schema is two columns in `settings`. Everything else is in a separate file, so the tax records, their backups and the single-writer rule are untouched. The weakest point is the soft reference from diagnostics to devices and shifts: an orphaned diagnostic row after a purge is harmless and expires by `expires_at`.
