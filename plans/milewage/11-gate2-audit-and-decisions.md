# 11 — Gate 2 Audit and Decision Dossier

**Lead Agent:** Agent 5 (Anti-Slop Auditor) with Agent 0 (Orchestrator)  
**Status:** AWAITING HUMAN REVIEW (Gate 2 is **not** approved)  
**Parent:** [`plans/milewage/README.md`](./README.md) · Covers [`07`](./07-database-schema-spec.md), [`08`](./08-api-spec.md), [`09`](./09-background-gps-decision.md), [`10`](./10-backup-restore-and-ops-spec.md)

---

## 1. One-Page Summary

Gate 2 asked for the specs to be complete enough to build from. Four documents now specify the schema (`07`), the API and offline upload contract (`08`), the Android tracking engine (`09`) and operations (`10`). They were written separately, so this audit reconciled them against each other and against the Modularity Rule (README §1.3).

- **What the system is:** a Fastify + SQLite server (two containers: Caddy and the API) holding the only copy of one driver's data, plus an Expo/React Native Android app with a small native Kotlin tracking module copied from Comma. Home lab first, reached through host Tailscale.
- **Data:** about 11 MB per year of permanent growth plus a rolling 90 days of raw GPS points (about 17 MB). Tax records are never deleted automatically.
- **Phone contract:** every create is idempotent, GPS points are identified by `(device_id, seq)`, and only points the server confirms are deleted from the phone.
- **Safety:** nightly verified, `age`-encrypted backups; a restore that cannot damage a working database; a stolen phone cannot download history or backups.
- **Modularity:** nine modules (core, devices, tracking, replay, live, stops, exporters, country packs, backup) with toggles and removal paths, three registries (exporters, country packs, backup targets), and one swappable slot (the mileage segmenter).
- **Audit result:** 26 cross-document conflicts were fixed, one speculative behaviour was cut, and two missing boundaries were added. Nothing blocks Gate 2 except the Human approvals in §5 and the verification of sources in §4.

## 2. Decisions (07–10)

### Data (`07`)
| Decision | Choice | Why |
|---|---|---|
| Coordinates | Integer degrees × 10⁷ | Compact, exact dedup |
| Point identity | `UNIQUE(device_id, seq)` | Safe retries |
| Offline-created rows | Integer PK + `client_id` UUID | Compact joins, idempotent upsert |
| Time | UTC epoch ms + stored `local_date` | No timezone drift |
| Odometer | One `odometer_readings` table | Serves shift and fiscal-year readings |
| Active vs deadhead | **Estimated** from auto-detected stops (1.5b, supersedes tapped delivery windows); web-only labels; whole-shift when the `stops_enabled` setting is off | No taps while riding; total miles never depend on it |
| Deduction value | Computed at read time | Rate fixes never leave stale data |
| Expenses | ~~Out of scope~~ **Reversed by decision 1.9 (2026-11-05): module `expenses` and the other Comma-parity modules, see [`18`](./18-comma-parity.md)** | Original reason: not in the vision; standard rate excludes them. The standard-rate overlap is handled by the per-vehicle, per-year deduction method and a double-count flag (`18` §5, §7) |
| Raw point retention | 90 days (min 7), then route archive after finalization | Covers a quarter of review; capacity effect is small |
| Tax records | Never auto-deleted; warn under 7 years | Longer than every retention figure found |
| Migrations | Drizzle Kit SQL, forward only, verified backup first, per-module folders | Simple, recoverable |
| Web sessions | Opaque cookie, hash in `web_sessions` | Instant revocation, no env secret |
| Platform tag | Slug validated in code, on optional web `stop_labels` | A shift can span platforms |
| Distance override | Not allowed on auto trips | Protects the contemporaneous record |
| ATO logbook | Deferred | No launch country needs it |

### API (`08`)
| Decision | Choice | Why |
|---|---|---|
| Wire format | JSON, gzip bodies, problem+json | Tiny payloads, shared TypeScript types |
| Device credential | Opaque `mwd_` token, SHA-256 stored | Leaked DB yields no usable credentials |
| Device scope | Write path plus 14-day read window; no exports or backups | A stolen unlocked phone cannot dump history |
| Idempotency | Natural keys, no header | Matches `07` |
| Batch failure | Per-point `rejected` list | One bad point must not block 99 good ones |
| Acknowledgement | All points not in `rejected` are stored | Safe with gaps and out-of-order retries |
| Stop labels | One web `PUT` of the full label per `stop_key`, last write wins (replaces phone delivery writes, 1.5b) | No phone order UI; no per-field merge |
| Upload cadence | 60 s, 15 s while the web map is open | Live map without constant radio wake-ups |
| Live channel | WebSocket server → web only | Single user, smallest protocol |
| Clock skew | Never rewrite; warn above 2 min | Preserves the contemporaneous record |
| Versioning | `/api/v1`, additive only, 12-month overlap for `v2` | Old phones can always upload |
| v1 exports | CSV (trip, shift), PDF, GPX, GeoJSON | Audit record, accountant, map tools |
| Restore over HTTP | Only on an empty instance | Destructive actions need shell access otherwise |
| Rate limits | Per account/device first, per IP second | Correct behind `tailscale serve` |
| Module system | Registered at start, restart to toggle, graph check, flags exposed to clients | README §1.3; no half-enabled states |

### Android tracking (`09`)
| Decision | Choice | Why |
|---|---|---|
| Engine | Copy and trim Comma's Kotlin foreground-service module; `expo-location` only for permission UI | Expo-only cannot gate the radio or restart after a kill |
| Sampling | One request (5 s / 10 m) + 150 s stillness gating; tiers and heartbeat cut | No evidence for the tiers |
| Cut from Comma | Overlay (`SYSTEM_ALERT_WINDOW`), boot receiver | Play review risk; Android 12+ restriction |
| Buffer | Native-owned DB file; JS reads and acknowledges | Avoids two writers on one file |
| Upload | JS timer in v1; native uploader only if Spike A test A7 fails | Build only what a test shows is needed |
| Auto-start | None in v1 | Android blocks background service starts |
| De-Googled phones | Deferred | Doubles the location code paths |

### Operations (`10`)
| Decision | Choice | Why |
|---|---|---|
| Backup method | SQLite online backup API, verified on write | Consistent while live |
| Encryption | `age`; private key shown once, never on server | Backups travel; location history is sensitive |
| Retention | 7 daily / 4 weekly / 12 monthly + 3 pre-migration + 2 pre-restore | Covers bad upgrades and bad restores |
| Off-site | Download button + documented Syncthing/rsync; S3 in v1.1 | No extra dependency |
| Restore | Abort before touching live data on any failed check; auto-revert on failed verification | A restore must not destroy a working DB |
| Network | Caddy on `127.0.0.1:8080`; host Tailscale terminates HTTPS | No extra container, no router changes |
| Secrets | No signing secret; scrypt; hashed tokens | Nothing for a driver to invent |
| Low disk | 507 on every write below 200 MB; reads and exports keep working | Phone keeps data; driver can still export |
| Budget | ≤ 100 MB idle, ≤ 150 MB peak | Matches `03` §1 |
| Basemap (new, `05` §3.2) | Self-hosted PMTiles file, optional | No tile traffic leaves the server |

## 3. What the Audit Changed

**Cross-document fixes applied (all 26 in `08` §14):**
- `02`: new buffer schema (`seq`, `shift_client_id`, e7 integers, quarantine table); sampling replaced by `09`'s single request plus stillness gating; local compaction removed; auto-start moved to v1.1; delivery count and tracker made module-aware.
- `03`: rewritten sections 3–6. No `JWT_SECRET`, pinned image tag, loopback port only, `*.db.gz.age`, no 30-day or 10 GB claims, routes replaced by a pointer to `08`, Caddy's role reworded.
- `05`: "Net Hourly Rate" renamed "Hourly Earnings"; basemap decided (F10); new §5 mapping every screen to its module.
- `07`: tables grouped by module; `web_sessions` and `backup_runs` added; `trips.delivery_id` no longer a foreign key; segmenter fallback written down; scrypt; country validated against registered packs.
- `09`: `markRejected(seqs)` and `seq`-based acknowledgement; module-flag behaviour added.
- `10`: no session signing secret; `tiles` volume; trusted proxy setting; 507 covers every write; backup engine separated from its triggers; stale `03` conflicts marked resolved.
- `08`: CSP final (no tile origin) and a status line. No contradictions found otherwise.

**Slop cut:**
- The immediate backup on every delivery completion (`10` §13): one small row per delivery does not justify a backup each time. Shift end remains.
- The session signing secret and its rotation step (`10` §9): opaque sessions need none.

**Missing boundaries added:** the shift-end backup trigger and download button (now behind `backup.on_shift_end` and `backup.download`); screen visibility (now by module, `05` §5).

**Left in place on purpose (low cost, noted):**
- `bearing_deg` is stored per point but no export or screen uses it yet. It costs about 2 bytes per row; cut it if you prefer.
- `core` is large (auth, logbook, settings). It stays whole because no plausible deployment removes any part of it.

## 4. Unverified Claims (status after Spike S0, 2026-11-03)

S0 (`spikes/S0-results.md`) used WebSearch only, so "Confirmed" means a primary-domain excerpt supported the claim, not that the full page was read. A short human skim of IRS Pub. 463, the CRA motor vehicle page and sqlite.org `wal.html` is still recommended before Gate 4.

| Claim | Where | Status after S0 | Remaining check |
|---|---|---|---|
| IRS record elements and retention | `07` §4.1, `04` §1 | **Confirmed** on IRS Pub. 463 excerpts (3 years; no odometer requirement, `04` corrected) | Human skim of Pub. 463 |
| CRA record elements and retention | `07` §4.1 | **Confirmed** on canada.ca excerpts (6 years; odometer at start and end of fiscal period; no prescribed format) | Human skim of the motor vehicle page |
| HMRC record elements | `07` §4.1 | Retention (5 years) **confirmed** on GOV.UK. **Field list could not be verified**; no primary page lists it | Open |
| Per-country PDF log layouts | `08` §11, `04` | **Changed**: no authority prescribes a layout, so "compliant" wording removed | Closed |
| QuickBooks / TurboTax import formats | `04` | **Could not verify**; presets removed from the spec, generic CSV only | Deferred past v1 |
| SQLite WAL-reset bug and fixed versions | `10` §3.3 | **Confirmed** on sqlite.org (fixed in 3.51.3, 3.50.7, 3.44.6) | B12 records the bundled version |
| `better-sqlite3` `db.backup()` under writes | `10` §3.1 | **Changed**: only starvation-free with a single writing connection | Spike B tests B5, B5b (`12` B15) |
| Tailscale `serve` pattern and HTTPS enablement | `10` §8 | **Confirmed**; public-ledger naming warning added. Loopback / `X-Forwarded-For` detail **unverified** | Spike D |
| `age-encryption` npm package | `10` §4 | **Confirmed** name; pre-1.0 and ESM-only, version pinned | Spike B test B14 (cross-tool decrypt) |
| Android 15: no timeout for `location` foreground services | `09` E7 | Docs scope the timeout to two other types; absence for `location` is an inference | Spike A test A4 |
| No Bluetooth-receiver exemption for starting a foreground service | `09` E8 | **Confirmed**; new constraint added: Android 14+ needs `ACCESS_BACKGROUND_LOCATION` to start or restart a location FGS from the background | Spike A tests A10, A12 |
| Samsung One UI 6 foreground-service claim; iOS facts | `09` E11, E12 | Pending hardware | Real device (Spike A); iOS has its own later spike |
| Play policy on `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | `09` §5.3 | **Confirmed** policy substance; permission removed from the copied manifest. The exact policy page was not opened individually | Re-read before Play submission |
| Failure behaviour without Play services | `09` §5.7 | Dependency **confirmed**; behaviour **undocumented and not tested** | Not testable on the owner's Samsung (`12` §16) |
| Pi SD-card wear guidance; stack RAM budgets | `10` §12, §14 | Pending. RAM budgets: Spike B tests B1, B7 in the 1 vCPU / 1 GB VM. SD-card wear: deferred, no Pi (`12` §16) | Spike B |
| PMTiles regional extract size and setup effort | `05` §3.2 | Pending | Spike E |
| Comma's Kotlin module works as copied | `09` §9 | Pending; it was read, not run | Spike A |
| HMRC per-mile rates assumed for the UK | country pack data | **Unverified** (S0 saw a figure that may differ); out of S0 scope | Country-pack data check before UK support ships |
| Untested hardware risk: Pixel and Xiaomi tracking, ARM64 / Raspberry Pi image, SD-card wear, VPS and public-domain TLS | `09` §7, `10` §12 | Deferred, no hardware (`12` §16); not verified | Later |

## 5. Decisions That Need the Human

1. **Approve `09`'s approach:** copy and trim Comma's native module as the Android tracking engine, with the overlay, boot receiver and four-tier sampling table cut.
2. **De-Googled phones in v1?** Self-hosters may skew toward GrapheneOS and similar. Supporting them means a second location code path (`09` §5.7). Default if you say nothing: unsupported with a clear message.
3. **Spike A devices:** the owner has a Samsung only. Pixel and Xiaomi/Redmi runs are deferred (`12` §16).
4. **Basemap setup cost:** the self-hosted map needs the driver to download a regional extract once (`05` §3.2). Confirm that, or accept a map with no background.

---

## 6. Changes from S0 (2026-11-03)

Spike S0 (`spikes/S0-results.md`) found no claim that changes a Gate 1 or Gate 2 decision. Twelve spec edits were applied; none alters a decision.

| Sev | Doc | Change |
|:---:|---|---|
| High | `10` §3.1, §15 | Single-writing-connection rule for `db.backup()`; new test B5b (`12` B15) |
| High | `09` E8, §5.1 item 6, §5.5, §7 | Android 14+ cannot start or restart a location foreground service from the background without `ACCESS_BACKGROUND_LOCATION`; onboarding requirement and warning; new test A12 (also in `12`) |
| High | `10` §8 | Tailscale HTTPS public-ledger warning, non-sensitive machine name, full MagicDNS name; loopback detail marked unverified (Spike D) |
| Med | `04` §1, §4 | IRS Pub. 463 does not require odometer readings; wording corrected |
| Med | `04` §1, `08` §11 and audit note | "Compliant layout" claims removed; no authority prescribes a layout |
| Med | `10` §4, `03` §2, `12` B14 | `age-encryption` pinned, pre-1.0 and ESM-only; cross-tool decrypt test |
| Med | `04` §2.3, §4 | Named QuickBooks / TurboTax presets removed; generic CSV only |
| Low | `07` §4.1 | HMRC field list no longer implied; IRS 3 years cited from the IRS; CRA base-year / 3-month sample note |
| Low | `10` §3.3 | WAL-reset bug cited to sqlite.org with its trigger; single writer makes the startup check defence in depth |
| Low | `09` E7 | Reworded to "docs scope the timeout to `dataSync` and `mediaProcessing`" |
| Low | `09` §5.2, §5.3 | Play sources cited; `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` added to the cut list |
| Low | `09` §5.7 | Detect missing Play services with the availability check at first launch; marked not tested |

Not applied: nothing from the S0 table was skipped. The anti-slop audit over these edits was run as part of the 14/15 reconciliation (§7).

---

## 7. Changes from 14/15 (2026-11-04, decision 1.5a)

Specs `14` (shared processing engine) and `15` (offline storage and sync) were written in parallel. This section records the reconciliation: contradictions between them, the cross-document fixes both listed (`14` §19, `15` §16 X1-X27), and the anti-slop audit over all of it. No sign-off status changed; the specs are still awaiting Human review.

### 7.1 Contradictions between `14` and `15`, resolved

| # | Conflict | Resolution |
|---|---|---|
| 1 | `14` called the phone's result `client_result` (with `algorithm_version`); `15` called it `phone_result` (with `calc_version`, no digest) | One object, `phone_result {calc_version, input_digest, total_m, active_m, deadhead_m, personal_m, trips_count}`, plus `manifest` and `interruptions`, sent only with `shift.end`. `14` §9.3 and `15` §6.1 now say the same; a later trip edit travels as a `trip.override`, not a second result |
| 2 | `15` compared totals with a 10 m / 0.1% tolerance; `14` guarantees exact integer equality | **Exact comparison, no tolerance** (`14` §9.4, `15` §7.2). A margin would hide `engine_disagreement`, the one bug the digest exists to find |
| 3 | `14` had `calc_mismatch` (same digest, different totals); `15` had reason codes (`points_missing`, `calc_version`, `edited_on_web`, `late_points`, `unknown`) | Both kept and joined: `recon_status` and reasons drive the UI; `engine_disagreement` is a new reason that also sets the flag `calc_mismatch`. The server picks reasons in a fixed order (`15` §7.3) |
| 4 | `15` re-attached an orphaned trip override to a segment overlapping it by 80%; `14` returns `override_orphaned` and does not guess | `14`'s rule wins: **no fuzzy re-attachment**. The change feed reports `orphaned_override` (`15` §8.3) |
| 5 | `trip_key` was "needs 14" in `15` | Defined once, `<shift client_id>:<segment start epoch ms>:<original_kind>` (`14` §6.4), stored in `trips.trip_key` (`07`) |
| 6 | `14` said event times use the phone wall clock and are "not corrected"; `15` stamps events with GNSS-corrected time | `15` §10 wins: corrected once at capture on the phone. The engine's `clock_skew` flag is kept and records that a correction was applied. The server still never rewrites a received timestamp |
| 7 | `15` UI offered "pause"; `14` has no pause in v1 | Pause removed from the offline UI (`14` §6.5) |
| 8 | `15`'s route size used the 5 m archive tolerance; `14` uses 10 m for the display route | Sizes marked upper bounds; 10 m named for the phone's route |
| 9 | `15` sized storage for ~3,900 points per shift (a 4 s cadence); `14` adopts 10 s / 20 m | Cadence note added; all sizes are upper bounds until Spike A measures them |
| 10 | The engine takes `interruptions` and `flags` but `15` had nowhere to store or send them | Phone: `interruptions_json`, `flags_json`, `input_digest` on `shifts`. Server: `interruptions_json` on `shifts` and a `shift_flags` table. Interruptions travel with `shift.end` |
| 11 | `14` §3 column names (`client_calc_version`, `client_total_m`) vs `15` X5 (`phone_total_m`, `phone_calc_version`) | `phone_*` names everywhere |
| 12 | `14` and `15` each said the other was unwritten | Real cross-references in both headers; `14` §13 and §19 now point at `15` sections |
| 13 | `15` `applied: false` in a response body vs the frozen response shapes | A response header, `X-MileWage-Applied`, with the body unchanged (the current server row) |

### 7.2 Cross-document fixes applied

| Doc | What changed |
|---|---|
| `02` | 1.5a wording; storage budgets replaced by `15` §3.3; cadence 10 s / 20 m (Comma's proven values); phantom-mile and jitter rows moved to the engine; `uploaded_at` and the eviction index; acknowledgement rule now "mark `UPLOADED`, keep 14 days, never evict `PENDING`"; red sync state; batch 100 live / 500 backlog |
| `07` | `shifts` gained `updated_at`, `recon_status`, `recon_reasons`, `phone_total_m`, `phone_calc_version`, `input_digest`, `calc_mismatch`, `interruptions_json`, `device_touched_at`, `overlaps_shift_id`; `trips` gained `trip_key` (unique) and `client_id`; new §2.7 with `trip_overrides`, `shift_flags`, `change_log`, `overwrite_log`, `instance`; new module `sync`; mileage rules 2, 3, 5 rewritten (20 m gate, decimetre rounding, no-deliveries fallback); decisions D18-D20 |
| `08` | `shift.end` gains `manifest`, `phone_result`, `interruptions`, response `recon`; new §4.4 and §6a; new routes `GET /sync/changes`, `PUT /shifts/{ref}/trips/{client_id}`, `PUT /shifts/{ref}/trip-overrides/{trip_key}`; `Shift` gains flags, recon fields, `overlaps_shift_id`; `Settings` gains `engine_version`; `Modules` gains `sync`; batch maximum 500; `X-MileWage-Instance` and `X-MileWage-Restore-Gen` headers; device read window widened; GNSS-corrected event times; `sync` and `local_export` rows in §16.2; new event `trip.updated`. The OpenAPI block still parses, every `$ref` resolves, and every one of its 50 operations in 40 paths is in `x-modules` |
| `09` | Tracker records every fix with accuracy and speed and filters nothing; API gains `evictUploaded`, `gnssOffsetMs`, `markUploaded` no longer deletes; recovery path writes an interruption record; sampling table is cadence only; backlog upload mode; new Spike A tests A13-A15 |
| `10` | Restore sets `restore_generation = max(live, restored) + 1` and keeps `instance_id`; the phone re-sends after a restore; backups already include the new tables; phone data-loss boundary updated |
| `12` | Spike A adds A10 (byte-identical Node vs Hermes), A11 (parallel ride vs Comma), A12 (engine speed); Spike C adds C8 (backlog drain) and C9 (wrong server); rig includes the engine package; time 9-11 days |
| `06`, README | README file list and principle 4 updated; `06` points to the open Human questions in §8 below |

Not applied on purpose: `POST /sync/bundle` and the `local_export` module (v1.1; the route is not in the v1 OpenAPI, only named in `08` §3 and §16.2).

### 7.3 Anti-slop audit over the 14/15 edits

Test used (README §1.3 rule 7): every boundary needs a plausible toggle or swap; every setting, route and table needs a driver problem.

**Cut**

| Item | Where | Why |
|---|---|---|
| `POST /shifts/{ref}/trips` (`createManualTrip`) | `08` | Two routes for one job. The idempotent `PUT .../trips/{client_id}` serves phone and web (the web generates a UUID). Not a frozen route, so safe to remove. OpenAPI is now 50 operations |
| `sync_wifi_only` setting and the 25 MB large-backlog prompt | `15` §6.6, §13 | A 12-week backlog is about 9 MB. A setting, a code path and a dialog for 9 MB is slop. Revisit only if Spike C8 shows the wire size is far above the estimate |
| `app_lock` module | `15` §12, §13 | No Gate 1 driver problem asks for it |
| `LOCAL_RAW_DAYS` (7-60) and `unsynced_reminder_days` as user settings | `15` §3.2, §4.4 | No settings screen needed; they are app constants (14; 3 and 7 days) |
| 80% fuzzy re-attachment of orphaned overrides | `15` §8.3 | Guessing which segment an edit belonged to is the silent change 1.5a forbids; `14`'s rule is simpler |
| Reconciliation tolerance | `15` §7.2 | Would hide the engine disagreement the check exists for |

**Kept, with the reason**

| Item | Reason |
|---|---|
| `change_log`, `overwrite_log`, `trip_overrides`, `shift_flags`, `instance` | Each answers a stated failure: the phone cannot learn web edits without a feed; an overwrite must never be silent; a recompute must not erase an edit; flags carry detail; a restored or re-pointed server must be detected. `change_log` is skipped entirely when `sync` is off |
| `restore_generation` and `X-MileWage-Instance` | One header each, and they close a silent data-loss and a silent disclosure case |
| GNSS-corrected event stamps | Removes the largest known clock weakness (delivery windows from an unchecked phone clock) at the cost of one number per fix |
| `overlaps_shift_id` | Overlapping shifts double-count miles; one nullable column and a badge |
| `local_export` (specified, deferred to v1.1) | Not built; the lost-phone risk is covered by markers, reminders and the blocked unpair |

**Missing boundaries checked:** stop handling degrades to the whole-shift segmenter when the `stops` setting is off or no stop qualifies; `tracking` off means no engine call and manual trips only; `sync` off leaves the phone upload-only with its own numbers; `local_export` off removes a route and a button. No optional capability is hard-wired into the engine, the schema's core tables or the frozen phone routes.

**Remaining candidate for Gate 4:** `PATCH /trips/{id}` duplicates `PUT /shifts/{ref}/trip-overrides/{trip_key}` for auto trips (it delegates to the same override logic). It is left in because the web client is not yet specified; remove it if the web client can use the PUT.

---

## 8. Open Questions for the Human, and Unverified Items (from `14` and `15`)

### 8.1 Decisions that genuinely need the Human

**ACCEPTED 2026-11-04: the Human accepted the defaults for items 1-3 below, as written.** Item 4 is resolved (decision 1.5b).

1. **Unsynced reminder timing** (`15` §4.4): 3 days, then daily, stronger at 7. Keep or change?
2. **Lost phone** (`15` §9.1): is "make the exposure visible, remind, and block unpair while unsynced" enough for v1, with the encrypted `local_export` in v1.1, or is the export needed first?
3. **No offline basemap in v1** (`15` §4, D22): a plain route line with no map when offline. Accept?
4. ~~Active vs deadhead depends on taps~~ **Updated 2026-11-04 (decision 1.5b): resolved by the owner.** No taps; stops are auto-detected, the split is an estimate, labelling is web-only and optional, and the whole feature is a setting. New open question: the stop-detection constants (40 m / 120 s / 180 s) are a guess until Spike A13 measures them.

Not a Human decision, but needs the owner's help: export `routePath` and totals from a few past Comma shifts, ride three measured loops in Toronto, and do one parallel ride with Comma's tracker (`14` §20). These feed the engine's tests and experiments E1-E12, not a Gate 3 pass/fail. For the stop experiments (E9-E12, Spike A13) the owner also compares the detected stops with the delivery platform's own order history after at least 3 normal shifts.

### 8.2 Unverified items

| Item | Source | Checked by |
|---|---|---|
| Hermes `Math` (`sin`, `cos`, `atan2`) gives the same rounded result as Node | `14` §18 item 3, §9 | Spike A10: byte-identical fixtures on the S24 Ultra |
| Activity Transition (GPS-off gating) fires reliably on a scooter with a vibrating mount; a false STILL would create gaps | `14` §12 E7 | Spike A (A4/A5) and experiment E7 |
| `processShift` on 5,000 fixes runs in under 200 ms on the S24 Ultra | `14` §10.3 | Spike A12 |
| Hermes `Intl`: not needed by the engine | `14` §18 item 8 | Confirmed by the engine's "no Intl" rule |
| Whether orphaned overrides really are rare | `15` §15 item 3 | Observed in Spike A rides |
| Storage and wire sizes: 0.3 MB and 0.1-0.15 MB per shift, 12 MB steady state | `15` §3.1, §15 item 5 | Spike C8, Spike B |
| `expo-sqlite` behaviour under `SQLITE_FULL` (loud stop, no silent loss) | `15` §3.4, §15 item 6 | Test obligation in `15` §15 |
| `allowBackup="false"` and data-extraction rules on One UI 6.1+ | `15` §12, §15 item 6 | A manual check on the S24 Ultra |
| Whether 10 s / 20 m or a denser cadence is more accurate on Toronto grid streets (corner-cutting bias) | `14` §12 E1 | Experiment E1 over recorded loops |
| `better-sqlite3` on Node 24 (the `coder` machine) | Spike B findings | Not tested; the server is built and run on Node 22.22+ |
| Stop detection works while GPS sleeps (wake-up rule), and the constants (40 m radius, 120 s min dwell, 180 s flip, 30 min break) are right for Toronto scooter delivery | `14` §6.2, E9-E12 | Spike A13 against the platform's order history |
| The alternation model (pickup, dropoff, pickup...) gives an active distance within 15% for one-order-at-a-time riding; stacked orders under-state it | `14` §6.3-6.4, E10 | Spike A13, stacked orders measured separately |
| Queue creep and double-parked hand-overs are the main false-stop sources | `14` §6.4 | Spike A13 false-stop count |
| Diagnostics items U1 to U10 (exit-reason API on One UI 6.1, standby bucket without a permission, One UI version, no-wakeup battery read, capture cadence emulation, second-file backup independence, event-loop monitor cost, size estimates, anonymization accuracy, coordinate-guard false positives) | `16` §14 | Spike A (A4, A6, A15), Spike B (B16, B17), unit tests |

---

## 9. Changes from 1.5b (2026-11-04, no phone delivery taps)

**Decision (owner):** riders do not tap Accepted / Picked up / Dropped off per order. The phone has start/end shift only. Stops are auto-detected, the active/deadhead split is estimated, labelling is optional and web-only, and the whole feature is the setting `stops_enabled` (default on). Recorded as item 1.5b in `06`.

### 9.1 What changed

| Doc | Change |
|---|---|
| `14` | §6 rewritten: stop detection (stage 5: radius 40 m, min dwell 120 s, wake-up, merge and start-guard rules), the stop-based estimate state machine (flip at 180 s to under 30 min), confidence levels, edge cases (lights, queues, stacked orders, breaks), labels, label orphans. New flags `no_stops_detected`, `long_stop`, `label_orphaned`; the interface, digest, fixtures and modularity table updated; experiments E9-E12 with a ground-truth protocol and pass bars |
| `07` | `deliveries` table and `trips.delivery_id` removed; `stops` (derived) and `stop_labels` (web-only, optional payout/platform/place/notes) added; `settings.stops_enabled`; `shifts.segmenter` captured at shift start; mileage rules 4-6 and 9 rewritten; module `stops` replaces `deliveries`; sizes, retention and decisions updated |
| `08` | Routes `/deliveries*` removed; added `GET /shifts/{ref}/stops` and `PUT`/`DELETE /shifts/{ref}/stop-labels/{stop_key}`; `stops_enabled` in `Settings`; `segmenter` in `ShiftStart`, `Shift` and `PhoneResult`; WebSocket `delivery` replaced by `stops`; `delivery_id` removed from `Trip`; `deliveries` module replaced by `stops` (one runtime toggle, depends on `tracking`). OpenAPI re-verified: **49 operations in 39 paths** (was 50 in 40: minus 4 delivery operations, plus 3 stop operations), every operation mapped to a module, every `$ref` resolves |
| `15` | Local `deliveries` table and the `delivery.put` outbox kind removed; read-only `stops` table, `shifts.segmenter` and `settings_cache.stops_enabled` added; offline UI has no order buttons; sync ordering and coalescing re-checked (shift.create, points, shift.end; only `odometer.put` and `trip.override` coalesce); the phone never re-runs the engine on a server-confirmed shift |
| `02`, `09`, `05` | Phone UI: no order buttons, counts or end-of-shift review; web UI: stop table, labelling dropdowns, "estimated" markers, a settings switch |
| `04`, `01`, `00`, `03`, `10`, README, `12` | Wording: deliveries become labelled stops; exports mark estimates and sum payouts from labels only; backup counts use `stop_labels`; Spike A gains A13 (stop-detection accuracy) and A14 (toggle) |

### 9.2 Anti-slop audit of this change

- **Smaller on the path that matters:** the phone lost three buttons, a table, an outbox kind and three API routes. The API grew by two web-only routes.
- **Missing boundary check:** the feature is one module (`stops`), one setting and one engine stage, and degrades to the whole-shift segmenter. The only runtime toggle in the system is justified because a driver, not an operator, decides it. `stops` depends on `tracking`, which the startup check enforces.
- **Pointless-boundary check:** no `StopClassifier` interface or plugin; the estimate is a 20-line state machine inside the engine. A place-matching or notification-reading integration is named and refused for v1.
- **Honest weak spots:** the estimate rests on an alternation assumption and three guessed constants; stacked orders, queue creep and a first stop that is a drop-off are known wrong cases (`14` §6.4). Mitigation: it is always labelled "estimated", total miles never depend on it, and Spike A13 measures it with a free fallback (setting off).
- **A new orphan source:** web labelling can move trip boundaries and orphan trip overrides; the web warns and the shift reports `override_orphaned` (`14` §6.7).

---

## 10. Changes from 1.5c (2026-11-04, built-in diagnostics, owner's own server only)

**Decision (owner):** diagnostics for testing, debugging and further improving are built into the phone app, the server and the web app from the start, and are collected only to the driver's own server. Recorded as item 1.5c in `06`; specified in `16`.

### 10.1 What changed

| Doc | Change |
|---|---|
| `16` | New: event catalogue (27 kinds, each tied to a named question), the never-collected list and the allowlist enforcement with canary tests, levels (`off` / `basic` / `verbose`), phone rings and cost budgets, the separate `diagnostics.db`, the `capture` module (dense fixes, annotations, anonymized replay), Health checks, debug bundle, spike mapping, modularity, decisions, audit, unverified items |
| `07` | `settings.diagnostics_level` and `diagnostics_verbose_until`; §1 notes the second file; §1.1 modules `diagnostics` and `capture`; new §2.9; decision D22; audit item 11 |
| `08` | 12 operations in 8 new paths (**61 operations in 47 paths**, was 49 in 39); modules `diagnostics` and `capture`; `Modules`, `Settings`, `SettingsPatch`, `SystemStatus` additions; scope, size and rate-limit rows; `DiagnosticsPort` seam; decision A26 |
| `09` | §5.9 diagnostics hooks and capture mode; module API additions; Spike A criterion A15 |
| `10` | `diagnostics.db` in the volume layout; excluded from backup and restore; low-disk behaviour; RSS note; tests B16 and B17; decision 11 and audit item 7 |
| `12` | Spike A: minimal event set in the rig (+0.5 day), A15; Spike B: B16 and B17 |
| `15` | Outbox kinds `diag.batch` and `capture.batch`; priority step 7; ring retention and budget rows; privacy row; modularity row; D24 and X28 |
| `05` | Phone Diagnostics row and capture banner; web Diagnostics screens; modularity rows |
| `01`, README, `06` | In-scope line; blueprint entry, terminology and principle 5; item 1.5c |

### 10.2 Anti-slop audit of this change

- **Missing-boundary check:** diagnostics, capture and the debug bundle toggle independently; the engine, the tracker and the logbook import nothing from them; the store is a separate file, so removal is "delete the file and the registration".
- **Pointless-boundary check:** no exporter plugin interface, no metrics store, no remote config beyond one level setting, no log shipping. Prometheus, OTLP and any hosted service are refused for v1 (`16` §11).
- **Vanity metrics cut:** per-fix and per-request events, taps, screen views, session lengths, network type, IPs, web timings.
- **Gate 3 impact is small:** seven event kinds in the A-rig, one stub ingest route in the B-rig, A15, B16, B17 (about +0.5 day). Everything else is product work.
- **Weak spots, stated:** the health-score weights and thresholds are guesses until the spikes run; the exit-reason API on One UI 6.1 is unverified; capture cadence emulation is unverified; all sizes are estimates.

### 10.3 Defaults for the Human to confirm (change them before Gate 4 if wrong)

**ACCEPTED 2026-11-04: the Human accepted items 1-4 below as written** (decision 1.5c). Spike A15 can still flip the default level to `off` if the cost budget fails.

1. **Default level `basic`** (rather than `off`). It stays within the cost budgets, or A15 flips the default to `off`.
2. **Retention:** basic 90 days, verbose 14 days, crashes 365 days, rollups 2 years, capture 30 days after the session ends.
3. **Capture module off by default**, replay `anonymized` by default.
4. **`diagnostics.db` is not backed up**: diagnostics history is lost on a restore. The debug bundle and capture replays are how the owner keeps anything.

