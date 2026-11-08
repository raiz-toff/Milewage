# Voice and formats

## Who reads it

A delivery or ride-hail driver, often on a phone, often tired, in any of several countries. They
want to know what happened to their miles and money and what to do next. Nothing else.

## How MileWage speaks

- Short sentences, one idea each. Plain words. "Shifts not yet sent stay on this phone." Not
  "Unsynced shift data will be retained locally."
- Say what the thing is and what to do, in that order. An empty list: "No shifts this week. Start one
  on your phone." An error: "The password is wrong." A warning: "Location is switched off on this
  phone. Turn it on or no miles are recorded."
- Name the real cause. When the Location switch is off, say the switch, not the permission.
- Every problem message carries one way forward: a button ("Fix permissions", "Try again", "View
  shift") or a sentence saying where to go. Never a dead end.
- Confirm before anything hard to undo, with the consequence spelled out: "Backups made before
  today will still need the old key."
- Numbers come with their unit and their basis: "gross · 41 h", "per hour (shift time)". An
  estimate is called an estimate; a rate nobody has checked says so ("not yet checked against the
  official publications").
- A deduction at the driver's own rate is always "your" rate, never "official" (`deductionWord`).
- Title case only for the product name and screens' proper names; everything else sentence case
  ("Show as a table", "Make a new recovery key").
- No exclamation marks, no "please", no "oops", no jargon ("sync" becomes "sent to the server",
  "token" becomes "code" where a driver sees it), no em dashes.
- Settings names are quoted as the driver sees them: Settings > Time format.

## Words we use

| Say                    | Not                         |
| ---------------------- | --------------------------- |
| shift                  | session, trip log           |
| trip, stop             | leg, segment                |
| sent to the server     | synced, uploaded            |
| on phone only          | pending, unsynced           |
| paired                 | registered, enrolled        |
| recovery key           | encryption key, passphrase  |
| your mileage rate      | custom rate, override       |
| deduction              | write-off (except where the tax office says so) |

## Formats (use the helpers, never `toLocaleString()` alone)

All in `apps/web/src/format.ts` and `apps/web/src/dateText.ts`; the phone has its own mirrors.

| What        | Helper                               | Rule                                                                             |
| ----------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Money       | `formatMoney(minor, currency)`       | Stored as integer minor units of `settings.currency` (fields end in `_cents`). `minorDigits` gives 0 for JPY, 2 for USD, 3 for KWD. `moneyInput` and `parseMoney` for fields. Null shows as "not available", never 0. |
| Rates       | `rateInput`, `parseRate`             | Per-distance rates keep hundredths of a minor unit.                             |
| Day         | `formatDay(iso, dateLocale(country))`| English in the driver's country's order: "Nov 7, 2026" (CA, US), "7 Nov 2026" (GB). `parseDay` accepts typed days in that order. |
| Date and time | `formatDateTime(ms, timeZone, …)`  | Always the instance time zone (`settings.timezone`), never the browser's.        |
| Clock time  | `formatTime`, `formatClock`, `hourLabel` | 12h or 24h from Settings > Time format, not the browser language.            |
| Distance    | `formatDistance(m, unit)`            | Metres to the driver's unit with one decimal; null is a dash, never 0.          |
| Duration    | `formatDuration(startMs, endMs)`     | Hours and minutes.                                                               |
| Today       | `todayIn(timeZone)`                  | For defaults and period navigation.                                              |

Dashboards count the week from `settings.week_start` (the calendar's first weekday too). Period tabs are
named plainly and briefly: Today, Week, Month, Year, 30 days; the dashboard opens on Week.

## Accessibility that is part of the style

- Every control has a real name; tests find things by role and name, so a missing name fails a test.
- Charts carry a table a screen reader always gets, and a visible toggle for it.
- Codes meant to be read aloud (a 6-digit link code) are read digit by digit.
- Focus rings use `ring` (lane yellow); do not remove them.
- Dialogs trap focus and return it; a dialog showing a secret does not close on an outside click.
- Contrast: text 4.5:1, meaningful marks 3:1, checked in both web themes.
