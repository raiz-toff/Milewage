# 22 — Earnings as entries (Track L)

**Status:** spec for PRs L1–L4. Owner decision Q7a in [`21`](./21-jurisdictions-plan.md) §7 (2026-11-07).
**Parent:** [`21`](./21-jurisdictions-plan.md) §2.5, §2.6, §3.6b item 1; module `earnings` in [`18`](./18-comma-parity.md) §4.3.
**Rules:** [`17`](./17-gate4-execution-roadmap.md) §1 (≤ 400 lines per PR, tests, `npm run verify`); migrations as in [`10`](./10-backup-restore-and-ops-spec.md) §10 (verified pre-migration backup, forward only).

## 1. The problem

`shift_earnings` holds one row per shift and platform with three amounts: `gross_cents`, `tips_cents`
and `bonus_cents`, each `>= 0`. That fits a North American delivery driver whose app pays out with
its cut already taken. It cannot hold what drivers elsewhere see on their statements:

- a **cash trip**: the customer pays the driver, and the driver then owes the app its commission;
- the app's **commission** and other **platform fees**;
- **tax withheld** by the platform (Mexico, India);
- a **wallet top-up**, a **payout** to the bank, and a balance that can go **below zero**.

## 2. Standards and practice checked (web search, 2026-11-07)

| Source | What it says | What we take |
|---|---|---|
| OECD Model Reporting Rules for Digital Platforms (2020), as applied by HMRC ([IEIM901741](https://www.gov.uk/hmrc-internal-manuals/international-exchange-of-information/ieim901741)); OECD text: [model rules](https://www.oecd-ilibrary.org/en/publications/model-rules-for-reporting-by-platform-operators-with-respect-to-sellers-in-the-sharing-and-gig-economy_d7973047-en) | Per quarter the platform reports **Consideration** paid or credited *after* fees, commissions and taxes withheld; the **fees and commissions** and the **taxes withheld** separately; and the **number of activities**. HMRC's example: earnings £3,000 → consideration £2,244, fees £630 (commission counts as a fee), taxes £126. | Our types map onto those three amounts and `orders` maps onto the count (§4.4). |
| Stripe balance transactions ([object](https://docs.stripe.com/api/balance_transactions/object)) | One row per money movement with a `type` from a closed list (`charge`, `payout`, `topup`, `adjustment`, `stripe_fee`, `tax_fee` …) and a **signed** integer `amount` in the currency's smallest unit; positive increases the balance. | Closed type list; signed integer minor units; sign = effect on the balance. |
| Martin Fowler, [Accounting patterns](https://www.martinfowler.com/eaaDev/AccountingNarrative.html), [Account](https://martinfowler.com/eaaDev/Account.html) | A balance is the **sum of its entries**, never stored separately. Entries are immutable; a mistake is corrected by an opposite entry or removed, not edited. | Totals are sums at read time. No "edit entry": delete and add. |
| Uber ([how cash works](https://help.uber.com/h/7b67ce41-8e63-49a8-870d-dc2be97c3631), [service fee](https://uber.com/us/en/drive/driver-app/service-fee), [weekly statement](https://www.uber.com/gb/en/blog/uk-weekly-statement)) | On a cash trip the driver keeps the cash and the service fee is taken from the week's earnings. The statement lists fares, service fee, tips, promotions, then cash collected and payouts. "Earnings" are after the service fee. | `cash_collected` and `payout` move the balance but are not earnings. Earnings are after the platform's cut. |
| Grab ([cash commission](https://www.grab.com/my/blog/driver/car/new-commission-deduction-for-cashless-bookings), [negative balance](https://www.grab.com/ph/blog/driver/accept-bookings-kahit-mababa-ang-credit-balance/), [wallet labels](https://www.grab.com/my/clearer-and-organised-transactions/)) | Commission on cash bookings comes out of the driver's wallets; the credit wallet can go to zero or below and is topped up. The wallet history labels net earnings, tips, bonuses and commission. | `commission` and `top_up` types; a balance that can be negative. |
| Mexico ([platform withholding](https://siemprealdia.co/mexico/fiscal/obligaciones-fiscales-de-las-plataformas-digitales/)), India ([194-O](https://learn.quicko.com/section-194o-tds-e-commerce-sales)) | Platforms withhold income tax (and part of VAT in Mexico) from each payout and give a monthly or quarterly certificate. | `tax_withheld` type, kept apart from earnings so a later estimate does not count it twice. |
| Gig trackers: [Gridwise](https://gridwise.io/features/earnings), [Stride](https://support.stridehealth.com/hc/en-us/articles/35870402454935-How-does-the-No-Tax-on-Tips-feature-work-in-the-Stride-app) | Earnings per platform with tips and bonuses apart; Stride keeps tips in their own field; income is typed by hand or synced. Nothing found on how Gridwise, Solo or Driversnote record cash trips or commissions. | Keep base pay, tips and bonus apart (today's three amounts become three types). No vendor format is copied. |

The sources are press, vendor and tax-office pages. No figure from them is shipped as data.

## 3. Data model

### 3.1 Two tables

`shift_earnings` stays as the **row per shift and platform**. It keeps what belongs to the row, not
to a money movement: `orders`, `online_min`, `notes`, `source`, `edited_at`. Its three amount
columns move into a new table and are dropped.

```sql
-- earnings/0002_earning_entries.sql
CREATE TABLE earning_entries (
  id           INTEGER PRIMARY KEY,
  earnings_id  INTEGER NOT NULL REFERENCES shift_earnings(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL CHECK (type IN ('fare','tip','bonus','cash_collected','commission',
                                                'platform_fee','tax_withheld','top_up','payout','adjustment')),
  amount_cents INTEGER NOT NULL CHECK (CASE
                 WHEN type IN ('fare','tip','bonus','top_up') THEN amount_cents > 0
                 WHEN type = 'adjustment' THEN amount_cents <> 0
                 ELSE amount_cents < 0 END),
  note         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_entries_earnings ON earning_entries(earnings_id);
```

"Minor units" means the currency's smallest unit (ISO 4217). The column keeps the `_cents` suffix
like every other amount in MileWage. One currency per driver, as today (the settings currency).

### 3.2 The sign rule

An amount's sign is its **effect on what the platform owes the driver** (Stripe's rule). The database
enforces it.

| Type | Sign | Meaning | Earnings? |
|---|---|---|---|
| `fare` | + | Pay for the work: base pay, the full fare of a trip (cash or app). | yes |
| `tip` | + | Tips. A cash tip is a `tip` plus a `cash_collected` of the same amount. | yes |
| `bonus` | + | Incentives, promotions, quests. | yes |
| `commission` | − | The platform's cut of a fare. | yes (reduces) |
| `platform_fee` | − | Any other fee the platform charges: booking fee, instant cash-out fee, device rent. | yes (reduces) |
| `adjustment` | ± | A correction to pay (fare adjustment, refund of a fee). | yes |
| `tax_withheld` | − | Income tax or VAT the platform kept and pays to the tax office for the driver. | no |
| `cash_collected` | − | Cash the driver took from customers. The fare is already counted; this only says the money is in the driver's hand. | no |
| `top_up` | + | Money the driver paid into the platform wallet. | no |
| `payout` | − | Money the platform sent to the driver's bank. | no |

### 3.3 Figures derived from the entries (computed on read, never stored)

Every figure is the plain sum of its entries, **with their signs**:

| Figure | Sum of | Today's equivalent |
|---|---|---|
| `gross_cents` | `fare` | `gross_cents` |
| `tips_cents` | `tip` | `tips_cents` |
| `bonus_cents` | `bonus` | `bonus_cents` |
| `fees_cents` (≤ 0) | `commission` + `platform_fee` | — (always 0) |
| `adjustments_cents` | `adjustment` | — (always 0) |
| **`total_cents`** (earnings) | gross + tips + bonus + fees + adjustments | gross + tips + bonus |
| `tax_withheld_cents` (≤ 0) | `tax_withheld` | — |
| `cash_collected_cents` (≤ 0) | `cash_collected` | — |
| `balance_cents` | **all** entries | — |

`balance_cents` is how this shift changed what the platform owes the driver; below zero means the
driver owes the app (Grab's negative credit balance). Examples:

| Case | Entries | Earnings | Balance |
|---|---|---|---|
| App trip, paid out | fare +100, commission −25, payout −75 | 75 | 0 |
| Cash trip | fare +100, cash_collected −100, commission −20 | 80 | −20 (owed to the app) |
| … then a top-up | top_up +50 | 80 | +30 |
| Mexico payout | fare +100, commission −25, tax_withheld −2, payout −73 | 75 | 0 |
| Today's row (any) | fare, tip, bonus | gross + tips + bonus | same |

**Assumption (owner to confirm) A1:** "Earnings" everywhere in MileWage (dashboard, goals, analytics,
progress, tax income) means **after the platform's commission and fees, before tax withheld**. This
is what Uber and Grab call earnings and what a delivery driver types today. For every row that exists
today the figure is unchanged, because those rows hold only fare, tip and bonus.

### 3.4 Effective earnings keep their rule

The override rule of `18` §4.3 is unchanged: a typed row for a (shift, platform) is the figure; else
the stop labels of that platform; with the `sum` option both are added. Labels have no entries, so
their fees, adjustments and withheld tax are 0.

## 4. Migration of today's rows (L1)

### 4.1 What the migration does

In one transaction, after the verified pre-migration backup that `upgrade.ts` already takes (`10` §10):

1. Create `earning_entries`.
2. For each `shift_earnings` row, insert a `fare` entry for `gross_cents`, a `tip` entry for
   `tips_cents` and a `bonus` entry for `bonus_cents`, **each only when the amount is above 0**
   (an entry of 0 is refused by the CHECK and means nothing). `created_at` = the row's `edited_at`.
3. Drop the three columns (`ALTER TABLE … DROP COLUMN`, SQLite 3.35+; the server ships 3.53).

A row whose three amounts were 0 keeps existing with no entries. Its total is still 0, not `null`:
"the driver entered zero" stays different from "nothing entered", as today.

### 4.2 No data loss, proved by a test

The test builds a database at the schema before the migration, inserts rows (amounts, zeros, a
second platform, an imported row, orders and notes), runs the migration, and checks that every
row's `gross`, `tips`, `bonus`, `orders`, `notes` and `source` read back exactly, that the shift's
effective total and `GET /summary` are unchanged, and that deleting a shift still removes its rows
and entries (cascade). Rollback is a restore of the pre-migration backup, as for every migration.

## 5. API

### 5.1 Unchanged operations keep working

| Operation | Behaviour with entries |
|---|---|
| `GET /shifts/{ref}/earnings` | Same three arrays. Each typed row keeps `gross_cents`, `tips_cents`, `bonus_cents` (now sums) and **gains** `fees_cents`, `adjustments_cents`, `total_cents`, `tax_withheld_cents`, `cash_collected_cents`, `balance_cents` and `ledger` (its entries). Each effective row gains `fees_cents`, `adjustments_cents`, `tax_withheld_cents`. |
| `PUT /shifts/{ref}/earnings/{platform}` | Same body. Sets `orders`, `online_min`, `notes` as today. For each of fare, tip and bonus: if the entries of that type already add up to the sent amount they are kept; otherwise they are replaced by one entry of the sent amount (none for 0). **Entries of the other seven types are kept**, so an old client cannot wipe them. |
| `DELETE /shifts/{ref}/earnings/{platform}` | Removes the row and all its entries; the labels apply again. Unchanged. |

### 5.2 New operations (module `earnings`, web session only)

| Operation | Method and path | Purpose |
|---|---|---|
| `addEarningEntry` | `POST /shifts/{ref}/earnings/{platform}/entries` | Body `{ type, amount_cents, note? }`. Creates the row if missing (no orders, `source = 'manual'`). The shift must be ended or finalized. A wrong sign is a `422` that says which sign the type needs. Returns the listing. |
| `deleteEarningEntry` | `DELETE /shifts/{ref}/earnings/{platform}/entries/{id}` | Removes one entry. The row stays (with no entries its total is 0); deleting the row is the existing operation. Returns the listing. |

No edit operation: delete and add again (Fowler). Both emit `earnings.changed`. Platform check as
for `PUT`. Amounts up to 1 000 000 000 minor units either way, as today.

### 5.3 Who reads the sums, and what changes for them

All of them read `effective()` and `totalOf()` in `earnings-repository.ts`, so the change is in one
place:

| Consumer | Change |
|---|---|
| `GET /summary`, goals, progress, analytics, notifications | None in code; `total` is earnings as in §3.3. |
| Imports (`shifts` CSV) | None; gross, tips, bonus become fare, tip, bonus entries through the same `put`. |
| Exports (shift CSV) | None; `Gross_Pay`, `Tips`, `Bonus` are the sums. Fees and withheld tax are not exported yet. |
| Tax report (`tax-report.ts`) | L4: `income` gains `fees_cents`, `adjustments_cents`, `tax_withheld_cents`, so its lines add up to `total_cents`. Withheld tax is shown, not yet credited against the estimate (country packs, Track J). |
| Phone | None. The phone never writes earnings (`18` §4.3) and reads only `GET /summary`, whose shape is unchanged. |

## 6. Web (L3)

The shift's Earnings block stays as it is. Additions:

- Under each platform with entries other than fare, tip and bonus: one line each for fees, tax
  withheld, cash collected and balance ("You owe the app $20.00" when below zero), and the list of
  entries with a Remove button.
- An "Add a line" form: platform, type (Fare, Tip, Bonus, Cash collected, Commission, Platform fee,
  Tax withheld, Top-up, Payout, Adjustment), amount, note. The driver types a positive number; the
  screen applies the sign of the type. Only for an adjustment does the driver choose "adds" or
  "takes off".
- Tax screen (L4): "Platform fees and commission" and "Tax withheld by platforms" lines, only when
  not zero, so nothing changes for today's drivers.

## 7. PRs

| PR | Branch | Content | Tests |
|---|---|---|---|
| L0 | `pr-L0-earnings-entries-plan` | This plan. | — |
| L1 | `pr-L1-earnings-entries-db` | Migration `earnings/0002`; repository reads and writes entries; `PUT` keeps other types. API unchanged. | Migration on a database with rows (§4.2); sign CHECK; sums and the balance; `PUT` keeps other entries; existing earnings tests unchanged. |
| L2 | `pr-L2-earnings-entries-api` | `addEarningEntry`, `deleteEarningEntry`; listing fields of §5.1; OpenAPI and generated types. | Add and remove, wrong sign, active shift, unknown platform, ownership, summary totals after a commission; module matrix covers the 404 side. |
| L3 | `pr-L3-earnings-entries-web` | Web block of §6. | Add a commission and a cash line with the right signs; balance text; nothing new shown for a plain row. |
| L4 | `pr-L4-earnings-tax-income` | Tax report `income` fields and the two Tax-screen lines. | Lines add up to the total; absent when zero. |

## 8. Assumptions (owner to confirm) and what is left

- **A1** Earnings are after commission and fees, before tax withheld (§3.3).
- **A2** Entries belong to a shift and platform, as the plan says. A weekly payout or a top-up not
  tied to a shift is recorded on a shift of that week. Entries with no shift (a platform ledger
  per week) are a later decision.
- **A3** Signs are fixed per type; a refund of a fee or a reversed payout is an `adjustment`. An
  adjustment counts as earnings, so a reversed payout entered that way would wrongly raise earnings;
  the screen says "a correction to pay" to steer drivers.
- **A4** A driver who enters the commission here and also as an expense would deduct it twice in
  the tax estimate. Not detected; the expense category list has no "platform fee" today.

Not in Track L: comparing a platform statement with the entries (needs a statement import), the
withheld tax as a credit in the estimate (country tax packs, Track J), fees and withheld tax in the
CSV exports and the CSV import, entries without a shift, more than one currency.

**Expected conflict:** L4 edits `apps/server/src/tax-report.ts` (the `income` object only) and the
`TaxYear` schema; Track J's J3 rewrites both. L4 is kept to those few lines so the merge is by hand
in one place.
