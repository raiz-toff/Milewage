# Changelog

All notable changes to MileWage are listed here. The format follows
[Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A licence: MileWage is free software under the GNU Affero General Public License, version 3
  (`LICENSE`).
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

### Removed

- The planning documents (`plans/`). They stay in the git history. The build log and the owner's
  to-do list moved to `PROGRESS.md` and `TODO.md` at the root.

### Fixed

- The dev data folder committed by mistake is removed from git. It stays in the history.
- MCP audit rows older than the retention period are removed.
- The release APK job in CI runs the manifest checks.
- A server given only a data folder keeps its backups beside it, not in the folder it was started
  from.

### Docs

- Plans 02 to 19 have a build note under their status line, and plan 12 has a spike status table.
- A row in `DECISIONS.md` for the spike checks that are still open.

## [0.1.0] - 2026-11-08

First tagged version. It is a complete first build, but it has not been tried in the real world.
Read "Not yet verified" first.

### Not yet verified

- Nothing has run on a real phone in a real shift yet. Battery use, tracking after the phone kills
  the app, and the stop and split estimates are untested outside the test suite.
- Nothing has run over a real Tailscale network. The install guide has not been followed on a
  fresh machine, a Raspberry Pi or an ARM host.
- Every mileage rate and every tax figure is unverified. They were not checked against the tax
  offices' own pages, and the app says so wherever it shows one.

### Server

- A single-owner server in Docker (Fastify and SQLite, behind Caddy). One account, one
  database file.
- Shifts, trips, stops and flags. The server recomputes every shift from the phone's raw points
  with the same shared engine the phone uses, and flags any difference instead of overwriting it.
- Phones pair with a QR code and hold a device token that can be revoked at any time.
- Expenses with receipt photos, earnings entries, vehicles and their service log, odometer
  readings, goals, schedule, analytics, notifications and CSV import.
- Country packs for Canada, the United States and Great Britain, with a mileage deduction and, for
  Canada only, a tax estimate. A driver can set their own mileage rate.
- Exports: mileage log CSV (per trip or per shift), expenses CSV, tax summary, GPX and GeoJSON.
  There is no PDF export in this version.
- Nightly encrypted backups (age), a recovery key shown once at setup, restore on a fresh
  server, and an upgrade that takes a backup first and reverts if it fails.
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
- Banners for unsynced data, a wrong server and a server restored from an older backup.
- The QR scanner uses ZXing, with no Google ML Kit.

### Infra

- A Docker Compose stack, an install script, and guides for installing and upgrading.
- Caddy serves the web app and keeps the https address Tailscale sends.

### Docs

- This changelog, a security policy, a decisions index and driver guides in `docs/`.

### Not in this version

PDF export, road-snapped map lines (planned), a live map (removed on purpose), iPhone, phones
without Google services, offline basemaps, and more than one driver per server.
