---
summary: Every section of the Settings page in plain words, in the order the page shows them, and the account menu.
group: using
order: 110
---

# Settings

## How the page works

Settings has one page per section, listed in three groups: Preferences, Work and tracking, and Data and account. On a narrow screen it is a "Section:" menu at the top.

Each section says how it saves. Profile and region, Units and format, Tracking and privacy and Help pages share one Save bar. It names the sections with unsaved changes; Save keeps them all, Discard drops them. Mileage rate, Alerts and Platforms save each change at once. Account and security and AI assistants have their own buttons.

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

Shown when the notifications module runs. Under "Tell me about" are switches for shift reminders, goals and progress, tax dates, streak, backup problems, and the "Shifts not yet sent (on the phone)".

Alerts appear on the Notifications page, behind the bell at the top. The two switches marked "on the phone" do nothing yet: the phone app sends no reminders of its own in this version. Its home screen still says when shifts are on phone only.

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

## AI assistants

Lets an AI assistant such as Claude read your records and add to them. "Connect by signing in" is the easy way: give your assistant the address shown there. It opens MileWage in your browser, you sign in, choose "Read only" or "Read and change" and press Allow. Nothing to copy. For an assistant that cannot sign in, "Make a token" makes a code for it instead, with an access and an expiry. That code is shown once, and the commands beside it never hold it: do not paste it into a chat or a ticket. If you lose it, choose "Replace token" in its row's menu: the old code stops working and a new one is shown once. The page lists every connected assistant and the changes assistants made, and you can revoke one at any time. A signed-in assistant that is not used for 90 days is disconnected. An assistant cannot delete anything or see your password, backups or GPS points. If an assistant only says "Failed to connect", press "Test connection" on this page, from the address the assistant uses: it says what is wrong, for example a proxy in front of MileWage that it does not trust. See [Connect an AI assistant](../../infra/docs/install.md#7-connect-an-ai-assistant-optional) in the install guide.

## Server modules

A read-only list of what your server runs: each module marked On or Off, and the export formats it offers. It shows why a screen or section is missing. Modules are switched in the server's configuration when it starts, never here. See the [configuration guide](../../infra/docs/configuration.md).

## The account menu

The menu at the foot of the sidebar shows your name and holds:

- **Account**: opens Account and security.
- **Settings**: opens Profile and region.
- **Privacy**: the Privacy page.
- **Sign out**.
