# 18 — Comma Parity: Driver Admin Modules

**Lead Agent:** Agent 0 (Orchestrator) with Agents 2, 3 and 4  
**Status:** DRAFT SPECIFICATION — decision 1.9 (owner, 2026-11-05) recorded; modules below are specified, none is built yet  
**Build note (2026-11-08):** built; what was done and what differs is in [`progress.md`](./progress.md). The modules ship in 0.1.0 ([`CHANGELOG.md`](../../CHANGELOG.md)), so "none is built yet" is out of date. Decision 1.9 (2026-11-05, `06` section 6) is the owner's record for this plan; no separate sign-off of the spec is recorded.  
**Parent:** [`plans/milewage/README.md`](./README.md) · Amends [`01`](./01-core-vision-and-scope.md), [`05`](./05-design-system-and-ui-plan.md), [`07`](./07-database-schema-spec.md), [`08`](./08-api-spec.md), [`11`](./11-gate2-audit-and-decisions.md)  
**Source read (read-only):** `commaApp` `app/`, `app/(tabs)`, `src/` (schema, registry, services), `utils/taxCalculations.ts` and `docs/`.

This document is a specification, not code. It follows the conventions of `07` §1 (single user, `user_id` on every table, integer cents, metres, UTC epoch ms, `TEXT` enums with `CHECK`) and the operation style of `08`.

---

## 1. Decision and Guard-rails

**Decision 1.9 (owner, 2026-11-05).** MileWage brings back, as modules, every driver-facing admin function that Comma's phone and web apps have. This reverses the "Expenses: out of scope" rows (`07` §7.1 and D8, `11` §2), the "analytics, notifications: deliberately absent" line (`08` §3), the "no additional reports" line (`08` §12) and the "notification module refused" line (`08` §16.5).

What does **not** change:

| Rule | How it holds here |
|---|---|
| Server is the source of truth | Every module is server tables plus routes. The web is a thin client. The phone reads through the pull path (`sync` module, `08` §6a) and keeps only reminders it must fire offline. No local-first engine is ported from Comma. |
| One user, `user_id` everywhere | Every table below carries `user_id`; the API never accepts it. |
| No per-delivery taps | Nothing here adds a phone order UI. Earnings are never tapped per delivery. |
| Payouts only from stop labels or entered by the driver | Two sources only: `stop_labels` (`07` §2.8) and the driver's own per-shift totals (`shift_earnings`, §4.3), typed on the web or imported from the driver's own CSV. Nothing is inferred, scraped or estimated (`01` §3.2). |
| No speculative extras | A feature is here only if Comma ships it for drivers. Where Comma's behaviour conflicts with a MileWage rule, the row says what is dropped and why (§3.3). |
| Modularity Rule (README §1.3) | Each module has a toggle, a documented default, and a removal path (§11). Disabled means absent: no routes, no screens, no jobs; tables stay. |

## 2. Comma Inventory (what a driver can do in Comma)

Read from the Comma source and `docs/`. "Where" is the Comma screen or service.

| # | Function | Where | Detail |
|---|---|---|---|
| C1 | Expenses | `app/expense/*`, `(tabs)/expenses`, `expenseCategories.ts`, `recurringExpenses.ts` | Add, edit, delete. Fields: amount, date, merchant (autocomplete), category (20, CRA-aligned), deductible flag, business-use % (0 to 100), vehicle link, shift link (shifts within 7 days offered), notes, receipt photo, recurring (weekly, monthly, yearly) and, in Canada, HST/ITC paid. Filter by category and deductibility. Year-to-date tiles: deductible vs total spend. Standard-mileage guardrail (fuel, maintenance, insurance warn on a standard-mileage vehicle). Recurring is a reminder: when due, the driver confirms and one occurrence is created; snooze. The "scan receipt" button is a placeholder with fake values. |
| C2 | Goals | `app/goals`, `setup/goal`, `gamification.ts` | Goal = type (earnings, hours, shifts, active distance) x period (daily, weekly, monthly, yearly) x target; progress rings; default $500 weekly earnings seeded. |
| C3 | Gamification | `gamification.ts`, Progress tab | XP (100 per level), streak and streak freezes (max 3), 3 weekly challenges, 24 badges, celebration on unlock. Depends on the Goals flag. |
| C4 | Schedule | `app/schedule` | Calendar of planned shifts (single or recurring templates), non-delivery (off) days, local reminder 30 min before with Start and Remind-in-10 actions. Templates and off days stored as settings JSON. Feature flag, default off. |
| C5 | Analytics | `(tabs)/analytics` | Period navigator (week, month, year); 6 groups (Trends, Work Rhythm, Income Sources, Outlook, Efficiency and Stability, Order Economics); stat cards (gross, net take-home, expenses and burn ratio, average $/hr active vs online, tax set-aside, total time). Flag, default on. |
| C6 | Reports and export | `app/reports` | Period picker; shifts CSV; expenses CSV; PDF summary (flag, default off). Web extras: mileage-log CSV, tax summary CSV/JSON, print view, Year-in-Review image. |
| C7 | Tax Center | `(tabs)/tax`, `app/tax/center`, `taxCalculations.ts` | Taxable income = gross + tips + bonus − weighted deductible expenses − mileage deduction; CPP/CPP2 or QPP; income tax at the driver's set-aside rate; HST/GST owing if registered (collected − input tax credits); the mileage deduction shown as a deduction, never cash; Tax Jar (per-year manual set-aside, target = gross x rate, quick-add); CRA deadlines (instalments 15 Mar/Jun/Sep/Dec, filing 15 Jun) with a 10-day reminder; T4A threshold alert (CAD 500 per platform); JSON/CSV tax summary export. Docs say Canada only; the code also holds IRS Schedule C/SE and HMRC NI helpers that the docs say were removed pending verification. |
| C8 | Vehicles | `app/vehicles/*`, `setup/vehicle` | Nickname, type (gas, hybrid, EV, motorcycle, bicycle, e-bike, scooter, walking), make, model, year, plate, fuel type, current odometer; active vehicle (default for a new shift); delete; annual tax profile per vehicle (method standard mileage or actual expenses, primary/secondary rate, rate threshold, beginning/ending odometer); eligibility (bicycle, e-bike, scooter get no automobile rate); maintenance log (oil, tires, brakes, fuel, wash, other; cost, date, odometer, notes). |
| C9 | Profile and settings | `settings/profile`, `settings/index` | Name, country, province (sets provincial preset), distance unit (derived), currency, week start, time format, theme, accent, font size, layout density (web), date format (web). Feature toggles. |
| C10 | Platforms | `setup/platforms`, Settings, `platforms` table | Built-in list (CA: DoorDash, Uber Eats, SkipTheDishes, Foodora, Instacart, Amazon Flex, Other); custom platforms (name, colour, emoji); activate or deactivate; default hourly target; default per-km mileage rate; sort priority; header switcher that filters the whole app; per-platform vocabulary ("block" for Flex); a shift may span platforms, each with its own online time, earnings and trips (`shift_platforms`). |
| C11 | Notifications | `app/notifications`, `notify.ts`, Settings, Alerts | In-app list (day-grouped, read, dismiss) and OS notifications. Seven toggles: shift reminders, goal achievements, tax filing alerts, weekly digest, vehicle maintenance, insurance expiry, sync reminder. Triggers actually implemented: badge, challenge, level up, streak freeze, streak at risk, tax instalment due, shift reminder, backup overdue/complete/failed, plus operational confirmations (export, import, restore, wipe). Weekly digest, vehicle maintenance and insurance expiry exist only as toggles; no trigger code was found. |
| C12 | Import and export of data | `settings/import`, `settings/backup`, `docs/guides/import-csv.md` | CSV import (shifts, expenses; web wizard for platform statements); CSV export; Google Drive backup and two-way sync; data health check; danger zone (reset one platform, reset the vault). |
| C13 | Dashboard and onboarding | `(tabs)/index`, `setup/*` | Today/Week hero, hours/distance/$ per hour tiles, goal ring, activation checklist (other apps, real vehicle, goal, GPS, backup), recent sessions with mini-map, mileage write-off tip. |
| C14 | Other | `about`, `widgets`, demo mode, keyboard shortcuts, year-in-review | About and version, Android home widget, demo/sample data, web shortcuts and fullscreen, Year-in-Review image. |

## 3. Gap Analysis

### 3.1 Already in MileWage

| Comma | MileWage today | Note |
|---|---|---|
| Shifts, route, trips, odometer (C8 partial) | core, tracking, replay (`07` §2.2 to 2.3) | Shift and trip edit, purge and recalculate exist. Per-shift and year odometer readings exist (web `Odometer`, `ShiftOdometer`). |
| Export shifts CSV, mileage-log CSV, PDF (C6 partial) | exporters `csv` (`level=trip` and `level=shift`), `pdf`, `gpx`, `geojson` (`08` §11) | Print view = the PDF summary page rendered by the browser; no new route. |
| Mileage deduction (C7 partial) | country packs US, CA, GB; `GET /summary` `deduction_cents` | Read-time, shown as a deduction. |
| Profile basics, units, currency (C9 partial) | `GET/PATCH /settings`: country, distance unit, currency, timezone | Name, region, week start, time format are missing. |
| Password | `POST /auth/password` (`changePassword`) | Has no web screen yet. |
| Vehicles (C8 partial) | `GET/POST /vehicles`, `PATCH /vehicles/{id}`; kinds car, motorcycle, van, bicycle; archive, not delete | No web screen yet (the odometer screen says "add one on the phone"). |
| Backup and restore (C12 partial) | backup module, `age`-encrypted | Replaces Google Drive backup and sync (`01` §1.1). |
| Data health check (C12) | `shift_flags` and `GET /diagnostics/health` | Equivalent. |
| About, system (C14) | `GET /system/status` | Equivalent. |
| Platform tag, payout, tip (C10 partial) | `stop_labels.platform/payout_cents/tip_cents` | Payout per labelled stop only. |
| Dashboard three metrics (C13 partial) | `GET /summary`, web Dashboard | Goal ring, hero toggle and checklist are missing. |

### 3.2 Missing: the new modules

| Module | Covers | Toggle (default) | Depends on | Section |
|---|---|---|---|---|
| core additions | C8 details, C9 profile | not toggleable | none | §4.1 |
| `platforms` | C10 | `modules.platforms` (on) | core | §4.2 |
| `earnings` | C10 sub-records, bonus; the driver-entered payout source | `modules.earnings` (on) | core | §4.3 |
| `expenses` | C1 | `modules.expenses` (on) | core | §5 |
| `receipts` | C1 receipt photo | `modules.receipts` (on) | expenses | §5.4 |
| `maintenance` | C8 maintenance log | `modules.maintenance` (on) | core | §6 |
| `tax` | C7, vehicle tax year | `modules.tax` (on) | core, expenses and earnings optional | §7 |
| `goals` | C2 | `modules.goals` (on) | core | §8 |
| `progress` | C3 | `modules.progress` (**off**) | goals, earnings | §8.4 |
| `schedule` | C4 | `modules.schedule` (**off**, as in Comma) | core | §9 |
| `analytics` | C5 | `modules.analytics` (on) | core | §10 |
| exporters `expenses`, `tax_summary` | C6 | `modules.export_expenses`, `modules.export_tax_summary` (on) | expenses, tax | §10.3 |
| `notifications` | C11 | `modules.notifications` (on) | core | §11 |
| `import` | C12 import | `modules.import` (on) | core | §12 |
| Dashboard checklist, hero toggle, goal ring | C13 | web only, no module | reads module flags | §13 |

### 3.3 Not carried, with the reason (owner may overrule)

| Comma function | Why not | Owner question |
|---|---|---|
| Per-platform default mileage rate (C10) | The deduction is computed from the country pack by distance (`07` D7). A second, per-platform rate would produce a conflicting deduction value on a log a tax office reads. | No |
| `shift_platforms` online time and trips per platform (C10) | Kept in reduced form: `shift_earnings.online_min` and `orders` are driver-typed totals per shift and platform, never per-delivery taps (§4.3). | No |
| Scan-receipt auto-fill (C1) | In Comma it is a simulated placeholder with sample values. A fake OCR would write wrong figures. | No |
| Weekly digest, vehicle maintenance reminders, insurance expiry (C11) | Toggles exist in Comma but no trigger is implemented. Building the triggers is speculative. Insurance expiry would also need a policy-date field Comma does not have. | Add later if wanted |
| Danger zone buttons (C12) | A web button that erases tax records contradicts the retention rule (`07` §4.2). Per-shift purge exists. A full reset is a CLI command (`milewage reset`, typed confirmation, verified backup first), added to `10`. | Confirm CLI-only |
| Google Drive backup and sync (C12) | Replaced by the server (`01` §1.1). | No |
| Demo mode and sample data (C14) | Sample rows would pollute a tax-record store. | No |
| Year-in-Review image (C6, C14) | A social share asset, not an admin or tax function. | Opt in if wanted |
| Android widget, GPS settings (C14) | Phone work, not touched here. | No |
| Keyboard shortcuts, fullscreen (C14) | Web conveniences, not modules; may be added to any screen without a spec. | No |
| Gamification default on (C3) | Lowest driver-problem value, and it depends on earnings being entered. Shipped as a module, **default off**. | Confirm default |
| Weekly challenge "20 deliveries" (C3) | MileWage has no delivery count. It is defined as labelled drop-off stops, and the challenge is hidden when nothing is labelled. | Confirm |
| Currency per-viewer, theme, accent, font size, density, date format (C9) | Display preferences of one browser, not data. They live in the browser (`localStorage`), no server field, no phone effect. `week_start` and `time_format` do change numbers (week boundaries, time display) and are server settings so the phone agrees. | No |

---

## 4. Core Additions and Two Small Modules

### 4.1 Core additions (profile and vehicle details)

Not toggleable: vehicles and settings are core (`07` §1.1). All new columns are optional.

```sql
-- core migration. vehicles: details + wider kind set (SQLite table rebuild for the CHECK).
ALTER TABLE vehicles ADD COLUMN make  TEXT;
ALTER TABLE vehicles ADD COLUMN model TEXT;
ALTER TABLE vehicles ADD COLUMN year  INTEGER CHECK (year IS NULL OR year BETWEEN 1900 AND 2100);
ALTER TABLE vehicles ADD COLUMN plate TEXT;                       -- the driver's own record; never exported unless the driver ticks it
ALTER TABLE vehicles ADD COLUMN power TEXT CHECK (power IN ('gas','hybrid','ev','other'));
-- kind CHECK becomes: ('car','motorcycle','van','bicycle','ebike','scooter','walking')

ALTER TABLE settings ADD COLUMN display_name       TEXT;           -- greeting and export header
ALTER TABLE settings ADD COLUMN region             TEXT;           -- subdivision code without country, e.g. 'ON'; validated by the country pack
ALTER TABLE settings ADD COLUMN week_start         INTEGER NOT NULL DEFAULT 1 CHECK (week_start IN (0,1));   -- 0 Sunday, 1 Monday
ALTER TABLE settings ADD COLUMN time_format        TEXT    NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h','24h'));
ALTER TABLE settings ADD COLUMN default_vehicle_id INTEGER REFERENCES vehicles(id);   -- Comma's "active vehicle": preselected when a shift starts
```

- **Current odometer is not stored.** Comma keeps `current_odometer` on the vehicle; here the latest `odometer_readings` row is the answer (`07` §2.2).
- **Eligibility.** `CountryPack.deduction()` gains the vehicle kind: `deduction(total_m, year, vehicleKind)`. Under CA, `bicycle`, `ebike`, `scooter` and `walking` return `null` (not an automobile; Comma `docs/features/vehicles.md`); the new kinds also return `null` under US and GB until each pack's rule is verified (the `11` §4 policy: unverified means no number).
- **Delete.** Vehicles stay archive-only (`08`): a vehicle referenced by a shift cannot be deleted without breaking the tax record. Comma's "delete" is the archive action.
- **Operations.** `createVehicle` and `updateVehicle` accept the new optional fields (`make`, `model`, `year`, `plate`, `power`; `kind` gains three values). `updateSettings` accepts `display_name`, `region`, `week_start`, `time_format`, `default_vehicle_id`. `getSettings` returns them. `changePassword` is unchanged.
- **Web.** Vehicles screen (list, add, edit, archive, set default), Account section (password), profile fields in Settings.
- **Tax relevance (CRA).** Vehicle type decides eligibility for the automobile rate. Plate, make, model and year are the identifying elements of a vehicle log (`04` §2).

### 4.2 Module `platforms`

Comma's platform list becomes a registry (built-ins, as data in the shared package, per `08` §16.3) plus the driver's overrides and custom platforms. The registry gains the Canadian built-ins `skipthedishes` and `foodora`; the active list per country is data in the country pack.

```sql
CREATE TABLE platform_settings (
  user_id             INTEGER NOT NULL REFERENCES users(id),
  slug                TEXT    NOT NULL CHECK (slug GLOB '[a-z0-9_]*' AND length(slug) BETWEEN 1 AND 32),
  label               TEXT    NOT NULL,
  custom              INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0,1)),   -- 1 = created by the driver; 0 = override of a built-in (row exists only once changed)
  color               TEXT    CHECK (color IS NULL OR color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  emoji               TEXT,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),   -- inactive platforms drop out of pickers, not out of history
  sort                INTEGER NOT NULL DEFAULT 0,
  hourly_target_cents INTEGER CHECK (hourly_target_cents IS NULL OR hourly_target_cents >= 0),   -- used by analytics only
  PRIMARY KEY (user_id, slug)
);
```

- **Validation.** `stop_labels.platform` and `shift_earnings.platform` accept a built-in slug or a custom slug that exists here (it replaces the free `[a-z0-9_]` slug of `07` §2.4 when the module is on; when off, the old rule applies).
- **Filter.** `platform=<slug>` is an optional query on `getSummary`, `getAnalytics`, `listExpenses` and the exports. It filters only what carries a platform: label and earnings figures, and trips whose shift has labels on that platform. Distance of a shift that spans platforms is not apportioned (it cannot be measured); the response says `platform_filter: "earnings_only"`.
- **Vocabulary** ("block" for Amazon Flex) is a web string table keyed by slug, not data.

API:

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listPlatforms` | `GET /platforms` | S+D read | Built-ins merged with overrides and customs, in `sort` order. `include_inactive`. |
| `putPlatform` | `PUT /platforms/{slug}` | S | Create a custom platform or override a built-in's `active`, `sort`, `hourly_target_cents`, `color`, `emoji`, `label` (label only on a custom one). Idempotent. |
| `deletePlatform` | `DELETE /platforms/{slug}` | S | Custom platforms only, and only if no label or earnings row uses the slug (else `409 platform_in_use`; deactivate instead). Built-in override rows are reset. |

Web: Settings, Platforms card. **Tax relevance:** none directly; the platform key feeds the T4A threshold check (§7) and income-by-source (§10).

### 4.3 Module `earnings` (the driver-entered payout source)

Why it exists: payouts come only from stop labels or from the driver. Labels require GPS stops and are per stop. Goals, the tax centre, analytics and the CSV imports all need earnings that a driver can enter when labelling every stop is not wanted (or stops are off, or a shift was imported). Comma's equivalents are the shift earnings and the `shift_platforms` sub-record. This table is **one row per shift and platform, typed by the driver after the fact**, never a per-delivery tap, never written by the phone.

```sql
CREATE TABLE shift_earnings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  platform    TEXT    NOT NULL DEFAULT 'other',                       -- slug, as in §4.2
  gross_cents INTEGER NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),    -- base pay as the platform reports it
  tips_cents  INTEGER NOT NULL DEFAULT 0 CHECK (tips_cents  >= 0),
  bonus_cents INTEGER NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),    -- incentives and promotions (taxable income in C7)
  orders      INTEGER CHECK (orders IS NULL OR orders >= 0),          -- the platform's own count for the shift, typed once
  online_min  INTEGER CHECK (online_min IS NULL OR online_min >= 0),  -- logged-in time on this platform; for $/hr by platform
  notes       TEXT,
  source      TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  edited_at   INTEGER NOT NULL,
  UNIQUE (shift_id, platform)
);
CREATE INDEX idx_earn_user_shift ON shift_earnings(user_id, shift_id);
```

- **Effective earnings** for a (shift, platform): if a `shift_earnings` row exists it is the figure (the platform's own total wins); else the sum of that platform's `stop_labels`. Labels for the same platform stay visible as a breakdown and are not added again. Labelled stops with no platform count under `other`. When neither exists the figure is `null`, never zero.
- `GET /summary` `earnings_cents` and `tips_cents` become effective earnings (labels or entries); with `earnings` and `stops` both off they stay `null`.
- Turning `stops` off no longer forces earnings to `null` when `earnings` is on.

API:

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listShiftEarnings` | `GET /shifts/{ref}/earnings` | S | Rows plus the label breakdown per platform. |
| `putShiftEarnings` | `PUT /shifts/{ref}/earnings/{platform}` | S | Idempotent upsert of one row. Shift must be `ended` or `finalized`. |
| `deleteShiftEarnings` | `DELETE /shifts/{ref}/earnings/{platform}` | S | Remove the row; labels apply again. |

Web: an "Earnings" block on the shift screen under the stop labels. **Tax relevance:** gross, tips and bonus are the business income lines of CRA T2125 (and Schedule C); the T4A threshold check reads them.

---

## 5. Module `expenses`

Comma C1. The Tax Centre and the standard-mileage guardrail use it. Mileage deduction and actual expenses are exclusive per vehicle and year (§7.2).

### 5.1 Categories (data, not a table)

A registry in the shared package, like platforms: `{ slug, label, default_deductible, default_business_pct, vehicle_related, covered_by_standard_rate }`. Comma's 20: `fuel, maintenance, parking, tolls, insurance, licensing, interest, leasing, fees, phone, data_plan, wash, supplies, meals, bank_fees, software, accounting, bike_maintenance, out_of_pocket, other`. Defaults as in Comma: all deductible at 100 % except `phone`, `data_plan`, `meals` at 50 % and `out_of_pocket` not deductible at 0 %. `covered_by_standard_rate` is true for `fuel`, `maintenance`, `insurance`. The country pack may relabel or add a category; **mapping categories to T2125 or Schedule C line numbers is out of this version** (the line numbers are not verified, `11` §4 policy). Two categories beyond Comma's, `vehicle_rental` and `vehicle_finance`, come from [`21`](./21-jurisdictions-plan.md) §3.6c (vehicle ownership).

### 5.2 Tables

```sql
CREATE TABLE expenses (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  spent_on         TEXT    NOT NULL,                                       -- 'YYYY-MM-DD', the driver's local date (as shifts.local_date)
  category         TEXT    NOT NULL,                                       -- registry slug, validated in code
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),              -- total paid, tax included
  merchant         TEXT    NOT NULL DEFAULT '',
  deductible       INTEGER NOT NULL DEFAULT 1 CHECK (deductible IN (0,1)),
  business_pct     INTEGER NOT NULL DEFAULT 100 CHECK (business_pct BETWEEN 0 AND 100),
  tax_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_credit_cents >= 0 AND tax_credit_cents <= amount_cents),  -- input tax credit portion (HST/GST/VAT); counts only when settings say the driver is registered (§7.3)
  vehicle_id       INTEGER REFERENCES vehicles(id),
  shift_id         INTEGER REFERENCES shifts(id) ON DELETE SET NULL,       -- a purged shift must not be blocked by, or take, its expenses
  notes            TEXT,
  recurrence       TEXT    CHECK (recurrence IN ('weekly','monthly','yearly')),   -- template rows only
  next_due         TEXT,                                                   -- local date, template rows only
  snoozed_until    TEXT,
  template_id      INTEGER REFERENCES expenses(id),                        -- set on an occurrence created from a template
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK ((recurrence IS NULL) = (next_due IS NULL))
);
CREATE INDEX idx_exp_user_date ON expenses(user_id, spent_on);
CREATE INDEX idx_exp_user_cat  ON expenses(user_id, category, spent_on);
CREATE INDEX idx_exp_due       ON expenses(user_id, next_due) WHERE recurrence IS NOT NULL;
```

- **Deductible amount** is computed at read time: `deductible ? round_half_up(amount_cents * business_pct / 100) : 0`, never stored (`07` D7 spirit). When the expense's vehicle uses the standard-mileage method for that year and the category has `covered_by_standard_rate`, the response flags `double_counts: true` and the tax module excludes it from the deduction (Comma behaviour: saved, warned, not deducted).
- **Merchants** autocomplete is `SELECT DISTINCT merchant`; no merchants table.
- **Recurring is a reminder, as in Comma.** A template is an expense row with `recurrence`. Nothing is created automatically. `getDueExpenses` lists templates with `next_due <= today` and not snoozed; confirming creates one occurrence dated by the driver (default `next_due`) and advances `next_due` by the interval; snooze sets `snoozed_until`.
- **Retention.** Expenses are tax records: never auto-deleted (`07` §4.2); the 7-year warning applies.

### 5.3 API

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listExpenses` | `GET /expenses` | S | Filter `from`, `to`, `category`, `deductible`, `vehicle_id`, cursor-paginated like shifts. |
| `createExpense` | `POST /expenses` | S | Create. Response includes `deductible_cents`, `double_counts`. |
| `getExpense` · `updateExpense` · `deleteExpense` | `GET/PATCH/DELETE /expenses/{id}` | S | Read, edit, delete (deleting a template keeps its occurrences, `template_id` set null). |
| `getExpenseTotals` | `GET /expenses/totals?year=` | S | Deductible YTD vs total spend, per category (Comma's two tiles). |
| `listExpenseMerchants` | `GET /expenses/merchants?q=` | S | Autocomplete. |
| `getDueExpenses` | `GET /expenses/due` | S | Templates due and not snoozed. |
| `confirmDueExpense` | `POST /expenses/{id}/occurrences` | S | Body `spent_on` (and optional amount); creates the occurrence, advances the template. |
| `snoozeExpense` | `PUT /expenses/{id}/snooze` | S | Body `until`. |
| `listExpenseCategories` | `GET /expenses/categories` | S | The registry with defaults for the form. |

Web: Expenses screen (list, filters, YTD tiles, add/edit form, business-use quick picks 25/50/75/100, shift suggestion within 7 days). The form asks for the amount and the date first. Of the categories, five are one tap (the driver's most used, topped up with fuel, parking, tolls, phone and car wash). The rest are in one **More** list, grouped into Vehicle and Work and other (W7a; owner, 2026-11-08: the full grid of 22 was too much at once). Under the category, one line says what will be deducted ("Deductible in full.", "Deductible: 50 % business use.", "Not deductible."). Merchant, the deductible flag and business share, vehicle, shift, repeats and notes are under **More details**, closed for a new expense and open when editing; vehicle is offered only when the driver has one and shift only when one is within 7 days. A vehicle category goes on the default vehicle (W7b). The double-count warning is informational.

### 5.4 Module `receipts` (sub-module of expenses)

```sql
CREATE TABLE expense_receipts (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expense_id INTEGER NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,   -- one receipt per expense, as in Comma
  file       TEXT    NOT NULL,                    -- name under /app/data/receipts/, server-generated
  mime       TEXT    NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  bytes      INTEGER NOT NULL CHECK (bytes > 0),
  sha256     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
```

- Files live on the volume, so the **backup engine includes `/app/data/receipts/`** (an addition to `10`); restore checks each row's `sha256`. Size cap 10 MB per file and a total cap with the disk-state rules of `10` (`507` when the disk is not `ok`). A receipt is tax evidence: kept as long as the expense.
- Photos may carry EXIF location; the server strips GPS EXIF from JPEGs on upload (privacy principle, `01` §2).
- `putExpenseReceipt` `PUT /expenses/{id}/receipt` (S, binary body, `Content-Type` = mime), `getExpenseReceipt` `GET /expenses/{id}/receipt` (S, streamed), `deleteExpenseReceipt` `DELETE /expenses/{id}/receipt` (S). The device scope has no access (`08` §2.2): a phone camera capture goes through the web or a later phone change, not this PR.

**Tax relevance (CRA):** expenses reduce net business income (T2125 Part 4 / Schedule C); the business-use % is the mixed-use apportionment the CRA expects; the CRA asks for receipts and keeps six years from filing, so the expense and receipt retention follows `07` §4.2. Input tax credits feed the HST remittance estimate (§7.3).

---

## 6. Module `maintenance`

Comma's per-vehicle service record. Fuel and wash types in Comma duplicate expenses; here a cost is one fact in one place.

```sql
CREATE TABLE maintenance_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  kind        TEXT    NOT NULL CHECK (kind IN ('oil_change','tires','brakes','other')),   -- 'fuel' and 'wash' are expenses (categories), not services
  serviced_on TEXT    NOT NULL,                                -- local date
  odometer_m  INTEGER CHECK (odometer_m IS NULL OR odometer_m >= 0),
  cost_cents  INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),   -- NULL when expense_id is set: the cost then lives on the expense
  expense_id  INTEGER UNIQUE REFERENCES expenses(id) ON DELETE SET NULL,
  notes       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_maint_vehicle ON maintenance_logs(vehicle_id, serviced_on);
```

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listMaintenance` | `GET /vehicles/{id}/maintenance` | S | Newest first; cost read from the linked expense when linked. |
| `createMaintenance` | `POST /vehicles/{id}/maintenance` | S | Body includes `record_expense` (default true when `expenses` is on): creates a `maintenance` expense for the vehicle and links it. |
| `updateMaintenance` · `deleteMaintenance` | `PATCH/DELETE /maintenance/{id}` | S | Edit, delete (the linked expense is kept; it is a tax record). |

Web: a Maintenance tab on the vehicle screen. **Tax relevance:** with actual-expense vehicles the service cost is deductible via the linked expense; with standard mileage it is recorded and flagged `double_counts` (the rate already covers it). Odometer values corroborate the year odometer readings.

---

## 7. Module `tax` (Tax Center)

Comma C7. It estimates, never files, and says so on screen ("estimates to bring to an accountant, not tax advice"). The numbers come from a **tax pack** per country; **only CA ships in this version**, as in Comma's docs. US (Schedule C, self-employment tax) and GB (NI) helpers exist in Comma's code but its docs say their numbers were removed until verified; here they return `{ supported: false }` until the owner verifies them (`11` §4 policy). Every rate and ceiling is data with a year and a source note, and is re-verified before use (Comma's tables are copied deliberately, not trusted: README principle 4).

### 7.1 Tables

```sql
-- Driver inputs for the estimate. One row per user and tax year.
CREATE TABLE tax_years (
  user_id        INTEGER NOT NULL REFERENCES users(id),
  tax_year       INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  set_aside_bp   INTEGER NOT NULL DEFAULT 2500 CHECK (set_aside_bp BETWEEN 0 AND 10000),   -- income-tax planning rate in basis points (Comma: "withholding rate")
  sales_tax_registered INTEGER NOT NULL DEFAULT 0 CHECK (sales_tax_registered IN (0,1)),   -- HST/GST (CA) registration
  PRIMARY KEY (user_id, tax_year)
);

-- Tax Jar: the driver's manual set-aside ledger. Nothing moves real money.
CREATE TABLE tax_jar_entries (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  tax_year     INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),     -- positive = set aside, negative = withdrawn
  entered_on   TEXT    NOT NULL,                               -- local date
  note         TEXT
);
CREATE INDEX idx_jar_user_year ON tax_jar_entries(user_id, tax_year);

-- Per vehicle and year: which way the vehicle is deducted (Comma "annual tax profile").
CREATE TABLE vehicle_tax_years (
  user_id        INTEGER NOT NULL REFERENCES users(id),
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id),
  tax_year       INTEGER NOT NULL,
  method         TEXT    NOT NULL CHECK (method IN ('standard_mileage','actual_expenses')),
  rate1_milli    INTEGER CHECK (rate1_milli IS NULL OR rate1_milli >= 0),   -- optional override, thousandths of the currency unit per distance unit
  rate2_milli    INTEGER CHECK (rate2_milli IS NULL OR rate2_milli >= 0),
  threshold_m    INTEGER CHECK (threshold_m IS NULL OR threshold_m >= 0),   -- distance after which rate2 applies
  PRIMARY KEY (vehicle_id, tax_year)
);
```

`vehicle_tax_years` and the year odometer readings of `07` §2.2 replace Comma's `beginning/ending_year_odometer` columns (one place for readings). A saved row **overrides the country pack default, including an explicit opt-out**: `method = 'actual_expenses'` makes the mileage `deduction_cents` for that vehicle and year `null` in `GET /summary` and the exports (the vehicle is deducted through expenses). When no row exists the pack default applies (standard mileage), exactly today's behaviour. The seam is a core function `deductionMethodFor(vehicleId, year)` whose default implementation lives in core and which `tax` overrides, so `expenses` and `summary` never import `tax` (README §1.3 rule 1).

### 7.2 The estimate

Computed at read time, in cents, from effective earnings (§4.3), expenses (§5) and the mileage deduction:

```
taxable_income = gross + tips + bonus
               - sum(deductible expenses, business_pct applied, standard-rate-covered ones excluded)
               - mileage deduction (standard-mileage vehicles only)
```

| Piece | Rule (CA pack, rates from data) |
|---|---|
| Self-employed CPP / CPP2 or QPP / QPP2 | On net self-employment income above the basic exemption, up to the year's ceilings; QPP when `region = 'QC'`. |
| Income tax | `taxable_income x set_aside_bp`. A planning figure, not brackets. |
| HST/GST | Only when `sales_tax_registered`: collected minus input tax credits (`tax_credit_cents` of deductible expenses). Collected tax is a driver-entered figure in the request (`collected_cents`) because platform income arrives tax-inclusive or not by arrangement; no tax-collected data is invented. Rate by region from the pack. |
| Mileage deduction | Shown as a deduction line, never as cash (`05` rules). |
| Instalments | Quarterly: from the year's estimate by the pack's rule. |
| Deadlines | Instalments 15 Mar, 15 Jun, 15 Sep, 15 Dec; self-employed filing 15 Jun of the next year; payment of balance 30 Apr (verify). Pack data, with year. |
| T4A threshold | Per platform, effective earnings for the year above CAD 500 (pack data) raises an alert row. |

### 7.3 API

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `getTaxYear` | `GET /tax/{year}` | S | Inputs, the estimate with each line, deadlines, T4A alerts, jar balance vs target (target = gross earnings x rate). `supported:false` for packs without numbers. Optional query `collected_cents`. |
| `updateTaxYear` | `PUT /tax/{year}` | S | `set_aside_bp`, `sales_tax_registered`. |
| `listTaxJar` · `addTaxJarEntry` · `deleteTaxJarEntry` | `GET /tax/{year}/jar`, `POST /tax/{year}/jar`, `DELETE /tax/jar/{id}` | S | The quick-add ledger. |
| `getVehicleTaxYear` · `putVehicleTaxYear` · `deleteVehicleTaxYear` | `GET/PUT/DELETE /vehicles/{id}/tax-years/{year}` | S | Method and optional rate override; delete returns to the pack default. |
| `exportData` (existing) | `GET /exports/tax_summary?year=&format=csv|json` | S | Tax summary exporter (§10.3). |

Web: Tax screen (estimate with its working shown, jar with quick-add, deadlines, alerts), vehicle tax-year panel on the vehicle screen.

**Tax relevance (CRA):** this is the module. It implements method exclusivity (standard rate or actual expenses per vehicle and year), the business-use apportionment, CPP on self-employment, HST remittance estimate, deadlines and the T4A threshold. It is an estimator and says so; it does not produce a filed form.

---

## 8. Modules `goals` and `progress`

### 8.1 Goals (C2)

```sql
CREATE TABLE goals (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  label        TEXT    NOT NULL,
  metric       TEXT    NOT NULL CHECK (metric IN ('earnings','hours','shifts','active_distance')),
  period       TEXT    NOT NULL CHECK (period IN ('daily','weekly','monthly','yearly')),
  target       INTEGER NOT NULL CHECK (target > 0),     -- cents | minutes | count | metres, by metric
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   INTEGER NOT NULL
);
```

- Progress is **computed at read time** from the same sources as `GET /summary` (effective earnings, shift durations, shift count, `active_m`). Week boundaries use `settings.week_start`; periods use `settings.timezone`.
- `active_distance` is the stop-based **estimate** (`14` §6): shown labelled "estimated", and `null` for shifts whose `segmenter` is `whole_shift`. `earnings` progress is `null`-aware: a goal with no earnings entered shows "no earnings entered", not 0 %.
- **Seed.** No default goal is seeded silently (Comma seeds $500/week). The checklist (§13) offers "set a weekly goal" instead. This avoids a fabricated number.

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listGoals` | `GET /goals` | S+D read | Goals with `progress {value, target, ratio, period_from, period_to, estimated}`. |
| `createGoal` · `updateGoal` · `deleteGoal` | `POST /goals`, `PATCH/DELETE /goals/{id}` | S | CRUD. |

Web: Goals screen and the goal ring on the dashboard. **Tax relevance:** none; income goals are planning aids. (Phone reads goals through `sync` for a ring, a later phone change.)

### 8.2 Progress / gamification (C3), default off

Specified so it can be built last. Everything that can be derived is derived; only stable facts are stored.

```sql
CREATE TABLE badge_unlocks (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  badge       TEXT    NOT NULL,                  -- slug from the shared badge registry (Comma's 24)
  unlocked_at INTEGER NOT NULL,
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge)
);
CREATE TABLE progress_state (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id),
  freezes_held     INTEGER NOT NULL DEFAULT 0 CHECK (freezes_held BETWEEN 0 AND 3),
  freezes_used_on  TEXT    NOT NULL DEFAULT '[]',   -- JSON array of local dates a freeze covered
  levels_rewarded  INTEGER NOT NULL DEFAULT 0       -- level-ups already paid with a freeze
);
```

XP, level, streak and challenge progress are computed from shifts, effective earnings and distance (Comma's table: shift +10, duration target +15, record +30, badge +40, challenge +60, goals met +20; 100 XP a level; level-up grants a freeze, max 3). Badges that need earnings, tips or deliveries evaluate only from entered or labelled figures and stay locked otherwise; "deliveries" means labelled drop-off stops. The three weekly challenges are fixed (earn $500 [currency from settings: configurable target], 20 deliveries, 5-day streak).

| Operation | Method and path | Purpose |
|---|---|---|
| `getProgress` | `GET /progress` | XP, level, streak, freezes, challenges, badge grid. Evaluates and records new unlocks (idempotent). |

Notifications for unlocks go through `notifications` (§11). Web: Progress screen. **Tax relevance:** none. Owner question (§3.3): confirm default off.

---

## 9. Module `schedule` (default off)

Comma C4: plan shifts ahead, repeating templates, off days, reminders. The server stores the plan; the phone fires the reminder locally because a self-hosted server has no push service and third-party push is out of scope (`01` §3.2). The phone reads the plan through `sync` (`pullChanges` entity `schedule`), schedules local notifications and shows "Start shift" / "Remind in 10 min" (a later phone change).

```sql
CREATE TABLE schedule_templates (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  label      TEXT    NOT NULL,
  weekdays   INTEGER NOT NULL CHECK (weekdays BETWEEN 1 AND 127),   -- bit 0 Monday ... bit 6 Sunday
  start_time TEXT    NOT NULL,                                       -- 'HH:MM' local
  end_time   TEXT    NOT NULL,
  platform   TEXT,                                                   -- slug, optional
  vehicle_id INTEGER REFERENCES vehicles(id),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE schedule_entries (                                      -- one planned shift on one date
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  planned_on  TEXT    NOT NULL,                                      -- local date
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL,
  platform    TEXT,
  vehicle_id  INTEGER REFERENCES vehicles(id),
  template_id INTEGER REFERENCES schedule_templates(id) ON DELETE SET NULL,
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE SET NULL,      -- set when the driver works it (matched by date, never required)
  remind      INTEGER NOT NULL DEFAULT 1 CHECK (remind IN (0,1)),
  UNIQUE (user_id, planned_on, start_time)
);
CREATE TABLE schedule_off_days (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  off_on     TEXT    NOT NULL,
  note       TEXT,
  PRIMARY KEY (user_id, off_on)
);
```

Templates expand into entries for a date window on request (`POST /schedule/expand`); entries are never generated by a background job. Off days suppress expansion and the streak-at-risk notice.

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listSchedule` | `GET /schedule?from=&to=` | S+D read | Entries, off days and templates for the window. |
| `createScheduleEntry` · `updateScheduleEntry` · `deleteScheduleEntry` | `POST /schedule/entries`, `PATCH/DELETE /schedule/entries/{id}` | S | Single planned shift. |
| `putScheduleTemplate` · `deleteScheduleTemplate` | `POST /schedule/templates`, `PATCH/DELETE /schedule/templates/{id}` | S | Recurring template. |
| `expandSchedule` | `POST /schedule/expand` | S | Create entries from active templates for `from`..`to`, skipping off days and existing entries. |
| `putOffDay` · `deleteOffDay` | `PUT/DELETE /schedule/off-days/{date}` | S | Non-delivery days. |

Web: Schedule screen (month calendar). **Tax relevance:** none (a plan is not a record); a worked shift stays the contemporaneous record.

---

## 10. Module `analytics` and Report Exporters

### 10.1 Analytics (C5)

Read-only, computed from existing tables, so **no new table**. `GET /analytics?from=&to=&group=` (S) with `group` one of `trends`, `rhythm`, `sources`, `outlook`, `efficiency`, `order_economics`, `cards`. `platform` filter as in §4.2. This replaces the "three metrics only" limit of `05` §5 and `08` §12; `GET /summary` keeps its shape.

| Group | Content | Source and honesty rules |
|---|---|---|
| `trends` | Earnings, hours, distance, $/hr per day, week or month bucket (`bucket`); previous-period comparison. | Effective earnings; buckets with no earnings entered are `null`, not zero. |
| `rhythm` | Shifts and hours by weekday and by hour of day; average shift length. | Shifts only. Week start from settings. |
| `sources` | Earnings and tips by platform; share of total. | Effective earnings; `other` for no platform. |
| `outlook` | Run-rate projection of the period end from days elapsed (linear), and days left. | A projection, labelled; none when under 3 shifts. |
| `efficiency` | Active vs deadhead share; consistency (spread of $/hr across shifts). | Active/deadhead is the stop **estimate** and carries `estimated: true`; absent for `whole_shift` shifts. |
| `order_economics` | Pay per order and per distance unit; orders per hour. | Orders = `shift_earnings.orders` where entered, else labelled drop-off stops; absent otherwise. No per-delivery taps. |
| `cards` | Gross, net take-home (gross − deductible expenses − tax set-aside from §7), expenses and burn ratio, average $/hr (active `online_min` vs shift time), tax set-aside, total time. | Net needs `expenses`; set-aside needs `tax`; each card is omitted (not zero) when its module is off. |

Web: Analytics screen with a period navigator (week, month, year). **Tax relevance:** none direct; net take-home and set-aside reuse §7.

### 10.2 Print view

The PDF summary (`08` §11) rendered by the browser's print dialog. No route.

### 10.3 New exporters

Registered like the others (`08` §16.3), one switch each, listed in `GET /settings` `modules.exporters`.

| Format | Content | Switch |
|---|---|---|
| `expenses` (CSV) | `Date, Category, Merchant, Amount, Deductible, Business_Use_Pct, Deductible_Amount, Tax_Credit, Vehicle, Shift_Date, Receipt (yes/no), Recurring, Notes`; filters `from`, `to`, `category`. Not receipts' files. | `modules.export_expenses` |
| `tax_summary` (CSV or JSON, `format` param) | The §7.2 estimate lines for a year with their inputs (earnings by platform, expenses by category, mileage deduction per vehicle and method, CPP, set-aside, HST, jar balance). Includes the "estimate, not tax advice" line. | `modules.export_tax_summary` |

Shifts CSV already exists as `csv` `level=shift` (`04` §2.3, now including the earnings entries) and the mileage-log CSV as `level=trip`. The Year-in-Review image is not carried (§3.3). **Tax relevance:** these are the hand-off to an accountant.

---

## 11. Module `notifications`

Comma C11 had two channels. Here: an **in-app inbox** on the server, shown by the web and (later) the phone, and **phone-local** notifications the phone schedules itself (shift reminders, the unsynced-data reminder of `15`). No push service, no third-party endpoint (`01` §3.2, `16` §11).

```sql
CREATE TABLE notification_prefs (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id),
  shift_reminders INTEGER NOT NULL DEFAULT 1 CHECK (shift_reminders IN (0,1)),
  goals           INTEGER NOT NULL DEFAULT 1 CHECK (goals IN (0,1)),
  tax_deadlines   INTEGER NOT NULL DEFAULT 1 CHECK (tax_deadlines IN (0,1)),
  streak          INTEGER NOT NULL DEFAULT 1 CHECK (streak IN (0,1)),
  backup          INTEGER NOT NULL DEFAULT 1 CHECK (backup IN (0,1)),
  sync_reminder   INTEGER NOT NULL DEFAULT 1 CHECK (sync_reminder IN (0,1))
);
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('badge','challenge','level_up','streak_freeze','streak_risk','goal_met','tax_deadline','shift_reminder','backup_overdue','backup_failed','recurring_expense_due')),
  dedupe_key TEXT    NOT NULL,                       -- e.g. 'tax_deadline:2026-12-15'; one inbox row per key
  body_key   TEXT    NOT NULL,                       -- message id; text is built by the client (no free text, no amounts: the inbox is not a data copy)
  created_at INTEGER NOT NULL,
  read_at    INTEGER,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);
```

- Triggers come from the event bus (`08` §16.4): `backup` failure/overdue, `goals`/`progress` events, the `tax` deadline calendar (10 days ahead, evaluated by the existing daily housekeeping job, no new timer), and `expenses` due templates. A module that is off simply never emits. Comma's operational confirmations (export, import, restore done) are inline results on the screen, not inbox rows.
- Not carried: weekly digest, maintenance and insurance triggers (§3.3).
- `shift_reminders` and `sync_reminder` are read by the phone from `GET /settings` and applied locally.

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `listNotifications` | `GET /notifications` | S+D read | Newest first, `unread` filter, cursor. |
| `markNotificationRead` | `PATCH /notifications/{id}` | S | `read`. |
| `dismissNotification` | `DELETE /notifications/{id}` | S | Remove. |
| `getNotificationPrefs` · `updateNotificationPrefs` | `GET/PATCH /notifications/prefs` | S+D read, S write | The toggles. |

Web: bell with unread count in the header, notifications list, Alerts card in Settings. **Tax relevance:** the instalment and filing deadline reminders.

---

## 12. Module `import`

Comma C12 imports shifts and expenses from CSV. It is a generic CSV import of the driver's own historical records; it adds no Comma-specific reader, so decision 1.8 (no Comma import) stands. Two kinds, each in two steps so nothing is written by surprise:

- **Expenses** CSV: maps to `expenses` (columns mapped on screen from the file's header; no fixed vendor format). Duplicates are detected by `(spent_on, amount_cents, merchant)`.
- **Shifts** CSV: each row becomes a `finalized` shift with `segmenter = 'whole_shift'`, one **manual** trip carrying the typed distance (`source = manual`, purpose "Imported"), and, if the row has earnings, a `shift_earnings` row with `source = 'import'`. Imported shifts have no route, are flagged `imported` in `shift_flags`, and are marked as such in every export (a tax office must be able to tell typed from tracked distance, `07` rule on the contemporaneous record). Duplicates are detected by `(vehicle, started_at, distance)`.

| Operation | Method and path | Auth | Purpose |
|---|---|---|---|
| `previewImport` | `POST /imports/{kind}/preview` | S | Upload CSV (gzip allowed, size cap as `08` §7.3); returns detected columns, mapping, row count, per-row `ok / duplicate / error` and nothing is written. |
| `commitImport` | `POST /imports/{kind}` | S | Same file plus the confirmed mapping; writes in one transaction; returns counts. Idempotent: a repeat of the same file imports zero rows (duplicate rule). |

`kind` is `expenses` (needs the `expenses` module) or `shifts`. Web: Import wizard in Settings, Data. **Tax relevance:** back-filling a year's expenses and mileage from earlier records; the `imported` marker keeps the audit trail honest.

---

## 13. Web-only: Dashboard Checklist and Hero

No module and no table. The dashboard (`apps/web` Dashboard) adds, computed from other modules' state and hidden for modules that are off:

- A Today / Week toggle on the hero (uses `GET /summary` with two ranges).
- A goal ring (goals).
- A **Finish setting up** card: add your other apps (platforms), add your real vehicle, set a weekly goal (goals), pair the phone (devices), run a backup (backup). Each item shows done or not, from server state; the card disappears when all visible items are done.
- The mileage write-off tip stays a deduction, never cash (`05`).

---

## 14. Modularity (README §1.3)

| Module | Interface | Depends on | Toggle (default) | When off | Removal |
|---|---|---|---|---|---|
| platforms | `GET/PUT/DELETE /platforms`; slug validator | core | `modules.platforms` (on) | Built-in slugs and free `[a-z0-9_]` slugs as today; no platform screen or filter | Drop registration; table stays |
| earnings | `shift_earnings` routes; effective-earnings function used by summary, goals, tax, analytics | core | `modules.earnings` (on) | Earnings come from labels only (as before) | Drop registration |
| expenses | routes in §5.3; category registry | core | `modules.expenses` (on) | No routes or screens; tax and analytics omit expense lines | Drop registration; tables stay |
| receipts | receipt routes | expenses | `modules.receipts` (on) | No upload; existing files stay on the volume | Drop registration; delete `receipts/` |
| maintenance | routes in §6 | core | `modules.maintenance` (on) | No maintenance tab | Drop registration |
| tax | routes in §7.3; `deductionMethodFor` override; tax pack registry | core | `modules.tax` (on) | No tax screen; mileage deduction as today (standard mileage); no set-aside, no deadlines | Drop registration; tables stay |
| goals | routes in §8.1 | core | `modules.goals` (on) | No goals screen or ring | Drop registration |
| progress | `getProgress`; badge registry | goals, earnings | `modules.progress` (**off**) | No progress screen, badges, XP | Drop registration |
| schedule | routes in §9; `sync` entity `schedule` | core | `modules.schedule` (**off**) | No schedule screen; phone schedules no reminders | Drop registration |
| analytics | `getAnalytics` | core; cards read earnings, expenses, tax when on | `modules.analytics` (on) | No analytics screen | Drop registration; no data owned |
| export_expenses, export_tax_summary | exporter registry | expenses; tax | one switch each (on) | Format absent | Delete the exporter file |
| notifications | routes in §11; event subscriptions | core | `modules.notifications` (on) | No inbox, no bell, no prefs; phone keeps its own local reminders | Drop registration |
| import | routes in §12 | core; expenses for that kind | `modules.import` (on) | No wizard | Drop registration |

`GET /settings` `modules` gains these names; the web hides screens for absent modules (`05` §5). The CI rule of `08` §16.6 (once all on, once per module with only its dependencies) applies to each. Event bus additions (`08` §16.4): `expense.changed`, `earnings.changed`, `goal.met`, `badge.unlocked`, `notification.created`. `sync` writes `change_log` rows for the entities the phone reads (vehicles with new fields, goals, schedule, notification prefs).

## 15. Build Order (proposed)

Smaller first, each PR at most 400 lines (`17` §5), tests with every PR, server before web.

| Step | Content | Why here |
|---|---|---|
| P1 | Web: vehicles screen and password change (existing routes only) | Needs no server work. |
| S1 | Core additions (vehicle fields, kinds, profile settings), then web profile | Unblocks tax eligibility and goals week boundaries. |
| S2 | `platforms` | Slug validation used by earnings, schedule, analytics. |
| S3 | `earnings`, then summary/CSV use effective earnings | Everything numeric depends on it. |
| S4 | `expenses` (+ categories registry, recurring) | Largest owner value; the tax module needs it. |
| S5 | `receipts`, backup includes the receipts directory | Disk and backup rules need care; isolated. |
| S6 | `tax` (CA pack, tax years, jar, vehicle tax years), exporters `expenses`, `tax_summary` | Needs S1, S3, S4. Numbers need verification first. |
| S7 | `goals`, then `analytics` | Read-only on top of S3, S4, S6. |
| S8 | `maintenance`, `import` | Independent; import after expenses and earnings exist. |
| S9 | `notifications` | Subscribes to events from S4 to S7. |
| S10 | `schedule`, then `progress` | Lowest priority, both default off. |
| Web | Each module's screen follows its server step; dashboard checklist last. | |

## 16. Open Questions for the Owner

1. Confirm `progress` default **off** and `schedule` default **off** (Comma defaults schedule off, goals and gamification on).
2. Confirm the full-reset stays CLI-only, with no web button (§3.3).
3. `shift_earnings` override rule (the typed platform total replaces that platform's label sum for the shift): confirm, or prefer summing both with a warning.
4. Opt in to the Year-in-Review image and the three untriggered notifications (weekly digest, maintenance, insurance expiry)?
5. Tax pack numbers (CPP/CPP2 ceilings and rates, HST rates, deadlines, T4A threshold) must be checked against CRA publications before S6 ships; US and GB tax estimates stay off until their numbers are checked.
6. Default currency symbol and the weekly-challenge target ($500 in Comma) when the currency is not CAD.

---

## 17. Assumptions Made Without Owner Answers (Comma-modules agent)

The owner has not answered section 16. The modules were built on the defaults written in this document. Each row says where to flip it (a config value or a module flag, never a code change). The same list is in `progress.md`.

| # | Question | Assumption used | How to flip it |
|---|---|---|---|
| 1 | `progress` and `schedule` defaults | Both **off** (`defaultEnabled: false`) | `modules.progress` / `modules.schedule` in `config/settings.json`, or `MILEWAGE_MODULE_PROGRESS=1` / `MILEWAGE_MODULE_SCHEDULE=1` |
| 2 | Full reset | CLI-only; no web button was built | nothing to flip; a future `milewage reset` command |
| 3 | `shift_earnings` against labels | The typed platform total **replaces** that platform's label sum | `comma.earnings_override` = `"sum"` in `config/settings.json` (or `MILEWAGE_EARNINGS_OVERRIDE=sum`) |
| 4 | Year-in-Review, weekly digest, maintenance and insurance notices | Not built | would be new work |
| 5 | Tax pack numbers | **CA only** is on; US and GB have no pack and return `supported: false`; every CRA figure carries `verified: false` (`unverified: true` in every response) and the UI shows an "Unverified rates" alert. The figures were written from memory and must be compared with the CRA pages before anyone relies on them | `comma.tax_countries` in `config/settings.json` (default `["CA"]`, or `MILEWAGE_TAX_COUNTRIES=CA,US`; a country without a pack stays unsupported) |
| 6 | Currency and the weekly challenge target | The challenge target is 50 000 minor units of the settings currency (CAD 500 in Comma) | `comma.challenge_target_cents` in `config/settings.json` |
| 7 | `progress` rules that 18 leaves open | A "duration target" shift is 4 hours; a "record" is a shift longer in distance than every earlier one; goals-met XP (+20) is **not** counted (it needs period history nothing stores); badge thresholds are this project's own | `packages/shared/src/badges.ts` and `progress-engine.ts` (data and constants) |
| 8 | When notification triggers are evaluated | When the inbox is read, not by a timer (the spec's daily housekeeping job belongs to diagnostics); a failed backup is recorded when it happens; `DELETE` dismisses without forgetting | `notifications.ts` |
| 9 | Receipts in backups | Each receipt file is copied into the backup copy of the database as a scratch table, so the single encrypted file carries them | `backup/engine.ts`, `receipts/store.ts` |
| 10 | Per-vehicle mileage rate override (7.1) | Stored and returned, **not applied** to the deduction (the pack rate rules, as in 07 D7) | `routes/tax.ts` |
| 11 | `platform=` filter | Applies to the summary and analytics earnings only; `listExpenses` has none because an expense carries no platform | nothing to flip |

Build status: every module of section 14 and every step of section 15 (S1 to S10) is built, each as a server PR and a web PR (the web Platforms, Import and Alerts features are Settings cards, the Earnings block is on the shift screen, the Maintenance log and the vehicle tax-year choice are on the vehicle screen). Still open: the phone reading goals, the schedule and the notification toggles through `sync` (phone work), and the person-checked CRA figures.
