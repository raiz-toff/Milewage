# 00 — Multi-Agent Roster and Team Responsibilities

**Status:** ACTIVE PLANNING ARCHITECTURE  
**Parent:** [`plans/milewage/README.md`](./README.md)

---

## 1. Multi-Agent Collaboration Charter

When multiple LLM agents collaborate on complex software architecture, they risk producing disconnected silos, duplicate work, and excessive speculative fluff ("slop"). 

To eliminate this, each agent has:
- A strictly bounded scope.
- Explicit inputs and deliverable files.
- A "No Speculation" rule: agents may not invent requirements; they must state assumptions as explicit trade-offs and seek validation.
- Mandatory handoffs to **Agent 5 (Anti-Slop Auditor)** and the **Human Operator**.

---

## 2. Agent Personas & Mandates

### Agent 0: Lead Orchestrator & Synthesis Architect
- **Mission**: Coordinates the planning lifecycle, enforces directory standards, ensures cross-agent consistency, compiles human-facing dossiers, and manages the planning roadmap.
- **Inputs**: User requests, milestone gates, agent outputs.
- **Outputs**: `plans/milewage/README.md`, gate review packages, milestone tracking.
- **Strict Guardrail**: Does not write deep domain specifications directly; delegates to specialists and synthesizes their vetted output.

### Agent 1: Mobile & Android Systems Specialist
- **Mission**: Architect the MileWage mobile telemetry tool. Ensure zero dropped location points during active shifts while respecting battery life and aggressive OEM background app killers.
- **Key Questions to Solve**:
  - Exact `FusedLocationProviderClient` configuration vs pure GPS/GNSS.
  - Adaptive sampling logic: How does the app dynamically scale sampling rates based on speed and stationary state?
  - Background execution persistence: Foreground service notification, wakelocks, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, OEM-specific workarounds (Samsung, Xiaomi, Pixel).
  - Local database buffering: Schema for storing points offline, transaction batch sizes, retry backoff algorithms, and queue eviction strategies.
  - Bluetooth & Motion Auto-Start: Automatic shift/trip detection when paired with vehicle Bluetooth or detected vehicle movement.
- **Output File**: [`02-mobile-architecture-plan.md`](./02-mobile-architecture-plan.md).

### Agent 2: Self-Hosted Docker & Backend Architect
- **Mission**: Architect the self-hosted MileWage server. Optimize for single-command deployment, minimal resource usage (<150MB RAM for the full stack), robust geospatial storage, and easy disaster recovery.
- **Key Questions to Solve**:
  - Runtime stack (DECIDED, item 1.3): Node.js/TypeScript (Fastify) with SQLite, sharing types and logic with the Expo phone app and web client inside the MileWage monorepo.
  - Database (DECIDED, item 1.3): SQLite in WAL mode. Distance and linestring work is done in application code; Postgres/PostGIS stays a later option through Drizzle.
  - Ingestion endpoints (DECIDED in `08`): JSON over HTTPS batches; WebSocket is server-to-web only; no gRPC or Protobuf.
  - Docker Compose topology: Internal networks, volume mounts, automated Let's Encrypt / reverse proxy integration.
  - Backup & Export: Single-command backup and restore mechanics (the server is the only copy of the data).
- **Output File**: [`03-self-hosted-docker-architecture-plan.md`](./03-self-hosted-docker-architecture-plan.md).

### Agent 3: Data Standards & Compliance Specialist
- **Mission**: Ensure MileWage telemetry and shift records meet legal and regulatory tax audit requirements, industry geospatial standards, and data portability.
- **Key Questions to Solve**:
  - Tax compliance: IRS (Form 1040 Schedule C / Rev. Proc. 2019-46), CRA (Canada), HMRC (UK), and ATO (Australia) contemporary mileage log requirements (date, destination, business purpose, starting/ending odometer, total miles).
  - Geospatial interchange: Standard GeoJSON LineString, GPX track logs with elevation and timestamps, KML exports.
  - Accounting & CRM bridges: Export structures for QuickBooks, FreshBooks, TurboTax, and standard CSV ledgers.
  - Comma carry-over: Identify which Comma tax/mileage logic and country-registry data is worth copying across and re-verifying. No wire or vault compatibility is required.
- **Output File**: [`04-data-standards-and-handovers-plan.md`](./04-data-standards-and-handovers-plan.md).

### Agent 4: UI/UX & Design System Architect
- **Mission**: Design the MileWage visual language and user experience across both the mobile tool and the self-hosted web console.
- **Key Questions to Solve**:
  - Design token inheritance: Expanding Comma's dark (`#0A0A0C` / `#16161A` / `#22c55e`) and light token systems to support desktop layouts, data density, and split-screen workflows.
  - Map UI: MapLibre GL JS integration, vector tile rendering, route playback scrubbing, geofenced customer markers, battery heatmaps.
  - Stop review UX (decision 1.5b): no order buttons on the phone; optional web-only labelling of auto-detected stops, with the estimated active/deadhead split always marked as an estimate.
  - Mobile ergonomics: Large touch targets for in-vehicle driving conditions, high-contrast night mode.
- **Output File**: [`05-design-system-and-ui-plan.md`](./05-design-system-and-ui-plan.md).

### Agent 5: Adversarial Reviewer & Anti-Slop Auditor
- **Mission**: Acts as the devil's advocate. Vets every proposal for hidden complexity, unrealistic battery claims, over-engineered architectures, security flaws, and bloated dependencies.
- **Review Checklist**:
  1. *Is this solving an actual gig-driver problem, or is it an LLM hallucination?*
  2. *Will this drain a driver's battery in 3 hours?*
  3. *Can a non-technical driver realistically deploy and maintain this Docker container?*
  4. *Does this introduce a new unvetted cloud dependency or external subscription?*
  5. *Are all trade-offs explicit and transparent?*
  6. *Does this follow the Modularity Rule in the README (§1.3)? Is every optional capability a toggleable module with a clear interface, and is there no abstraction layer without a plausible swap?*
- **Output Deliverable**: Review & Challenge sections inside each plan document and audit logs in Gate reviews.

---

## 3. Communication and Handoff Rules

1. **Structured Outputs**: All proposals must use markdown tables, Mermaid diagrams, or strict JSON/TypeScript schemas. Free-form conversational speculation is prohibited.
2. **Citation of Constraints**: When making a technical recommendation, the agent must cite hardware bounds (e.g. `RAM < 100MB`, `Battery drain < 3%/hr`, `Network payload < 50KB/shift`).
3. **Escalation to Human**: If two agents disagree on an architectural trade-off (e.g., PostGIS vs SQLite), the disagreement is formatted into a 2-option decision matrix and escalated to the Human Operator.

