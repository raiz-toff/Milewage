/** Date and time in the instance time zone (settings.timezone), never the browser's. */
export function formatDateTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(ms));
}

export function formatTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(ms));
}
