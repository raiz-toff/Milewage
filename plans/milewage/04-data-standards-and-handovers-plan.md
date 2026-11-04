# 04 — Data Standards, Compliance & Handover Specifications

**Lead Agent:** Agent 3 (Data Standards & Compliance Specialist)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION (Gate 1 In Progress)  
**Parent:** [`plans/milewage/README.md`](./README.md)

---

## 1. Regulatory Mileage Log Compliance

A mileage tracker is only as good as its defense in an audit. MileWage designs its data structures from the ground up to satisfy the strictest tax authority standards:

| Regulatory Body | Legal Requirement | MileWage Implementation |
|---|---|---|
| **IRS (United States)**<br>*Rev. Proc. 2019-46 / Treas. Reg. § 1.274-5T* | Written or computer record kept at or near the time of travel: date, destination, business purpose, mileage for each business use, and total miles for the year (Pub. 463). Pub. 463 does not require odometer readings; they are optional supporting evidence for the annual total. | Automatic trip logging with timestamped geocodes, platform tag (e.g. DoorDash delivery), and auto-calculated route distance. |
| **CRA (Canada)**<br>*Automobile Allowance & Logbook Guide* | Logbook showing date, destination, purpose of the trip, distance driven per trip, total annual business vs personal km. | Kilometres/miles toggle, business ratio calculation, PDF log export for any date range up to 366 days (a month, quarter or tax year) containing the record elements the CRA lists. The CRA does not specify a format, so no layout is called "compliant". |
| **HMRC (United Kingdom)**<br>*Simplified Expenses / Advisory Fuel Rates* | Exact business journeys, dates, reasons for journey, miles traveled per vehicle type. | Support for UK vehicle classification (Car, Motorcycle, Van) and advisory rate calculations. |
| **ATO (Australia)**<br>*Logbook Method (12 consecutive weeks)* | Start and end dates of logbook, odometer readings, business percentage, purpose of each journey. | Dedicated 12-week logbook audit mode calculating continuous business-use percentage. |

---

## 2. Geospatial Interchange & Export Formats

MileWage guarantees complete data portability. Drivers own their data and can export it at any time in industry-standard formats:

### 2.1 GPX 1.1 (GPS Exchange Format)
Standard GPX track export compatible with QGIS, Google Earth, Strava, and law enforcement / insurance audit viewers:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MileWage v1.0" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Shift 2026-11-02 — DoorDash / Courier</name>
    <trkseg>
      <trkpt lat="37.774929" lon="-122.419416">
        <ele>15.2</ele>
        <time>2026-11-02T18:04:12Z</time>
        <extensions>
          <speed>8.3</speed>
          <accuracy>4.5</accuracy>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>
```

### 2.2 GeoJSON (RFC 7946)
FeatureCollection representing driving routes and detected stops:
- `LineString`: Driving polyline geometry with embedded properties (distance_km, duration_seconds, platform).
- `Point`: Detected stops with their estimated or labelled role and confidence (labels, payouts and customer data are never exported in GeoJSON or GPX).

### 2.3 Accounting CSV Export
v1 ships two generic CSV levels (per trip and per shift); the columns below are the shift-level file. XLSX and vendor-specific presets are deferred because their import formats are unverified (`08` §11). A generic CSV that opens in any spreadsheet. No accounting-vendor import compatibility is claimed until a vendor publishes a primary import specification (S0):
- `Platform`, `Deliveries_Completed`, `Gross_Pay` and `Tips` are sums over the driver's optional web stop labels and are blank when nothing was labelled. `Active_Miles` and `Deadhead_Miles` are **estimates** when the stop-based segmenter was used (`14` §6) and are marked `estimated`; `Total_Miles` is exact either way.
- Columns: `Date`, `Shift_ID`, `Vehicle_ID`, `Start_Time`, `End_Time`, `Start_Location`, `End_Location`, `Platform`, `Deliveries_Completed`, `Gross_Pay`, `Tips`, `Active_Miles`, `Deadhead_Miles`, `Total_Miles`, `IRS_Deduction_Value`, `Notes`.

---

## 3. What Carries Over From Comma

Per decisions 1.2 and 1.5 (see [`06`](./06-human-in-the-loop-review-gates.md)), MileWage is a separate product. The server holds all data, so there is no vault file, no encrypted sync envelope, and no byte-parity requirement with Comma's `.cmstate` / `.cmlog` formats.

Only these Comma assets are candidates to copy across, each re-verified in the MileWage repo rather than shared:
- Country registry and tax/mileage rate logic.
- Design tokens (see [`05`](./05-design-system-and-ui-plan.md)).
- Onboarding flow ideas.

MileWage offers no Comma import (decision 1.8): Comma has no other users, so MileWage is treated as a new project.

---

## 4. Adversarial Review & Anti-Slop Audit (Agent 5)

> [!CAUTION] Critical Audit Findings & Mitigations
> 1. **Odometer Readings Are Supporting Evidence, Not an IRS Requirement**:
>    - *Audit Finding*: IRS Pub. 463 asks for per-trip mileage and the total miles for the year, not odometer readings. The CRA does ask for the odometer at the start and end of the fiscal period. Purely GPS-based trackers often omit odometer readings, which weakens a driver's position in a CRA audit and is useful corroboration elsewhere (S0).
>    - *Mitigation*: MileWage provides optional odometer entries (shift start/end and fiscal-year start/end, `07` §2), cross-referenced with calculated GPS mileage. They are optional in the US and strongly prompted for Canada.
> 2. **CSV Format Fragmentation**:
>    - *Audit Finding*: Generic CSV exports often require manual cleanup before QuickBooks or TurboTax accept them.
>    - *Mitigation*: Deferred past v1 until each vendor's import format is verified. No named vendor preset is planned until a primary import specification exists (S0 found none for TurboTax and only a community-sourced column list for QuickBooks Self-Employed). A preset, if ever added, would be added as a new exporter module (`08` §16.3) without changing existing code.

