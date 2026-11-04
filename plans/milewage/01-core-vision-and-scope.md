# 01 — Core Vision, Ecosystem Scope & Brand Migration

**Status:** ACTIVE PLANNING ARCHITECTURE  
**Parent:** [`plans/milewage/README.md`](./README.md)

---

## 1. Context & Nomenclature Evolution

MileWage is a new product in a new repo, derived in spirit from **Comma**. Comma stays in `commaApp`, untouched.

```
+----------------------------------------------------------------------------+
|                          MILEWAGE ECOSYSTEM                                |
+----------------------------------------------------------------------------+
|                                                                            |
|   +-------------------------------+    +-------------------------------+   |
|   |     MileWage Mobile App       |    |   MileWage Self-Hosted Web    |   |
|   |  (Mileage-tracking companion  |    |  (Thin client: no local data  |   |
|   |   buffers only while offline) |    |   cache, needs the server)    |   |
|   +---------------+---------------+    +---------------+---------------+   |
|                   |                                    |                   |
|                   +-----------------+------------------+                   |
|                                     |                                      |
|                                     v                                      |
|                   +----------------------------------+                     |
|                   |    MileWage Server (Docker)      |                     |
|                   |   Source of truth for all data   |                     |
|                   +----------------------------------+                     |
+----------------------------------------------------------------------------+
```

### 1.1 Brand & Terminology Mapping
- **Comma Phone App** &rarr; **MileWage Mobile App**: Expanded beyond simple shift logging to include high-precision GPS tracking, automatic trip and stop detection (no per-order taps).
- **Comma Web App** &rarr; **MileWage Self-Hosted Web Application**: Containerized thin web client served by the self-hosted server, with live map telemetry, optional stop labelling, shift replay, and multi-format tax export. It keeps no local data cache and does not work without the server.
- **Comma Vault** &rarr; *not carried forward*: the server holds all data. Comma's local-first vault/sync engine is replaced by a single server-side database.

---

## 2. Core Value Proposition for Drivers & Couriers

Gig workers (DoorDash, UberEats, Instacart, Amazon Flex, couriers) face three universal problems:
1. **The Mileage Audit Trap**: Tax agencies (IRS, CRA, HMRC) require contemporaneous, verifiable mileage logs with exact dates, locations, and business purposes. Manual notes fail audits; big-tech tracker apps (MileIQ, Everlance, Gridwise) charge \$60–\$120/year, sell location data, and track drivers even off-shift.
2. **Deadhead vs Active Mile Visibility**: Drivers need to know how much distance they spend on an order versus driving empty looking for orders. Separating these optimizes route efficiency and maximizes deductible tax write-offs.
3. **Data Sovereignty & Privacy**: A driver's location data reveals where they live, where they sleep, and where they eat. Storing this in an unencrypted corporate database is an unacceptable privacy hazard. MileWage gives drivers their own private, self-hosted Docker vault.

---

## 3. Scope Boundaries: In-Scope vs Out-of-Scope

### 3.1 In-Scope (Phase 1 & 2 Targets)
- **Mobile Telemetry Collection**:
  - High-precision, battery-optimized background GPS tracking.
  - Automatic drive start/stop via vehicle Bluetooth and movement detection.
  - Offline buffering (only what must be held until the server is reachable) with zero data loss during network dead zones.
- **Self-Hosted Docker Deployment**:
  - Single-line Docker Compose setup with internal DB and reverse proxy.
  - User authentication and device pairing via QR code.
  - Real-time and historical GPS map visualization.
- **Stops and Estimated Split** (decision 1.5b; a setting, default on):
  - Stops are detected automatically from the GPS track. The rider only starts and ends a shift.
  - Active vs deadhead mileage is an **estimate** from the stop pattern, always labelled as such. Total business miles never depend on it.
  - Optional, web-only labelling of stops (pickup, dropoff, platform, payout) to correct the estimate and record earnings.
- **Diagnostics (decision 1.5c)**:
  - Built-in testing and debugging diagnostics in the phone app, the server and the web app, collected only to the driver's own server, with no coordinates, addresses, payouts, labels or free text (`16`).
- **Data Handovers & Compliance**:
  - IRS / CRA / HMRC compliant mileage logs (PDF and CSV export).
  - Standard geospatial export (GeoJSON, GPX).

### 3.2 Explicitly Out-of-Scope (To Prevent Slop & Creep)
- **Centralized SaaS / Cloud Subscriptions**: MileWage will never require an account on a centralized company server. It is 100% self-hosted: all data lives on the driver's own server.
- **Invasive Screen Scraping / Account Hijacking**: MileWage will not require users to input their gig platform passwords (e.g. DoorDash credentials) to scrape data, which violates platform ToS and risks deactivation.
- **Bloated Fleet Enterprise Telematics**: MileWage is built for independent drivers and small owner-operators, not 1,000-vehicle freight logistics enterprises. We avoid over-engineered ERP features.
- **Unvetted Third-Party Cloud APIs**: No mandatory paid Google Maps API keys or third-party tracking SDKs (e.g. Segment, Mixpanel). Open-source, self-hosted alternatives only.

