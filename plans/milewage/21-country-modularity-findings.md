# 21. Country and platform modularity: findings and proposal

**Status:** findings and proposal only. No code was changed. Written 2026-11-07 for the agent planning the country structure, so the two efforts become one plan.

**Goal (from the owner):** the base structure is strong enough that adding a country (different platforms, different money flow, different tax) means adding a folder and one registration line, never reworking existing code. Do not build every country now. Build the seam.

## 1. What is already modular

| Piece | Where | Notes |
|---|---|---|
| Mileage deduction | `packages/shared/src/countries.ts` | `CountryPack` per country (CA, US, GB) with `unit`, `regions`, `periodStart`, `deduction()`, `sources`, `verified`, `notes`. `countryPacks.register(pack)` adds one with no other edits. Deduction is computed at read time, never stored (07 section 3). |
| Tax estimate | `packages/shared/src/tax.ts` | `TaxPack` and `taxPacks` registry. Only CA ships. Every figure carries a year, sources and `verified`. |
| Server modules | `packages/shared/src/module.ts`, `registry.ts`, `matrix.ts` | `defineModule`, `buildRegistry`, topological order, toggles, module matrix tests. This is the template for the country contract. |
| Track engine | `packages/track-engine/src` | No country logic. Keep it that way. |

## 2. Where it leaks

Country-specific data is spread over several places, so a new country is a multi-file edit.

| Country-specific thing | Where it lives now |
|---|---|
| Mileage rates, unit, regions | `countryPacks` (`countries.ts`) |
| Tax | `taxPacks` (`tax.ts`), a second registry, switched on by `comma.tax_countries` in the server config |
| Platforms per country | `BUILTIN_PLATFORMS[].countries` (`platforms.ts`), a flat list tagged with country codes |
| Expense categories | `EXPENSE_CATEGORIES` (`expense-categories.ts`), global, no country override (18 section 5.1 says a pack may relabel or add, but no hook exists) |
| Currency, unit, country picker | Hardcoded list in `apps/web/src/pages/Setup.tsx` (lines 11 to 13) |

Consumers that read these separately:

- Server: `routes/settings.ts` (validates region via `countryPacks`), `routes/platforms.ts` (filters `BUILTIN_PLATFORMS` by country), `processing/presenter.ts` (`countryPacks`), `tax-report.ts` and `notifications.ts` (`taxPacks` plus `taxCountries`).
- Phone: `store/summary.ts` (`countryPacks`).
- Web: Setup picker, plus `distance_unit` and `currency` read from settings.

Result: adding a country touches `countries.ts`, `tax.ts`, `platforms.ts`, `Setup.tsx`, and the server tax config.

### 2.1 The tax pack is shaped like Canada

`TaxPack` hard-codes `cpp`, `CppYear` (`ympeCents`, `yampeCents`, `selfBp`, `self2Bp`), `ownPensionPlan` (Quebec), `slipName: 'T4A'`, and `TaxEstimate` has `cpp_cents` and `cpp2_cents`. A US pack needs self-employment tax and Schedule C. A GB pack needs National Insurance. Forcing them into CPP fields would be wrong, so the interface needs to be generic before a second country is added.

## 3. Proposal

### 3.1 One `CountryModule` per country, one folder per country

```
packages/shared/src/countries/
  types.ts      CountryModule interface (the contract)
  registry.ts   register / get / list
  ca/index.ts   mileage + tax + platforms + currency + expense overrides
  us/index.ts
  gb/index.ts
  index.ts      the only file that lists which countries ship
```

```ts
interface CountryModule {
  code: string;                       // ISO 3166-1 alpha-2
  name: string;
  currency: string;
  unit: 'km' | 'mi';
  regions: readonly string[];
  mileage: MileagePack;               // today's CountryPack.deduction and periodStart
  tax?: TaxPack;                      // absent: "no tax estimate for this country"
  platforms: readonly PlatformDef[];  // the country owns its list
  expenseOverrides?: ExpenseOverrides;
  income?: IncomeModel;               // section 3.3
  sources: readonly string[];
  verified: boolean;
  notes: readonly string[];
}
```

- Adding a country: copy a folder, add one line to `countries/index.ts`.
- Web Setup picker, server `routes/settings.ts`, `routes/platforms.ts` and phone summary all read the registry. The hardcoded Setup list and the `countries: [...]` tags on platforms go away.
- Keep `platforms.ts` for what is the same everywhere (slug, label, vocabulary such as "block" for Amazon Flex). The country lists which slugs it offers. DoorDash existing in CA and US is a fact about the country's list, not about DoorDash.
- Keep the policy: unverified means no number (11 section 4). `deduction()` returns `null` outside the supported dates and vehicles, never a guess.

### 3.2 Make the tax pack a strategy

```ts
interface TaxPack {
  verified: boolean; sources: readonly string[]; notes: readonly string[];
  estimate(input: TaxInput): TaxEstimate;
  deadlines(year: number): Deadline[];
  informationSlip?: { name: string; thresholdCents: number; season(year: number): { from: string; by: string } };
}
interface TaxEstimate {
  lines: { key: string; label: string; cents: number | null; note?: string }[];
  totalSetAsideCents: number;
  instalmentCents: number;
  salesTax?: { collectedCents: number; creditsCents: number; owingCents: number; rateBp: number };
}
```

CA keeps its CPP logic inside `countries/ca/tax.ts` and returns CPP lines. A US or GB pack returns its own lines. The UI renders `lines` and never names a country-specific field. This changes the API shape of the tax report (18 section 7), so it needs the OpenAPI schema and generated types updated in the same change.

### 3.3 Money flow (the Toronto versus Nepal difference)

The owner's example: a driver on DoorDash or Uber in Toronto works differently from one in Nepal in how a transaction happens and how money flows. Keep this to a small data object the existing screens can read, and leave most fields empty until a real second market needs them:

```ts
interface IncomeModel {
  payers: readonly ('platform' | 'cash' | 'wallet')[];  // wallet: e.g. mobile wallets
  tipsCommon: boolean;
  payoutsTaxInclusive: boolean | null;   // sales tax or VAT inside the payout; null = unknown
  payoutRhythm: readonly ('instant' | 'weekly' | 'monthly' | 'none')[];
  platformIssuesSlip: boolean;
}
```

- Do not build a workflow engine. Nothing in the plans needs one.
- Do not invent facts about Nepal or any other country. A country's `income` is filled only from checked sources, with the same `verified` flag as the rest.
- Add the field to the contract now so adding data later is not a breaking change.

### 3.4 Conformance tests for the contract

One suite loops over every registered country, in the same spirit as `moduleMatrix`:

- Has at least one source, a `verified` flag, a non-empty `regions` list when regions apply, a currency and a unit.
- `mileage.deduction()` returns `null` for non-automobile vehicles and for dates outside its range.
- `periodStart(date)` is on or before `date`.
- Platform slugs are in the shared registry or valid custom slugs.
- `tax.estimate()` returns lines whose sum equals `totalSetAsideCents`.
- A lint or test rule: no country code string literal outside `packages/shared/src/countries/` and tests, like the existing track-engine lint rule.

A new country then fails CI until it meets the contract.

## 4. Migration order (smallest steps first)

1. Add `countries/types.ts` and `countries/registry.ts`. Move CA, US and GB `CountryPack` objects into `ca/`, `us/` and `gb/` with the same behaviour. Keep `countryPacks` exported as a thin alias for one release so consumers do not all change at once. Golden tests must stay green.
2. Move platform lists into each country module. Update `routes/platforms.ts` to read from the registry. Remove the `countries` tag array from `BUILTIN_PLATFORMS`.
3. Replace the hardcoded list in `Setup.tsx` with a registry read (the registry needs to reach the web app, for example via a `GET /countries` endpoint or the shared package, whichever the API plan prefers).
4. Generalise `TaxPack` and `TaxEstimate` (section 3.2). Update OpenAPI and regenerate `packages/shared/generated`. Replace `comma.tax_countries` with "a country has a `tax` pack".
5. Add the conformance suite and the no-hardcoded-country lint rule.
6. Add `IncomeModel` to the contract (empty for CA, US, GB).
7. Only then add a new country as the first real test of the seam.

## 5. Decisions needed from the owner

1. **Platform ownership.** Recommended: the country owns its platform list, shared `platforms.ts` keeps only labels and vocabulary.
2. **Scope now.** Recommended: ship CA, US and GB through the new contract and do not add Nepal yet. The second country's real requirements should drive `IncomeModel`.
3. **`comma.tax_countries` setting.** Recommended: remove it. A tax pack either exists for a country or it does not. If the owner wants an operator switch to hide an unverified pack, keep it, but as an override, not the source of truth.
4. **How the web app gets the country list.** Shared package import versus a `GET /countries` endpoint. The endpoint keeps the web bundle independent of country code, but adds an API surface to 08.

## 6. Risks

- The tax pack change is an API change (OpenAPI, generated types, web and phone consumers). It should be one atomic change.
- The phone computes the summary deduction locally from the shared pack, so the phone and server must register the same countries. The shared package is the single source, which supports putting the contract there.
- The CA, US and GB figures are all `verified: false`. This refactor must not change any number or flip any flag.
- Moving files will touch many imports. Do step 1 as a pure move with no behaviour change, and run the golden and conformance tests before going further.
- The working tree already has many uncommitted changes (phone redesign). Land this on its own branch to keep the diff reviewable.
