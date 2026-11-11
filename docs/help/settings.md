---
summary: Every section of the Settings page in plain words, in the order the page shows them, the account menu, and the phone app's own Settings.
group: using
order: 110
---

# Settings

## How the page works

Settings has one page per section, listed in three groups: Preferences, Work and tracking, and Data and account. On a narrow screen it is a "Section:" menu at the top.

Each section says how it saves. Profile and region, Units and format, Tracking and privacy and Help pages share one Save bar. It names the sections with unsaved changes; Save keeps them all, Discard drops them. Mileage rate, Alerts and Platforms save each change at once. Account and security has its own buttons.

Some sections appear only when their module runs on your server. They are marked below.

## Profile and region

- **Name**: shown in the account menu.
- **Country**: decides which mileage rates and tax rules apply. Canada, the United States and Great Britain have country packs.
- **Province or state**: optional. Without it only the national rules apply, and the page says so.

There is no tax section: the Tax page works from these answers.

"Run setup again" asks the first-run questions again. Your answers stay until you change them.

## Mileage rate

The rate your mileage deduction uses. The first line says which is in use today.

- **Country rate** or **Your rate**: your rates replace the country's from the day each starts. Shown when your country has rates in MileWage; without them your rate is used anyway.
- **Your mileage rates**: each with its amount, the day it starts and your note. The "..." menu edits or removes one. "From the start" is a rate you set before rates had days.
- **Add a rate**: the day it starts, the rate in your currency per km or per mile, and an optional note.

A deduction at your rate is always called your rate. See [Your mileage rate](mileage-rates-and-tax.md#your-mileage-rate).

## Units and format

- **Distance unit**: kilometres or miles.
- **Currency**: a three-letter code, such as CAD or GBP.
- **Week starts on**: Monday or Sunday. Dashboards and calendars count the week from it.
- **Time format**: 24-hour or 12-hour.
- **Time zone**: all dates and times are shown in it, and the nightly backup runs at 03:30 in it. A change applies to shifts started afterwards.

## Alerts

Shown when the notifications module runs. Under "Tell me about" are switches for goals, tax dates, backup problems, and the "Shifts not yet sent (on the phone)".

Alerts appear on the Notifications page, behind the bell at the top. The switch marked "on the phone" does not reach the phone yet. The phone app has its own reminder when shifts have been only on the phone for 3 days or more ("Shifts only on this phone"); to stop it, turn off its Reminders channel in the phone's notification settings for MileWage. Its home screen also says when shifts are on phone only.

## App on this device

Installs the web app so it opens in its own window, like an app. Browsers install only from an https address. If the page says it was opened at an http address, open MileWage at its Tailscale address and install it from there.

## Help pages

Help pages: show or hide the Help screen and its links. The switch "Show help pages" is on by default. Off, Help leaves the sidebar and the help links on screens go. Nothing else changes, and this section stays so you can turn it back on.

## Platforms

Shown when the platforms module runs. The apps you work for, each with an active switch. An inactive platform drops out of the pickers, and its past labels and earnings stay. "Add a platform" adds your own. The row menu adds, changes or removes a logo, and deletes a platform you added.

## Tracking and privacy

- **Detect stops and estimate active vs deadhead**: the stops switch. Shifts started afterwards follow it. Past shifts, stops and labels do not change. See [Active and deadhead miles](active-and-deadhead.md).
- **Keep raw GPS points (days)**: at least 7, 90 by default. After that, a finalized shift's points are replaced by a simplified map line. Its totals and trips stay.
- **Diagnostics level**: shown when the diagnostics module runs. Off, Basic (the default) or Verbose, which returns to Basic after 7 days. Diagnostics stay on your server and never carry coordinates.

A link leads to the Privacy page: what the phone and the server record, and who else sees something.

## Your data

"Import a CSV file" brings in expenses, shifts with a typed distance, or your drives from MileIQ. It shows a preview first, with the rows that are ready, already there or have problems. Nothing is written until you choose Import. It is shown when the import module runs.

### Drives from MileIQ

If you are moving from MileIQ, download your drive report from MileIQ as CSV (not PDF or Excel), choose "Drives from MileIQ (its CSV report)" and pick the file.

- Each drive becomes one shift with one trip, marked as imported. MileIQ recorded it, so it has no GPS track and no map here.
- **Business** drives count as business distance.
- **Personal** and commute drives, and MileIQ's medical, charity and moving drives, become personal trips. They count in your total distance, never in your deduction.
- **Unclassified** drives are imported as personal unless you choose "Leave out". Leave them out if you will classify them in MileIQ first: a drive imported once is never imported again, even when MileIQ's category changes.
- Parking and tolls of a business drive become expenses on that drive's shift. Those of other drives are not imported.
- MileIQ's value column is not imported. MileWage works out your deduction from your mileage rate.
- The start and end places are kept as text in the shift's notes. Nothing is looked up.
- Dates are read month first or day first as the file shows. When every date fits both, your country decides; the preview says which, and you can switch. Times are read in your time zone.
- A drive goes to your vehicle of the same name, or else to your default vehicle. The preview says which.

Importing the same file again adds nothing. The preview lists each problem with its line in the file.

Below are links to the Backups and Exports pages.

## Account and security

"Change password" needs your current password and a new one of at least 10 characters, typed twice. Other signed-in browsers are signed out; this one stays.

A link leads to the Devices page. See [Phones and devices](phones-and-devices.md).

## Server modules

A read-only list of what your server runs: each module marked On or Off, and the export formats it offers. It shows why a screen or section is missing. Modules are switched in the server's configuration when it starts, never here. See the [configuration guide](../../infra/docs/configuration.md).

## The account menu

The menu at the foot of the sidebar shows your name and holds:

- **Account**: opens Account and security.
- **Settings**: opens Profile and region.
- **Privacy**: the Privacy page.
- **Sign out**.

## On the phone

The phone app has its own Settings tab. Units, currency, time zone and time format are not set there: they come from your server, and the phone shows them under "Units and formats". Change them on the web.

- **Server**: the server this phone sends to, both its addresses, and Check, which tries the connection now. "Connect to a different server" disconnects this phone; shifts not yet sent stay on it and go only to the server they were recorded for, and it asks you to send them first.
- **Permissions**: the same screen as at first run, to fix location, notifications or battery.
- **Ask to start a shift when I seem to be driving**: off unless you turn it on. When it is on and no shift runs, MileWage watches for a drive and asks "You seem to be driving." with Start and Not now. Start begins a shift that counts from when the drive began. Not now quiets it for that drive and an hour. It needs location "Allow all the time", because it runs with no app on screen, and it shows a silent notification, "Watching for drives", while it is on. It uses a network position about once a minute and short GPS checks, so it costs some battery.
- **"Still on shift?" reminder**: during a shift, asks once when you have not moved for this long: 15, 30 (the default), 45, 60, 90 or 120 minutes, or Off. Keep going carries on; End shift ends it. It never ends a shift by itself.
- **Saving battery while stopped**: always on. After 2½ minutes without moving, MileWage checks your position once a minute instead of every 5 seconds, and records fully again as soon as you move.
- **Sending**: what is not yet on the server, and Send now.
- **Appearance**: Theme (Follow the phone, Light or Dark) and "Use wallpaper colours" (Android 12 or later) instead of MileWage yellow.
- **Help**: these pages, opened on your server in the browser.
- **Diagnostics**: the mileage maths check ("Passed. This phone calculates distances exactly like your server."), versions and states, and "Copy diagnostics summary" for a bug report. The summary never holds a location.
- **About**: the app's version and build, the mileage engine's version, the open-source licences and the source code.
