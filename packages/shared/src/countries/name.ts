// A country's name from Unicode CLDR through `Intl.DisplayNames`, never hand-written. Without
// `Intl.DisplayNames` (Hermes on the phone may lack it) the ISO code is shown instead.
export function countryName(code: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
