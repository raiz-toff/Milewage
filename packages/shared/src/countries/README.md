# Countries, regions and cities

This folder holds every rule that differs by place: mileage rates, tax estimates, sales tax,
pension, platforms and the odometer note. The server, the web (through `GET /countries`) and the
phone all read it. The design is in `plans/milewage/21-jurisdictions-plan.md`.

In short: **data flows down the tree (country → region → city), each country owns its own
calculation, and screens only show generic output.** No code outside this folder may check a
country or region code; a lint rule enforces it.

## The data shape

| File                | What it holds                                                                |
| ------------------- | ---------------------------------------------------------------------------- |
| `types.ts`          | `CountryModule` (the contract), `Place`, `Dated`, `ResolvedPlace`            |
| `dated.ts`          | Rates that change over time, in the OpenFisca shape                          |
| `slots/`            | One file per kind of regional data: its type, how levels combine, its checks |
| `resolve.ts`        | Combines the country's data with its region's and city's                     |
| `mileage.ts`        | Mileage deduction from dated rates                                           |
| `tax.ts`            | The tax pack contract: an estimate as generic lines                          |
| `index.ts`          | The only list of the countries that ship                                     |
| `ca/`, `us/`, `gb/` | One folder per country                                                       |

A **country** (`CountryModule`) has: an ISO 3166-1 code, an ISO 4217 currency, a unit (`km` or
`mi`), the word for its regions (`province`, `state`, `nation` …, from Google's address data),
its places, its national data, its mileage rates, an optional tax pack, its sources, `verified`
and notes. The country's name is never written here: it comes from `Intl.DisplayNames`.

A **place** is a region (ISO 3166-2, `CA-QC`) or a city (region + UN/LOCODE location part,
`US-NY-NYC`). It holds only the data that differs from the level above.

A **rate** is a `Dated` parameter: `values` keyed by the date each value starts, in date order,
ended by a final `null` so it is never carried into a period nobody announced. Each has a
`label`, a `unit` (`cents/km`, `bp` …) and a `reference` (the source URL).

```ts
const perKm: Dated<number> = {
  label: 'First 5,000 km',
  unit: 'cents/km',
  reference: ['https://…'],
  values: { '2025-01-01': 72, '2026-01-01': 73, '2027-01-01': null },
};
```

### Slots: how a region combines with its country

| Slot        | Combines by                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `salesTax`  | A level whose components are all `combinable` adds them to the parent's; otherwise it replaces them. `compound` charges on top. |
| `pension`   | Nearest level wins; `null` means "not estimated here".                                                                          |
| `platforms` | Each level adds apps; `available: false` takes one away. Slugs must be in `../platforms.ts`.                                    |
| `logbook`   | Nearest level wins.                                                                                                             |

A new kind of regional data is a new file in `slots/` plus one line in each table of
`slots/index.ts`. Existing places do not change.

### Dimensions: how gig work differs

`dimensions.ts` holds closed lists: work kinds, worker statuses, income-tax regimes, mileage
methods, payers and the OECD platform statement fields. A country lists the values that apply
(`work`, `statuses`, `mileage.methods`, `tax.regimes`); leave out what you have not checked.
The `filing` slot holds the sales-tax registration rule and the platform statement.

## Add a country

1. Create a folder named after the code in lower case, for example `de/index.ts`, exporting a
   `CountryModule`. Copy the shape of `gb/index.ts` (the smallest).
2. List its regions with `regionsOf('DE', { BY: 'Bavaria', … })`. Region codes must be ISO
   3166-2 codes.
3. Add one line to `index.ts`: import it and add it to `createCountryModules([...])`.
4. Run the tests (below). The conformance suite fails until the contract is met.

Leave out what you have not checked: no tax pack means "no tax estimate for this country"; no
rate for a vehicle class means no deduction. Never copy another country's number.

## Add a region or a city

- A region is one entry in the country's `regionsOf(...)` call. To give it its own data, add it
  in the third argument: `{ ON: { data: { salesTax: [...] }, sources: [...], notes: [...] } }`.
- A city is a `Place` whose `parent` is its region, with a code made of the region code and the
  UN/LOCODE location part: `US-NY-NYC`. Add it to the country's `places`.

## Sources and `verified`

- Every country lists `sources` (government pages) and every rate a `reference`.
- `verified` stays `false` until a person has compared every figure with the primary page.
  Do not set it to `true` in the same change that adds the figures.
- Write what is uncertain in `notes`. A figure is a published number with its source, never
  advice or a claim that the result is correct for a driver.
- Licences: only copy data whose licence allows it, and name the licence in the change.

## Run the tests

```sh
npx vitest run packages/shared/test/country-*.test.ts
npm run lint
```

- `country-conformance.test.ts` checks every registered country: codes and names, currency,
  places and their ISO 3166-2 codes, slot data, dated rates, mileage and the tax pack.
- `country-lint-rule.test.ts` checks the rule that keeps country codes out of other code.
- The ISO 3166-2 list is `packages/shared/test/fixtures/iso-3166-2.json`, made from Unicode
  CLDR (Unicode-3.0 licence, tests only). Refresh it with `node scripts/iso-subdivisions.mjs`.
