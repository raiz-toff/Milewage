<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/coin-thin/lockup-reverse.svg" />
    <img src="branding/coin-thin/lockup.svg" alt="MileWage" height="72" />
  </picture>
</p>

# MileWage

Self-hosted mileage tracking for gig riders and drivers. Your phone records the shift, your own
server keeps the miles and the money, and nothing leaves your network.

[![Licence: AGPL-3.0](https://img.shields.io/github/license/raiz-toff/Milewage)](LICENSE)
[![verify](https://img.shields.io/github/actions/workflow/status/raiz-toff/Milewage/verify.yml?branch=main&label=verify)](https://github.com/raiz-toff/Milewage/actions/workflows/verify.yml)
[![Release](https://img.shields.io/github/v/release/raiz-toff/Milewage)](https://github.com/raiz-toff/Milewage/releases/latest)

## About

Delivery and ride-hail drivers need a mileage log their accountant will accept, and a view of
what a shift really earned after fuel and wear. The apps that do this keep the location history
of every working day on someone else's servers. MileWage runs on a machine you own, a home
server or a Raspberry Pi, reached from the phone over your Tailscale network. There is one driver
per server, the phone works offline for weeks, and the backups are encrypted with a key only you
hold.

Three parts, one TypeScript monorepo:

| Part                     | What it is                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Server (`apps/server`)   | Fastify and SQLite in Docker, behind Caddy. Holds the data, recomputes every shift, makes the backups.    |
| Web app (`apps/web`)     | React and shadcn/ui. Dashboard, shifts, expenses, tax, exports, backups, devices, settings.               |
| Phone app (`apps/phone`) | Expo and React Native, Android. Records GPS while a shift runs and sends it when the server is reachable. |

## Features

- Shifts, trips and stops from the phone's GPS track. The server recomputes every shift with the
  same shared engine the phone uses and flags any difference instead of overwriting it.
- Active and deadhead miles split by detected stops, with labels you add on the web. The split is
  an estimate and says so. Total miles never depend on it.
- Expenses with receipt photos, earnings, vehicles and their service log, odometer readings,
  goals, schedule, analytics, notifications and CSV import. Each module can be switched off.
- Country packs for Canada, the United States and Great Britain: a mileage deduction, and for
  Canada a tax estimate. Your own mileage rate can be entered only for a country without a rate;
  all three packs have one, so the field does not appear yet.
- Exports for your accountant: mileage log CSV per trip or per shift, expenses CSV, tax summary,
  GPX and GeoJSON.
- Nightly encrypted backups (age) and a recovery key shown once. Restore onto a fresh server. An
  upgrade takes a backup first. A failed migration is rolled back and the server stays up
  read-only on the old database version.
- Phones pair with a QR code, or with a link code on the home Wi-Fi, and hold a device token you
  can revoke at any time.
- Diagnostics that stay on your server and never carry coordinates.
- An optional AI assistant endpoint (MCP): nothing reaches your data until you connect an
  assistant, and the server owner can switch it off.

**Status.** Version 0.2.0 is a complete build that has not yet been tried in the real
world: no real shift on a real phone, no run over a real Tailscale network, and every mileage
rate and tax figure is unverified against the tax offices' own pages. The Tax page (for Canada)
and the tax summary export say so; the dashboard, shift pages and phone show deductions without
that notice. Details under "Not yet verified" in [`CHANGELOG.md`](CHANGELOG.md).

## Install

### The server

You need a host with Docker and the Docker Compose plugin, about 1 GB of RAM, and a Tailscale
account. Nothing is opened on your router.

```bash
git clone https://github.com/raiz-toff/Milewage.git milewage && cd milewage
infra/install.sh
```

The script writes `infra/docker/.env`, builds the two images, starts them and checks `/healthz`.
It then offers to turn on https over Tailscale so the phone can reach the server from anywhere.
To pull the published images instead of building, set `MILEWAGE_IMAGE_REPO=ghcr.io/raiz-toff/milewage`
and use `docker-compose.release.yml`; the install guide shows the exact commands.

Open the web app, create the owner account and **write down the recovery key** it shows. It
decrypts your backups and the server cannot show it again.

The full guide, with LAN access for your home Wi-Fi, the Tailscale step and its privacy note, is
[`infra/docs/install.md`](infra/docs/install.md). Setting it up with an AI coding agent?
Give it [`infra/docs/agent-setup.md`](infra/docs/agent-setup.md).

### The phone

1. Install Tailscale on the Android phone and sign in to the same tailnet. On your home Wi-Fi with
   LAN access on, this step can wait.
2. Install `milewage-<version>.apk` from the
   [latest release](https://github.com/raiz-toff/Milewage/releases/latest). Android asks once to
   allow installs from your browser. Your server can also hand the file out from its own
   download page.
3. Open the app and point it at your server, then scan the QR code from the web's Devices page.
   On the home Wi-Fi the app finds the server by itself and asks for the code instead.

## Usage

Start a shift on the phone before the first pickup and stop it after the last drop. The phone
shows the live distance in its notification and keeps recording if the app is closed. When the
server is reachable the shift is sent; until then it stays on the phone and the app says so.

On the web, each shift has a map, a timeline, stops you can label, earnings, odometer and notes.
The dashboard shows the week's earnings, goals and recent shifts. The Tax and Exports pages give
the figures and the CSV files for the year. Backups are nightly; the Backups page can make one now,
download it, or make a new recovery key.

## Documentation

| For                      | Read                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drivers                  | [`docs/help/`](docs/help/README.md): getting started, shifts and trips, how miles are counted, vehicles, expenses, earnings, tax, backups, phones, settings, troubleshooting, questions and answers; also in the web app under Help.                  |
| Running a server         | [`infra/docs/install.md`](infra/docs/install.md), [`infra/docs/upgrade.md`](infra/docs/upgrade.md), [`infra/docs/configuration.md`](infra/docs/configuration.md) (every `MILEWAGE_*` setting).                                                        |
| What changed             | [`CHANGELOG.md`](CHANGELOG.md)                                                                                                                                                                                                                        |
| Reporting a problem      | [`SECURITY.md`](SECURITY.md) for vulnerabilities, the bug template in Issues for everything else.                                                                                                                                                     |
| Why it is built this way | [`DECISIONS.md`](DECISIONS.md), the dated index of the owner's decisions; [`PROGRESS.md`](PROGRESS.md), the build log; [`TODO.md`](TODO.md), open items.                                                                                              |
| Design                   | [`.claude/skills/milewage-design/`](.claude/skills/milewage-design/SKILL.md): palette, type, components and voice. Claude Code loads it before UI work; it reads as a guide for people too. The brand marks are in [`branding/`](branding/README.md). |

The planning documents left the repository on 2026-11-08 and stay in the git history
(`git show 25e3d6d:plans/milewage/README.md`).

## Development

Requires Node 22.22.x (`.nvmrc`). Earlier 22.x releases crash `better-sqlite3`.

```bash
npm install
npm run verify   # typecheck, lint, version and OpenAPI checks, server and phone tests
npm run dev      # API on 127.0.0.1:3000 with its data in .dev/, web dev server in front of it
                 # (MILEWAGE_DEV_PORT=3200 npm run dev when 3000 is taken)
```

`npm run dev -- --host` puts the web app on the LAN and announces the server on the Wi-Fi, so a
phone on the same network can pair with it.

The phone app is built with Expo (`npx expo run:android` in `apps/phone`, with JDK 17 and the
Android SDK). There is no emulator in this project's workflow: the owner tests on a real device.

| Folder                  | Holds                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/server`           | The API, database migrations, backups, exporters, the MCP endpoint, `milewage-cli`.               |
| `apps/web`              | The web app. shadcn/ui components live in `src/components/ui`, the repo's primitives in `src/ui`. |
| `apps/phone`            | The Android app, with Kotlin modules for tracking, QR scanning and the network check.             |
| `packages/track-engine` | The pure mileage engine both the phone and the server run. No dependencies, no I/O.               |
| `packages/shared`       | The OpenAPI contract and the types generated from it (`npm run openapi:generate`).                |
| `infra`                 | Docker Compose, the install script, the server guides, VM test drills.                            |
| `scripts`               | Dev server, server bundle, versioning, OpenAPI generation, the phone keystore and release build.  |

### Releasing

Bump `VERSION` (`npm run version:sync`), move the changelog's Unreleased entries under the new
version, tag `v<version>` and push the tag. GitHub Actions
([`release.yml`](.github/workflows/release.yml)) builds the server and Caddy images for amd64 and
arm64 and publishes them to `ghcr.io/raiz-toff/milewage`. The phone app is built on the owner's
machine with `scripts/phone-release-build.sh`, signed with the upload key from
`scripts/phone-keystore.sh` (kept in `~/.milewage`, never in git), and attached to the GitHub
release by hand.

## Contributing

This is a one-person project, and pull requests are welcome. Open an issue first for anything
larger than a fix, so the work is not done twice.

- Branch from `main`. A pull request needs the `verify` check green; the template asks what
  changed, how it was checked and what the owner should confirm.
- Commits on `main` are squashed, titled `[ID] Area: what changed`, as the log in `PROGRESS.md`
  shows.
- Before UI work, read the design skill. Driver-facing text follows its voice: short sentences,
  plain words, every problem message with one way forward.
- Dependency security updates arrive through Dependabot. `renovate.json` asks for one weekly pull
  request with the minor and patch updates, but it runs only when a Renovate bot is pointed at the
  project; nothing happens until then.

## Licence

MileWage is free software under the GNU Affero General Public License, version 3
([`LICENSE`](LICENSE)). Copyright (C) 2026 rajkumar. If you run a changed MileWage for others, the
AGPL asks you to offer them your changes.
