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
  "token" becomes "code" where a driver sees it), no em dashes in sentences (the lone dash that
  stands for a missing figure comes from the formatters).
- Settings names are quoted as the driver sees them: Settings > Time format.

## Words we use

| Say                | Not                                             |
| ------------------ | ----------------------------------------------- |
| shift              | session, trip log                               |
| trip, stop         | leg, segment                                    |
| sent to the server | synced, uploaded                                |
| on phone only      | pending, unsynced                               |
| paired             | registered, enrolled                            |
| recovery key       | encryption key, passphrase                      |
| your mileage rate  | custom rate, override                           |
| deduction          | write-off (except where the tax office says so) |

## Formats (use the helpers, never `toLocaleString()` alone)

Web: `apps/web/src/format.ts` and `apps/web/src/days.ts` (the driver's day). Android: the `:core`
module, package `app.milewage.core.format` (`apps/android/core/src/main/kotlin/app/milewage/core/format/`),
ported from the same rules (tests in `core/src/test/.../format/FormatTest.kt`). Never format in a composable or a
page by hand.

| What           | Web helper                                                                                              | Android (`app.milewage.core.format`)                           | Rule                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money          | `formatMoney(minor, currency)`, `moneyInput`, `parseMoney`                                              | `formatMoney`, `moneyInput`, `parseMoney`, `minorDigits`       | Stored as integer minor units of `settings.currency` (fields end in `_cents`). `minorDigits`: 0 for JPY, 2 for USD, 3 for KWD. Null shows "not available" (`NOT_AVAILABLE`), never 0. |
| Rates          | `formatRate`, `rateInput`, `parseRate`, `deductionWord`                                                 | (none yet)                                                     | Per-distance rates keep hundredths of a minor unit.                                                                                                                                   |
| Day            | `formatDay(iso, dateLocale(country))`, `parseDay`                                                       | `formatDay(day, country)`                                      | English in the driver's country's order: "Nov 7, 2026" (CA, US), "7 Nov 2026" (GB).                                                                                                   |
| Date and time  | `formatDateTime(ms, timeZone, …)`                                                                       | `dayOf(ms, timeZone)`, `zoneOf`                                | Always the instance time zone (`settings.timezone`), never the browser's or the phone's.                                                                                              |
| Clock time     | `formatTime(ms, tz, fmt)`, `formatClock(hhmm, fmt)`, `hourLabel`                                        | `formatClock(ms, timeZone, TimeFormat.H12/H24)`                | 12h or 24h from Settings > Time format, not the browser or phone language.                                                                                                            |
| Distance       | `formatDistance(m, unit)`, `toMetres`, `fromMetres`, `distanceInput`, `parseDistance`, `formatOdometer` | `formatDistance(m, DistanceUnit)`, `toMetres`, `parseDistance` | Whole metres to the driver's unit with one decimal; null is a dash (`DASH` on Android), never 0. Nothing else writes 1609.344.                                                        |
| Duration       | `formatDuration(startMs, endMs)`                                                                        | `formatDuration(startMs, endMs)`                               | Hours and minutes.                                                                                                                                                                    |
| Today          | `todayIn(timeZone)`, `dayOf(ms, timeZone)`                                                              | `dayOf(ms, timeZone)`                                          | The driver's day, for defaults and period navigation. Never `new Date().toISOString()` (the UTC day).                                                                                 |
| Weeks, periods | `addDays`, `weekOf`, `period`, `PERIODS`, `monthGrid`, `startOfDay`                                     | (none yet)                                                     | Day arithmetic on `YYYY-MM-DD` days; weeks start at `settings.week_start`.                                                                                                            |
| Totals caption | (server shows its own)                                                                                  | `totalsCaption(totalM, CalcSource)`                            | "Calculated on phone", "Confirmed by server", "Totals will appear once it is sent to the server".                                                                                     |

Dashboards count the week from `settings.week_start` (also the calendar's first weekday). Period
tabs are named plainly and briefly (Today, Week, Month, Year, 30 days), and the dashboard opens on
Week.

## Notifications (Android)

The tracker's wording is in `apps/android/tracking/src/main/res/values/strings.xml`. The running
shift's text is built in `:core` (`ShiftNotice` in `app.milewage.core.tracking`, shared with its
tests). The patterns:

- Channel names say what the driver will see in the phone's settings: "Shift in progress",
  "Watching for drives", "Shift reminders", "Recording problems". Each has a one-sentence
  description.
- The ongoing notification leads with the figure: title "12.3 km this shift", the text "Today
  20.1 km · 2 shifts" or the start time and vehicle ("Started 09:02 · Toyota Prius"). Metric
  labels are one short word ("Shift", "Time", "Today"; Android allows 10 characters).
- A prompt is a question with two plain buttons: "You seem to be driving." / "Start a shift? It
  counts from when the drive began." with **Start** and **Not now**. The nudge is "Still on shift?"
  / "You have not moved for 12 minutes." with **Keep going** and **End shift**. A nudge never ends a
  shift by itself.
- A problem states the fact, then the way forward: "Your shift is not recording." / "Open MileWage
  to keep recording it."
- Counts use `<plurals>`, never "minute(s)".

## Accessibility that is part of the style

- Every control has a real name; tests find things by role and name, so a missing name fails a test.
- Charts carry a table a screen reader always gets, and a visible toggle for it; the keyboard reads
  them slot by slot. A comparison says the direction in words ("less than by this point last
  week"), never by colour alone.
- Codes meant to be read aloud (a 6-digit link code) are read digit by digit.
- Focus rings are Material's: 3 px in `ring` (the scheme's secondary) on the web, the platform's own on Android. Never remove them.
- Dialogs trap focus and return it; a dialog showing a secret does not close on an outside click.
- Contrast: text 4.5:1 and meaningful marks 3:1, in light and dark (the scheme is held to it by
  `apps/web/test/m3-contrast.test.ts`). Android targets are at least 48 dp, and every icon-only
  button has a `contentDescription` (`stringResource`).
