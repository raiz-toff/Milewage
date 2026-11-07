# 17 — Gate 4 Execution Roadmap

**Lead Agent:** Agent 0 (Orchestrator) with Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT FOR HUMAN REVIEW (Gate 4). Nothing here has been built. No product repo content exists yet.  
**Parent:** [`plans/milewage/README.md`](./README.md) · Rules: [`06`](./06-human-in-the-loop-review-gates.md) §5 (≤ 400 lines per PR, tests with every PR, no broken `main`)  
**Inputs:** specs `00`–`16`, dossier `11`, spike plan `12` (merged into this roadmap by the Human on 2026-11-04), `infra-requirements.md`

Durations below are **estimates** for one owner working with agents. They are not measured, and the long poles are owner-supplied items (rides, a VM, an account), not code.

---

## 0. One-page summary

**What this is:** the build order for MileWage, as small PRs grouped into milestones. The Gate 3 spike checks are not a separate phase: each becomes the **exit criteria** of the milestone that builds the thing it tests, with numbers and a named fallback.

**Order (risk first):** the two things most likely to break the plan are built first and in parallel: the shared **track engine** (does it give byte-identical results on Hermes and Node?) and the **server ingest** (does it fit in 1 vCPU / 1 GB?). The phone tracker follows, then offline sync, then stops, then the web client, diagnostics, exports and hardening.

| M | Milestone | Track(s) | Goal in one line | Spike checks that close it | PRs | Rough time |
|:--:|---|---|---|---|:--:|---|
| M0 | Foundations | all | Repo, tooling, CI, module registry, OpenAPI as source of truth | — | 4 | ~1 wk |
| M1 | Track engine core | Engine | Pure TypeScript engine: distance, gaps, route, digest, whole-shift result, deterministic | A10 (Node half), `14` §10 properties | 7 | ~2 wk |
| M2 | Server core + ingest | Server | Setup, login, pairing, shifts, idempotent telemetry ingest, compose stack, minimal diagnostics | B1–B4, B6, B12, B13, B15 (partial), D1–D6 | 12 | ~3 wk |
| M3 | Server ops | Server | Backup, encryption, restore, migrations, low disk, status | B5, B5b, B7–B10, B14, B16 | 6 | ~1.5 wk |
| M4 | Phone tracker | Phone | Trimmed Comma native module, pairing, start/end shift, upload, minimal diagnostics | A1–A9, A10 (Hermes half), A12 | 10 | ~3 wk |
| M5 | Offline sync | Phone + Server | Weeks-offline phone, backlog drain, shift end with manifest, reconciliation, pull | C1–C9, A11 | 9 | ~3 wk |
| M6 | Stops and shift processing | Engine + Server + Phone | Auto-detected stops, estimated split, recalc, archive | A13, A14 | 7 | ~2 wk |
| M7 | Web client | Web (+ Server routes) | Thin client: setup, devices, shifts, map, live, stops labelling, settings | module-flag UI checks | 16 | ~5 wk, parallel from M2 |
| M8 | Diagnostics, full | Phone + Server + Web | Levels, health, debug bundle, capture | A15, B17, redaction canaries | 5 | ~2 wk |
| M9 | Exports and country packs | Server (+ Web) | CSV, GPX, GeoJSON, PDF; CA first, then US, GB; odometer logbook | PDF RAM check (Spike F) | 5 | ~2 wk |
| M10 | Hardening and release | Infra | Install guide, upgrade/rollback, signed APK, week-long acceptance, restore drill | acceptance (§9) | 4 | ~1.5 wk |

**Total: about 85 PRs.** With the Engine, Server, Phone and Web tracks overlapping as in §5, the critical path (M0 → M2 → M4 → M5 → M6 → M10) is roughly **12–16 weeks**. The estimate moves most with: when the `milewage-spike` VM exists, when the Tailscale/WireGuard decision is made, and how many normal riding shifts the owner can log for M4–M6 checks.

**What the Human is asked to approve for the Final sign-off:** §14.

---

## 1. Ground rules (from `06`, `README` §1.3, and decisions 1.1–1.5d)

1. **PR size:** at most **400 changed lines**, counting source and tests, excluding lockfiles, generated files and committed fixture data. A PR that needs more is split. *One proposed exception:* the mechanical copy of Comma's native module (M4.2) is exempt because it is a verbatim copy reviewed by diffing against the source (§14, approval item 3).
2. **Every PR has automated tests** that fail without the change.
3. **`main` never breaks.** Branch protection requires `npm run verify` (§3.3) to pass; no direct pushes; squash merge.
4. **Modularity Rule on every PR:** a PR that adds an optional capability puts it in a module (routes, tables, jobs, tests) and adds its toggle test (§8). No cross-module imports of internals.
5. **No PR for anything not in the specs.** If a PR needs a decision a spec did not make, it stops and the Human decides (§12).
6. **Zero execution without the Final sign-off** (`06`). This document does not authorize any code.
7. **Comma is copied, not linked** (decision 1.2): see §3.6.

---

## 2. Repository layout

The product repo is `/home/coder/Production/milewage` (decision 1.2). It currently has **no commits and no remote**; `plans/` stays in it as documentation. The spike rigs stay in `/home/coder/Production/milewage-spikes/` and are deleted or archived at the end of M3/M4 (§10).

```
milewage/
├── apps/
│   ├── server/                 Fastify API, modules, repositories, migrations, CLI
│   ├── phone/                  Expo (SDK 56) app + native Kotlin tracker module
│   │   └── native/comma-tracker/   copied once from Comma, then trimmed (§3.6)
│   └── web/                    Vite + React + TypeScript thin client
├── packages/
│   ├── shared/                 module registry, event bus, OpenAPI + generated types/schemas,
│   │                           DiagnosticsPort + event allowlist, country packs, design tokens
│   └── track-engine/           pure TypeScript engine (14): no RN, Node, DB or network imports
├── infra/
│   ├── compose/                docker-compose.yml, Caddyfile, .env template
│   ├── vm-tests/               B-series scripts adapted from milewage-spikes/B
│   └── docs/                   install guide, upgrade/rollback, restore drill
├── scripts/                    version.mjs (check/sync), openapi generation, fixtures tooling
├── plans/                      this planning set (unchanged)
├── .nvmrc  VERSION  CHANGELOG.md  package.json (workspaces)  tsconfig.base.json
```

`track-engine` is its own workspace package (not buried inside `shared`) so its zero-dependency boundary can be enforced by a lint rule. It is still imported by both phone and server, as `14` §3 requires.

---

## 3. Tooling decisions

| # | Decision | Choice | Why | Rejected |
|:--:|---|---|---|---|
| T1 | Language and strictness | TypeScript, `strict`, ESM everywhere | One language across phone, server, web, engine (decision 1.3) | JS for web as Comma's web does |
| T2 | Node | **22.22.x**, pinned in `.nvmrc` and `engines`; used for the server, tests and phone builds | `better-sqlite3` crashes on 22.11/22.12; Node 24 (on `coder`) is untested with it (`12` §5 findings 1–2) | Node 24 until tested |
| T3 | Package manager | **npm workspaces** | Same as Comma and the B rig; Expo/Metro handle npm hoisting without extra config | pnpm (symlink issues with Metro), Yarn |
| T4 | Monorepo task runner | Root scripts only (`npm run -w`) | Five workspaces do not need a task graph tool | Nx/Turborepo |
| T5 | Server stack | Fastify, `better-sqlite3`, Drizzle ORM, `drizzle-kit` SQL migrations (forward-only) | `03` §2, `07` §6; repositories per aggregate (`08` §16.5) | Prisma, Postgres |
| T6 | API contract | `08` §13 OpenAPI 3.1 file is **the source of truth**, committed in `packages/shared`; types and JSON Schemas are generated from it by a script; CI fails if the generated files differ from a fresh generation | One contract for phone, web, server; no drift | Hand-written types |
| T7 | Request validation | Fastify's built-in schema validation using the schemas extracted from the same OpenAPI file | No second schema language | Zod/TypeBox duplicates |
| T8 | Web framework | **React + Vite + TypeScript + Tailwind + MapLibre GL + TanStack Query** | `03` §2 names Vite, Tailwind, MapLibre but not a UI framework. React shares types and the query library with the Expo app. **DECIDED 2026-11-04: the Human approved React for the web.** | Plain JS (Comma's web), Svelte, Preact |
| T9 | Tests | **Vitest** for `shared`, `track-engine`, `server`, `web`; **jest-expo** + React Native Testing Library for phone JS; **JUnit** for pure Kotlin logic; **Playwright** only for a web smoke path (M7.14) | One fast runner for everything that runs in Node; device checks stay manual or scripted | Jest everywhere, broad E2E suites |
| T10 | Lint and format | ESLint (flat config, typescript-eslint) + Prettier; a lint rule forbids imports from `react-native`, `node:*`, `fs`, `fetch` and `Date.now`/`Math.random` inside `packages/track-engine` | Matches Comma's ESLint; enforces `14` §3 | Biome (new tool, no gain) |
| T11 | The single gate | `npm run verify` = typecheck + lint + unit tests + OpenAPI drift check + `version:check` + module matrix (§8). CI runs exactly this. | Same idea as Comma's `verify`; one command to run locally | A multi-job pipeline per package |
| T12 | CI host | The `verify` script is the contract. M0.2 adds a `.gitlab-ci.yml` that runs it. **DECIDED 2026-11-04: the Human hosts the repo on their own self-hosted GitLab.** CI is GitLab CI on a self-hosted runner (Docker executor; the image has Node 22.22 pinned; Android builds run on the `coder` machine, which already has JDK 17 and the Android SDK). The GitLab URL, project path and runner registration are supplied by the Human before M0.2. | The repo has no remote yet | Choosing for the Human |
| T13 | Versioning | One `VERSION` file synced by `scripts/version.mjs check|sync` (idea copied from Comma); API version is separate (`/api/v1`, `X-MileWage-Api`); `algorithmVersion` is a constant in the engine; DB migrations are numbered | Three different things change at three different rates | One number for everything |
| T14 | Server image and VM tests | Image built from `node:22.22.x-bookworm-slim` (as the B rig), tags pinned; VM test scripts live in `infra/vm-tests` and are run by hand on the `milewage-spike` VM at milestone exits | Real thresholds need the 1 vCPU / 1 GB VM, not CI | Running RAM tests in CI |
| T15 | Commit and PR convention | Branch `m<M>.<n>-short-name`; PR title `[M<M>.<n>] what`; squash merge; one logical change per PR | Traceable to this document | Free-form |

### 3.6 How Comma code is copied in (once)

- **Native tracker:** M4.2 copies `modules/comma-tracker` verbatim into `apps/phone/native/comma-tracker/` with a `COPIED-FROM-COMMA.md` recording the source path and Comma's commit hash. It builds unchanged first. M4.3 trims it (`09` §5.2). From then on it is MileWage's code.
- **Country registry data and tax logic:** M9.2 copies the figures Comma holds for Canada, the US and the UK into `packages/shared` country packs, then **re-verifies each against the primary source** (`07` §4.1, `11` §4). Nothing is imported from `commaApp`, and no parity script is needed because there is one copy.
- **Design tokens:** M4.1 and M7.1 copy the token values from `05` §1.1 (which come from Comma) into one tokens file in `packages/shared`.
- **No other Comma code is copied.** The old vault, sync and web-app code is not carried forward (decision 1.5).

---

## 4. Owner-supplied items and when they are needed

These are the long poles. Each has a "needed by" milestone. A late item moves the milestone, not the plan.

| Item | Needed by | Detail |
|---|---|---|
| **Final sign-off** (§14) | Before M0.1 | Nothing is built until this |
| GitLab project URL, access for the agent, and a registered runner | Before M0.2 | Branch protection and CI need the host (T12). Self-hosted GitLab, decided 2026-11-04 |
| `milewage-spike` VM on Proxmox (infra agent) | End of M2.9 (server image exists) | 1 vCPU, 1 GB, no ballooning, 20 GB no-cache disk, snapshot `os-ready`, `qm stop` verified (`infra-requirements.md`) |
| Comma export: `routePath` + totals for a handful of past shifts | M1.7 | `14` §10.2 item 2; raw points do not exist in Comma |
| **Day 0 baseline ride** with Comma's own tracker on the S24 Ultra, same mount | Before M4.9 results are read; can be done in week 1 | The "no worse than Comma" baseline for A1, A2, A5 (`12` §6) |
| Tailscale (or WireGuard + public-CA) decision and account | Start of Spike D at M2 exit | `12` §4 recommends Tailscale first; HTTPS enabled and a non-sensitive machine name (`10` §8) |
| Odometer readings for scooter rides | M4 exit | A3: server distance vs odometer over ≥ 20 km |
| Three measured loops (map-measured lengths) in Toronto | M4 exit (raw fixes are needed) | `14` §12 golden data |
| Parallel ride, Comma tracker and MileWage tracker on the same trip | M5 | A11 |
| 3+ normal shifts of riding with the product build | M4, M5, M6 | A1–A9, C2, A13, A14 |
| Stop ground truth: compare detected stops with the delivery platform's order history | After M6.3 | A13: ≥ 30 real stops over ≥ 3 shifts; about 20 min per shift |
| CRA (and US/UK) log-element check against primary pages | Before the PDF exporter claims anything (M9.4) | `11` §4 claims 1–3 stay "Open" until a human checks |
| Node 24 + `better-sqlite3` check | Optional | Only if the Human wants to build the server on `coder` |

---

## 5. Parallel tracks

```
week →   1    2    3    4    5    6    7    8    9   10   11   12   13   14
Engine   M0 ─ M1 ──────────────────────── M6.1-2 (stops engine) ─ tuning
Server   M0 ─ M2 ────────────── M3 ─── M5 server ─ M6.3-7 ─────── M8 ─ M9
Phone         (Day 0 ride)  ── M4 ───────── M5 phone ── M6.5 ───── M8 ─ M10
Web           M7.1 (after M2.4 + OpenAPI) ──────────────────── M7 ───────────
Infra   VM ──────── D ────── B-run ─────── C/A rides ─── A13 ──── drills
```

Rules of thumb: Engine and Server start together after M0. Phone starts when the server image exists (M2.9), but its native copy/trim work (M4.2–M4.4) needs nothing from the server and can begin during M2. Web starts once OpenAPI types exist (M0.4) and the setup/login routes exist (M2.3). Two tracks never edit the same files in a PR (`packages/shared` changes go in their own small PRs).

---

## 6. Milestones and PRs

Notation: **Mod** = module touched (README §1.3). **LOC** = estimated changed lines under 400. **Dep** = PRs that must be merged first. Tests are listed by kind; each PR must add them.

### M0 — Foundations (1 week)

**Exit:** `npm run verify` passes on an empty-but-wired repo; a module registry refuses to start with a missing dependency; the OpenAPI file generates types and CI detects drift.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M0.1 | Repo skeleton, workspaces, tooling, `verify` | — | `verify` runs green; lint rule forbidding disallowed imports in `track-engine` has a failing-sample test | 300 | — |
| M0.2 | CI workflow, `VERSION` + `scripts/version.mjs`, branch protection notes | — | `version:check` fails on mismatch (test) | 200 | M0.1 |
| M0.3 | Module registry, dependency graph, start-time refusal, typed event bus, module-matrix test helper | shared | graph cycles, missing dep refusal, event delivery, 404 for absent module routes | 350 | M0.1 |
| M0.4 | OpenAPI source file in `shared`, generator for types + schemas, drift check, `x-modules` lint (every operation maps to one module) | shared | drift check fails on edited generated file; lint fails on unmapped operation | 250 + generated | M0.1 |

### M1 — Track engine core (2 weeks, Engine track)

**Goal:** the engine of `14` stages 1–4, 7–8 and the whole-shift segmenter, deterministic and property-tested, before anything depends on it.

**Exit:** all engine property tests (`14` §10.2 item 6) pass under Node 22; fixtures committed with a "changing outputs requires an `algorithmVersion` bump" test; the Comma sanity check (item 2) agrees within the simplification bias; `processShift` on 5,000 fixes runs under **50 ms on Node** (`14` §10.3).
**Fallback:** if a fixture shows an inconsistency between Comma's accept rules and the engine, fix the engine and bump `algorithmVersion` (nothing is released yet). If Node timing fails, profile before the phone check.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M1.1 | Engine types, integer helpers, stages 1–2 (normalize, qualify) | engine | shuffle/duplicate/out-of-window property tests | 380 | M0.1 |
| M1.2 | Stage 3 gate and distance (haversine, 42 m/s cut, 20 m gate), live accumulator | engine | straight line, closed loop, jitter-spike cases | 350 | M1.1 |
| M1.3 | Seeded synthetic ride generator + golden fixtures + version-bump guard | engine | guard test fails when outputs change without a bump | 300 | M1.2 |
| M1.4 | Stage 4 gaps, unfinished shifts, clock flags (`14` §7, §8, §15) | engine | gap, tunnel, killed-app, dead-battery fixtures | 350 | M1.2 |
| M1.5 | Stage 8 route simplification (integer RDP), `inputDigest`, `processShift` with the whole-shift segmenter | engine | digest stable across reorder; trips sum to `totalM` | 380 | M1.4 |
| M1.6 | Stage 7 trip edits, deterministic `trip_key`, override orphan reporting | engine | overrides survive recompute; orphan flagged, not guessed | 300 | M1.5 |
| M1.7 | Canonical-JSON conformance runner + Comma sanity-check script | engine, scripts | byte-identical repeat runs; sanity check script on the owner's exported shifts | 250 | M1.5 + Comma export |

### M2 — Server core and ingest (3 weeks, Server track)

**Exit (run on the `milewage-spike` VM, 1 vCPU / 1 GB, from `infra/vm-tests`):**

| Check | Threshold |
|---|---|
| B1 idle footprint, 30 min | stack ≤ **100 MB** RSS, CPU < **0.5%** |
| B3 stress ingestion, 50 req/s × 200-point gzip × 10 min | write p99 < **100 ms**, zero `SQLITE_BUSY` to clients, stack peak ≤ **150 MB** |
| B4 reader during writes | read p95 < **200 ms** |
| B6 `kill -9` mid-batch | `integrity_check` clean, resend inserts no duplicates |
| B12 SQLite version | at or above the fixed release (`10` §3.3) |
| B13 module flags | disabled routes 404; a module with a missing dependency refuses to start |
| B2 realistic load, 8 h time-scaled | no errors, RSS growth ≤ 10% |
| D1–D6 reachability | valid public-CA certificate with no custom CA, HTTP 200; first request within 30 s after Doze; tunnel-down fails in < 10 s; `X-Forwarded-For` trusted only from Caddy |

**Fallbacks (`12`, `10` §15):** RAM over budget → lower `--max-old-space-size`, change Caddy gzip, otherwise the **Human decides** whether to rebase the 150 MB budget; `SQLITE_BUSY` → single write connection plus a batch queue; D fails without a custom CA → reopen decision 1.7 with the Human; D3/D4 slow → add reconnect requirements to `08` §9 and `09` §5.4.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M2.1 | Server skeleton: app factory, config, module wiring, `/healthz`, error model, log redaction | core | inject tests; error shape per `08` §7.1; redaction | 380 | M0.3, M0.4 |
| M2.2 | DB layer: single write connection, PRAGMAs, Drizzle, forward-only migration runner, first core tables | core | PRAGMAs set; migration idempotent; refuses a newer DB | 380 | M2.1 |
| M2.3 | Setup and login: owner creation, scrypt, opaque web sessions, logout, login rate limit | core | setup only while no users; session expiry; brute-force limit | 350 | M2.2 |
| M2.4 | Settings, vehicles, `GET /settings` with `modules` flags | core | flag object matches registry; settings validation | 350 | M2.3 |
| M2.5 | Devices module: pairing token, redeem, device auth, scopes (S, D, D\*), list/rename/revoke | devices | token one-time; revoked device gets 401; scope matrix | 390 | M2.4 |
| M2.6 | Shifts (core logbook): start (idempotent on `client_id`), get/list/patch, odometer PUT, minimal end | core | idempotent start; 14-day device window | 380 | M2.5 |
| M2.7 | Tracking ingest: telemetry table, `POST /telemetry/batch` idempotent on `(device_id, seq)`, refused-points list, 500 cap, gzip | tracking | replay twice stores once; partial refusal; size limits | 390 | M2.6 |
| M2.8 | Rate limits, `X-MileWage-Api/Instance/Restore-Gen` headers, clock-skew handling | core | 429 + `Retry-After`; header presence; skew cases | 300 | M2.7 |
| M2.9 | Server image + compose stack + Caddyfile (127.0.0.1:8080), pinned tags, memory/CPU caps | infra | compose builds; smoke script reaches `/healthz` | 250 | M2.1 |
| M2.10 | `DiagnosticsPort` (no-op), event kinds + allowlist schemas in `shared`, canary redaction test | shared | allowlist rejects coordinates and free text | 350 | M0.4 |
| M2.11 | Minimal `diagnostics.db` + `POST /diagnostics/events` (A-rig subset of `16` §9.3) | diagnostics | idempotent on `(device, src, seq)`; rejects listed | 330 | M2.10, M2.7 |
| M2.12 | Module matrix suite: all-on, each-alone-with-dependencies, missing-dependency refusal | all | the matrix itself | 250 | M2.5, M2.7, M2.11 |

### M3 — Server operations (1.5 weeks, Server track)

**Exit (VM):**

| Check | Threshold |
|---|---|
| B5 backup under B3 load | completes, copy passes `integrity_check`, no write stall > **1 s** |
| B5b second writing connection | with one writer: completes; with two: expected to restart/stall and the result is recorded (confirms the single-connection rule) |
| B7 power pull (`qm stop <vmid>` during B2) | `integrity_check` clean; at most the last few seconds of acknowledged telemetry lost |
| B8 restore drill on a fresh host | counts match the verification output; total time recorded |
| B9 migration drill on a ~1 GB DB | pre-migration backup verified first; forced failure leaves the old schema intact |
| B10 low disk | banner, backup skip, then **507** on every write while reads still work |
| B14 encrypted backup and restore | decrypts with the Go `age` tool |
| B16 diagnostics under load | ingest p99 < 100 ms; the backup still passes `integrity_check` |

**Fallbacks (`10` §15, `12` §5):** backup stalls writes → run the `integrity_check` in a worker thread (rig flag `SPIKE_CHECK_IN_WORKER=1`) or smaller steps; crash or power-pull integrity failure → `synchronous=FULL` and re-measure; B9 shows the server is unreachable during a long pre-migration backup → start listening first (decision after B9); restore runs inside the API process (`10` §7 updated after B8).

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M3.1 | Backup engine: online backup API on the write connection, integrity + FK + row-count checks, `backup_runs`, local target, retention 7/4/12 | backup | corrupt copy rejected; retention pruning; counts compared | 390 | M2.2 |
| M3.2 | Backup encryption with `age` (pinned, pre-1.0 note), recovery key at setup | backup | round trip; wrong key fails; cross-tool check script | 330 | M3.1, M2.3 |
| M3.3 | Restore: preflight, safety copy, swap, verification output, auto-revert; `POST /setup/restore` | backup | schema-newer abort; revert on failed verification | 390 | M3.2 |
| M3.4 | Upgrade flow: pre-migration backup, newer-schema refusal, status during migration | core | forced failing migration leaves schema intact | 300 | M3.1 |
| M3.5 | Low-disk rules (507 on every write), `GET /system/status`, log rotation | core | thresholds; reads stay up; status shape | 330 | M2.8 |
| M3.6 | Port `milewage-spikes/B` tests B1–B17 to `infra/vm-tests` against the product server | infra | script self-checks (dry run); results by hand on the VM | 350 | M3.3, M2.12 |

After M3 exits, `milewage-spikes/B` is deleted or archived outside the repo with a note (`12` §10).

### M4 — Phone tracker (3 weeks, Phone track)

**Exit (S24 Ultra, release build, normal shifts; the Day 0 Comma baseline exists):**

| Check | Threshold |
|---|---|
| A1 battery | no worse than Day 0: within **+0.5 %/h or +20 % relative** (new); `09`'s 3.5 %/h recorded as a reference |
| A2 gaps | no gap > **60 s** while moving (excluding logged no-fix places) and no more gaps than Day 0 |
| A3 distance | within **±2 %** of the scooter odometer over ≥ **20 km** |
| A4 survival | swipe from recents and 30 min screen-off: service alive, points arriving |
| A5 stillness | ≥ 45 min parked adds **< 0.3 km**; GPS client gone after the 150 s timeout |
| A6 restart | "Allow all the time": service restarts or the shift is recoverable; "While using": behaviour recorded and the onboarding warning shown |
| A7 background start | notification-tap start on Android 14 raises no `ForegroundServiceStartNotAllowedException` |
| A8 replay | the same bytes uploaded twice are stored once |
| A9 module flag | `tracking` off in `GET /settings` means no service and no upload worker |
| A10 | `processShift` over the fixture set is **byte-identical** under Node 22 and under Hermes on the S24 Ultra |
| A12 | `processShift` on 5,000 fixes under **200 ms** on the S24 Ultra |

**Fallbacks (`09`, `12` §6):** A1 over → raise interval/displacement, then bring back speed tiers (`09` §6); A2 → separate OEM kill from fix quality with `dumpsys` and logcat; A3 → tune the engine filters (`algorithmVersion` bump); A4/A6 → fix the restart path with **no extra native code for other OEMs**; A5 → fix stillness gating; A7 fails → build the native uploader inside the service; A10 fails → replace haversine `sin/cos/atan2` with a deterministic implementation, bump `algorithmVersion`; A12 slow → move the shift-end run off the UI thread or reduce work before changing the algorithm. If both Comma and the rig exceed 3.5 %/h that goes to the Human, not to the rig.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M4.1 | Expo app skeleton, navigation shell, design tokens, release-build script on `coder` (Node 22.22), jest-expo setup | phone | render test; `verify` includes phone typecheck | 350 | M0.4 |
| M4.2 | **Copy** Comma native tracker verbatim + `COPIED-FROM-COMMA.md` (exempt from 400, §1) | tracker | builds unchanged; provenance file present | mechanical | M4.1 |
| M4.3 | Trim: remove overlay, boot receiver, battery-exemption permission; cadence from JS config; manifest per `09` §5.3 | tracker | JUnit on config parsing; manifest lint test (forbidden permissions absent) | 300 | M4.2 |
| M4.4 | Native buffer DB + tracker interface (`start`, `stop`, `readPending`, `markUploaded`, `markRejected`, `evictUploaded`, `gnssOffsetMs`) and TS bridge/fake | tracker | JUnit buffer semantics; TS contract test against the fake | 380 | M4.3 |
| M4.5 | Permission ladder and onboarding warnings (all-the-time vs while-using), battery-settings link | phone | ladder state machine tests | 330 | M4.4 |
| M4.6 | Pairing: QR scan, redeem, secure credential storage, instance id, `GET /settings` cache and flags | phone, devices | redeem against mock; flag-driven UI | 360 | M4.1, M2.5 |
| M4.7 | Start/End shift screen, live distance from the engine accumulator, odometer start edit, online shift create | phone | accumulator wiring; idempotent create | 380 | M4.4, M1.2, M2.6 |
| M4.8 | Upload worker: 50–100 point gzip batches, backoff 2/4/8/16/32/60 s ±20%, 422 → `markRejected`, 401 → re-pair state, `tracking`-off behaviour | phone | mock-server cases including replay and revoke | 390 | M4.7, M2.7 |
| M4.9 | Minimal phone diagnostics (`DiagSink`, JS port, A-rig event set) + allowlist canary | diagnostics | canary: no coordinates in any event | 350 | M2.10, M4.8 |
| M4.10 | Hermes conformance screen + timing harness (A10, A12) | phone | harness output matches Node's canonical JSON | 250 | M1.7, M4.1 |

### M5 — Offline sync (3 weeks, Phone + Server)

**Exit (S24 Ultra + the VM):**

| Check | Threshold |
|---|---|
| C1 airplane mode 30 min mid-shift | server `seq` set equals the phone's: zero lost, zero duplicate |
| C2 any real dead zone met on rides | same as C1; place noted |
| C3 kill the app mid-batch | zero loss, zero duplicate after the next upload |
| C4 `kill -9` the API mid-batch | zero loss, zero duplicate |
| C6 server refuses one point (422) | others stored, the `seq` quarantined, queue not blocked |
| C7 revoke the device (401) | uploads stop, buffered data kept, re-pair state shown |
| C8 backlog drain: 24 synthetic shifts | all shifts, `shift.end` barriers and `recon` results arrive; zero loss/duplicate; wall time and bytes per shift recorded (estimates: 3–4 min; 0.3 MB phone, 0.1–0.15 MB wire) |
| C9 wrong server | nothing is sent; the red state appears |
| A11 parallel ride vs Comma | totals agree within the effect of the 50 m accuracy filter and the cadence difference, which the run quantifies |

**Fallback:** any C failure or a duplicate/lost point → redesign the `seq` acknowledgement and manifest barrier (`12` §6 "On failure"); an engine disagreement between phone and server → investigate A10 first.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M5.1 | Phone `app.db` schema and migrations (`15` §2.2) | phone | migration upgrade with unsynced rows | 380 | M4.1 |
| M5.2 | Outbox engine: kinds, FIFO, coalescing, one in flight, idempotency keys | phone | coalescing; resume after kill | 390 | M5.1 |
| M5.3 | Server `POST /shifts/{ref}/end`: engine run, manifest comparison, `phone_result`, recon reason codes | core, tracking | each reason code incl. `engine_disagreement` | 390 | M1.5, M2.7 |
| M5.4 | Phone shift end: run the engine, show results offline, "Calculated on phone" marker, shift detail | phone | deterministic vs server fixture | 380 | M5.1, M1.5 |
| M5.5 | Backlog drain: ordering, barrier before `shift.end`, batch 500, determinate progress, cancel/resume, live-shift priority | phone | 24-shift synthetic drain test against a mock | 390 | M5.2, M5.3 |
| M5.6 | `sync` module: `change_log`, `overwrite_log`, `GET /sync/changes` | sync | cursor paging; tombstones; module off = upload-only | 380 | M5.3 |
| M5.7 | Phone pull, tombstones, conflict log, driver-visible diff | phone | server-wins; no phone delete of server data | 380 | M5.6, M5.1 |
| M5.8 | Status markers, global banner, reminders (3 days, then daily, stronger at 7), low-storage, wrong-server and restore-generation handling | phone | state tests for each connection state | 390 | M5.5, M2.8 |
| M5.9 | Trip overrides, manual trips, offline odometer edits, last-writer-wins on both sides | phone, core | LWW ties go to the server; override survives recompute | 390 | M5.7, M1.6 |

### M6 — Stops and shift processing (2 weeks)

**Exit:**

| Check | Threshold |
|---|---|
| A13 stop-detection accuracy (≥ 3 shifts, ≥ 30 real stops, owner compares with the platform's order history) | detects ≥ **90%** of real stops; ≤ **1 false per 10**; estimated active distance within **15%** (all three "new", the Human may change them) |
| A14 toggle | with `stops_enabled` off a new shift reports one business total and no stop UI; an earlier shift is unchanged; with it on, a new shift has stops and `segmenter = stops` |
| `total_m` | identical with `segmenter = stops` and `whole_shift` (fixture, `14` §10.2 item 5) |

**Fallback:** below the bars → adjust the constants (40 m, 120 s, 180 s, 30 min) with an `algorithmVersion` bump and re-measure; if still below, **the Human decides** whether to ship stops default-off or low-confidence-only (a roadmap proposal, not a spec decision).

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M6.1 | Engine stage 5 stop detection (cluster, merge, wake-up, start guard) | engine | stop fixtures; lights vs real stops; queue creep | 380 | M1.5 |
| M6.2 | Engine stage 6 estimate, confidence, label roles | engine | stacked orders, breaks, whole-shift fallback; `total_m` unchanged | 380 | M6.1, M1.6 |
| M6.3 | Server `stops` module: tables, routes, `stops_enabled` guard, segmenter slot, `shifts.segmenter` fixed at start | stops | toggle at runtime; past shifts unchanged | 390 | M6.2, M5.3 |
| M6.4 | Recalculate, finalize, late-point debounce, override re-apply and orphan report | core | finalized shift never auto-recomputed | 380 | M6.3 |
| M6.5 | Phone: read-only stops and estimated split honouring `stops_enabled` | phone | flag matrix | 300 | M6.3, M5.4 |
| M6.6 | Raw-point retention and route archive job (RDP 5 m, keep stop points) | tracking | archive keeps totals; export says "simplified" | 350 | M6.3 |
| M6.7 | `milewage-cli recalc --dry-run` comparison report | core | prints diffs, changes nothing | 250 | M6.4 |

### M7 — Web client (5 weeks, Web track, parallel)

**Exit:** every screen in `05` §3 exists for the modules that are on and is absent for those that are off; the Playwright smoke path (setup → pair → view shift → label a stop → export) passes; no screen shows an estimate without its "estimated" marker; totals are never labelled estimated.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M7.1 | Web skeleton: Vite + React, Tailwind tokens, generated API client, auth shell | web | render + client typing | 350 | M0.4, M2.3 |
| M7.2 | Setup wizard, login, recovery-key confirmation | web | form + error states | 350 | M7.1, M2.3 |
| M7.3 | Devices page: QR pairing token, list, rename, revoke | web | pairing flow against mock | 300 | M7.2, M2.5 |
| M7.4 | Settings page: country, units, currency, timezone, retention, stops toggle, diagnostics level, module flags | web | write + readback; flag-driven hiding | 350 | M7.2, M2.4 |
| M7.5 | Shifts list + shift detail (totals, trips table, flags) | web | table sorting; flag display | 380 | M7.2, M2.6 |
| M7.6s | Server: `GET /shifts/{ref}/route` columnar route (`replay`) | replay | columnar format; off = 404 | 250 | M1.5, M2.7 |
| M7.6 | Map and replay scrubber (MapLibre, plain background) | web | scrubber maths; no-basemap fallback | 390 | M7.5, M7.6s |
| M7.7s | ~~Server: `GET /live` WebSocket (`live`)~~ **Removed by decision 1.10 (2026-11-07).** | live | frame schemas; off = 404 | 300 | M2.7 |
| M7.7 | ~~Live map~~ **Removed by decision 1.10 (2026-11-07).** | web | reconnect; module off hides screen | 330 | M7.7s, M7.6 |
| M7.8 | Stops table and labelling UI, estimated markers, warnings | web, stops | label → recompute; warning conditions | 390 | M6.3, M7.5 |
| M7.9s | Server: `GET /summary` (three dashboard metrics) | core | metrics vs fixtures | 200 | M5.3 |
| M7.9 | Dashboard: net hourly earnings, deduction value, active/deadhead split | web | "not entered" not zero; estimate marker | 300 | M7.9s |
| M7.10 | Odometer logbook UI (year start/end, shift readings) | web | CRA base-year note | 300 | M7.5 |
| M7.11 | Module-flag hiding tests across the web app | web | each flag off hides its screens | 250 | M7.8 |
| M7.12 | Dense tables: keyboard navigation, sort, CSV copy | web | keyboard tests | 300 | M7.5 |
| M7.13 | *Optional:* PMTiles basemap served by Caddy range requests (Spike E exit) | web, infra | file present/absent both render | 250 | M7.6 |
| M7.14 | Playwright smoke path | web | the path itself | 200 | M7.8 |

M7.13 is optional because `05` §3.2 defines a working no-basemap fallback; its exit is the first measured extract size and load time (`12` §7).

### M8 — Diagnostics, full (2 weeks)

**Exit:**

| Check | Threshold |
|---|---|
| A15 diagnostics cost on the phone | CPU < **0.5 s/h**, ≤ **30 writes/h** (new); no timer, alarm, job, wake lock or extra request registered by diagnostics |
| B17 idle cost on the server | RSS difference with the module on vs off ≤ **5 MB**; CPU difference < **0.1%** (new) |
| B16 under load | ingest p99 < 100 ms (carried from M3) |
| Redaction canaries | zero coordinates, addresses, payouts, labels or free text reach `diagnostics.db`, the bundle, or the web; verified at the phone, at ingest and at export |

**Fallback:** A15 over → default level becomes `off` (`16` §5); the redaction canary is a hard stop with no fallback.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M8.1 | Server diagnostics: full catalogue ingest, retention, caps, levels, health computations | diagnostics | retention; cap drop order; health score cases | 390 | M2.11 |
| M8.2 | Phone levels (off/basic/verbose, verbose reverts after 7 days), ring buffers, drop policy, outbox kind at lowest priority | phone | offline caps; priority below telemetry | 380 | M5.2, M8.1 |
| M8.3 | Web Health, Shift timeline, Errors, Server screens | web | rendering from fixtures | 390 | M8.1, M7.5 |
| M8.4 | Redacted debug bundle + canary suite across phone/ingest/export | diagnostics | canaries | 330 | M8.1 |
| M8.5 | `capture` module: sessions, dense fixes, annotations, anonymized replay (off by default) | capture | session expiry; replay anonymization | 390 | M8.1, M4.8 |

### M9 — Exports and country packs (2 weeks)

**Exit:** CSV (trip and shift level), GPX and GeoJSON generate from fixtures and open in standard viewers; a country pack exists for **CA first**, then US and GB, each citing its primary source; the Human has checked the CRA log elements (claims 1–3 in `11` §4) or the PDF carries no compliance wording; PDF exporter (if kept) shows RAM within budget on the 1 GB VM for a year of data (Spike F).

**Fallback (PDF):** RAM over budget → build the PDF in monthly chunks and merge; otherwise CSV only for that country; otherwise a short-lived separate process so a failure cannot take the API down. A headless-browser PDF stays rejected (`12` §7).

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M9.1 | Exporter registry + CSV (trip level and shift level) | exporters | column order; streaming; unregistered = 404 | 350 | M2.6 |
| M9.2 | Country pack registry; CA, US, GB packs with re-verified rates and primary-source notes; HMRC fields and rates stay "unverified" until checked | country packs | rate lookup by year; unknown country → generic | 390 | M9.1 |
| M9.3 | GPX and GeoJSON exporters (archived shifts say "simplified") | exporters, tracking | schema validity; no payouts/labels in output | 330 | M9.1, M6.6 |
| M9.4 | PDF exporter (summary page + trip log), registered only when its dependency is installed | exporters | golden text checks; **no compliance claims** without the Human check | 390 | M9.2 |
| M9.5 | Odometer cross-checks in exports (CRA year start/end, shift readings vs GPS) | exporters | mismatch flagged, not corrected | 250 | M9.4, M7.10 |

### M10 — Hardening and release (1.5 weeks)

**Exit (acceptance):** the owner uses **only MileWage** for one working week of normal riding (no Comma), then a restore drill from the install guide succeeds on a fresh VM, and an upgrade → forced-failure → rollback drill leaves data intact.

| ID | Title | Mod | Tests | LOC | Dep |
|---|---|---|---|---|---|
| M10.1 | Install guide (home lab + Tailscale), first-run script, `.env` generation | infra | guide followed on a fresh VM by script | 300 | M3.3, M2.9 |
| M10.2 | Upgrade and rollback procedure + drill script (B9 on the product) | infra | forced failure leaves schema intact | 250 | M3.4 |
| M10.3 | Signed release pipeline on `coder` producing an APK and a Play AAB; **DECIDED 2026-11-04: Play Store beta (internal/closed testing track) using the Human's existing Play developer account, no public release for now.** The Play background-location and foreground-service declarations are prepared in this PR (unverified whether the testing tracks require them: check in Play Console) | phone | build reproducible; manifest lint | 250 | M4.3 |
| M10.4 | Acceptance run protocol and results template; spike code archived/deleted | infra | checklist | 150 | all |

---

## 7. The first 10 PRs in full detail

Building can start with M0, M1 and M2 in parallel. Each PR below is self-contained.

### PR 1 — [M0.1] Repo skeleton, workspaces, tooling, `verify`
- **Scope:** root `package.json` with npm workspaces (`apps/*`, `packages/*`), `.nvmrc` (22.22.x), `tsconfig.base.json` (strict, ESM), ESLint flat config + Prettier, Vitest root config, `.gitignore`, `README.md` pointing to `plans/`, placeholder `package.json` + `src/index.ts` + one test in `packages/shared`, `packages/track-engine`, `apps/server`. `npm run verify` = typecheck + lint + test. This PR also makes the repo's **initial commit** including `plans/`.
- **Lint rule:** forbid imports of `react-native`, `node:*`, `fs`, `path`, DB and network libraries, and the globals `Date.now`, `Math.random`, `fetch` inside `packages/track-engine`.
- **Tests:** `verify` passes; a deliberately bad sample file proves the lint rule fails.
- **Modules:** none. **Depends:** none (needs the Final sign-off). **Size:** ~300 lines.
- **Not in this PR:** CI, the Expo app, the web app, any real code.

### PR 2 — [M0.2] CI, `VERSION`, `version.mjs`
- **Scope:** `VERSION`, `scripts/version.mjs` with `check` and `sync` (idea from Comma's `scripts/version.mjs`, written fresh), `npm run version:check` added to `verify`, a CI workflow that runs `npm run verify`, and notes on required branch protection.
- **Tests:** `check` fails when a workspace's version differs from `VERSION` (unit test for the script).
- **Depends:** PR 1 and the Human's remote decision (T12). **Size:** ~200.
- **Not in this PR:** release automation, changelog tooling.

### PR 3 — [M0.3] Module registry, dependency graph, event bus
- **Scope:** `packages/shared`: `defineModule({ name, dependsOn, routes?, jobs?, subscriptions? })`, a registry that builds the graph and **refuses to start** (clear error) when an enabled module depends on a disabled one, config resolution (`config/settings.json` + `MILEWAGE_MODULE_<NAME>=0|1`), a typed in-process event emitter with the event names from `08` §16.4, and a **module-matrix test helper** (all-on, each-alone-with-dependencies, missing-dependency).
- **Tests:** cycles detected; missing dependency refused; absent module's routes not registered (404); events reach subscribers and publishers need no knowledge of them.
- **Modules:** the registry itself. **Depends:** PR 1. **Size:** ~350.
- **Not in this PR:** any real module, no hot toggling, no plugin loader (refused in `08` §16.5).

### PR 4 — [M0.4] OpenAPI as source of truth
- **Scope:** copy the OpenAPI document from `08` §13 into `packages/shared/openapi/openapi.yaml`; `scripts/openapi-generate.mjs` producing TypeScript types and JSON Schemas into `packages/shared/generated/`; a drift check in `verify` (regenerate and compare); an `x-modules` lint that fails if any operation is not mapped to exactly one module; the tool choice for generation is made inside this PR with a short rationale (candidate: `openapi-typescript`).
- **Tests:** editing a generated file makes the drift check fail; an unmapped operation makes the lint fail.
- **Depends:** PR 1. **Size:** ~250 plus generated files (excluded).
- **Not in this PR:** route handlers.

### PR 5 — [M1.1] Engine types, integer helpers, stages 1–2
- **Scope:** `packages/track-engine`: `Fix`, `ShiftInput`, `ShiftResult` types as in `14` §3; integer-only helpers (degrees ×1e7, metres, rounding rules); `algorithmVersion = 1`; stage 1 `normalize` (sort by `(recordedAt, seq)`, drop duplicate `seq`, drop fixes outside the shift window); stage 2 `qualify` (drop `accuracyM > 50`).
- **Tests:** property tests: shuffling the input changes nothing; duplicating fixes changes nothing; empty and single-fix inputs; accuracy boundary at 50.
- **Modules:** engine. **Depends:** PR 1. **Size:** ~380.
- **Not in this PR:** distance, gaps, stops, route.

### PR 6 — [M1.2] Stage 3 gate, distance, live accumulator
- **Scope:** stage 3 per `14` §5.3: walk against the **last accepted fix**; drop non-positive time; drop implied speed over 42 m/s; drop movement under 20 m; otherwise accept and add the haversine distance (Earth radius 6,371,000 m, integer-rounded). `createLiveAccumulator` runs stages 1–3 one fix at a time using the same functions.
- **Tests:** straight line and closed-loop known lengths; single jitter spike excluded; the 20 m gate; accumulator and batch result agree on clean input; no use of the clock.
- **Depends:** PR 5. **Size:** ~350.
- **Not in this PR:** gaps, stops, trips.

### PR 7 — [M1.3] Seeded ride generator, golden fixtures, version-bump guard
- **Scope:** a deterministic generator (fixed seeds) for the synthetic rides in `14` §10.2 item 1 that exist at this stage: straight, grid with turns, closed loop, stop-and-go; committed expected `ShiftResult` JSON; a test that **fails if committed fixture outputs change without an `algorithmVersion` bump**.
- **Tests:** the guard itself, tested by simulating a change.
- **Depends:** PR 6. **Size:** ~300 plus fixture data (excluded).
- **Not in this PR:** stop fixtures (M6.1), gap fixtures (M1.4).

### PR 8 — [M2.1] Server skeleton
- **Scope:** `apps/server`: Fastify app factory, config loading, module registry wired in, `GET /healthz` (outside `/api/v1`, returns only `{"ok":true}` or 503), the error model of `08` §7.1, structured JSON logging with redaction.
- **Tests:** `inject` tests for health and the error shape; a log-redaction test; the module-matrix helper runs with the (so far empty) module set.
- **Modules:** core. **Depends:** PRs 3 and 4. **Size:** ~380.
- **Not in this PR:** database, auth, any route beyond health.

### PR 9 — [M2.2] DB layer and migration runner
- **Scope:** `better-sqlite3` single write connection; PRAGMAs per `10` §3.4 applied on every open; Drizzle setup; forward-only migration runner with a lock and a "pre-migration backup" hook (a no-op until M3.4); first `core` migration with `users`, `settings`, `instance` from `07`; the repository-per-aggregate pattern with one example repository.
- **Tests:** PRAGMAs verified; applying migrations twice is idempotent; the server **refuses to start on a database newer than the code**; a failing migration leaves the old schema intact.
- **Modules:** core. **Depends:** PR 8. **Size:** ~380.
- **Not in this PR:** other tables, backup logic.

### PR 10 — [M2.3] Setup and login
- **Scope:** `GET /setup/status`, `POST /setup` (only while no users exist), `POST /auth/login`, `POST /auth/logout`, `POST /auth/password`; scrypt password hashing; opaque web sessions in `web_sessions`; login rate limit.
- **Tests:** setup refuses a second owner; wrong password; session expiry and logout; brute-force limit returns 429 with `Retry-After`.
- **Modules:** core. **Depends:** PR 9. **Size:** ~350.
- **Not in this PR:** the recovery key (`POST /setup/confirm` is added with backup encryption in M3.2), pairing, settings.

---

## 8. How modules and toggles are tested

1. **Server matrix (`08` §16.6):** CI runs the server suite once with every module on, once per module with **only that module and its dependencies** on, and once with a deliberately broken configuration. Each configuration must start, serve its own routes, and return **404** for the others; the broken one must **refuse to start** with a plain message.
2. **`x-modules` drives both:** the OpenAPI `x-modules` map is the input for route registration and for the matrix (M0.4 lint keeps it complete).
3. **Runtime toggle `stops`:** its own tests: setting off returns 404 from the guard, past shifts unchanged, new shifts `segmenter = whole_shift`.
4. **Phone:** flag-matrix tests with a mock `GET /settings`: `tracking` off → no service, no worker (A9); `stops` off → no split UI; `diagnostics` off → port is a no-op; `sync` off → upload-only.
5. **Web:** every screen has a test that it is absent when its module flag is off (M7.11).
6. **Registries:** exporters, country packs and backup targets each get a test that adding a registration (a stub) works without editing any other module.

---

## 9. How spike checks run as exit criteria

- The checks come from `12` and `10` §15; the **numbers above are copied from there** and unchanged unless marked "(new)". "(new)" thresholds are proposals the Human may change before the run (§14).
- **Where they run:** server checks on the `milewage-spike` VM from `infra/vm-tests`; phone checks on the S24 Ultra with the release build; engine checks in CI (Node) plus the Hermes harness (M4.10).
- **Results:** each milestone exit writes `plans/milewage/spikes/<ID>-results.md` in the `12` §9 template. A check that was not run counts as a failure (`12` §10).
- **When a check fails:** the named fallback is applied in a PR, the owning spec is edited with `Changed after <check> (<date>): …`, and the Anti-Slop audit re-runs on the changed text before the milestone closes.
- **Deferred, recorded as untested risk (`12` §14):** Pixel and Xiaomi runs, iOS, Raspberry Pi/ARM64, SD-card wear, the VPS and public-domain TLS path, Node 24 + `better-sqlite3`. None may be described as verified.

### S0 leftovers (from `spikes/S0-results.md` and `11` §4) and where each closes

| Open item | Closes at |
|---|---|
| Tailscale loopback detail | Spike D at the M2 exit |
| Behaviour on phones without Play Services (clear message) | M4 (a check on the S24 Ultra with Play Services removed is not possible; verify the availability check by code review and a fake) |
| Hermes `Math` determinism | M1.7 and M4.10 (A10) |
| Activity Transition on a scooter | M4 (A5) |
| `expo-sqlite` behaviour on full storage; Android backup setting on One UI 6.1+ | M5.8 |
| Storage and wire-size estimates | M5 (C8) |
| HMRC required fields and rates | M9.2 (remain "unverified" until a human checks) |
| IRS/CRA/HMRC log elements (claims 1–3) | Before M9.4 makes any compliance claim |
| QuickBooks/TurboTax import formats | Not in the roadmap (deferred in `08` §11) |
| `better-sqlite3` on Node 24 | Not tested; the server stays on Node 22.22 |

---

## 10. Definition of done

**A PR is done when:** it is ≤ 400 changed lines (excluding lockfiles, generated files, fixture data; M4.2 excepted); `npm run verify` passes; its tests fail without the change; any new optional capability has a module, a toggle and a toggle test; the OpenAPI file and generated files are updated together when an operation changes; the owning spec carries a one-line pointer if the PR changed a decision; and it is squash-merged to `main`.

**A milestone is done when:** every PR in it is merged; the exit table is run, recorded in `spikes/<ID>-results.md`, and either passes or has the fallback merged and re-audited; and the Human has seen the result for any threshold that failed or any "(new)" threshold they changed.

**Cleanup:** `milewage-spikes/B` is deleted or archived at the end of M3; the A-rig is not built separately (the product phone app is the rig); the Human signs the closing of the merged Gate 3 items in `06` at the end of M5.

---

## 11. Risks

| # | Risk | Likelihood | Effect | Mitigation | Early signal |
|:--:|---|:--:|---|---|---|
| R1 | Hermes and Node give different engine output | Medium | Phone and server disagree on totals | Integer-only maths; conformance harness before the phone depends on the engine (M1.7, M4.10); documented fallback | First M4.10 run |
| R2 | Stack exceeds 150 MB in the 1 vCPU / 1 GB VM | Medium | Budget change or work to cut RSS | Measure at M2 exit, not at the end; levers listed; Human decides on rebasing | B1/B3 |
| R3 | Tracker is worse than Comma on battery or gaps | Low–Medium | Rework sampling | Day 0 baseline; "no worse than" bar; speed-tier fallback | First ride day |
| R4 | JS upload timers stop screen-off | Medium | Native uploader needed (+1–2 weeks) | A-rig style check early in M4.8 | A7/A8 |
| R5 | Stop detection misses scooter stops (lights, short waits) | Medium | Estimate unreliable | Constants are tunable with a version bump; feature is a toggle; totals never depend on it | A13 |
| R6 | A single owner/phone/city proves too little | High | Hidden failures on other phones | Results recorded as Samsung/scooter/Toronto only (`12` §14); beta users later | After release |
| R7 | Owner-supplied items arrive late | High | Milestones slip, not the plan | §4 schedule; PRs that need nothing from the owner continue in parallel | Weekly |
| R8 | 400-line limit slows work | Medium | More PRs, more reviews | PRs are already scoped small; agent-assisted | PR size trend |
| R9 | Unverified tax claims reach users | Medium | Misleading compliance wording | No compliance claim until the Human checks the primary pages (M9.4) | M9 review |
| R10 | Android 14+ kills the service after "While using" only | Medium | Missing mileage | Onboarding warning; A6 records it | A6 |
| R11 | Scope creep from "just one more setting" | High | Slop | Rule 5 in §1; Anti-Slop audit per milestone | Any PR without a spec reference |
| R12 | Single copy of tax records on the server | Medium | Data loss | Backup is not optional; unsynced reminders; M3 drills; lost-phone exposure stated plainly (`15` §9.1) | B7/B8 |

---

## 12. Decisions

| # | Decision | Chosen | Why | Rejected |
|:--:|---|---|---|---|
| D1 | Gate 3 handling | Spike checks become milestone exit criteria with numbers and fallbacks | The Human merged Gate 3 into Gate 4 | A separate spike phase |
| D2 | Build order | Risk first: engine and server ingest in parallel, then phone, then sync, stops, web | Determinism, RAM and tracking are the three plan-breaking risks | UI first |
| D3 | Repo | One monorepo in `/home/coder/Production/milewage`, `plans/` kept | Decision 1.2; shared types are the point of decision 1.3 | Separate repos per app |
| D4 | Engine as its own package | `packages/track-engine` with an enforced zero-dependency lint rule | `14` §3 | A folder inside `shared` |
| D5 | Node 22.22.x everywhere | `.nvmrc` and `engines` | `better-sqlite3` crashes on earlier 22.x; Node 24 untested | Node 24 |
| D6 | npm workspaces, root scripts, no task-graph tool | Simplicity | pnpm/Nx/Turbo | |
| D7 | OpenAPI is the contract; types and schemas generated; drift fails CI | One source of truth | Hand-written types | |
| D8 | Web uses React + Vite + TS + Tailwind + MapLibre + TanStack Query | Shares types and the query library with the Expo app | **Not decided in the specs; needs approval** | Plain JS, Svelte |
| D9 | PR limit counts source and tests, excludes lockfile/generated/fixtures; one exemption for the verbatim Comma copy | Keeps PRs reviewable without making a mechanical copy impossible | No exemption | |
| D10 | Diagnostics minimum arrives with the server (M2.10–2.11) and phone (M4.9) | The measurements for A1–A15 come from diagnostics events (`16` §9) | Full diagnostics last (M8) | |
| D11 | Backup before sync (M3 before M5) | The server holds the only copy of the data | Backup at the end | |
| D12 | Stops engine after offline sync (M6) | Totals and sync do not depend on stops; the feature is a toggle | Stops first | |
| D13 | Optional work stays optional: PMTiles basemap (M7.13), PDF fallbacks | Modularity Rule | Making them blockers | |
| D14 | Local export, QuickBooks/TurboTax presets, XLSX, KML, auto-start, iOS, map matching, Pi/VPS runs are **not** in this roadmap | Deferred or rejected in the specs | | |

---

## 13. Adversarial review and anti-slop audit (Agent 5)

> [!CAUTION] Findings
> 1. **No PR for anything outside the specs.** Every PR above maps to a spec section; items the specs defer or reject (`local_export`, QuickBooks/TurboTax presets, XLSX, KML, auto-start, iOS, map matching, Pi/VPS, E and F as gates) have no PR. M7.13 (PMTiles) and the PDF exporter are in `05` §3.2 and `08` §11 but are flagged optional with a fallback.
> 2. **Two choices are mine, not the specs':** the web framework (T8) and the CI host (T12). Both are marked for the Human. Neither changes behaviour.
> 3. **Boundary check:** every optional capability sits in a module with a toggle test (§8). The roadmap adds no abstraction without a plausible swap: no plugin loader, no feature-flag service, no message broker (refused in `08` §16.5).
> 4. **Honest gaps:** durations are guesses; "(new)" thresholds are unvalidated; results from one phone, one rider, one city cannot be generalized; the Human check of tax claims is a dependency I cannot complete.
> 5. **Over-testing risk:** the VM test suite (B1–B17) is long. Only the checks named in the exit tables gate a milestone; the rest are run once and recorded.
> 6. **Under-testing risk:** the weakest coverage is the Kotlin service (JUnit covers pure logic only); real behaviour is checked on the phone (A-series). That is why M4 is risk-front-loaded and why a native uploader fallback is pre-planned.
> 7. **Not verified here:** the tooling choices were not trialled (for example the OpenAPI generator, Hermes performance, jest-expo with SDK 56). M0.4 and M4.1 each contain a small tooling check and can change their own choice with a rationale.

---

## 14. What the Human must approve for the Final sign-off

1. **The order and scope** of milestones M0–M10 (§0, §6), including that they close the merged Gate 3 items.
2. **The tooling table** (§3), in particular **T8 (React for the web)** and **T12 (where the repo is hosted and where CI runs)**, which the specs did not decide.
3. **The PR rule** (D9): 400 changed lines with tests counted, lockfiles/generated/fixture data excluded, and the **single exemption** for the verbatim Comma native copy (M4.2).
4. **The exit thresholds**, especially the ones marked "(new)": A1 (+0.5 %/h or +20%), A3 (≥ 20 km, ±2%), A13 (90% detected, 1 false per 10, 15% estimate error), A15 (0.5 s/h, 30 writes/h), B17 (5 MB, 0.1%). Change them now or accept them.
5. **The fallbacks that need a Human decision when they trigger:** rebasing the 150 MB budget; shipping stops default-off; reopening decision 1.7 if reachability needs a custom CA.
6. **The owner schedule** (§4): the VM, the Tailscale/WireGuard choice, the Day 0 ride, odometer readings, three measured loops, a parallel ride, stop ground truth, and the CRA primary-page check.
7. **The first code authorization:** approving the Final sign-off authorizes PRs 1–10 (§7) to begin, in the product repo and no wider; later PRs proceed milestone by milestone under the same PR rules unless the Human pauses at a milestone exit.
8. ~~Play Store scope~~ **DECIDED 2026-11-04:** beta testing on Play (existing account); APK sideload remains the dev path.

Nothing in this document changes any gate status. The sign-off log in `06` is untouched.
