// Slot `logbook`: what the tax office asks of a driver's odometer records, shown on the web's
// Odometer screen. Nearest level wins. Absent: readings are optional and no note is shown.

export interface Logbook {
  /** First sentence of the note, e.g. who asks for readings at the start and end of the year. */
  readings: string;
  /** Further paragraphs under it. */
  notes: readonly string[];
}

export const logbookProblems = (l: Logbook): string[] =>
  l.readings.trim() ? [] : ['logbook: the readings sentence is required'];
