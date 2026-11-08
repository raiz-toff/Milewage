import type { CountryModule } from './types';

export interface CountryModules {
  register(country: CountryModule): void;
  get(code: string): CountryModule | undefined;
  codes(): string[];
  list(): CountryModule[];
}

/** Countries by ISO code. Adding a country is one `register` call; nothing else changes. */
export function createCountryModules(countries: readonly CountryModule[] = []): CountryModules {
  const byCode = new Map<string, CountryModule>();
  const register = (c: CountryModule) => void byCode.set(c.code.toUpperCase(), c);
  countries.forEach(register);
  return {
    register,
    get: (code) => byCode.get(code.toUpperCase()),
    codes: () => [...byCode.keys()],
    list: () => [...byCode.values()],
  };
}
