# 21 — Country structure: countries, regions and cities

**Status: owner decisions recorded 2026-11-07 (section 7); build started.** Q1 was left
unanswered and the owner said "start the work now", so the design proceeds as written.

This merges two planning notes into one plan:

- `21-country-modularity-findings.md` (the other session): one module per country, a tax pack that
  works for any country, money flow, conformance tests, lint rule.
- This session's findings: places form a tree (country → region → city), and regional rules are
  data layered on the country.

Once approved it amends `08` §16.2–16.3, `07` (settings), `18` §4.2, §5.1 and §7. The findings file
can then be deleted (or kept as background), so only one plan numbered 21 remains.

## 1. Goal (owner, 2026-11-07)

- Do **not** add more countries or tax laws now.
- Build the foundation now, while the code is small, so the owner or the community can later add a
  country, its regions (provinces, states, nations) and, where needed, cities **by adding files**,
  without changing calculation code, screens or other countries.
- Rules sit at different levels. Some countries are national only. Some have rules per province or
  state. A few have rules per city. Countries also differ in platforms, how money flows (payouts,
  cash, wallets) and tax.

## 2. What exists today (checked in code at aa73ff4)

### 2.1 Already modular: keep

- **Feature modules:** `defineModule` / `buildRegistry` (`packages/shared/src/module.ts`,
  `registry.ts`, `matrix.ts`), listed in `apps/server/src/modules.ts`. Dependencies are checked at
  start-up. The web and phone read the `modules` flags. Countries are data, not feature modules.
- **Track engine:** no country logic. Keep it that way.
- **Policy:** deductions computed at read time, never stored (`07` §3); every figure has a year,
  sources and `verified`; unverified or unknown means `null`, never a guess (`11` §4).

### 2.2 Where it leaks

| Country-specific thing | Where it lives now | Problem |
|---|---|---|
| Mileage rates, unit, regions | `packages/shared/src/countries.ts` (`CountryPack`, CA/US/GB in one file) | Regions are only a list of codes, with no names and no rules. |
| Tax | `packages/shared/src/tax.ts` (`TaxPack`, CA only), a second registry switched on by `comma.tax_countries` | Shaped like Canada: `cpp`, `CppYear`, `ownPensionPlan: ['QC']`, `salesTaxBp: {ON: …}`, `slipName: 'T4A'`; `TaxEstimate` has `cpp_cents`, `cpp2_cents`. A US pack (self-employment tax) or GB pack (National Insurance) does not fit. Province rules are special fields. No city level. |
| Platforms | `BUILTIN_PLATFORMS[].countries` (`platforms.ts`) | Availability is a tag on the platform, country only. |
| Expense categories | `EXPENSE_CATEGORIES` (`expense-categories.ts`) | `18` §5.1 says a pack may relabel or add; no hook exists. |
| Country list | `apps/server/src/routes/settings.ts:16` `DEFAULT_COUNTRIES`; `apps/web/src/pages/Setup.tsx:11-13` (name, currency, unit) | Two more copies of the list. |
| Region picker | `apps/web/src/pages/SettingsPage.tsx:239-266` | Country shown as a raw code; region is free text ("ON or QC"). |
| Country rule inside a screen | `apps/web/src/pages/Odometer.tsx:160,175` (`country === 'CA'`, CRA note) | Rule written into a screen. |
| Driver's place | `settings.country`, `settings.region` (`db/schema.ts:28`, `migrations/core/0008_profile.sql`) | No city. |

Adding a country today touches `countries.ts`, `tax.ts`, `platforms.ts`, `settings.ts`, `Setup.tsx`
and the server config.

Consumers to move: server `processing/presenter.ts`, `tax-report.ts`, `notifications.ts`,
`routes/platforms.ts`, `routes/settings.ts`, `routes/core.ts`, `expense-math.ts`; phone
`store/summary.ts`; web `Setup.tsx`, `SettingsPage.tsx`, `Odometer.tsx`, `Dashboard.tsx` (tax
text). Tests: `packages/shared/test/countries.test.ts`, `apps/server/test/tax.test.ts`,
`apps/phone/test/summary.test.tsx`.

### 2.3 Comma (for comparison, not to copy)

`commaApp/src/registry/countries/` had a folder per country and a file per province. The math still
switched on country flags (`calcCpp`, `calcSeTax`, `calcNI`, `regionPresetType`), so a new country
meant editing calculation code. Keep the folders; drop the flags. Comma's own registry notes that
US, UK and NP were removed until their numbers were checked.

### 2.4 Standards and prior art checked (web search, 2026-11-07)

The rule for this plan: **use an existing standard or proven design wherever one exists; invent only
the gap.** What was found, and what this plan takes from it:

| Need | Standard or prior art | What we take | Source |
|---|---|---|---|
| Country codes | ISO 3166-1 alpha-2 | Already used. Keep. | — |
| Region codes | ISO 3166-2; Unicode CLDR bases its subdivision data on it; Medusa and date-holidays use it too | Already used (`ON`, `QC`, `ENG`). Keep. ISO codes can change; CLDR notes it may diverge from ISO. Stored codes stay as stored; a rename gets an alias, never a data rewrite. | [ISO 3166-2](https://en.wikipedia.org/wiki/ISO_3166-2), [CLDR TR35 part 6](https://www.unicode.org/reports/tr35/tr35-74/tr35-info.html) |
| City codes | **No ISO city standard.** UN/LOCODE (UNECE): country + 3-letter location code (`CATOR` Toronto, `USNYC` New York), about 100,000 places, and each entry names its ISO 3166-2 region | City code = region + UN/LOCODE location part: `US-NY-NYC`, `CA-ON-TOR`. Replaces the invented `[A-Z0-9]{2,6}` id. | [UN/LOCODE](https://wikiwand.com/EN/UN/LOCODE) |
| Country names | Unicode CLDR, built into browsers and Node as `Intl.DisplayNames` (`type: 'region'`) | Do **not** hand-write country names; use `Intl.DisplayNames`, in the driver's language for free. | [Intl.DisplayNames notes](https://www.volcengine.com/article/23302) |
| Region names | `Intl.DisplayNames` does **not** support ISO 3166-2. CLDR has (draft) subdivision names. | Region names are written in the country's file (small, rarely change). The conformance test checks every code against an ISO 3166-2 list. | [CLDR subdivision names](https://www.unicode.org/cldr/cldr-aux/charts/33/subdivisionNames/index.html) |
| "Province" vs "State" labels | Google libaddressinput address metadata: `state_name_type` (province, state, island …, default province) and a city-level name type; data CC-BY 4.0 | Use its vocabulary for the level labels instead of free text. | [libaddressinput metadata](https://github.com/google/libaddressinput/wiki/AddressValidationMetadata) |
| Currency, unit | ISO 4217; CLDR supplemental `currencyData` and `measurementData` per territory | Country file states currency and unit; the test checks the currency against `Intl.supportedValuesOf('currency')`. | [cldr.js paths](https://github.com/rxaviers/cldrjs) |
| Dated rates with sources | **OpenFisca / PolicyEngine parameters**: rules-as-code used by governments (France) and PolicyEngine (US, UK, Canada). A parameter is a list of dated values; the value at a date is the last one set before it; metadata has a unit, label and references | Adopt the same shape for every rate: `values: { 'YYYY-MM-DD': value }`, `unit`, `label`, `reference` (source URL). Contributors who know OpenFisca recognise it. | [OpenFisca](https://openfisca.readthedocs.io/), [PolicyEngine parameters](https://policyengine.github.io/policyengine-core/usage/parameters.html) |
| Regional rules without editing the country | OpenFisca **extensions** add parameters and formulas next to a country package but cannot change existing ones (Paris, Rennes on France). PolicyEngine-US puts state rules under `gov/states/<st>/` in the same tree. | Regions as a sub-tree of the country folder (PolicyEngine style). Do not use extension packages: we are one product, not a microsimulation platform. | [OpenFisca extensions](https://openfisca.readthedocs.io/en/latest/contribute/extensions.html) |
| Region adds to or replaces the parent | **Medusa** tax regions: parent/child regions; a child rate with `is_combinable: true` is applied together with the parent's, otherwise it replaces it. **WooCommerce**: rates per location with `priority` and `compound` (tax on tax). **Avalara**: several jurisdictions (state, county, city, district) apply at once. | Name the flag `combinable` (Medusa's word) and add `compound` (WooCommerce's) to sales-tax components. This confirms the slot design of 3.4 rather than inventing it. | [Medusa tax rules](https://docs.medusajs.com/resources/commerce-modules/tax/tax-rates-and-rules), [WooCommerce Canada setup](https://stackharbor.com/en/knowledge-base/woo-tax-rates-setup-canada/), [Avalara jurisdictions](https://www.avalara.com/us/en/blog/a-handy-guide-to-us-sales-tax-jurisdictions.html) |
| Community-contributed per-country data | **date-holidays** (npm): one folder per country under `data/countries`, ISO 3166-2 regions nested further where needed, contributors edit their country's file, compiled to one JSON, tested | Same contribution model: one folder per country, a schema, a conformance test, a README for contributors. | [date-holidays](https://github.com/thacac/date-holidays) |
| Calculation of law | **Catala** (Inria, used for French tax) and OpenFisca are full rules-as-code engines | **Not adopted**: OpenFisca is Python and AGPL, Catala compiles from its own language; both are far more than an estimate needs and cannot run on the phone. Their published parameter files (PolicyEngine Canada, US, UK) are a cross-check source when a person verifies our figures, always traced back to the government page. | [Catala paper](https://arxiv.org/pdf/2103.03198v1.pdf), [policyengine-canada](https://github.com/policyengine/policyengine-canada) |
| Mileage rates | No standard or open dataset. Mileage apps (Driversnote) ship government rates for a handful of countries and let the user set a **custom rate** otherwise | Ship only verified-source rates; consider a driver-entered custom rate for countries without a pack (Q5). | [Driversnote rates](https://driversnote.helpscoutdocs.com/article/102-manage-reimbursement-rates) |

Not verified by these searches, to check before relying on them: how OpenFisca ends a parameter
(a `null` value), the exact libaddressinput city-level key name, and the licence of PolicyEngine's
data files (the engine is AGPL). MileWage itself has no `LICENSE` file yet, which matters before
copying anything from another project.

### 2.5 How gig work differs around the world (web search, 2026-11-07)

The owner asked for the foundation to fit gig work everywhere, not one country. Research on
location-based platform work (the ILO's term for ride-hailing and delivery, as opposed to online
work) shows that countries differ along a small number of **dimensions**. Every figure below is from
press, adviser or government pages found by search, is **not verified**, and is here only to show
the shape of the problem, never to be shipped as data.

| Dimension | What varies | Examples found |
|---|---|---|
| **Kind of work** | Delivery (food, grocery, parcel), ride-hailing with passengers, motorcycle taxi | ILO splits platform work into web-based and location-based; ride-hailing and delivery are location-based. Motorcycle taxis are central in Indonesia (ojek, Gojek, Grab) and Nepal (Pathao). |
| **Vehicle** | Car, motorcycle, scooter, bicycle, e-bike, three-wheeler, on foot; and **who owns it** | India: most riders on petrol two-wheelers; e-scooter rental by the hour, day or month. Nigeria and Kenya: many drivers do not own the car and repay a lease or hire purchase weekly from earnings (Bolt with leasing partners). Germany: €0.30/km for cars, €0.20/km for motorbikes. |
| **How money flows** | The app pays out (commission already taken) **or** the customer pays cash to the driver, who then owes the app its commission; a driver wallet can go negative and must be topped up; tips in-app or cash; bonuses; payout weekly or instant | Grab: commission on cash bookings is taken from the driver's cash and credit wallets; the credit balance can go to zero or negative; top-ups at shops. Indonesia: commission caps (20 %, cut to 8 % for two-wheelers from July 2026). |
| **Worker status** | Independent contractor; employee; a simplified micro-business status | Spain's Rider Law (2021) presumes delivery riders are employees; the EU Platform Work Directive extends a presumption of employment, transposed by 2 December 2026. Brazil: MEI micro-entrepreneur. Argentina: monotributo. |
| **How income tax is collected** | (a) Driver self-assesses net profit with deductions; (b) the platform **withholds** tax from each payout; (c) a **flat or presumptive** regime on gross income, with no deductions | (a) US, Canada, UK, Australia, Germany. (b) Mexico (platforms withhold ISR and IVA since June 2020; higher if the driver has no tax ID); India (TDS under section 194-O); Nepal (1 % TDS proposed). (c) Brazil MEI (fixed monthly DAS, yearly gross ceiling); Argentina monotributo (monthly fee by gross-income category, includes pension and health); India 44AD (income presumed as a % of turnover). |
| **Sales tax / VAT on rides** | Driver registers above a threshold; driver registers **from the first dollar**; the **platform collects** it | Australia: ride-sourcing drivers register for GST from the day they start. Nepal: 5 % VAT on rides collected by the platform from July 2026. Mexico: platform withholds part of the IVA. |
| **Mileage / vehicle deduction** | Rate per distance (flat, tiered, **capped**), by vehicle class; or actual costs × business-use % with a logbook; or nothing (flat regimes) | US flat rate per mile; Canada tiered at 5,000 km; UK tiered at 10,000 miles, tax year from 6 April; Australia cents per km capped at 5,000 km, or a 12-week logbook; Germany per km by vehicle class. |
| **What the platform reports** | A yearly statement to the tax office and a copy to the driver | **OECD Model Reporting Rules for Digital Platforms** (2020) cover transport and personal services: Canada (Part XX, from 2024, due 31 January, seller copy), UK (from 2024, due 31 January, seller copy), EU (DAC7). Elsewhere: US 1099 forms, India TDS certificates, Mexico withholding certificates. |
| **Pension / social contributions** | Separate contribution, part of a flat fee, or none | Canada CPP (Quebec QPP), US self-employment tax, UK National Insurance, Brazil INSS inside the MEI fee, Argentina inside the monotributo. |
| **Tax year and calendar** | Calendar year; 6 April (UK); 1 July (Australia); 1 April (India); Nepal's fiscal year starts on Shrawan 1 (mid-July) of the Bikram Sambat calendar | — |
| **Money and language** | Currency and its minor unit; large amounts under inflation (Argentina); the driver's language | — |

Sources: [ILO platform work](https://www.ilo.org/resource/news/ilo-presents-new-report-platform-work-european-parliament),
[OECD model rules / DAC7](https://www.fonoa.com/resources/blog/dac7overview),
[CRA digital platform reporting](https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/compliance/reporting-rules-digital-platforms.html),
[HMRC digital platform reporting](https://www.gov.uk/government/publications/reporting-rules-for-digital-platforms/reporting-rules-for-digital-platforms),
[Mexico platform withholding](https://siemprealdia.co/mexico/fiscal/obligaciones-fiscales-de-las-plataformas-digitales/),
[India 194-O and 44AD](https://www.taxbuddy.com/blog/side-hustles-zomato-swiggy-partners),
[India two-wheeler rental](https://redseer.com/articles/wheels-of-the-last-mile-how-e2w-rentals-are-powering-indias-hyperlocal-logistics-boom/),
[Grab cash commission](https://www.grab.com/my/blog/driver/car/new-commission-deduction-for-cashless-bookings),
[Grab negative balance](https://www.grab.com/ph/blog/driver/accept-bookings-kahit-mababa-ang-credit-balance/),
[Indonesia 8 % cap](https://insideretail.asia/2026/06/24/under-pressure-grab-goto-cut-driver-commissions-in-indonesia/),
[Spain Rider Law and EU directive](https://bloglaboral.garrigues.com/en/riders-law-and-platform-work-directive-challenges-ahead),
[Brazil MEI](https://jornalcontabil.com.br/noticia/mei-digital-para-entregadores-de-aplicativos/),
[Argentina monotributo](https://tributosimple.com/monotributo-para-riders-pedidos-ya-rappi/),
[Australia GST and cents per km](https://smallbusiness.taxsuperandyou.gov.au/introduction-to-ride-sourcing/fast-fact),
[Germany Kilometerpauschale](https://norman.finance/blog/reisekosten-selbststaendige),
[Nepal ride-sharing VAT](https://www.vatupdate.com/2026/07/24/nepal-brings-ride-hailing-into-the-vat-net-with-a-5-platform-collected-levy/),
[Kenya and Nigeria vehicle finance](https://techcabal.com/2021/11/24/bolt-partners-max-ng/).

**Finding that affects Canada today:** since 2024 Canadian platforms report under Part XX (OECD
rules) by 31 January with a copy to the driver. The CA pack's "collect your T4A slips by end of
February" (`slipSeason` in the uncommitted `tax.ts` change) may describe the wrong statement for
gig drivers. A person must check this against the CRA pages before it ships.

### 2.6 What MileWage cannot represent yet (checked in code)

| Global pattern | MileWage today | Gap |
|---|---|---|
| Cash trips, commission owed to the app, wallet top-ups, negative balance | `shift_earnings`: `gross_cents`, `tips_cents`, `bonus_cents`, all `>= 0`, per shift and platform (`migrations/earnings/0001`) | No cash vs app payment, no commission or fee, no top-up, no balance that can go below zero. |
| Tax withheld by the platform | not stored | A Mexico or India driver cannot record what was already withheld, so any estimate double-counts. |
| Flat or presumptive regimes | the CA estimate assumes net profit with deductions | The estimate needs a regime choice (net, presumptive, flat fee, withheld) per country and driver. |
| Worker status | not stored | An employee (Spain) has different deductions from a contractor. |
| Three-wheeler, motorcycle taxi | `vehicles.kind` CHECK: car, motorcycle, van, bicycle, ebike, scooter, walking (`core/0008`) | No three-wheeler; widening the CHECK means rebuilding the table, as `0008` already had to. |
| Rented, leased or financed vehicle | no ownership field | Rent and hire-purchase repayments are a large cost in many markets. |
| Platform statements | only the CA slip name and threshold | No common shape; the OECD model fields are the obvious standard. |
| Currency minor units | every amount is `_cents` | Fine as "minor units" (ISO 4217 says how many digits each currency has), but formatting must use the currency's digits, never assume 2. |
| Non-Gregorian fiscal years | `periodStart(date)` per pack | Works if the pack lists the Gregorian dates of each fiscal year (Nepal); the UI shows Gregorian dates only. |
| Driver's language | English only | Out of scope here, but the global foundation needs a translation standard (ICU MessageFormat, used by FormatJS and i18next) before screens multiply. |

## 3. Design: two layers

**Layer 1, the country module, is the unit someone contributes** (from the findings note). It owns
its profile, platforms, money flow, mileage and tax *calculation*.

**Layer 2, the place tree, lives inside a country** (from this session). Regions and cities supply
only the *data* that differs from the level above. The country's calculation reads the combined data
for the driver's place and never checks a region code itself.

In short: **data cascades down the tree; calculation belongs to the country; output is generic.**

### 3.1 Places form a tree

```
CA                      country      ISO 3166-1 alpha-2
├─ CA-ON                region       ISO 3166-2 (today's codes: ON, QC, ENG, SCT …)
├─ CA-QC
└─ CA-BC
US
└─ US-NY
   └─ US-NY-NYC         city         <region>-<UN/LOCODE location part>
GB
├─ GB-ENG
└─ GB-SCT
```

- Every country has the first level; regions and cities are optional.
- The country names its levels for screens with libaddressinput's vocabulary (`province`, `state`,
  `island` …; city level likewise), not free text.
- Country names come from `Intl.DisplayNames`; region and city names are in the country's files.

### 3.2 The country module (contract)

```ts
interface CountryModule {
  code: string;                         // ISO 3166-1 alpha-2
  name: string;
  currency: string;                     // ISO 4217
  unit: 'km' | 'mi';
  labels: { region?: string; city?: string };
  places: readonly Place[];             // its regions and cities (section 3.3)
  data: PlaceData;                      // national values of the data slots (section 3.4)
  mileage: MileagePack;                 // today's deduction() and periodStart(), reads resolved data
  tax?: TaxPack;                        // absent = "no tax estimate for this country" (section 3.5)
  income?: IncomeModel;                 // money flow (section 3.6), empty until checked
  expenseOverrides?: ExpenseOverrides;  // relabel or add categories (18 section 5.1)
  sources: readonly string[];
  verified: boolean;
  notes: readonly string[];
}
```

- The country **owns its platform list** (a data slot, so a region can add a local app). Shared
  `platforms.ts` keeps only what is the same everywhere: slug, label, vocabulary ("block" for Amazon
  Flex). The `countries` tag on `BUILTIN_PLATFORMS` goes away.

### 3.3 Regions and cities

```ts
interface Place {
  code: string;            // CA-QC, US-NY-NYC
  parent: string;          // CA, US-NY
  name: string;
  data?: Partial<PlaceData>;   // only what differs from the parent
  sources?: readonly string[]; verified?: boolean; notes?: readonly string[];
}
```

### 3.4 Data slots and how levels combine

A **slot** is one kind of regional data. The slot decides how levels combine, so a region can
either replace or add to its parent. This is what a plain "most specific wins" cannot express.

| Slot | Combines by | Example |
|---|---|---|
| `salesTax` | list: a component with `combinable: true` is **added** to the parent's; otherwise the level **replaces** the parent's list (Medusa's rule). A component may be `compound` (charged on top of the others, WooCommerce's rule). | CA: GST 5 %. CA-BC adds PST 7 %. CA-ON replaces with HST 13 %. |
| `pension` | nearest wins; `null` = not estimated here | CA: CPP figures. CA-QC: `null` with note (own plan, QPP). |
| `incomeTax` (later) | list, adds | US federal + NY state + NYC city. |
| `filing` | nearest wins | slip name, threshold, season, deadlines. |
| `logbook` | nearest wins | the CRA odometer note now hard-coded in `Odometer.tsx`. |
| `platforms` | list, adds or removes | CA: DoorDash, Uber Eats, Skip…; a region adds a local app. |
| `mileage` (rare) | nearest wins | only if a region ever has its own rate. |

Rules:

1. **No country or region check outside a country's own folder.** Code asks for data
   (`resolve(place).salesTax`), never `if (country === 'CA')` or `region === 'QC'`. A lint rule
   forbids country-code string literals outside `packages/shared/src/countries/` and tests, like the
   existing track-engine rule.
2. **A new slot is added once,** in its own file (type, how it combines, validation). Existing
   places do not change.
3. **Every rate is a dated parameter in the OpenFisca shape:** `values` keyed by start date, plus
   `unit`, `label` and `reference`. The value at a date is the last one set before it, and a final
   end date stops it, so a rate is never carried into a period nobody announced. One shared helper
   reads them.
4. **Provenance per file and per value:** `reference` on each value, `verified` and `notes` on each
   file. A resolved result is verified only if every contributing file is verified.
5. **Data first.** Shared builders cover the common shapes (tiered per-unit rate, flat rate by era,
   percentage components), so contributors mostly write numbers.
6. **Absence is meaningful.** An empty slot means "no rule known here" and yields `null` with a
   notice, never another country's number.

### 3.5 Tax pack as a strategy with generic output

```ts
interface TaxPack {
  verified: boolean; sources: readonly string[]; notes: readonly string[];
  estimate(input: TaxInput, place: ResolvedPlace): TaxEstimate;
  deadlines(year: number, place: ResolvedPlace): Deadline[];
}
interface TaxEstimate {
  lines: { key: string; label: string; cents: number | null; note?: string }[];
  totalSetAsideCents: number;
  instalmentCents: number;
  salesTax?: { collectedCents: number; creditsCents: number; owingCents: number; rateBp: number };
}
```

- CA keeps its CPP logic in `countries/ca/tax.ts` and returns CPP lines. It reads `place.pension`
  (QC → `null` → a line with a note) and `place.salesTax`, instead of `ownPensionPlan` and
  `salesTaxBp`.
- A future US or GB pack returns its own lines. The screens render `lines` and never name a
  country-specific field.
- This changes the `GET /tax/{year}` response (`cpp_cents`, `cpp2_cents`, `pension_note` become
  lines): OpenAPI and generated types change in the same PR.

### 3.6 Money flow (`IncomeModel`)

For the difference between a driver in Toronto and one in, for example, Nepal:

```ts
interface IncomeModel {
  payers: readonly ('platform' | 'cash' | 'wallet')[];
  tipsCommon: boolean;
  payoutsTaxInclusive: boolean | null;   // null = unknown
  payoutRhythm: readonly ('instant' | 'weekly' | 'monthly' | 'none')[];
  platformIssuesSlip: boolean;
}
```

The field is in the contract now so adding data later is not a breaking change. It stays empty for
CA, US and GB until filled from checked sources. No workflow engine.

### 3.6a Global dimensions in the contract

From section 2.5, each country module (and, where it varies, a region) declares its answer to each
dimension. Values are closed lists so screens and calculations can rely on them; a country picks the
ones that apply.

| Dimension | Contract field | Values |
|---|---|---|
| Kinds of work | `work` | `delivery`, `ride_hailing`, `moto_taxi`, `courier` |
| Vehicle classes | `mileage` rates keyed by class | `car`, `van`, `motorcycle`, `three_wheeler`, `scooter`, `bicycle`, `ebike`, `walking` (adds `three_wheeler`) |
| Worker statuses | `statuses` | `contractor`, `employee`, `micro_business` (MEI, monotributo …), with the country's own label |
| Income-tax regimes | `tax.regimes` | `net_profit` (deductions apply), `presumptive` (a % of gross), `flat_fee` (fixed amount by gross band), `withheld_final` (the platform's withholding is the whole tax) |
| Sales tax / VAT | `salesTax` slot + `registration` | threshold, `from_first_dollar`, or `platform_collects` |
| Mileage methods | `mileage.methods` | `per_distance` (flat, tiered, capped, by class), `actual_costs` (business-use %), `none` |
| Platform statement | `filing.platformStatement` | name, due date, and which OECD model fields it carries |
| Payment methods | `income.payers` (findings note §3.6) | `platform`, `cash`, `wallet` |

The driver's own choices (status, regime where the law gives a choice, mileage method per vehicle,
which already exists as `deduction-method.ts`) are stored per driver and per year. A country without
data for a dimension simply offers nothing for it.

### 3.6b Foundation outside the country files

These are not country rules, but the global patterns need them, and each is cheaper now than later:

1. **Earnings as entries, not three totals.** Per shift and platform, entries of a closed set of
   types: `fare`, `tip`, `bonus`, `cash_collected`, `commission`, `platform_fee`, `tax_withheld`,
   `top_up`, `payout`, `adjustment`, with signed amounts. Today's `gross/tips/bonus` become entries
   (`fare`, `tip`, `bonus`); totals are sums. This is the usual double-entry-style ledger pattern and
   matches the OECD statement (consideration, fees, taxes withheld), so a platform statement can be
   compared with the driver's own records.
2. **Vehicle ownership** on the vehicle: `owned`, `leased`, `rented`, `financed`, with rent or
   repayment as an expense category.
3. **`three_wheeler`** vehicle kind (table rebuild, as `core/0008` did).
4. **Money:** amounts stay integer minor units; display uses `Intl.NumberFormat` with the currency,
   which knows each currency's digits.
5. **Translation standard** chosen before more screens are written (ICU MessageFormat), English only
   for now.

Each is its own plan item and PR; none is needed to move CA, US and GB into the new structure.

### 3.7 Files and registration

```
packages/shared/src/countries/
  types.ts          CountryModule, Place, slot types, Dated
  slots/            one file per slot: type, combine, validate
  resolve.ts        country → region → city
  registry.ts       register / get / list / tree
  index.ts          the only file listing which countries ship (one line each)
  README.md         how to add a country, region or city
  ca/index.ts       profile, national data, platforms
  ca/mileage.ts
  ca/tax.ts         CPP strategy
  ca/regions.ts     names of all 13, plus data for ON, NB, NL, NS, PE (HST) and QC (pension)
  us/index.ts       profile, mileage eras, state names; no tax
  gb/index.ts       profile, mileage tiers, nation names; no tax
```

Adding a country = a new folder + one line in `index.ts`. A region or city = one entry or file in
that country's folder.

### 3.8 Conformance tests

One suite loops over every registered country, like `moduleMatrix`:

- Codes valid, every parent exists, names and labels present, currency and unit present.
- At least one source and a `verified` flag on each country file.
- Every `Dated` list sorted and closed with an `until`.
- `mileage.deduction()` is `null` for non-automobiles and outside its dates; `periodStart(d) <= d`.
- Platform slugs exist in the shared list.
- `tax.estimate()` lines add up to `totalSetAsideCents`.
- The no-country-literal lint rule.

A new country fails CI until it meets the contract.

### 3.9 Screens get the list from `GET /countries`

- Public, read-only (first-run setup needs it before an owner exists). It returns the tree: code,
  name, currency, unit, labels, regions and cities with names, and what each supports (`mileage`,
  `tax`, `verified`).
- It keeps rule code out of the web bundle and removes `DEFAULT_COUNTRIES` and the `Setup.tsx` list.
  Settings shows names and a region drop-down.
- The phone keeps computing its summary deduction from the shared package (it is bundled), so phone
  and server use the same registry.

### 3.10 The driver's place

- Keep `settings.country` and `settings.region` as they are (phones read them; API stays
  compatible).
- Add `settings.city` (nullable), a new core migration and API field, always `null` until a country
  registers a city. It must be a child of the region; a new region clears it (as `settings.ts:185`
  already does for region vs country). See Q2.

### 3.11 Onboarding follows the tree

The web wizard asks country → region only if that country has regions → city only if that region
has cities. Platforms, the vehicle step's "this vehicle gets the mileage rate" note and the
currency/unit defaults come from the resolved place. The wizard is a separate plan built on this.

## 4. What gets filled now

Only what exists today, with the **same numbers and the same `verified: false` flags**:

- CA: profile, mileage 2024–2026, CPP, GST 5 %, T4A, deadlines, slip season. ON, NB, NL, NS, PE: HST
  replaces GST (today's `salesTaxBp`). QC: `pension: null` with today's note. Names for all 13
  provinces and territories.
- US: profile, mileage eras, state names. No tax.
- GB: profile, mileage tiers, nation names. No tax.
- Platforms: today's lists, moved onto each country.
- `IncomeModel` and `expenseOverrides`: empty.

The current tests (`countries.test.ts`, `tax.test.ts`, `summary.test.tsx`) keep their expected
numbers. They prove the move changed nothing.

## 5. Order of work (each step its own PR, on its own branch)

Owner's rule for every step: **before building, check what the standard or industry practice is**
(section 2.4 is the start of that list) and record it in the PR. Build only the gap.

Branches are stacked on `pr-J0-country-plan`, which sits on the P1 phone stack (`main`'s lockfile fails `typecheck:web` on a clean install; P1 fixes it, so P1 merges first); each PR at most 400 changed lines (`17` §1), with
tests, `npm run verify` green and a `progress.md` entry. Pushed to `origin`; merging to `main` is
the owner's call.

**Track J, country structure (one stack, in order):**

| PR | Branch | Content |
|---|---|---|
| J0 | `pr-J0-country-plan` | This plan with the owner's decisions; pointer in `08` §16.3. |
| J1 | `pr-J1-countries-core` | `countries/` types, dated parameters (OpenFisca shape), slots, resolver, registry; CA, US, GB moved with identical numbers; `countryPacks` / `taxPacks` kept as thin aliases; first conformance tests. |
| J2 | `pr-J2-country-platforms` | Platform lists move onto each country; `routes/platforms.ts` reads the registry; the `countries` tags go. |
| J3 | `pr-J3-tax-lines` | Generic `TaxPack` / `TaxEstimate` (lines); CA strategy reads resolved place data (`pension`, `salesTax`); OpenAPI, generated types and the web tax view in one change. |
| J4 | `pr-J4-country-consumers` | Remaining consumers move to the registry (presenter, phone summary, notifications, settings check, Odometer note via `logbook`); aliases and `DEFAULT_COUNTRIES` deleted; `tax_countries` becomes a hide-only switch (Q3). |
| J5 | `pr-J5-countries-api` | `GET /countries`; web Setup and Settings use names and a region drop-down; prompt to set the region when the country has regional rules (Q4). |
| J6 | `pr-J6-country-contract-rules` | No-country-literal lint rule, full conformance suite, `countries/README.md` for contributors. |
| J7 | `pr-J7-country-dimensions` | Work kinds, worker statuses, income model, expense overrides in the contract (Q8), filled only for today's use. |
| J8 | `pr-J8-custom-mileage-rate` | Driver's own rate for a country without a pack (Q5). |

**Track L, earnings as entries (Q7a), stacked on J0:** split into PRs by the builder (database and
migration of today's rows; API; web; import), each within the size rule.

**Track V, vehicle ownership (Q7b), stacked on J0:** ownership field, API, web form, rent and
financing expense categories.

Later, not started: onboarding wizard (separate plan), then a new country as the first real test of
the structure.
## 6. Agreed by both planning notes

- One folder per country, one registration line, no other edits.
- The country owns its platform list; shared `platforms.ts` keeps labels and vocabulary.
- Tax becomes a per-country strategy with generic output lines.
- Conformance tests and a lint rule enforce the contract.
- No new countries now; no figure or `verified` flag changes; the shared package is the single
  source for server and phone.

## 7. Owner decisions (2026-11-07)

| # | Question | Decision |
|---|---|---|
| Q1 | Approve the two-layer design | Not answered; the owner said to start the work, so it proceeds as written. |
| Q2 | City field in settings | **Later**, when the first city with its own rules is registered. The registry still models cities; only the settings field waits. |
| Q3 | `comma.tax_countries` | **Keep, only as an operator switch to hide tax rules nobody has checked.** A country's tax pack is the source of truth; the switch can only hide it. Default unchanged (CA). |
| Q4 | Region required? | **Optional.** Without it the national rules apply, and the screens prompt the driver to set it ("Set your province to include provincial rules"). |
| Q5 | Driver's own mileage rate where no pack exists | **Yes.** Shown as "your rate", never as an official one. |
| Q6 | Data file format | **Typed TypeScript files** in the OpenFisca shape; YAML only when outside contributors appear. |
| Q7 | Global foundations now | **(a) earnings as entries** and **(b) vehicle ownership**. Not now: three-wheeler, translation standard. |
| Q8 | Work kinds and worker statuses in the contract now | **Yes**, as closed lists; only `delivery` and `contractor` are used today. |

## 8. Watch-outs

- **Rounding:** CA mileage rounds twice today (`tiered()` to 1/100 cent, then `whole()` to a cent);
  US rounds once. A shared builder must reproduce today's results exactly, or the change is called
  out as a deliberate fix (values are computed at read time, so past shifts would show it).
- **Uncommitted work:** `packages/shared/src/tax.ts` has an uncommitted `slipSeason` change from the
  notifications work; it moves into the `filing` slot. The working tree also holds the phone
  redesign. Do this on its own branch from `main`.
- **API changes:** the tax report shape (step 4) and `GET /countries` (step 6) need OpenAPI updates
  and regenerated types in the same PR.
- **Deadlines on weekends and holidays:** tax offices usually move a deadline that falls on a
  weekend or public holiday to the next business day. date-holidays (country and region holidays,
  ISO 3166-2) is the existing source if the `filing` slot ever needs that; do not hand-write holiday
  lists.
- **Licences:** check the licence of any data copied from another project (PolicyEngine's engine is
  AGPL) and choose MileWage's own licence before community contributions start.
- **No compliance claims:** a rate is a published figure with its source, not advice (`17` R9). No
  facts about a country are written without checked sources.
