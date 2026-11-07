# 20 — Road Snapping (Map Matching)

**Lead Agent:** Agent 2 (Self-Hosted Docker & Backend Architect) with Agents 3 and 4
**Status:** DRAFT PLAN — decision 1.11 (owner, 2026-11-07) recorded; open questions in §10; nothing built yet
**Parent:** [`plans/milewage/README.md`](./README.md) · Amends [`08`](./08-api-spec.md) (route response, module table), [`14`](./14-phone-processing-spec.md) §5.5 (display only), [`05`](./05-design-system-and-ui-plan.md) §3.2

**Decision 1.11 (b):** routes are snapped to roads with **Valhalla**: the public FOSSGIS server now, a self-hosted Valhalla later. Both speak the same API, so "later" means changing one address.

---

## 1. What It Is For, and What It Never Touches

| Does | Never does |
|---|---|
| Draws a finished shift's route **on the roads** in the web app, instead of straight lines between GPS fixes | Change any distance, total, trip, stop, deduction or export. Mileage stays the track engine's figure (`14`), the same on phone and server |
| Runs **on the server**, once per finished shift | Run on the phone. No extra phone data, no phone battery |
| Falls back to the recorded line whenever snapping is missing, failed or looks wrong | Block or delay anything else: totals, sync and exports never wait for it |

Why display only: the shared engine guarantees the phone and server compute the **same** totals from the same points (`14`). A third-party result that can change, fail or detour cannot be part of that. A test on 2026-11-07 showed the risk: five points 1.2 km apart came back as a **1.9 km** snapped route, because the points sat between streets and the matcher detoured.

**What Comma did:** `utils/mapMatching.ts` describes OSRM snapping but only runs Douglas-Peucker simplification, and nothing calls it. MileWage already simplifies for display (`track-engine/src/route.ts`), and filters bad fixes before any distance is counted (accuracy over 50 m, impossible speeds, under-20 m jitter, gap flags). This plan adds the real snapping Comma never had.

---

## 2. The Public Server (FOSSGIS Valhalla)

Checked on 2026-11-07:

- `POST https://valhalla1.openstreetmap.de/trace_route` answered a test request: "Found route between points".
- The valhalla/valhalla README says the demo server follows the "usual fair-usage policy as OSRM & Nominatim demo servers (somewhat enforced by rate limits)". Apps shipped to end users should "let us know via Github Discussions and … include an identifying `X-Client-Id` request header".
- Rate limits stated by a maintainer (2021): **1 call per user per second**, 100 per second in total, with bursts of 10. Limits are "a lot stricter now" (2026), with no new numbers.
- A maintainer (2021): "it won't be usable for any production service for third parties".
- **No written statement** on logging or privacy of request data. The FOSSGIS terms page could not be read by a script (bot check).

What this means for MileWage:

1. At most **one request every 2 seconds** per server, and only for finished shifts. A day of driving is a handful of requests.
2. Every request carries `X-Client-Id: milewage` and `User-Agent: MileWage/<version>`.
3. The owner posts in the valhalla GitHub Discussions before a public release (§9).
4. **Privacy:** the route of every snapped shift goes to FOSSGIS servers in Germany. This is the first time MileWage sends driver coordinates off the driver's server. It needs a visible switch and plain words (§5).
5. Self-hosted Valhalla (§7) is the long-term path. Until then the public server is a courtesy that can rate-limit or block, so every failure must degrade to the recorded line.

---

## 3. How It Works

### 3.1 When

A server job, after the shift's route is final:

- **Trigger:** the shift-processing result for an `ended` or `finalized` shift (event bus, the same events the summary uses). A late batch that changes the processed points changes the **input digest**, and the shift is queued again.
- **Queue:** one worker, oldest first, **one request in flight**, at least 2 s between requests. The queue is in the database, so a restart resumes it.
- **Backfill:** never automatic. Turning the module on snaps **new** shifts only. A **Snap past shifts** button on the web (§5) queues the last 90 days, so the public server is not flooded.

### 3.2 What is sent

- The **display-simplified** route (`simplifyRoute`, 10 m tolerance), not raw fixes. That is fewer points and enough for drawing.
- Per point: `lat`, `lon`, `time` (epoch s) and the fix's `accuracy_m` as `radius`, which helps the matcher.
- `shape_match: "map_snap"`, `costing` from the shift's vehicle type:

| Vehicle `kind` | Valhalla `costing` |
|---|---|
| car, van | `auto` |
| motorcycle | `motorcycle` |
| scooter | `motor_scooter` (owner check, §10 Q3: a kick-scooter would be `bicycle`) |
| bicycle, ebike | `bicycle` |
| walking | `pedestrian` |
| no vehicle | `auto` |

- **Chunks:** routes are split into pieces of at most **50 km or 1,000 points**, overlapping by 2 points, then joined. That stays well under Valhalla's default trace limits (200 km, 16,000 points), which the public server may lower.

### 3.3 Checks before a result is kept (the "stable" part)

| Check | If it fails |
|---|---|
| Valhalla answered 200 with a `trip` for every chunk | Status `failed`, retried later (§3.4) |
| Snapped length is within **±15 %** of the engine's distance for the shift (stops and personal parts included) | Status `rejected`, the recorded line is kept. This catches detours like the 1.9 km case |
| No chunk joined with a jump over **200 m** | Status `rejected` |

Thresholds are "(new)" and can be tuned with the owner's real shifts.

### 3.4 Failures and retries

`429`, `5xx`, timeout or no network: retry after 1 min, 10 min, 1 h and 6 h, then status `failed` with no further automatic tries. Four `429`s in a row pause the whole queue for 1 h, because the server is asking MileWage to slow down. `4xx` other than `429` (bad input) means `failed` straight away. None of this is an error for the driver: the shift just shows the recorded line.

---

## 4. Data and API

### 4.1 Table (migration in the module's own folder, `07` §1 conventions)

```sql
CREATE TABLE route_matches (
  shift_id     INTEGER PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  input_digest TEXT    NOT NULL,           -- digest of the simplified route sent
  status       TEXT    NOT NULL CHECK (status IN ('queued','done','rejected','failed')),
  provider     TEXT    NOT NULL,           -- host name, e.g. 'valhalla1.openstreetmap.de'
  costing      TEXT    NOT NULL,
  shape        TEXT,                       -- polyline6 of the snapped line when status = 'done'
  length_m     INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_try_at  INTEGER,                    -- epoch ms
  detail       TEXT,                       -- short machine reason: 'length_off_by_23pct', 'http_429'
  updated_at   INTEGER NOT NULL
);
```

- It is not counted, exported or synced to the phone. Backups include it. Restoring an old backup without it simply re-queues nothing until the button is pressed.
- When the 90-day route archive (M6.6) drops raw points, the snapped shape stays, because it is already simplified.

### 4.2 API

`GET /shifts/{ref}/route` (module `replay`) gains one optional member:

```json
"snapped": { "status": "done", "shape": "<polyline6>", "provider": "valhalla1.openstreetmap.de" }
```

When it is absent the module is off or the shift was never queued. `status` can be `queued`, `rejected` or `failed`, with `shape` only when `done`.

`POST /route-matches/backfill` (web session, module `map_match`) queues finished shifts of the last 90 days that have no match, and returns `{ queued: n }`.

---

## 5. Web

- **Shift page map:** draws the snapped line when it exists. The replay scrubber and the speed and time readouts still use the recorded points, because those carry the times. A small switch, **On roads / As recorded**, appears only when a snapped line exists.
- Under the map, one muted line when relevant: "Snapping to roads…" (queued), or "Shown as recorded: the road match did not fit this route" (rejected or failed).
- **Settings → Maps** (new section, visible when the module is on):
  - **Snap routes to roads** switch, with the text: "Finished routes are sent to the Valhalla server at valhalla1.openstreetmap.de (run by FOSSGIS, Germany) to draw them on the roads. Distances are not changed."
  - **Snap past shifts** button (§3.1).
  - The provider address is shown, read-only. It is changed in the server configuration (§6).

---

## 6. Module and Configuration (README §1.3)

| | |
|---|---|
| Module | `map_match`, depends on `replay` (it decorates the route response) and `tracking` |
| Toggle | `modules.map_match` (restart-time, like other modules); default in §10 Q1 |
| Driver switch | `settings.map_match_enabled` (runtime): the Settings switch of §5. Off means no new requests; stored shapes stay until the module is removed |
| Provider | `MILEWAGE_MAP_MATCH_URL`, default `https://valhalla1.openstreetmap.de`. Any Valhalla speaks the same `/trace_route` |
| Interface | `MapMatcher.match(points, costing) → { shape, lengthM }` with one implementation, `ValhallaMatcher`. No provider registry: OSRM or GraphHopper would be a second implementation if ever needed, not a plugin system |
| Removal | Module off: no routes, no job, no `snapped` member. The table stays (`18` §1 rule) |
| CSP | Nothing for the browser: requests go from the server, not the page |

---

## 7. Later: Self-hosted Valhalla

- A compose profile `valhalla` (`docker compose --profile valhalla up -d`) with a pinned Valhalla image, a `valhalla_tiles` volume and the driver's region extract from Geofabrik (for example `ontario-latest.osm.pbf`, several hundred MB).
- Building the tiles is a one-time step: minutes to an hour, a few GB of RAM and disk. **Not for a 1 GB Raspberry Pi.** It fits a home server or mini PC. Exact figures are to be measured on the owner's Proxmox VM.
- `MILEWAGE_MAP_MATCH_URL=http://valhalla:8002`. Nothing else changes, and no coordinates leave the house again.
- Monthly tile rebuild: a documented command, not automatic.

---

## 8. Tests

| Where | Test |
|---|---|
| Server, unit | Costing per vehicle kind; chunking (50 km / 1,000 points, 2-point overlap) and joining; the ±15 % and 200 m checks; polyline6 encoding and decoding; digest change re-queues |
| Server, job | Fake Valhalla: one request in flight, 2 s spacing, retries 1 min to 6 h, a run of `429`s pauses the queue for 1 h, a restart resumes the queue, module off makes zero requests, driver switch off makes zero requests |
| Server, API | `snapped` present, absent and in each status; backfill queues 90 days only and skips shifts already done |
| Web | Snapped line drawn and the switch shown only when `done`; muted line for queued, rejected and failed; Settings text and switch; the backfill button |
| Contract | OpenAPI `Route.snapped`, the backfill operation, `modules.map_match`, `settings.map_match_enabled` |
| Owner | A week of real shifts: how many are `done` and how many `rejected`, and how the snapped length compares to the engine's |

---

## 9. Build Order (PRs)

| ID | Title | Track | LOC | Dep |
|---|---|---|---|---|
| MM1 | Module skeleton, migration, repository, settings flag, OpenAPI additions | server | 200 | — |
| MM2 | `ValhallaMatcher`: request building, chunking, joining, checks, headers | server | 250 | MM1 |
| MM3 | Queue job: triggers, spacing, retries, pause on `429`, backfill route; `snapped` in the route response | server | 300 | MM2 |
| MM4 | Web: snapped line, On roads / As recorded, status line, Settings → Maps | web | 250 | MM3 |
| MM5 | Owner week of real shifts; tune the ±15 % threshold | owner | — | MM4 |
| MM6 (later) | Self-hosted Valhalla compose profile and install guide section | infra | 150 | MM3 |

**Owner step before a public release:** post in github.com/valhalla/valhalla Discussions that MileWage uses the demo server, with the `X-Client-Id` value. The plan's limits (one request in flight, 2 s spacing, finished shifts only, no automatic backfill) are what that post would promise.

---

## 10. Open Questions for the Owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Default for **new installs** once shipped: snapping on or off? | **Off**, with the Settings switch. It sends every route to a third party, and if every install sends by default the volunteer server is more likely to block MileWage. You switch it on for yourself |
| Q2 | ±15 % length check: keep, or show any snapped result? | **Keep.** A wrong road drawn confidently is worse than a slightly jagged true line |
| Q3 | Your scooter: motor scooter or moped (`motor_scooter`), or kick or e-scooter (`bicycle`)? | Your answer sets the costing for `scooter` |
| Q4 | Should snapped lines ever appear in exports (GPX, GeoJSON)? | **No**, exports stay the recorded truth |
