# 05 — UI/UX and Design System Specification

**Lead Agent:** Agent 4 (UI/UX & Design System Architect)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION (Gate 1 In Progress)  
**Build note (2026-11-08):** built; what was done and what differs is in [`progress.md`](./progress.md). The web and phone use shadcn/ui and the MileWage palette, not the Comma styling below (owner decision 2026-11-06, [`DECISIONS.md`](../../DECISIONS.md)). Gate 1 was approved on 2026-11-03 (`06` section 6, [`DECISIONS.md`](../../DECISIONS.md)); this status line was not updated after that.  
**Parent:** [`plans/milewage/README.md`](./README.md)

---

## 1. Design Heritage & Brand Tokens

MileWage strictly inherits and builds upon the design principles established in Comma's [`AGENTS.md`](/home/coder/Production/commaApp/AGENTS.md) and [`marketing/design-prompts.md`](/home/coder/Production/commaApp/marketing/design-prompts.md).

### 1.1 The Brand Rules
1. **Never Invent Hex Codes**: Every surface, border, and text element must use established design tokens.
2. **Typography Hierarchy**:
   - **Headings & Key Metrics**: *DM Serif Display* (dignified, editorial, calm).
   - **Interface & Body**: *DM Sans* (neutral, highly legible at small sizes).
   - **Money, Mileage & Timers**: *DM Mono* (tabular, predictable number alignment).
3. **Product Mode Palette (Dark Default)**:
   - Primary Surface: `#000000` / `#0A0A0C`
   - Secondary / Card Surface: `#16161A`
   - Hairlines & Borders: `#2E2E36`
   - Primary Text: `#F6F6F7`
   - Muted / Secondary Text: `#9B9BA4`
   - Hero Accent: `#22c55e` (Emerald Green for earnings/active status)
4. **Light Theme Discipline**:
   - Accents must flip to their 600/700 twins (e.g. `#15803D`) to pass WCAG AAA contrast ratios on white backgrounds.

---

## 2. Mobile App UI: Driving Ergonomics

Drivers interact with their phones while mounted to a vehicle dashboard vent or windshield.

```
+-------------------------------------------------------+
|  ACTIVE SHIFT                                03:14:22 |
|                                                       |
|   DISTANCE TODAY              SYNC                    |
|   38.4 km                     ● Not yet on server     |
|                                                       |
|   Odometer start: 12,480 km   [ Edit ]                |
|                                                       |
|                                                       |
|                                                       |
|                         [   END SHIFT   ]             |
+-------------------------------------------------------+
```

The phone has **no order buttons** (decision 1.5b): the rider starts a shift, rides, and ends it. After the shift the detail screen shows total distance, and, when stops are on, an **estimated** active/deadhead split and the detected stops as read-only markers. There is no end-of-shift review screen to fill in. Labelling stops (pickup, dropoff, platform, payout) is optional and happens only on the web.

### 2.1 Ergonomic Guidelines
- **Minimum Touch Target**: 48x48dp (minimum 56dp for the one high-frequency driving button, **Start / End shift**).
- **Zero Distraction / High Contrast**: Glanceable status badges (Active GPS: Pulsing Emerald dot; Buffering Offline: Amber pill).
- **One-Tap Actions**: Big accessible action bars pinned to the bottom thumb-zone.

### 2.2 Diagnostics on the phone (minimal, `16` §6.5)
Settings has a read-only **Diagnostics** row: the current level (it is changed on the web), events waiting, and the last upload time. There is no event viewer on the phone. While a capture session is active, the home screen shows a banner ("Tuning capture on until <date>") with a **Stop capture** button, and the foreground notification text changes. Nothing is shown while riding.

---

## 3. Self-Hosted Web Dashboard UI

The desktop web application serves as the command center for retrospective analysis, tax prep, and shift review, optional stop labelling and exports.

```
+---------------------------------------------------------------------------------+
|  MILEWAGE   [Dashboard]   [Live Map]   [Shifts]   [Tax & Reports]  [Settings]
+---------------------------------------------------------------------------------+
|                                                        |                        |
|                   Interactive Map                      |    Shift Details       |
|            (MapLibre GL Vector Tiles)                  |                        |
|                                                        | Date: Nov 2, 2026      |
|   [Route Polyline in Emerald]                          | Duration: 4h 12m       |
|   [P = Detected stop, estimated pickup]                | Total: 54.2 mi         |
|   [D = Detected stop, estimated dropoff]               | Active*: 41.8 mi       |
|                                                        | Deadhead*: 12.4 mi     |
|   +----------------------------------------------+     | Gross: $184.00 (labels)|
|   |  Timeline Scrubber:  [====●==============]   |     | Deduction: $36.31      |
|   |  12:00 PM                               4:12 PM |  |                        |
|   +----------------------------------------------+     | * estimated            |
|                                                        | [ Export PDF Log ]     |
+---------------------------------------------------------------------------------+
| Detected stops (optional labelling):                                            |
| Time    Dwell   Confidence  Estimate    Label            Platform   Payout       |
| 12:41   6 min   high        pickup      [ pickup   v ]   DoorDash   -            |
| 12:58   3 min   medium      dropoff     [ dropoff  v ]   DoorDash   $12.50       |
| 13:20   2 min   low         (none)      [ other    v ]   -          -            |
+---------------------------------------------------------------------------------+
```

### 3.1 Responsive Layout Features
- **Split Screen**: Resizable side panel for route inspection and stops and labels alongside full-height vector map.
- **Playback Scrubber**: Scrub back and forth across any past shift to see exact vehicle speed, coordinates and detected stops at any given minute.
- **Dense Data Tables**: Keyboard-navigable tabular data with sortable columns, CSV quick-copy, and inline editing.

### 3.1a Stops and labelling (web only, optional)

Shown only when the stops setting is on and the shift has detected stops.

- **Every estimate is marked.** Active and deadhead distances carry an "estimated" marker (an asterisk and a tooltip) on the dashboard, the shift panel, the stop table, CSV/PDF exports and the phone's shift detail. **Total distance is never marked estimated**: it never depends on stops.
- **Detected stops** appear as markers on the route and as rows in the stop table, each with dwell time, confidence (low / medium / high) and the engine's estimated role. Low-confidence stops are drawn muted.
- **Labelling is a fix-up tool, not a chore.** Each row has a role dropdown (pickup, dropoff, other), optional platform, place, payout and tip, and a clear button. Labelling any stop re-runs the estimate for the shift immediately; the panel shows the new split. Nothing needs to be labelled for the shift to be complete.
- **Warnings the screen must show:** when a shift has stacked orders the estimate under-states active miles ("stacked orders? label the stops"); when a shift has edited trips, labelling may unlink those edits (`14` §6.7); a stop whose label no longer matches is listed as "label not applied".
- **Shift summary and exports** sum payouts and tips from labels only. With no labels, earnings read "not entered", never zero.
- **Setting.** A switch in Settings: "Detect stops and estimate active vs deadhead" (default on). Turning it off hides everything above, keeps stored stops and labels, and makes new shifts report one business total. Past shifts do not change.

### 3.2 Basemap (decision)

> **Amended by decision 1.11 (owner, 2026-11-07).** The default basemap is **OpenFreeMap** (`https://tiles.openfreemap.org/styles/positron` light, `/styles/dark` dark): free public vector tiles, no key, commercial use allowed, attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" shown as a compact control. The owner chose it over CARTO (Comma's choice, licensed for non-commercial use only) and over a self-hosted file only (an extra setup step for every driver). Trade-off accepted: the tile server learns which areas are viewed (not the route, which is drawn in the browser). A build can still set `VITE_MAP_STYLE_URL` to a self-hosted PMTiles style, or to `none` for the plain background. If the style cannot load (offline, server down) the map falls back to the plain background and keeps the route. The text below is the original Gate 2 decision, kept for the record.

- **Self-hosted PMTiles.** The map uses MapLibre GL with one optional `region.pmtiles` vector-tile file, served by Caddy from the `tiles` volume (`10` §2) with HTTP range requests. The driver downloads an extract of their own region once. No tile request ever leaves the home server, so the areas a driver views are not disclosed to a third party, and the CSP stays `connect-src 'self'` (`08` §10).
- **Without the file** the map draws routes and markers on a plain background. Nothing breaks.
- **Rejected:** a public tile server (leaks viewed regions, and public servers restrict heavy use), and a ServiceWorker tile cache (a second cache to keep correct for no gain with one local file).
- **Unverified:** region extract sizes and the download/extract step have not been measured. Spike B records extract size and load time on a Raspberry Pi.

### 3.3 Diagnostics screens (module `diagnostics`, `16` §10)

Tables and one timeline strip, no chart library and no dashboard tiles (the §4 rule applies). A "Diagnostics" group in the navigation, hidden when the module is off:

- **Health:** per paired device, the last 7 shifts as seven checks with a traffic light each and a 0 to 100 score; plus five server checks.
- **Shift timeline:** one shift's service, windows, uploads, engine and sync events as lanes, merged with the shift's flags.
- **Errors:** crashes grouped by signature (count, first and last seen, app version, device model).
- **Server:** the latest memory, event-loop lag, disk and error-rate figures as a small table.
- **Capture sessions** (module `capture`, off by default): start and end a session, download its replay (anonymized by default), and an annotation table to mark detected stops real, false or missed.
- **Settings:** the diagnostics level (off, basic, verbose; verbose reverts after 7 days) and a **Download debug bundle** button (redacted: relative times, pseudonymous ids, no location, no capture data unless ticked).

---

## 4. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Critical Audit Findings & Mitigations
> 1. **Slop Dashboard Trap (Too Many Generic Charts)**:
>    - *Audit Finding*: AI-generated dashboards often fill empty space with useless doughnut charts ("Deliveries by Day of Week", "Weather vs Tips").
>    - *Mitigation*: Only 3 core dashboard metrics are allowed on the main screen: **Hourly Earnings** ($/hr, pay plus tips divided by shift hours; expenses were out of scope at Gate 2; decision 1.9 reinstated them, see `18`: the dashboard keeps these three metrics, and net figures live in the analytics screen), **Deduction Value** (\$), and **Active vs Deadhead Distance Split** (miles). Everything else is tucked into dedicated reports.
> 2. **Map Tile Bandwidth Consumption**:
>    - *Audit Finding*: Loading raster tiles continuously over slow mobile data or self-hosted connections burns driver bandwidth and can cost money.
>    - *Mitigation*: See the basemap decision in §3.2 below. Tiles come from one self-hosted file, so there is no third-party tile traffic at all.

---

## 5. Modularity (README §1.3)

Every screen is owned by an API module and is hidden when that module is off (the web client reads `modules` from `GET /settings`, `08` §16.1). Core screens (login, shifts list, trips and odometer editing, settings, summary) are always present.

| Screen or control | Owning module | When the module is off |
|---|---|---|
| Detected stops, stop labelling screen, estimated active/deadhead split (web and phone) | `stops` (the `stops_enabled` setting) | Hidden. Mileage is one business total; earnings show as unavailable (`08` §16.2). |
| ~~Live map~~ | ~~`live`~~ | **Removed by decision 1.10 (2026-11-07).** |
| Route map, timeline scrubber | `replay` (and `tracking`) | Hidden. |
| Export buttons, one per format | one `exporters` switch per format | That button disappears. |
| Backup download, off-site reminder | `backup.download` | Hidden; the driver collects backups from the volume. |
| Pair a phone, device list | `devices` | Hidden. The system is web-only. |
| Diagnostics screens (Health, shift timeline, Errors, Server, debug bundle) and the diagnostics level setting | `diagnostics` | Hidden. |
| Capture sessions and the annotation table | `capture` (**off** by default) | Hidden. |
| Phone Diagnostics row and capture banner | `diagnostics` and `capture` | Hidden; the phone behaves as level `off`. |
