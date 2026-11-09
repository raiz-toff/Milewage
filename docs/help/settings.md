---
summary: Every section of the Settings page in plain words, in the order the page shows them, and the account menu.
group: using
order: 110
---

# Settings

## How the page works

Settings has one page per section, listed in three groups: Preferences, Work and tracking, and Data and account. On a narrow screen it is a "Section:" menu at the top.

Each section says how it saves. Profile and region, Units and format, Tracking and privacy and Help pages share one Save bar. It names the sections with unsaved changes; Save keeps them all, Discard drops them. Alerts and Platforms save each change at once. Account and security and AI assistants have their own buttons.

Some sections appear only when their module runs on your server. They are marked below.

## Profile and region

- **Name**: shown in the account menu.
- **Country**: decides which mileage rates and tax rules apply. Canada, the United States and Great Britain have country packs.
- **Province or state**: optional. Without it only the national rules apply, and the page says so.
- **Your mileage rate**: shown only for a country without a published rate. Deductions then use your rate and are always called your rate.

There is no tax section: the Tax page works from these answers.

"Run setup again" asks the first-run questions again. Your answers stay until you change them.

## Units and format

- **Distance unit**: kilometres or miles.
- **Currency**: a three-letter code, such as CAD or GBP.
- **Week starts on**: Monday or Sunday. Dashboards and calendars count the week from it.
- **Time format**: 24-hour or 12-hour.
- **Time zone**: all dates and times are shown in it, and the nightly backup runs at 03:30 in it. A change applies to shifts started afterwards.

## Alerts

Shown when the notifications module runs. Under "Tell me about" are switches for shift reminders, goals and progress, tax dates, streak, backup problems, and the "Unsynced data reminder (on the phone)".

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

"Import a CSV file" brings in expenses, or shifts with a typed distance. It shows a preview first, with the rows that are ready, already there or have problems. Nothing is written until you choose Import. It is shown when the import module runs.

Below are links to the Backups and Exports pages.

## Account and security

"Change password" needs your current password and a new one of at least 10 characters, typed twice. Other signed-in browsers are signed out; this one stays.

A link leads to the Devices page. See [Phones and devices](phones-and-devices.md).

## AI assistants

Shown only when the assistant module is switched on in the server's configuration. It is off by default. "Make a token" makes a code for one assistant, with "Read only" or "Read and change" access and an expiry. The code is shown once. The page lists your codes and the changes assistants made, and you can revoke a code at any time. An assistant cannot delete anything or see your password, backups or GPS points. See [Connect an AI assistant](../../infra/docs/install.md#7-connect-an-ai-assistant-optional) in the install guide.

## Server modules

A read-only list of what your server runs: each module marked On or Off, and the export formats it offers. It shows why a screen or section is missing. Modules are switched in the server's configuration when it starts, never here. See the [configuration guide](../../infra/docs/configuration.md).

## The account menu

The menu at the foot of the sidebar shows your name and holds:

- **Account**: opens Account and security.
- **Settings**: opens Profile and region.
- **Privacy**: the Privacy page.
- **Sign out**.
