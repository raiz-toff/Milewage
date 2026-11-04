# 06 — Human-in-the-Loop Review Gates and Governance Protocol

**Lead Agent:** Agent 0 (Lead Orchestrator) & Agent 5 (Anti-Slop Auditor)  
**Status:** ACTIVE GOVERNANCE PROTOCOL  
**Parent:** [`plans/milewage/README.md`](./README.md)

---

## 1. Governance Principles

The planning of MileWage is governed by **Human-in-the-Loop (HITL) checkpoints**. No agent is permitted to move from planning to execution or assume answers to fundamental product questions.

Every transition from one planning milestone to the next requires an explicit **Review Dossier** and **Human Sign-Off**.

**Standing rule at every gate:** the Modularity Rule in the [README §1.3](./README.md) must hold. A gate dossier that lacks a Modularity section, or that hard-wires an optional capability, fails review.

```
+------------------------------------------------------------------------+
|                      HUMAN-IN-THE-LOOP GATES                           |
+------------------------------------------------------------------------+
|                                                                        |
|  [GATE 1] Scope & Gray Zones Clearance                                |
|     |  - Multi-agent trade-off analysis completed                      |
|     |  - 4 foundational questions signed off by Human                  |
|     v                                                                  |
|  [GATE 2] Frozen Technical Specifications & Wire DTOs                 |
|     |  - Exact database schemas, REST/WS APIs, and JSON contracts        |
|     |  - Battery & memory consumption budgets verified                 |
|     v                                                                  |
|  [GATE 3] Prototype Spikes & Proof-of-Concept Plan                     |
|     |  - Android background service spike plan                         |
|     |  - Docker Compose memory & container benchmark plan              |
|     v                                                                  |
|  [GATE 4] Execution Phasing & Implementation Roadmap                  |
|     |  - Granular, atomic PR steps (no giant single-commit drops)      |
|     |  - Verification gates and characterization tests defined         |
|     v                                                                  |
|  [FINAL SIGN-OFF] Authorization to Write Code                          |
+------------------------------------------------------------------------+
```

---

## 2. Gate 1: Scope & Gray Zones Checklist (APPROVED 2026-11-03)

### Purpose
Align completely on naming, repository structure, backend technology stack, and driver tenancy before spending time writing deep code schemas.

### Review Rubric
- [x] **Item 1.1 — Brand Transition**: DECIDED 2026-11-03. Renamed to **MileWage**.
- [x] **Item 1.2 — Codebase Topology**: DECIDED 2026-11-03. MileWage is a **new, separate repo** (`/home/coder/Production/milewage`). Comma stays in `commaApp`, untouched. Reused ideas/code are copied across deliberately and re-verified, not shared via `shared/`.
- [x] **Item 1.3 — Backend Stack Selection**: DECIDED 2026-11-03. **TypeScript (Fastify + Drizzle) + SQLite**, Caddy for TLS, in one monorepo with a shared types/logic package. Chosen because the phone app is Expo/React Native (TypeScript) and the web client is too, so API types and mileage logic are shared. Go and Postgres/PostGIS were rejected (see `03` §2).
- [x] **Item 1.4 — Tenancy Model**: DECIDED 2026-11-03. Single-user (1 driver per instance). Every table still carries a `user_id` so multi-user is an added feature later, not a rewrite.
- [x] **Item 1.5 — Server is the source of truth**: DECIDED 2026-11-03. The self-hosted server holds all data. The web app is a thin client with no local data cache and does not work without the server. The phone app is a delivery-tracking companion: it records trips and deliveries, buffers only what it must while offline, and lets the driver add details at the end. Comma's local-first vault/sync engine is not carried forward. Only its best ideas are (country registry, tax/mileage logic, design system, onboarding).

---

- [x] **Item 1.5a — Phone works offline for weeks (revises 1.5)**: DECIDED 2026-11-04. The server stays the final source of truth, but the phone is a working local app: it runs the shared processing module at shift end (starting from Comma's proven algorithm), stores raw points and results, and shows everything offline, even if the driver does not connect for a week or more. Data stays on the phone until the server confirms it. The server re-runs the same module on the uploaded raw points; mismatches are flagged, not silently overwritten. Specs: `14` (processing) and `15` (offline storage and sync).
- [x] **Item 1.5b — No per-delivery taps; auto-detected stops (revises the delivery model)**: DECIDED 2026-11-04. The phone has only start shift and end shift: no Accepted / Picked up / Dropped off buttons and no end-of-shift order review. Stops are auto-detected from the GPS track by the shared track-engine (dwell clusters, deterministic, same result on phone and server). The active vs deadhead split is **estimated** from the stop pattern and labelled "estimated" everywhere; total business miles for tax come from the whole shift and never depend on stops. Optional labelling of stops (pickup, dropoff, other, platform, payout, notes) happens **only in the web app**, after the fact. The whole feature is one setting, `settings.stops_enabled` (default on), exposed via `GET /settings`; when off, no stop or split UI or routes are used and totals are whole-shift only. The `deliveries` module and the phone's delivery routes are replaced by the `stops` module. Specs: `14` §6, `07` §2.8, `08` (`stops`), `15`, `05` §3.1a.
- [x] **Item 1.5c — Built-in diagnostics, owner's own server only**: DECIDED 2026-11-04. Diagnostics (not the GPS telemetry the plans already call telemetry) are built into the phone app, the server and the web app from the first build, for testing, debugging and further improving. Everything is collected only to the driver's own self-hosted server: no third-party SDK, crash service, analytics service or outside endpoint. Diagnostics never contain coordinates, addresses, payouts, labels or free text (an allowlist, tested with canary values). The `diagnostics` module is toggleable (default on, level `basic`); a separate `capture` module (default off) records dense fixes plus annotations for tuning and replay. Spec: `16`.
- [x] **Item 1.5d — Defaults accepted**: DECIDED 2026-11-04. The Human accepted the defaults listed in `11` §8.1 (unsynced reminders at 3 days then daily and stronger at 7; reminders plus blocking unpair for v1 with the encrypted local export in v1.1; no offline basemap in v1) and `11` §10.3 (diagnostics level `basic`; retention 90 / 14 / 365 days; capture off by default; `diagnostics.db` not backed up).
- [x] **Item 1.6 — Phone platform**: DECIDED 2026-11-03. **Expo / React Native** (TypeScript), **Android first**. iOS may follow from the same codebase, but its background location rules differ, so it is not assumed to work until its own spike passes.
- [x] **Item 1.7 — Deployment target**: DECIDED 2026-11-03. **Home lab first**: the server must run well on a home server or Raspberry Pi (x86_64 and ARM64). The phone reaches it while driving through a private tunnel (Tailscale) or a tunnel/domain the owner already uses. VPS support follows after home lab works. Local-IP-only is unsupported because it fails when the driver leaves home Wi-Fi (see `03` §4.3).
- [x] **Item 1.8 — Comma import**: DECIDED 2026-11-03. No import. Comma has no users besides the owner, so MileWage is treated as a new project.

---

## 3. Gate 2: Technical Specifications Checklist (APPROVED 2026-11-03)

### Purpose
Ensure all APIs, database migrations, and mobile service loops are 100% specified without vague "TBD" placeholders.

### Review Rubric
- [x] Full OpenAPI 3.1 specification for `/api/v1/*` routes published (`08` §13). Linting and generated-types vetting is a Gate 4 task (`08` F16).
- [x] SQLite schema fully specified (`07`: DDL with foreign keys, indexes for time-range and shift queries, migration policy). The Drizzle files themselves are code and belong to Gate 4.
- [x] Background location approach and battery mitigation specified (`09`). APPROVED by the Human 2026-11-03 together with three related decisions: (1) copy and trim Comma's native tracking module; (2) phones without Google services are unsupported in v1 and show a clear message (the `LocationManager` fallback is deferred, `09` §5.7); (3) test phones for Spike A: the owner has a Samsung now, Pixel and Xiaomi runs are later (`12` §16); (4) the self-hosted basemap needs a one-time regional download. Real battery behaviour is proven only in Spike A (Gate 3).
- [x] Server-side backup/restore round trip specified (`10` §3, §7). Proven only in Spike B.
- [x] Modularity Rule check: `07` §1.1, `08` §16, `09` §5.5a, `10` §3.1 and `05` §5 list modules, interfaces, toggles and removal paths; optional features live in their own routes and tables.
- [x] Anti-Slop Audit performed (`11`): speculative features cut and missing boundaries added. Awaiting Human review.

---

## 4. Gate 3: Prototype Characterization Spikes (CURRENT STAGE)

**Plan:** [`12-gate3-spike-plan.md`](./12-gate3-spike-plan.md) — **revised 2026-11-04 (slim version), awaiting re-approval.** It keeps S0 (done) and Spike B (server), shrinks Spike D (reachability: Tailscale vs the existing WireGuard, no custom CA), turns Spike A into normal scooter delivery riding judged "no worse than Comma's module" with the offline-queue checks (C-lite) folded in, and defers Spikes E (basemap) and F (PDF) as optional modules. The earlier seven-spike plan approved 2026-11-03 is superseded; see `12` §16 for the differences. The bullets below are the original summary and are kept for the record.

**Open Human questions from specs `14` and `15`** (tracked in `11` §8): reminder timing for unsynced data (3 days, then daily); whether reminders plus a blocked unpair are enough for v1 or the encrypted `local_export` is needed first; and accepting no offline basemap in v1. The fourth question (active/deadhead depending on taps) was resolved by decision 1.5b on 2026-11-04: no taps, auto-detected stops, estimated split, web-only labelling.

### Purpose
Before building the full production system, create isolated, minimal spikes to validate the highest-risk technical assumptions:
- **Spike A (Mobile Power)**: Run a 4-hour background GPS test measuring actual mA battery draw on a physical Android phone.
- **Spike B (Docker Memory & SQLite)**: Deploy minimal Fastify + SQLite (WAL) behind Caddy in a Proxmox VM capped at 1 vCPU / 1 GB (Pi and VPS runs are later, see `12` §16), measure idle and peak RAM and write throughput under 50 req/sec telemetry loads.
- **Spike C (Offline Upload Queue)**: Drive through a network dead zone and confirm the phone's buffer uploads with no lost or duplicated points once the server is reachable.

---

## 5. Gate 4: Execution Phasing & Implementation Roadmap

### Purpose
Break down the implementation into small, atomic, verifiable PRs.
- No PR larger than 400 lines of code.
- Every PR accompanied by automated unit/integration tests.
- Zero broken builds on `main`.

---

## 6. Official Sign-Off Log

| Gate | Date Submitted | Reviewer (Human) | Status | Notes / Conditions |
|:---:|:---:|:---:|:---:|:---|
| **Gate 1** | *2026-11-02* | rajkumar | **APPROVED 2026-11-03** | Items 1.1–1.8 decided |
| **Gate 2** | *2026-11-03* | rajkumar | **APPROVED 2026-11-03** | Dossier: [`11`](./11-gate2-audit-and-decisions.md). Specs 07–10 frozen as the basis for Gate 3. 14 unverified claims (`11` §4) must be checked before Gate 4. |
| **Gate 3** | *2026-11-03* | rajkumar | **MERGED INTO GATE 4 (2026-11-04)** | The Human chose not to run a separate spike phase. The checks in `12` (Spike B in the capped VM, D, and the on-phone checks of A and C) run as build milestones with pass/fail exit criteria in the Gate 4 roadmap. Throwaway rigs already built stay in `milewage-spikes/`. |
| **Gate 4** | *2026-11-04* | Pending | **OPEN — roadmap being drafted** | Roadmap: [`17`](./17-gate4-execution-roadmap.md) (in progress). |
| **Final Exec** | — | — | LOCKED | Blocked on Gate 4 |

