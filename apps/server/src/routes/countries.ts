import type { FastifyInstance } from 'fastify';
import { countryModules, countryName, resolvePlace, type CountryModule } from '@milewage/shared';

/** One region (or city) as screens list it. `code` is what `settings.region` stores (`ON`). */
function placeOf(c: CountryModule, code: string, parent: string): object {
  const p = c.places.find((x) => x.code === code)!;
  return {
    code: parent === c.code ? code.slice(c.code.length + 1) : code,
    name: p.name,
    own_rules: p.data !== undefined,
    verified: resolvePlace(c, code).verified,
    cities: c.places.filter((x) => x.parent === code).map((x) => placeOf(c, x.code, code)),
  };
}

/**
 * The countries a driver may choose, as a tree (plan 21 section 3.9). Names come from CLDR
 * (`Intl.DisplayNames`); what a country supports follows the operator's settings: `countries`
 * limits the list, `taxShown` (`comma.tax_countries`) can only hide a tax estimate.
 */
export function countryTree(countries: readonly string[], taxShown: readonly string[]) {
  return countries.flatMap((code) => {
    const c = countryModules.get(code);
    if (!c) return [];
    const regions = c.places.filter((p) => p.parent === c.code);
    return [
      {
        code: c.code,
        name: countryName(c.code),
        currency: c.currency,
        unit: c.unit,
        labels: { region: c.labels.region ?? null, city: c.labels.city ?? null },
        supports: {
          mileage: Object.keys(c.mileage.rates).length > 0,
          tax: c.tax !== undefined && taxShown.includes(c.code),
        },
        verified: c.verified,
        regional_rules: c.places.some((p) => p.data !== undefined),
        regions: regions.map((p) => placeOf(c, p.code, c.code)),
      },
    ];
  });
}

/** Public and read-only: first-run setup lists countries before an owner exists. */
export function countriesRoute(
  app: FastifyInstance,
  ctx: { countries: readonly string[]; taxShown: readonly string[] },
) {
  const tree = countryTree(ctx.countries, ctx.taxShown);
  app.get('/countries', async () => tree);
}
