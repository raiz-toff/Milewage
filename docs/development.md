# Development

For people who change MileWage's code. To install a server, see [`infra/docs/install.md`](../infra/docs/install.md). To send a change, see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## The three parts

| Part                       | What it is                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server (`apps/server`)     | Fastify and SQLite in Docker, behind Caddy. Holds the data, recomputes every shift, makes the backups.                                                                                |
| Web app (`apps/web`)       | React, restyled to Material Design 3. Dashboard, shifts, expenses, tax, exports, backups, devices, settings.                                                                          |
| Phone app (`apps/android`) | A native Android app: Kotlin, Jetpack Compose, Material 3. Records GPS while a shift runs and sends it when the server is reachable. No Google Play Services: de-Googled phones work. |

The server recomputes every shift with the same engine the phone runs (a Kotlin port that gives the same bytes as the TypeScript) and flags any difference instead of overwriting it.

## Run and check

Requires Node 22.22.x (`.nvmrc`). Earlier 22.x releases crash `better-sqlite3`.

```bash
npm install
npm run verify   # everything: verify:js, then verify:android
npm run verify:js       # typecheck, lint, version and OpenAPI checks, every vitest test
npm run verify:android  # the Android app: unit tests, Android lint, the Google-free policy check
npm run dev      # API on 127.0.0.1:3000 with its data in .dev/, web dev server in front of it
                 # (MILEWAGE_DEV_PORT=3200 npm run dev when 3000 is taken)
```

`npm run verify` needs JDK 17 and the Android SDK (`ANDROID_HOME`, default `$HOME/android-sdk`) for its Android half, and says so when either is missing. Gradle skips what has not changed, so a run with no change under `apps/android` adds seconds; after a change there it adds minutes. `npm run verify:js` is the quick check while working on the server or the web.

`npm run dev -- --host` puts the web app on the LAN and gives the server its home address, so a phone on the same network can pair with it.

## The phone app

The phone app is built with Gradle in `apps/android` (JDK 17, Android SDK platform 37): `./gradlew assembleDebug` makes a debug APK, `./gradlew test lint` checks it. The mileage engine there is a Kotlin port of `packages/track-engine`; after a change to the engine or a Node upgrade, `npm run conformance:fixtures` and `npm run crosscheck:engine` keep the two in step ([`apps/android/engine/README.md`](../apps/android/engine/README.md)). There is no emulator in this project's workflow: the owner tests on a real device. Details in [`apps/android/README.md`](../apps/android/README.md).

Its tests run on a computer only: unit tests, screens drawn by Robolectric, and the engine checked against Node on millions of cases. What only a real phone can show is listed as the field test in [`TODO.md`](../TODO.md): GPS waking up after a stop, battery use, phones that stop background apps, the QR scanner, recording after a restart, and the engine's maths on a phone's own processor.

## Folders

| Folder                  | Holds                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/server`           | The API, database migrations, backups, exporters, `milewage-cli`.                                    |
| `apps/web`              | The web app. Its restyled components live in `src/components/ui`, the repo's primitives in `src/ui`. |
| `apps/android`          | The Android app: Gradle modules `:engine` and `:core` (plain Kotlin), `:data`, `:tracking`, `:app`.  |
| `packages/track-engine` | The pure mileage engine the server runs and the Android app ports. No dependencies, no I/O.          |
| `packages/shared`       | The OpenAPI contract and the types generated from it (`npm run openapi:generate`).                   |
| `infra`                 | Docker Compose, the install script, the server guides, VM test drills.                               |
| `scripts`               | Dev server, server bundle, versioning, OpenAPI generation, the phone keystore and release build.     |

## Design

The design system is [`.claude/skills/milewage-design/`](../.claude/skills/milewage-design/SKILL.md): palette, type, components and voice. Claude Code loads it before UI work; it reads as a guide for people too. The brand marks are in [`branding/`](../branding/README.md).

## Why it is built this way

- [`DECISIONS.md`](../DECISIONS.md): the dated index of the owner's decisions.
- [`adr/`](adr/README.md): architecture decisions from 2026-11-09 on.
- [`PROGRESS.md`](../PROGRESS.md): the build log. [`TODO.md`](../TODO.md): open items.
- The planning documents left the repository on 2026-11-08 and stay in the git history (`git show 25e3d6d:plans/milewage/README.md`).

## Releasing

1. Bump `VERSION` and run `npm run version:sync`. Move the changelog's Unreleased entries under the new version and name the phone app's `versionCode` there.
2. `npm run verify`.
3. Build the phone app on the owner's machine: `MILEWAGE_VERSION_CODE=<code> scripts/phone-release-build.sh`, with a code above the last release's. It is signed with the upload key from `scripts/phone-keystore.sh` (kept in `~/.milewage`, never in git, never on CI) and written as `apps/android/app/build/outputs/apk/release/milewage-<version>.apk`.
4. Tag `v<version>` and push the tag. GitHub Actions ([`release.yml`](../.github/workflows/release.yml)) builds the server and Caddy images for amd64 and arm64 and publishes them to `ghcr.io/raiz-toff/milewage`.
5. `gh release create v<version>` with the changelog section, and attach the APK.
6. Raise the default `versionCode` in `apps/android/app/build.gradle.kts` to the released one, so a build from `main` still installs over it (`npm run version:check` holds it there).
