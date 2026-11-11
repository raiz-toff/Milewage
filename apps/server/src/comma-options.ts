import { ConfigError } from './config';

/**
 * The owner's open questions of 18 section 16 were answered with the defaults written there. Each
 * answer is a value here, read from `config/settings.json` under `comma` or from the environment,
 * so flipping one never needs a code change (18 section 17).
 */
export interface CommaOptions {
  /** 18 section 16 item 3: a typed platform total `replace`s that platform's label sum, or is added (`sum`). */
  earningsOverride: 'replace' | 'sum';
  /**
   * 16 item 5, plan 21 Q3: countries whose tax estimate is shown. Only a country's own tax pack can
   * make an estimate exist; this switch can only hide one nobody has checked. Listing a country
   * without a pack (US, GB today) shows nothing.
   */
  taxCountries: readonly string[];
}

export const COMMA_DEFAULTS: CommaOptions = {
  earningsOverride: 'replace',
  taxCountries: ['CA'],
};

export function loadCommaOptions(
  settings: object,
  env: Readonly<Record<string, string | undefined>> = {},
): CommaOptions {
  const file = ((settings as { comma?: Record<string, unknown> }).comma ?? {}) as Record<
    string,
    unknown
  >;
  const override = env.MILEWAGE_EARNINGS_OVERRIDE || file.earnings_override;
  if (override !== undefined && override !== 'replace' && override !== 'sum') {
    throw new ConfigError('comma.earnings_override must be "replace" or "sum".');
  }
  const countries = env.MILEWAGE_TAX_COUNTRIES
    ? env.MILEWAGE_TAX_COUNTRIES.split(',').map((c) => c.trim().toUpperCase())
    : file.tax_countries;
  if (
    countries !== undefined &&
    !(Array.isArray(countries) && countries.every((c) => typeof c === 'string'))
  ) {
    throw new ConfigError('comma.tax_countries must be a list of country codes.');
  }
  return {
    earningsOverride:
      (override as CommaOptions['earningsOverride']) ?? COMMA_DEFAULTS.earningsOverride,
    taxCountries: ((countries as string[] | undefined) ?? [...COMMA_DEFAULTS.taxCountries]).map(
      (c) => c.toUpperCase(),
    ),
  };
}
