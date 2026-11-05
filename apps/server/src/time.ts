/** The calendar date (`YYYY-MM-DD`) of an instant in an IANA time zone. Dates are never derived any other way (07 section 1). */
export const localDate = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
