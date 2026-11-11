# Changelog

All notable changes to MileWage are listed here. The format follows
[Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

A new phone app and a new look. The phone app is now a native Android app (Kotlin, Jetpack
Compose, Material 3) that needs nothing from Google; the Expo app is gone. The web app and the
phone follow Google's Material Design 3 from one colour scheme (ADRs 0009 to 0011). Also: your own
dated mileage rate, a PDF report for the accountant, parking and tolls on a shift, named places,
editing a trip you added on the web, MileIQ import, and a reverse proxy of your own in front of
MileWage (GitHub issue #6).

**After upgrading: the phone app.** The new Android app installs over the old one but starts
empty: nothing is carried over. Before installing it, open the old app on a connection to your
server, let it send every shift (its banner says when everything is on the server) and end any
running shift; anything the old app has not sent is lost with the update. Then install the new
app, pair it again (QR code, or the link code on your home Wi-Fi), and revoke the old entry on the
Devices page. It needs Android 8.0 or later: Android 7 is no longer supported.

**After upgrading: the engine.** The track engine is now version 4 (ADR 0006). Install the phone
app built from this release too, so the phone and the server count the same way; until then a
shift whose totals differ is marked as differing because of the engine version. Stored shifts keep
their figures. Run `milewage-cli recalc --dry-run` once to see which shifts the new rule would
change (only shifts with GPS accuracy worse than 20 metres can). To apply it to one of them, use
`POST /api/v1/shifts/<id>/recalculate`; a finalized shift is never changed.

**After upgrading: your rate.** A mileage rate of your own set before this release becomes a rate
"from the start" in Settings > Mileage rate. The switch to use it is off, so nothing changes until
you choose Your rate there; in a country without rates in MileWage it is used as before.

### Not yet verified

- The new Android app has never run on a real phone. Everything below was tested on a computer
  only (unit tests, the screens drawn by Robolectric, light and dark).
- The engine's maths on a phone's processor (ART on arm64) and on an arm64 server (a Raspberry
  Pi): checked bit for bit against Node on x86-64 only (2,000 and 5,000 random shifts, 900,195 maths
  calls, 250,000 distance pairs, 0 differences). The phone's Settings > Diagnostics > Mileage maths
  check runs the conformance set on the phone itself.
- GPS waking up after a stop (the motion sensor and the one-minute watch), recording through a
  tunnel, after the app is killed, after a force stop and after a reboot.
- Battery over a long shift, and over a day with the drive prompt on.
- Phone makers' battery savers that stop background apps (Samsung, Xiaomi, Huawei and others).
- The drive prompt's thresholds for a car, a bicycle or scooter, walking and a bus.
- The QR scanner (CameraX and ZXing) on real cameras, and finding the server on the Wi-Fi (NSD) on
  real routers; a phone without Google services.
- The MileIQ file layout: read from a third-party reader and template, not from a real MileIQ
  export.
- The tax treatment of parking and tolls (deducted in full, beside the mileage rate), and every
  mileage rate and tax figure, against the tax offices' own pages.
- The PDF report in a real viewer and printer.
- No real shift over a real Tailscale network, as before.

### Added

- Charts on the dashboard and in Analytics. The dashboard compares the period's earnings with the
  period before up to the same point, in words and with an arrow; draws the period day by day (month
  by month for Year, today against the six days before) as earned, distance or time; and says where
  the money came from by platform, or where the miles went. Analytics draws earnings by platform
  (or pay and tips), the pace against the period before, pay per hour and per mile for each day
  worked, the distance by kind with the estimate marked, when it pays (pay per hour by weekday and
  time of day), money in and out (what was paid, by category, with the deductible part named) and the
  deduction's value, and the
  platforms and vehicles side by side. Every chart has a table ("Show as a table") and is read with
  the keyboard. The shift start times chart and the trends table are replaced by these.

- `GET /summary/series` (per day or month, every slot of a range included, with each platform's
  earnings) and `GET /analytics/breakdown` (by weekday and clock hour, per vehicle, per platform,
  per expense category: what was paid and its deductible part). `GET /analytics` takes
  `group=all` for every group in one answer. Read-only.

- Fixed: the previous period's earnings in `GET /analytics` (group `trends`) left out fees and
  adjustments.

- Shifts: the dates above the week's figure open a calendar, and a day picked there opens its week
  with that day chosen. The list's rows follow the Comma phone app's: platforms, day and times,
  time and distance, then what the shift earned, its tips and its deduction.

- Changed: instalments on the Tax page are the driver's own choice ("I pay tax by instalments",
  kept for each tax year, off unless set). The instalment dates, the next-date chip and the
  quarterly amount show only when it is on; `PUT /tax/{year}` takes `pays_instalments`, and the
  report carries it with `instalments_note` from the country data.

- Changed: Analytics' burn ratio and net take-home count what was paid for expenses, in full, no
  longer only the deductible part. A "Spent" tile shows it beside "Deductible expenses"; the
  `cards` group carries it as `spent_cents`.

- The native Android app (`apps/android`): first run with pairing (the server found on the home
  Wi-Fi with a 6-digit link code, the QR scanner, a pasted code or address, Tailscale), one
  permissions screen, Home with the summary, the sending banner, the setup checklist and Start
  shift, the running shift with time, distance and the deduction so far, Shifts by week, a shift's
  detail with the route sketch, trips (change a trip's kind and purpose, add a trip), stops,
  odometer and notes, Settings, and Diagnostics with the mileage maths check. It runs on phones
  without Google services: no Google Play Services, Firebase or ML Kit, and the build fails if one
  appears.
- Tracking on the phone's own location service: a GPS position every 5 seconds while moving, every
  one stored; after 2½ minutes still it checks once a minute and wakes on the motion sensor;
  recording resumes by itself after the app is closed, updated or the phone restarts. Network
  positions (Wi-Fi, mobile masts) are never stored or counted.
- Settings > "Ask to start a shift when I seem to be driving" on the phone, off by default: with
  "Allow all the time" location it watches for a drive (a silent "Watching for drives"
  notification) and asks "You seem to be driving. Start a shift?". Start counts from when the
  drive began; Not now quiets it for that drive and an hour. It never starts a shift by itself.
- The "Still on shift?" reminder on the phone after a stop of 30 minutes (15 to 120 minutes, or
  off, in Settings), with Keep going and End shift. It never ends a shift by itself.
- The phone asks for an odometer reading at the start of a shift when a check is due ("Save and
  start" or "Start without it"), and for the end reading after it.
- The phone's own reminder, "Shifts only on this phone", after 3 days, with no push service.
- Platforms: a badge colour picker, with the colours drawn as Material tones (PL4b).
- Places: save the places you stop at often, with a name, a centre, a radius (100 m unless you
  change it, 25 to 1000 m) and the label for stops there (pickup, dropoff or other). A stop inside
  a place shows its name and takes its label unless you labelled it yourself; the nearest centre
  wins where places overlap. Save one from a stop ("Save as a place" under Label stops), by
  clicking the map on the new Places page, or by typing its coordinates; nothing is looked up
  anywhere. Adding, changing or deleting a place works out again every ended shift with a stop in
  it; finalized shifts keep their figures. The engine is unchanged: places become stop labels on
  the server before it runs (ADR 0008). Total miles never change, and the phone's result still
  matches. Places stay out of diagnostics and logs; the GeoJSON export names each stop's place. API: `GET`/`POST /places`, `PATCH`/`DELETE /places/{id}`, `place` on
  each stop. Stops migration 0002.
- Shift page: a trip added by hand has a "..." menu with Edit and Delete (TODO W2i). Delete asks
  first. Both changes reach the phone through the change feed, as before.
- Settings > Your data > Import: "Drives from MileIQ (its CSV report)". Each drive becomes an
  imported shift with one trip: business drives as business distance, personal, commute and
  MileIQ's other categories as personal trips, unclassified drives as personal or left out (your
  choice in the preview); parking and tolls of business drives become expenses on the shift.
  MileIQ's value column is not imported. The preview shows the counts by category, how dates and
  vehicles were read, the costs, the first drives and every problem with its line in the file;
  importing the same file again adds nothing. API: `POST /imports/mileiq/preview`,
  `POST /imports/mileiq`.
- Settings > Mileage rate: your own mileage rate may replace the country's, for example an
  employer's or your accountant's rate. Each rate starts on a day you choose and runs until your
  next one; shifts before it keep the country rate, and one shift never mixes the two (ADR 0007).
  Every deduction says which rate gave it: the shift and dashboard read "(your rate)" or "(country
  and your rate)", the Tax page and the tax summary name it, and the shift-level mileage log has a
  new last column, `Deduction_Rate`. API: `GET`/`POST /own-mileage-rates`,
  `PATCH`/`DELETE /own-mileage-rates/{id}`, `use_own_mileage_rate` in the settings,
  `deduction_rate` on shifts and the summary, `deductions.mileage_rate` in the tax report. Core
  migration 0014.
- Exports > Mileage and expenses report: a PDF for your accountant with a cover block, the summary
  (distances, the mileage deduction and the rates used, expenses by category, earnings), the
  mileage log with odometer readings and flags such as "distance estimated across a signal gap",
  the expenses, and the unverified-rates and not-tax-advice notices. Page numbers, headings
  repeated on every page, US Letter or A4 by country (or `paper=a4|letter`), tagged for screen
  readers, with Roboto embedded so names and currency signs print. Made on the server with
  pdfkit; the figures are the same as the CSV files and the tax summary for the period.
- Parking and tolls on a shift's page: add what you paid as an ordinary expense linked to the
  shift and its vehicle, and see the shift's total. `GET /expenses` takes `shift_id`.
- `MILEWAGE_TRUSTED_PROXIES` in `infra/docker/.env`: the address of a reverse proxy of your own in
  front of MileWage. Caddy keeps its `X-Forwarded-Proto`, `-Host` and `-For` and the API believes
  its client addresses, with no edit to the Caddyfile or the compose file.
- Install guide section 7: a reverse proxy of your own, and the headers it must send.
- A failed backup shows without the inbox: the Backups page says when the last run failed and the
  reason the server gave, and the dashboard shows a notice with a link to Backups until a run
  succeeds. The dashboard still says when no backup has worked for 36 hours. API:
  `last_backup_failure` on `GET /system/status`, from the backup service's memory, so a restart
  clears it (a failed run makes no file and was never in `GET /backups`).

### Changed

- Analytics says "Earned, after app fees" where it said "Gross" (the figure was always after app
  fees), shows "Per hour (online time)" only when online time was recorded, and shows the pay per
  mile or per km of business distance.

- The look is Material Design 3 on the web and the phone, from one colour scheme generated from
  Lane yellow, with earned and spent as matching extra colours (ADR 0010). The web's components
  are restyled in place: Roboto Flex on the Material type scale, Material shapes, elevation and
  motion, a ripple, one yellow action per screen, money colours on the headline figures. Material
  Symbols replace the lucide icons; they are bundled, nothing is fetched.
- Every text on the web follows the Material type scale, and dates and times follow the driver's
  formats everywhere.
- `npm run verify` checks the Android app too (`verify:android`: Gradle unit tests, Android lint and
  the Google-free policy check), after `verify:js`; it needs JDK 17 and the Android SDK. CI runs the
  two as separate jobs, and the Android job keeps the debug APK and the screenshots for a week.
- `scripts/phone-release-build.sh` builds the native app (through `apps/android/build-release.sh`):
  tests, lint and policy, then the signed APK, also named `milewage-<version>.apk`. Same flags,
  same upload key, no Node needed.
- The conformance fixtures moved to `packages/track-engine/conformance/fixtures.json`
  (`npm run conformance:fixtures`); `npm test` fails while they are stale.
  `npm run crosscheck:engine` re-checks the Kotlin engine against Node after a Node upgrade.
- `npm run version:check` checks that the Android app reads `VERSION` and that its default
  `versionCode` is not below the last released one.
- Renovate covers the Android app's Gradle catalog and wrapper, stable releases only, in a pull
  request of their own.
- The server bundle's `require` banner aliases its import of `createRequire`, so a bundled ES
  module that imports it too (pdfkit does) no longer breaks the build.
- Help: "Mileage rates and tax", "For your accountant", "Settings", "Shifts and trips" and
  "Expenses and receipts" describe your rate, the PDF report and parking and tolls; the mileage
  deduction is described as business distance (ADR 0005), as it has been since 0.2.0.
- Miles: the smallest move that counts now follows GPS accuracy. It is 20 metres, or the worse
  reported accuracy of the new point and the last counted one when that is larger, up to 50
  metres. A parked phone with poor GPS no longer adds distance that was never driven, and a
  point held back is counted later in the distance from the last counted point. Tracks with
  accuracy of 20 metres or better give exactly the same totals as before. Engine version 4
  (ADR 0006); the phone's notification counter follows the same rule.
- `MILEWAGE_TRUST_PROXY` accepts addresses separated by spaces as well as commas.

### Removed

- The Expo and React Native phone app (`apps/phone`), its jest tests and its Expo, React Native
  and Hermes dependencies (854 packages left the lockfile). Its Kotlin modules live on in the
  native app.
- Android 7 (API 24 and 25): the app needs Android 8.0 or later.
- The progress module (XP, levels, a streak, weekly challenges and badges), which was off by
  default: the Progress page, the streak on the dashboard's goal card, `GET /progress`, the
  `modules.progress` flag, the `comma.challenge_target_cents` setting, the Streak switch in
  Settings > Alerts and the badge, level, challenge and streak messages in the inbox. Upgrading
  deletes its tables (`badge_unlocks`, `progress_state`), those messages and the Streak switch's
  setting; a `modules.progress` or `challenge_target_cents` left in `settings.json` is ignored.
- The schedule module (planned shifts, repeating templates and off days), which was off by
  default: the Schedule page, the `/schedule` operations, the `modules.schedule` flag, the Shift
  reminders switch in Settings > Alerts and the `shift_reminder` inbox kind. Upgrading deletes its
  tables (`schedule_entries`, `schedule_templates`, `schedule_off_days`), any shift reminder
  messages and the switch's setting; a `modules.schedule` left in `settings.json` or
  `MILEWAGE_MODULE_SCHEDULE` in the environment is ignored.
- The AI assistant endpoint (module `mcp`), on by default since 0.2.0: the MCP endpoint
  `/api/v1/mcp`, assistant tokens, connecting an assistant by signing in (`/oauth/authorize` and
  its web page, `/oauth/register`, `/oauth/token` and the `/.well-known/oauth-*` documents), the
  log of changes assistants made, Settings > AI assistants with its Test connection, the
  `modules.mcp` flag and `MILEWAGE_MODULE_MCP` in the compose files. Upgrading deletes its tables
  (`mcp_tokens`, `mcp_clients`, `mcp_audit`, `mcp_kept_off`), so every assistant token and
  connection stops working; records an assistant added stay. A `modules.mcp` left in
  `settings.json` or `MILEWAGE_MODULE_MCP` in `.env` is ignored. The server no longer depends on
  `@modelcontextprotocol/server`, `@modelcontextprotocol/client` or `zod` (5 packages left the
  lockfile).
- The notifications module (the in-app inbox), on by default: the Notifications page, the bell
  with its unread count in the top bar, Settings > Alerts and its four switches (Goals, Tax dates,
  Backup problems, Shifts not yet sent), the `/notifications` operations and the
  `modules.notifications` flag. With it go the messages it made: a goal reached, a tax date within
  10 days, a repeating expense due, and a backup that failed or was overdue (the last two now show
  on the Backups page and the dashboard, see Added). The goals, the Tax page's dates and Expenses'
  Due now are unchanged. The phone's own notifications are unchanged. Upgrading deletes its tables
  (`notifications`, `notification_prefs`) in migration `zz_removed/0001`, which runs after every
  module's own migrations; a `modules.notifications` left in `settings.json` or
  `MILEWAGE_MODULE_NOTIFICATIONS` in the environment is ignored.

### Fixed

- The web ignored the 12-hour time setting in 14 files; every time now follows Settings > Time
  format.
- The shift timeline's time column no longer clips, and tax alerts name the platform.

## [0.2.0] - 2026-11-10

Second release. Help pages in the web app, AI assistants that connect by signing in, a password
reset from the sign-in page, a pass over the code's architecture (ADRs 0001 to 0005), and fixes to
pairing, sending and the deduction. The Android app changes too: install `milewage-0.2.0.apk`
(versionCode 2) on the phone after the server is upgraded.

**After upgrading:** run `milewage-cli recalc` once if shifts were ever created by CSV import
(their trips never reached the phone before). Shifts with a trip marked personal show a smaller
deduction than before, because personal distance no longer counts (ADR 0005); that is the
correction, not a loss of data.

The "Not yet verified" list of 0.1.0 still stands: no real shift on a real phone, no run over a real
Tailscale network, and every mileage rate and tax figure is unverified against the tax offices'
own pages.

### Added

- AI assistants connect by signing in: give Claude Code, Cursor or VS Code the address
  `https://<your server>/api/v1/mcp`, sign in to MileWage in the browser that opens and press Allow.
  No token to copy. Standard OAuth 2.1 with PKCE, self-registering clients and discovery documents
  (RFC 7591, 8414, 9728); access renews every hour, and an assistant unused for 90 days is
  disconnected. Signed-in assistants are listed, revoked and audited in Settings > AI assistants
  beside hand-made tokens.
- Forgot your password? on the sign-in page: paste the recovery key from setup and choose a new
  password. You are signed in at once and every other browser is signed out. 5 wrong keys per
  client per 15 minutes. If the recovery key is lost too, `milewage-cli reset-password` on the
  server machine (run with the server stopped) prints a new random password once.
- "Replace token" in Settings > AI assistants: a new secret for a token made by hand, shown once;
  the old one stops working at once, and its name, access and change history stay.
- Help pages in the web app: a Help screen (`/help`) with the driver guides from `docs/help/`,
  bundled into the build so they describe the version you run, with "What's new" cut from this
  changelog for that version and a note with Reload when the server reports another version. Ten
  new guides (getting started, shifts and trips, vehicles and odometer, expenses and receipts,
  earnings and platforms, mileage rates and tax, backups and the recovery key, phones and devices,
  settings, troubleshooting) join the six older ones, each checked against the code. Help links on
  the shift checks, the stops panel, Devices, the lost-key page and Exports. Settings > Help pages
  hides it all (`help_enabled`, default on). The same pages are readable on GitHub (ADR 0001, 0002).
- A release workflow: on every `v*` tag GitHub builds the server and Caddy images for amd64 and
  arm64 and publishes them as packages (`ghcr.io/raiz-toff/milewage/server` and `/caddy`).

### Changed

- The AI assistant module (`mcp`) is on by default, so Settings > AI assistants is always there.
  Nothing reaches your data until you connect an assistant. `MILEWAGE_MODULE_MCP=0` switches it off.
- The server is assembled by one function, `assembleServer`, for production and tests alike: the
  module registry and the event bus come first, each switched-on module wires itself from one typed
  host, and the list of modules exists once. The `modules` flags in `GET /settings` come from the
  registry. A wrong `MILEWAGE_MODULE_EXPORT_<FORMAT>` value now stops the server at start instead of
  failing the first settings read (ADR 0003).
- One pairing link format, in the shared package, for the server, the web pair page and the phone
  (`milewage://pair?v=1&u=&t=[&h=]` and `<server>/pair#v=1&t=[&h=]`).
- The phone builds every request body it sends (shift create, notes, odometer, trip override, manual
  trip, end, point batch) in one place, typed from the OpenAPI contract and checked against the
  spec's schemas in tests. Odometer readings are rounded to whole metres on every path.
- The phone keeps its sync halts (revoked, wrong server, sign-in problem) in one device session.
  A wrong server is now a halt retried at the upload interval, not an offline error with backoff.
  Settings shows its "Re-pair" message for a 403 as well as a 401.
- The web app sends every change through one write path and refreshes every cached read after a
  successful change (ADR 0004). Settings live in the same cache as every other read. One module,
  `days.ts`, holds the driver's calendar day, week start and period ranges for every page.
- The server reads the owner's settings once per request or job through one driver context, with
  one "stops on" rule and one local-time conversion. The mileage deduction is one module with
  batched queries (a 40-shift list costs 4 statement runs instead of about 160) and the deduction
  method injected. The shift book is the one place that records, recomputes and announces a shift
  and holds the 14-day device read window; routes are thin callers.
- The phone sends shifts through one module (`sync/sender.ts`); the screens read one status.
  "End shift" hands the shift to the queue and the home screen sends; focus, pull-to-refresh and
  "Send it now" run a full send round; "Check the address" also tries to send.
- Web: distance helpers (`toMetres`, `fromMetres`, `distanceInput`, `parseDistance`,
  `formatOdometer`) beside the money helpers, and no page serves as a helper library; one pairing
  session (`usePairingSession`) for Devices and the setup wizard, polling with TanStack Query; the
  shift page reads one shift record (`useShiftRecord`) and one pure view (`shiftView`).
- The app's own words follow the voice table and the glossary: "Send now" (was "Sync now"),
  "Shifts not yet sent (on the phone)", "My backup folder is copied to another place", the stop
  label's "Fare" (was "Payout"; the API field is unchanged), "cash order" (was "cash trip"), "tax
  year" (was "fiscal year"), and the setup wizard says a pack's mileage rate is "not yet checked
  against the official publications" instead of calling it official. The Assistants page says what a
  token is.

### Fixed

- Setup: a browser without a session (another device, or the same one at another address) was shown the recovery-key confirmation and then told "Sign in to continue" with no way to sign in. The server now asks for sign-in first; after signing in, the confirmation step follows.
- `npm run dev`: signing in and every other write failed with "The Origin header is missing or does not match", because Vite rewrote the Host header on its way to the API; the proxy now leaves Host alone.
- With the tracking module switched off, a failed backup now produces the `backup_failed` inbox item
  and the diagnostics record. Before, the event emitter was only wired when tracking registered its
  routes, so those events were dropped.
- The web pair page (camera fallback) dropped the home address from the app link, so a phone
  paired through it could not use the home Wi-Fi address.
- After pairing the phone again (by QR code or link code), queued shift creates and ends stayed
  unsent until "Sync now" or a restart, and a wrong-server block was never cleared. Pairing again
  now resumes everything.
- Expenses used the browser's UTC day for a new expense's date, the snooze date and the nearby
  shifts, so a Toronto driver adding an expense after about 19:00 got tomorrow's date.
- Figures on other pages stayed stale after a save: Tax kept the old total after an expense was
  saved, and settings changes refreshed nothing.
- The mileage deduction counted trips marked personal. It now uses the business distance (total
  minus personal trips), including the distance that fills a rate tier (ADR 0005). Nothing stored
  changes; every view corrects at once.
- Shifts created by CSV import never reached the phone (their `calculated_at` stayed empty, so the
  device pull skipped their trips). Imports now go through the shift book. Shifts imported before
  this fix keep the empty value; `milewage-cli recalc` fills it.
- Every trip added on the phone was sent with an empty purpose, which the server refuses, so it
  stayed parked for good and its shift showed "needs attention". A phone-added trip now gets
  "Business driving", and a blank purpose is refused before it is queued.
- The phone's "Deduction so far" counted trips marked personal; it now follows the server (ADR 0005).
- After a restore, a send round could re-create restored shifts while the server still held the
  just-ended shift active and get a 409; the round now ends that shift first.
- The Devices page shows a newly paired phone by itself, and an expired pairing code is replaced
  with a fresh one. The maintenance odometer field accepts "12,345" and refuses negative numbers.
- Receipt photos: location data is now removed from PNG and WebP photos too, not only JPEG, so the
  Expenses page's sentence is true. PDF files are stored as they are.

### Docs

- The README rewritten for people who find the project on GitHub: what it is, features, status,
  installing the server and the phone, usage, a documentation index, development, releasing and
  contributing.
- Guides corrected where they described controls the app does not have: a Recalculate button and
  finalizing a shift on the web. The FAQ now gives the http rule (plain http on the home address,
  https away from home), the licence (AGPL-3.0-only, public on GitHub) and the arm64 images (built,
  not yet tested). The README and this changelog say where the unverified notice appears and when
  your own mileage rate can be entered.

## [0.1.0] - 2026-11-09

First tagged version. It is a complete first build, but it has not been tried in the real world.
The Android app is attached to the GitHub release as `milewage-0.1.0.apk` (versionCode 1), signed with
the project's upload key.
Read "Not yet verified" first.

### Not yet verified

- Nothing has run on a real phone in a real shift yet. Battery use, tracking after the phone kills
  the app, and the stop and split estimates are untested outside the test suite.
- Nothing has run over a real Tailscale network. The install guide has not been followed on a
  fresh machine, a Raspberry Pi or an ARM host.
- Every mileage rate and every tax figure is unverified. They were not checked against the tax
  offices' own pages. The Tax page (for Canada) and the tax summary export say so; the dashboard,
  the shift pages and the phone show deductions without that notice.

### Server

- A single-owner server in Docker (Fastify and SQLite, behind Caddy). One account, one
  database file.
- Shifts, trips, stops and flags. The server recomputes every shift from the phone's raw points
  with the same shared engine the phone uses, and flags any difference instead of overwriting it.
- Phones pair with a QR code, or with a link code on the home Wi-Fi, and hold a device token
  that can be revoked at any time.
- Expenses with receipt photos, earnings entries, vehicles and their service log, odometer
  readings, goals, schedule, analytics, notifications and CSV import.
- Country packs for Canada, the United States and Great Britain, with a mileage deduction and, for
  Canada only, a tax estimate. A driver's own mileage rate can be entered only for a country
  without a rate; all three packs have one, so the field does not appear yet.
- Exports: mileage log CSV (per trip or per shift), expenses CSV, tax summary, GPX and GeoJSON.
  There is no PDF export in this version.
- Nightly encrypted backups (age), a recovery key shown once at setup, restore on a fresh
  server, and an upgrade that takes a backup first. A failed migration is rolled back and the
  server stays up read-only on the old database version.
- Built-in diagnostics that stay on your own server and never carry coordinates.
- An optional AI assistant endpoint (MCP). It is off by default and needs a token you create.

### Web

- Setup, then a dashboard with earnings, goals and recent shifts.
- Shift pages with a map, a timeline, stops you can label, earnings, odometer and notes.
- Pages for vehicles, expenses, tax, exports, backups, devices, platforms and settings.
- Light and dark themes (shadcn/ui), the Coin Road logo, and OpenFreeMap map tiles.
- Installable as an app from the browser, with a prompt when a new version is ready.

### Phone

- An Android app that records GPS while a shift runs. It works offline for weeks and sends its
  data when the server is reachable.
- First-run screens that connect to your server, check Tailscale and ask for permissions.
- A running-shift screen and notification with live distance. Shift lists work offline.
- Banners for shifts on phone only (not yet sent to the server), a wrong server and a server restored from an older backup.
- The QR scanner uses ZXing, with no Google ML Kit.

### Infra

- A Docker Compose stack, an install script, and guides for installing and upgrading.
- Caddy serves the web app and keeps the https address Tailscale sends.

### Docs

- This changelog, a security policy, a decisions index and driver guides in `docs/`.

### Not in this version

PDF export, road-snapped map lines (planned), a live map (removed on purpose), iPhone, phones
without Google services, offline basemaps, and more than one driver per server.

The sections Added, Changed, Removed, Fixed and Docs below are the fix pass of 2026-11-08 on top of the
first build, released together with it.

### Added

- A licence: MileWage is free software under the GNU Affero General Public License, version 3
  (`LICENSE`).
- `milewage-cli restore`: restore a backup from the command line with the API stopped, for
  example the pre-migration backup after a failed upgrade (`infra/docs/upgrade.md`).
- Backups page: make a new recovery key after setup. A backup under the new key is made right
  away.
- Show more on the Expenses and Notifications lists.
- The import preview shows every problem it finds.
- Edit a goal: its name, measure, period and target.
- An hour-of-day chart on Analytics.
- The phone sends its shifts again after the server is restored from a backup.
- The phone reads the system Location switch, so the permission steps can say when it is off.
- The phone records a battery and timing summary of each shift in its diagnostics (no coordinates).
- Every server setting is described in `infra/docs/configuration.md`.
- Repository: a code owners file, a pull request template and a bug report template under
  `.github/`.

### Changed

- CI moved from GitLab to GitHub Actions: `npm run verify` and the dependency audit run on every
  pull request and on `main` (`.github/workflows/verify.yml`). The release jobs are not ported yet.

### Removed

- The GitLab pipeline, its test and the GitLab branch-protection guide.
- The planning documents (`plans/`). They stay in the git history. The build log and the owner's
  to-do list moved to `PROGRESS.md` and `TODO.md` at the root.

### Fixed

- The dev data folder committed by mistake is removed from git. It stays in the history.
- MCP audit rows older than the retention period are removed.
- The release APK job in CI runs the manifest checks.
- A server given only a data folder keeps its backups beside it, not in the folder it was started
  from.

### Docs

- The design system is a project skill, `.claude/skills/milewage-design/`: palette and theme tokens,
  type, the web and phone primitives, the voice and the number formats, for anyone building a
  screen.
- Plans 02 to 19 have a build note under their status line, and plan 12 has a spike status table.
- A row in `DECISIONS.md` for the spike checks that are still open.
