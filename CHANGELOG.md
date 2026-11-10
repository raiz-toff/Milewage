# Changelog

All notable changes to MileWage are listed here. The format follows
[Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Fixes for AI assistants behind the owner's own reverse proxy or a private certificate authority
(GitHub issue #6).

**After upgrading:** a server set up before 0.2.0 that never made an assistant code has the AI
assistant endpoint off again, as it was in 0.1.0. Set `MILEWAGE_MODULE_MCP=1` in
`infra/docker/.env` to turn it on.

**After upgrading:** the track engine is now version 4 (ADR 0006). Install the phone app built
from this release too, so the phone and the server count the same way; until then a shift whose
totals differ is marked as differing because of the engine version. Stored shifts keep their
figures. Run `milewage-cli recalc --dry-run` once to see which shifts the new rule would change
(only shifts with GPS accuracy worse than 20 metres can). To apply it to one of them, use
`POST /api/v1/shifts/<id>/recalculate`; a finalized shift is never changed.

**After upgrading:** a mileage rate of your own set before this release becomes a rate "from the
start" in Settings > Mileage rate. Nothing changes until you choose Your rate there; in a country
without rates in MileWage it is used as before.

### Added

- Places: save the places you stop at often, with a name, a centre, a radius (100 m unless you
  change it, 25 to 1000 m) and the label for stops there (pickup, dropoff or other). A stop inside
  a place shows its name and takes its label unless you labelled it yourself; the nearest centre
  wins where places overlap. Save one from a stop ("Save as a place" under Label stops), by
  clicking the map on the new Places page, or by typing its coordinates; nothing is looked up
  anywhere. Adding, changing or deleting a place works out again every ended shift with a stop in
  it; finalized shifts keep their figures. The engine is unchanged: places become stop labels on
  the server before it runs (ADR 0008). Total miles never change, and the phone's result still
  matches. Places stay out of diagnostics, logs and the assistant connection; the GeoJSON export
  names each stop's place. API: `GET`/`POST /places`, `PATCH`/`DELETE /places/{id}`, `place` on
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
- Settings > AI assistants > Test connection: the address assistants are given from where you are,
  what reached the server through the proxies, and the cause in plain words (a wrong address, a
  proxy that is not trusted, a missing `X-Forwarded-Proto`, a changed host name, and the
  `NODE_EXTRA_CA_CERTS` and wildcard-certificate rules for a private certificate authority).
- Install guide section 7a: reverse proxies, the headers they must send, private certificate
  authorities and host names in the certificate.

### Changed

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
- The sign-in documents for assistants (`/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-authorization-server`) and the endpoint's 401 use `MILEWAGE_PUBLIC_URL` or
  `MILEWAGE_HOME_URL`, https included, when the request came for that host name. Before, a proxy
  Caddy did not trust turned `https://milewage.lan` into `http://milewage.lan` and clients refused
  it. Other host names keep their own address.
- The token commands in Settings > AI assistants no longer hold the token: Claude Code reads it
  from `MILEWAGE_TOKEN` (`read -rs` keeps it out of the shell history) and the Claude Desktop file
  has a place to paste it. The page says not to paste the token into a chat or a ticket.
- `MILEWAGE_TRUST_PROXY` accepts addresses separated by spaces as well as commas.

### Fixed

- The AI assistant endpoint no longer turns itself on when a server from 0.1.0 is upgraded: one
  set up before 0.2.0 that never made an assistant code keeps it off until
  `MILEWAGE_MODULE_MCP=1`. `docker-compose.release.yml` said the endpoint was off by default while
  `docker-compose.yml` said on; both now say what the server does.

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
