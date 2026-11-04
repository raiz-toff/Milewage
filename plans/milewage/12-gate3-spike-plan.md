# 12 — Gate 3 Spike Plan (Prototype Characterization) — SLIM REVISION

**Lead Agent:** Agent 0 (Orchestrator) with Agent 5 (Anti-Slop Auditor)  
**Status:** REVISED 2026-11-04, **awaiting re-approval** by the Human. The earlier seven-spike plan approved 2026-11-03 is superseded by this one (§16 lists the differences). Nothing here has been run except S0.  
**Parent:** [`README.md`](./README.md) · **Governance:** [`06`](./06-human-in-the-loop-review-gates.md) §4  
**Inputs:** `07` (schema), `08` (API), `09` (Spike A criteria), `10` (Spike B tests B1–B12), `11` §4 (claims), [`infra-requirements.md`](./infra-requirements.md) (real hardware), [`spikes/S0-results.md`](./spikes/S0-results.md), `milewage-spikes/B/README.md` (Spike B rig and findings), README §1.3 (Modularity Rule)

---

## 1. Purpose and Rules

Gate 2 froze the specs on assumptions that nobody has measured. A spike answers **one question** with a **number**, and names the plan change a failure triggers. A spike is not the first slice of the product.

**Why this plan is slimmer.** The owner's Comma tracking module already works for them in real delivery riding. So the phone side is **not** re-proven from scratch. Only what *changed* is checked:

| Changed from Comma's module | Checked by |
|---|---|
| Floating overlay and boot receiver removed | A (service still starts, survives, restarts) |
| Sampling simplified to one request (5 s / 10 m, 150 s stillness gating) | A (gaps, battery, distance) |
| Uploads from JS to a self-hosted server, with `seq` and a rejected-point quarantine | A + C-lite (no loss, no duplicates) |
| Reached through Tailscale or WireGuard | D |
| The server itself (new, Comma had none) | B |

Rules:

1. **Throwaway code, separate place.** Spike code lives in `milewage-spikes/` outside the product repo and is deleted or archived when Gate 3 closes. Nothing is copied into the product without being rewritten under Gate 4's rules (400-line PRs, tests).
2. **Authorization.** Approving this plan authorizes **throwaway spike code only** (Decision H1). Product code waits for Gate 4.
3. **Modularity is tested, not assumed.** Spikes never fold an optional capability into core. A11 and B13 test the module toggles from `08` §16.
4. **Real conditions.** Release builds, the physical phone, normal delivery riding, screen off in the mount. Emulator or dev-client numbers do not count.
5. **A failed spike is a result.** Each failure names the doc to change; the change is made and re-audited before Gate 3 closes.
6. **Thresholds.** Inherited ones come from `09` §7 and `10` §15. New ones are marked **(new)** and are the Human's to change before the run, not after.

### 1.1 Hardware reality (from `infra-requirements.md`)

| Item | What the owner has | Effect on the spikes |
|---|---|---|
| Phone | **Samsung Galaxy S24 Ultra**, One UI 6.1+, Android 14, 1 TB, Quad Lock mount, active mobile data | Spike A runs here only. Samsung is a hard background-kill case, so a pass is a strong, but **Samsung-only**, result. A broken S23 Ultra is unusable. |
| Vehicle | **Yamaha BWs 125 scooter** in Toronto; no car; phone on the handlebar; Sena Outrush 2 Bluetooth helmet | No car, no highway, no 50 km test route. Spike A is **normal delivery riding** at scooter speeds with frequent stops, rain, heat and vibration. Odometer check uses the scooter's odometer. |
| Server host | **Proxmox**, Core Ultra 7 265F, 64 GB RAM, NVMe pools, bridged LAN | A capped Debian VM (1 vCPU / 1 GB, no-cache disk) is the small-host stand-in. Snapshots before destructive tests; `qm stop` for the power-pull test. |
| Android build machine | **`coder` VM**: JDK 17, Android SDK, **Node 24**, 16 GB RAM, 142 GB disk, **no USB passthrough** | Build the release APK on `coder`, then install by transferring the APK or by `adb connect <phone-ip>:5555` over Wi-Fi. |
| Network path | Homelab runs **WireGuard** (`<wireguard-name>`, router at <router>) and an internal Root CA behind Nginx Proxy Manager. **No Tailscale account yet.** | Spike D must choose a path (see §4). |

Not testable with this hardware and therefore **untested risk** (§14): Pixel and Xiaomi behaviour, iOS, Raspberry Pi/ARM64, SD-card wear, VPS and public-domain TLS.

---

## 2. Spike List, Order and Time

| ID | Spike | Question | Status |
|:--:|---|---|---|
| **S0** | Desk verification | Are the unverified claims in `11` §4 true? | **DONE.** See [`spikes/S0-results.md`](./spikes/S0-results.md); its 12 spec edits are applied (`11` §6). Claims 10, 12, 13, 14 stay *Pending spike*. |
| **B** | Server footprint and durability | Does the stack fit the budget, sustain telemetry, and survive backup, crash, power pull and restore? | Rig built in `milewage-spikes/B/`. Needs the VM. |
| **D** | Reachability (~15 min) | Can the phone on mobile data reach the home server over HTTPS **without a custom CA**? | Needs a path decision (§4). |
| **A** | "Ride with it" | Does the trimmed module behave **no worse than Comma's** on normal shifts? | Needs the rig built and sideloaded. |
| **C-lite** | Offline queue | Is every buffered point stored exactly once? | **Folded into A and B** (§6). |
| **E, F** | Basemap size; year-long PDF | See §7. | **Deferred.** Optional modules; they cannot block anything. |

**Order:** B-rig VM and D can start now (no phone build needed). A-rig is built on `coder` in parallel. A needs B's ingest route up. C-lite runs on the same rigs.

```
B-rig VM ──► B tests ─────────────────────────────┐
   └──► D (15 min, path decision) ──┐             │
A-rig (build on coder) ──► Day 0 baseline ──► A ride days ──► C-lite ──► Gate 3 results
```

**Time (recomputed):**

| Work | Hands-on | Notes |
|---|:--:|---|
| B: create VM, run B1–B15, drills | 2–3 days | Test runtimes are in `milewage-spikes/B/README.md`; snapshots speed up drills |
| D | 0.5 day | Plus Tailscale account sign-in, or the WireGuard variant |
| A-rig build and sideload | 4–5 days | Copy and trim Comma's module, buffer DB, JS upload worker, one screen, plus the shared engine package and the A10 fixture runner (+1 day after `14`/`15`; +0.5 day for the minimal diagnostics events, `16` §9.3) |
| A: baseline day + 3–4 ride days | ~1 day of attention | The riding is the owner's normal work; the rig only logs |
| C-lite and results writing | 1–2 days | |
| **Total** | **about 9–11 working days, about 2 calendar weeks** | Was 10–12 days and 3–4 weeks. Calendar depends on riding days and weather. |

---

## 3. S0 — Desk Verification (done)

Results: [`spikes/S0-results.md`](./spikes/S0-results.md). Its status is kept as is: confirmed items, the changed `db.backup()` behaviour, the Tailscale public-ledger naming warning and the Android 14+ restart permission rule are already written into the specs. Still unverified (`11` §4): the HMRC field list, QuickBooks/TurboTax import formats, the Tailscale loopback detail (settled by D), and behaviour without Play services. The tax-rule reading (claims 1–3) is not blocked by Gate 3 unless the Human says so (§12).

---

## 4. Spike D — Reachability, About 15 Minutes

**Question:** From the S24 Ultra on **mobile data** (Wi-Fi off), can the app reach the home server over HTTPS that Android trusts with **no custom CA**?

**Why this is a trust problem.** The homelab's `*.lan` sites use an **internal Root CA**. A user-installed CA is not trusted by apps by default on Android 7+, so the app would need a network-security-config exception and the driver would need to install the CA on their phone. That is the thing to avoid in a product for ordinary drivers. Plain HTTP inside a tunnel has a similar issue: Android blocks cleartext unless the app declares an exception.

**Options (decide, then test):**

| Option | Trust on Android | Cost / catch |
|---|---|---|
| **Tailscale** (`tailscale serve`, MagicDNS HTTPS) | Real public certificate (Let's Encrypt via `*.ts.net`). **No custom CA, no app exception.** | Needs a Tailscale account the Human authenticates; machine name goes on a public certificate log (`10` §8). Phone runs the Tailscale app. |
| **Existing WireGuard** + public-CA cert via DNS challenge on a domain the owner controls | Public cert, **no custom CA** | Needs an owned domain and DNS API access; unverified in this environment. Phone runs the WireGuard app. |
| WireGuard + internal Root CA | Needs the CA installed and an app config exception | **Rejected** for the product path. Acceptable only for the owner's private testing. |
| WireGuard + plain HTTP | Needs a cleartext exception in the app | **Rejected** for the product path. |

**Recommendation:** test **Tailscale first** (it is the path `10` §8 and decision 1.7 describe, and drivers will not own a WireGuard router). If the Human does not want a Tailscale account, test the **WireGuard + public-CA** option. Only the first option that passes needs to be proven.

**Throwaway build:** the B-rig Caddy on `127.0.0.1:8080`; either `tailscaled` in the VM with `tailscale serve --bg 8080`, or the owner's WireGuard to the VM; `GET /healthz`. No pairing, no auth.

| # | Test | PASS |
|---|---|---|
| D1 | Phone on mobile data opens `https://<name>/healthz` in the phone's browser | Valid certificate, no CA installed, HTTP 200 |
| D2 | Time from enabling HTTPS to the first success | Recorded (install-guide content) |
| D3 | After the phone has been idle/in Doze for 1 h (done passively during the day), one request | First success within 30 s of waking |
| D4 | Tunnel down | Request fails in < 10 s with a distinguishable error (drives the "buffering" state) |
| D5 | `X-Forwarded-For` trusted only from Caddy (`10` §8.1) | Checked with one curl from the VM and one direct request |
| D6 | `tailscaled` (or WireGuard) RAM in the VM | Recorded (`10` §14 leaves it uncounted) |

**On failure:** neither public-cert option passes without a custom CA → reopen decision 1.7 with the Human. D3/D4 slow → add reconnect requirements to `08` §9 and `09` §5.4.

**Results:** `spikes/D-results.md`.

---

## 5. Spike B — Server Footprint, Throughput, Backup and Crash Safety (kept)

**Question:** Does the shipped compose stack meet `10` §14 budgets and survive the failures in `10` §15?

**Rig:** built, in `milewage-spikes/B/` (Fastify + `better-sqlite3`, WAL, one write connection; Caddy 2.8.4 + API compose; 50 req/s load generator; seed tool; one runner for **B1–B15**; README with exact Proxmox VM steps and run order). Nothing in it is a result: the local smoke runs were deleted.

**Where it runs:** a Debian 12 **Proxmox VM, 1 vCPU / 1 GB RAM (ballooning off), 20 GB VirtIO SCSI, cache "No cache"**, Docker, Node ≥ 22.22, `age`, `tailscaled` if used. Snapshot `os-ready` first, then before B6–B9 and B13. B7 uses `qm stop <vmid>` from the Proxmox host. B10 needs a root loop mount (a full VM, not LXC).

**Tests:** B1–B12 as in `10` §15 (thresholds inherited), plus B13 (module flags), B14 (encrypted backup and restore, cross-checked with the Go `age` tool), B15 (second writer during backup), B16 (diagnostics under load) and B17 (diagnostics idle cost; `16` §9.2, `10` §15). B16 and B17 need the stub diagnostics ingest route (`16` §9.3). B11 (SD-card wear) is informational only and its real answer is deferred (§14).

**Findings from building the rig (must be settled by the VM run):**

| # | Finding | What the VM run decides |
|:--:|---|---|
| 1 | `better-sqlite3@13.0.3` **segfaults at load on Node 22.11 and 22.12; works on 22.22.0.** `03` §2 says only "Node.js 22 LTS" | Add a **Node ≥ 22.22 floor** to `03` §2. The rig image pins `node:22.22.0-bookworm-slim`. |
| 2 | **Node 24 (on `coder`) + `better-sqlite3` is untested.** | Do not run the server on `coder` until a check is made. The VM uses Node 22.22. |
| 3 | `better-sqlite3` is synchronous, so the backup's `integrity_check` (`10` §3.1 step 2) **blocks every write**: about 420 ms on a ~60 MB copy locally. | B5 must show a stall ≤ 1 s on the VM; the rig has `SPIKE_CHECK_IN_WORKER=1` to measure a worker-thread fix. |
| 4 | Local preview (16-core host, **not results**): API idle ~76–83 MB, Caddy ~43–45 MB, stack above the 100 MB idle line and Caddy above its 15/30 MB lines. | B1 and B3 in the 1 vCPU VM decide the RAM budget; if it fails, the **Human decides** whether to change `10` §14/`03` §1 (150 MB is a plan target). |
| 5 | Single-writer rule: with a second writing connection the backup did not finish in 40 s, ~3 s with one writer. | B15 confirms in the VM. |
| 6 | The `shifts` foreign key forces a **`vehicles` table** the spike plan did not list. | Confirm in B; no spec change unless `07` already omits the dependency. |
| 7 | **Restore runs inside the API process** in the rig; `10` §7 has the CLI close the database, which only the API process can do. | Settle in `10` §7 after B8. |
| 8 | The server is not listening during a long pre-migration backup, so the `10` §10 status message is unreachable then. | Decide after B9 whether to start listening first. |
| 9 | Encryption was listed "not built" in the old plan but B14 needs it; the rig builds streaming gzip + `age`. | Treat as in scope for B. |

**On failure** (from `10` §15): RAM over budget → lower `--max-old-space-size`, change Caddy gzip, or the Human rebases the budget; `SQLITE_BUSY` → single write connection plus batch queue; backup stalls writes → worker-thread check or smaller steps; crash/power-pull integrity failure → `synchronous=FULL` and re-measure.

**Results:** `spikes/B-results.md`.

---

## 6. Spike A — "Ride With It" (with C-lite folded in)

**Question:** Does Comma's module, trimmed per `09` §5, behave **no worse than the unmodified Comma module** on the owner's real delivery shifts?

**Throwaway build (A-rig), scope limits**
- A bare Expo release APK (SDK 56) built on `coder`, with the copied and trimmed module (`09` §5.1), its dedicated buffer DB (`seq`, `markUploaded`, `markRejected`) and the JS upload timer posting 50–100 point gzip batches to the B-rig ingest route over the D path.
- One screen: Start, Stop, point count, last upload time, server module-flag state.
- Sampling per `09` §6.
- **Diagnostics events (1.5c, `16` §9.3):** the rig emits `app.start`, `service.event`, `track.window`, `upload.window`, `shift.summary`, `engine.run` and `crash` and posts them to a stub `POST /diagnostics/events` on the B-rig that validates against the shared schema and stores them. Where `16` §9.1 names an event for a check below, the result is read from it; the owner still does only the checks.
- **Also in the rig (2026-11-04, `14`):** the shared `track-engine` package (pure TypeScript) wired to the rig's shift end, a fixture runner for A10, and the rig's "dense" recording mode (1 s, 0 m) if experiments E1-E7 of `14` §12 are to be run. The experiments themselves are **not** Gate 3 gates; they are listed in `14` and can run after the build starts.
- **Not built:** onboarding, any order or stop buttons (the phone has none, 1.5b), map, auth UI, notification action buttons, auto-start, the full offline UI and sync pull of `15` (C8 uses synthetic shifts and the upload path only).
- Installed by transferring the APK or `adb connect <phone-ip>:5555` over Wi-Fi (no USB passthrough on `coder`).

**Baseline (Day 0).** One normal shift with **Comma's existing module only** on the S24 Ultra, same mount, same kind of riding, so "no worse than Comma" has a number. Record battery %, ride time, apparent gaps. (Two trackers at once would confound battery, so they are run on different days.)

**Ride days (3–4 normal shifts, release build).** The owner rides as usual, screen off in the Quad Lock. The rig logs; the owner does only the checks below.

| # | Check | How | PASS |
|---|---|---|---|
| A1 | Battery | `adb shell dumpsys batterystats` or the % delta over the shift; note start charge, temperature, rain/sun, Tailscale/WireGuard on | **No worse than the Day 0 baseline** (within +0.5 %/h or +20 % relative **(new)**). `09`'s 3.5 %/h is recorded as a reference; if both Comma and the rig exceed it, that goes to the Human, not to the rig |
| A2 | Gaps | Server-side gap analysis of `recorded_at` | No gap > 60 s while moving, excluding logged no-fix places (underpasses, parking), and **not more gaps than Day 0** |
| A3 | Distance | Compare server distance to the scooter's odometer over ≥ 20 km of riding **(new)** | Within ±2 % (record the odometer's resolution) |
| A4 | Survival | Once: swipe the app from recents mid-shift; once: 30 min screen off in the mount | Service alive and points still arriving |
| A5 | Stillness | Parked/idle ≥ 45 min (a lunch stop) with the service running | Added distance < 0.3 km; GPS client gone after the 150 s timeout (`dumpsys location`) |
| A6 | Restart (`09` A12) | Grant "Allow all the time"; kill the process (`adb shell am kill`); repeat once with only "While using the app" | "All the time": service restarts or the shift is recoverable. "While using": behaviour recorded and the onboarding warning (`09` §5.1 item 6) shown |
| A7 | Start from the background | Notification-tap start on Android 14 (`09` §5.5) | No `ForegroundServiceStartNotAllowedException` |
| A8 | Replay a batch twice | Resend the same bytes | Server holds each point once |
| A9 | Module flag (A11 in old plan) | Flip `tracking` off in `GET /settings` | App does not start the service or upload worker |
| A10 | Engine conformance (`14` §10.1, `09` A13) | Run the committed fixture set through `processShift` under Node 22 and under Hermes on the S24 Ultra; diff the JSON | **Byte-identical.** Any difference is a stop: replace the haversine trig with a deterministic implementation and bump `algorithmVersion` |
| A11 | Parallel ride vs Comma (`14` §10.2 item 3, `09` A14) | Day 0 and one ride day record the same kind of trip; compare Comma's total with the engine's | Agree within the effect of the 50 m accuracy filter and the cadence difference, which the run quantifies |
| A12 | Engine speed (`09` A15) | Time `processShift` on 5,000 fixes on the S24 Ultra | Under 200 ms (under 50 ms on Node, measured on the VM) |
| A13 | **Stop-detection accuracy** (decision 1.5b, `14` §12 E9-E12) | Over the ride days (at least 3 shifts, at least 30 real pickup/dropoff stops), open the shift's detected stops on the web and compare each with the delivery platform's own order history (times and place names; no integration). Mark each detected stop real or false and note missed stops | Detects at least 90% of real stops; at most 1 false stop per 10 real ones **(new)**; estimated `active_m` within 15% of the ground-truth active distance on average **(new)**; the same `stop_key`s on phone and server for the same recording (E12). Fail: tune the constants once (E9, E10); if still failing, ship with the stops setting default off, which costs nothing for tax totals |
| A14 | Setting toggle | Turn `stops_enabled` off on the web, start a new shift, end it; turn it on and start another | The off shift reports one business total with no stop UI; the earlier shift is unchanged; the on shift has stops and `segmenter = stops` |
| A15 | **Diagnostics cost** (`16` §6.2) | Over the ride days at level basic read `diag.self` (`cpu_ms_per_h`, `writes_per_h`); audit that diagnostics registers no timer, alarm, job, wake lock or extra request (`dumpsys alarm`, `dumpsys jobscheduler`, code review); record battery with diagnostics off for one shift for the record, not as a gate | CPU < 0.5 s per hour and ≤ 30 writes per hour **(new)**; zero extra wakeups or requests. Fail: lengthen the window, then default diagnostics to `off` |

**C-lite (offline queue), using the same rigs**

| # | Check | PASS |
|---|---|---|
| C1 | Airplane mode 30 min mid-shift, then reconnect | Server `seq` set equals the phone's: zero lost, zero duplicate |
| C2 | Any real dead zone met on rides (underpass, underground parking, tunnel) | Same as C1; note where |
| C3 | Kill the app while a batch is in flight, restart | Zero loss, zero duplicate after the next upload |
| C4 | `kill -9` the API mid-batch (VM), phone resends | Zero loss, zero duplicate |
| C6 | Server rejects one point (HTTP 422) | Others stored; the rejected `seq` quarantined; the queue is not blocked |
| C7 | Revoke the device (401) | Uploads stop; buffered data kept; app shows a re-pair state |
| C8 | Backlog drain (`15` §6.3): create 24 shifts of synthetic points on the phone (or replay a recorded one 24 times), go offline, reconnect | All shifts, `shift.end` barriers and `recon` results arrive; zero loss, zero duplicate; record wall time (estimate: about 3-4 minutes at 500 points per batch) and bytes per shift (estimates: 0.3 MB on the phone, 0.1-0.15 MB on the wire) |
| C9 | Wrong server (`15` §9.4): point the app at a second server with a different `X-MileWage-Instance` | Nothing is sent; the red state appears |

Drain time of a full shift's buffer, phone buffer bytes per row, and clock skew are **read off the ride data when convenient**, not separate tests. Original C5, C8–C11 are dropped as gates.

**Pass:** A1–A5 and A8 pass "no worse than Comma"; A13 meets its bars or the fallback above is accepted; A14 shows the toggle never alters a past shift; A10 passes byte-identical (any difference is a stop, with the fallback in the row); A11, A12 and A15 meet their bars; A6, A7, A9 choose between designs; C1–C4 and C6–C9 show zero loss and zero duplicates. The Samsung-only result is recorded as such.

**On failure:** A1 over → raise interval/displacement, then bring back speed tiers (`09` §6); A2 gaps → separate OEM kill from fix quality with `dumpsys`/logcat; A3 → tune filters; A4/A6 → fix the restart path (**no extra native code for other OEMs**); A5 → fix stillness gating or the phantom guard; A7 fails → build the native uploader in the service; A8 or any C fail → redesign `seq` acknowledgement in `07`/`08`; A7 notification start fails → keep a manual-start flow.

**Results:** `spikes/A-results.md` (raw `dumpsys`/logcat captures stay in the spike repo).

---

## 7. Deferred Spikes E and F

Both test **optional modules**, so neither can block Gate 3 or the core build (README §1.3):

- **E (self-hosted PMTiles basemap):** unmeasured extract size. Without it, the web app draws the route on a blank canvas (`05` fallback). Revisit when the web client is built.
- **F (year-long PDF in the small VM):** unmeasured RAM. CSV, GPX and GeoJSON exports are unaffected, and `pdf` is an exporter registered only when its dependency is installed (`08` §11). Revisit before the PDF exporter is built; the headless-browser option stays rejected.

Their old test lists are not carried here; they are recorded in §14 as untested risk.

---

## 8. Where Results Are Recorded

- Each spike writes `plans/milewage/spikes/<ID>-results.md` in the §9 format. Raw captures stay in `milewage-spikes/artifacts/<ID>/`.
- Plan changes are made in the owning doc with a pointer: `Changed after Spike <ID> (<date>): …`.
- A consolidated `13-gate3-results-and-decisions.md` is written at the end and is what the Human signs against.

## 9. Results Template (per spike)

```markdown
# Spike <ID> — <name> — Results

**Run dates:** …  **Run by:** …  **Plan version:** 12 (slim) @ 2026-11-04  
**Build:** <rig commit or archive name>  **Devices / hosts:** <model, OS build, RAM, storage>  
**Conditions:** <network path, tunnel on/off, release build, weather/temperature, battery start %>

## Summary
PASS / PASS WITH CHANGES / FAIL — one sentence.

## Results table
| Test | Threshold | Measured | Result | Raw data |
|---|---|---|---|---|

## Surprises and deviations from the plan
(What differed from `<doc>` §<n>. Anything that could not be run, and why.)

## Failures and the plan change they trigger
| Failure | Doc and section changed | Change | Re-audit done |
|---|---|---|---|

## Claims from 11 §4 touched by this spike
| # | Status | Evidence |
|---|---|---|

## Modularity check
(Which toggle was exercised, and whether an optional capability leaked into core.)

## Needs the Human
(Only genuinely theirs.)
```

---

## 10. Gate 3 Sign-Off Rubric

Gate 3 closes when **all** hold:

- [ ] Results files exist for **S0 (done), B, D, A** (with C-lite inside A/B) in the §9 format.
- [ ] Every test is **PASS**, or **FAIL** with the named plan change made in the owning doc and re-audited, or an explicit Human-accepted deviation in `13`.
- [ ] Spike A shows "no worse than Comma" on A1, A2, A3, A4, A5, A8, and the Human accepts a **Samsung-only, scooter-only** result.
- [ ] Spike B's stack total is ≤ 150 MB peak in the 1 vCPU / 1 GB VM, **or** the Human formally changed the budget.
- [ ] C1–C4, C6, C7 show zero lost and zero duplicate points.
- [ ] Spike D proved a path with a public-CA certificate and no custom CA, **or** decision 1.7 was reopened with the Human.
- [ ] Remaining claims in `11` §4 have a status; claims 1–3 may stay Open only if the Human carries them into Gate 4 as blockers.
- [ ] The module-flag checks (A9, B13) passed.
- [ ] `03` §2 states the Node ≥ 22.22 floor, and Node 24 + `better-sqlite3` is recorded as tested or untested.
- [ ] Specs `02`, `03`, `05`, `07`–`10` match what the spikes showed, and the Anti-Slop auditor re-ran on the changed text.
- [ ] Every item in §14 is in `13` as untested risk.
- [ ] Spike code is deleted or archived outside the product repo, with a note.
- [ ] `13-gate3-results-and-decisions.md` exists and the Human has signed the log in `06`.

A spike that was not run counts as a failure, except E and F, which are deferred by this plan.

---

## 11. Decisions

| # | Decision | Why | Rejected |
|:--:|---|---|---|
| H1 | Approving this plan authorizes **throwaway spike code only**, outside the product repo | Resolves "zero code" policy vs a spike needing code | Spikes inside the product repo |
| 1 | Phone side is a **delta check**, judged against Comma's own module on the same phone | Comma's module is already proven for the owner | Re-proving tracking with dedicated rigs and routes |
| 2 | A = normal delivery riding on the scooter; no dedicated route, no car, no highway tests | It is what the product will actually do; a 125cc scooter cannot run highways | A 50 km test route |
| 3 | Day 0 baseline with Comma only, on a different day | Gives "no worse than" a number without confounding battery | Running two trackers at once |
| 4 | C folded into A and B as C-lite; C5 and C8–C11 not gates | Any real dead zone and a handful of scripted checks cover the loss/duplicate risk | A separate C rig and a dead-zone drive |
| 5 | B kept in full | The server is new; Comma never had one; the single copy of tax records depends on it | Skipping B because "it's just SQLite" |
| 6 | D reduced to ~15 minutes and decides Tailscale vs WireGuard on the **no-custom-CA** criterion | Android does not trust user CAs by default; a CA install is not acceptable for ordinary drivers | Using the internal Root CA |
| 7 | E and F deferred | Optional modules; cannot block the core | Running them now |
| 8 | Samsung-only, Toronto-only results are recorded as such | Honesty about scope | Claiming OEM-wide or country-wide validity |
| 9 | Results as per-spike files plus one `13` | Mirrors `11`; reviewable | One long file |

---

## 12. Anti-Slop Audit (Agent 5)

> [!CAUTION] Findings
> 1. **Risk: spikes drift into the product.** *Mitigation:* separate repo, "Not built" lists, deletion required to close the gate.
> 2. **Risk: over-testing a proven module.** *Mitigation:* A is a delta check against Comma's baseline; E, F, C5, C8–C11 and the dedicated route are cut.
> 3. **Risk: under-testing the delta.** *Mitigation:* the delta table (§1) maps every change to a test; the baseline day gives "no worse" a number; A6 (restart) and A8 (replay) test the two changes most likely to lose data.
> 4. **Risk: measuring only what flatters.** *Mitigation:* tunnel on during A1; release build; weather and temperature recorded (scooter, sun, rain).
> 5. **Risk: modularity lost.** A9 and B13 test toggles; E and F stay optional.
> 6. **Honest gaps:** one phone, one OEM, one rider, one city, one vehicle type. A passing A proves "works for this rider on this phone". Node 24 + `better-sqlite3` is untested. RAM numbers from the 16-core preview are not results.

---

## 13. What the Human Must Supply or Decide

1. **Approve this revised plan** (replaces the 2026-11-03 approval).
2. **Day 0 + 3–4 shifts** of normal riding with the right build on the S24 Ultra, and the scooter's odometer readings for A3.
3. **Ground truth for A13 (1.5b):** after each ride day, compare the shift's detected stops on the web with the delivery platform's own order history (read by you; no integration, no scraping), and mark each stop real or false. About 20 minutes per shift.
4. **A path decision for D:** authenticate a Tailscale account (HTTPS certificates enabled; pick a non-sensitive machine name), **or** supply a domain with DNS access for the WireGuard + public-CA variant.
5. **The `milewage-spike` VM** (infra agent): 1 vCPU / 1 GB, Debian 12, no-cache disk, snapshot `os-ready`, `qm stop` verified.
6. **Thresholds marked "(new)":** A1 tolerance (+0.5 %/h or +20 %), A3 ≥ 20 km, the A13 stop-detection bars (90% recall, 1 false stop per 10, 15% estimate error), others in B13–B15. Change them before the run or accept them.
7. **Claims 1–3 (tax rules):** whether S0's desk read is enough for Gate 4, or you or a professional checks the primary pages.
8. **If B's RAM fails:** whether to raise the 150 MB budget or cut something.

---

## 14. Deferred Items and Untested Risk

None of these may be described as verified.

| Deferred item | Why deferred | Risk until tested | Revisit |
|---|---|---|---|
| Pixel and Xiaomi/HyperOS runs of Spike A | Not owned | Stock-Android and aggressive-kill behaviour unmeasured | Before a public release |
| iOS / iPhone background location | Not owned; Android first (1.6) | Own spike needed | When iOS is scheduled |
| Raspberry Pi and ARM64 image | No Pi | Multi-arch image may fail; Pi timings slower | When a Pi is bought |
| SD-card wear and real power pull on SD (B11) | No Pi | `10` §12 advice unmeasured | With the Pi run |
| 1 GB VPS and public-domain Caddy TLS | No VPS now (decision 1.7) | Let's Encrypt/public path untested | When VPS support is scheduled |
| Spike E (PMTiles size and Caddy range serving) | Optional module | Install effort and size unknown; blank-canvas fallback exists | When the web client is built |
| Spike F (year-long PDF RAM) | Optional exporter | RAM unknown; CSV/GPX/GeoJSON unaffected | Before the PDF exporter is built |
| Node 24 + `better-sqlite3` | Not tested | Server must stay on Node 22.22+ until checked | Before building the server on `coder` |
| Other riders, vehicles and cities | One rider tested | Results are Samsung/scooter/Toronto only | Beta users |

---

## 15. Items to Check in Other Docs (not edited here)

- **`07` vehicles:** confirm a vehicle type for **motorcycle/scooter** exists and that nothing assumes four wheels or a car odometer.
- **`09` sampling and guards:** *(Resolved 2026-11-04 by `14`: the guards moved into the shared engine: 42 m/s spike cut, 20 m stationary gate; E5 and E3 test whether they suit scooter speeds and long idle stops.)* confirm the Bluetooth auto-start note covers a **helmet headset (Sena)**, not a car head unit (it is v1.1 and out of scope here).
- **`04` and country focus:** the owner rides in **Toronto**, so **CRA** (logbook, personal vs business km, 6-year retention) is the primary case. Confirm CRA is first in the export priorities and the US/UK ones follow.
- **`03` §2:** add the Node ≥ 22.22 floor (Finding 1).
- **`02` and `09` wording:** "driving", "car" and "highway" in prose; replace with "riding/driving" only where it matters.

---

## 16. What Changed From the Approved Plan (2026-11-03)

| Old plan | This revision |
|---|---|
| Seven spikes: S0, D, B, A, C, E, F | S0 (done), B, D, A with C-lite folded in; E and F deferred |
| A: car, 50 km route, bench + road phases, A1–A12 as gates, ≥ 2 h battery runs with a control run | A: normal scooter shifts, Day 0 Comma baseline, 9 light checks judged "no worse than Comma" |
| C: 11 tests, a dedicated dead-zone drive | C-lite: 6 gating checks on the same rigs, any real dead zone |
| D: 7 tests, assumed Tailscale and a Tailscale account | D: ~15 minutes, Tailscale vs existing WireGuard decided on the no-custom-CA criterion |
| B: unchanged tests, rig unbuilt | B: rig built; Spike B findings (Node floor, backup stall, RAM, `vehicles`, restore-in-API) added; Node 24 untested |
| Hardware: Samsung (car), Proxmox VM, Tailscale, car route | S24 Ultra on a scooter, Proxmox VM, `coder` as build machine, WireGuard or Tailscale |
| Time: 10–12 days, 3–4 weeks | About 8–10 days, about 2 weeks |
