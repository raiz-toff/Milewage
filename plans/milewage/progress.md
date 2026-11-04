# MileWage build progress log

Running log for the Gate 4 build (roadmap `17`). Updated and pushed after each PR.

## Environment

- Host `coder` has Node 24.15.0 as default. Node 22.22.0 was extracted from the local Docker image `node:22.22.0-bookworm-slim` into `~/.local/node22` and put first on `PATH` for all work. `.nvmrc` is `22.22.0`. All `verify` runs below used Node 22.22.0 / npm 10.9.4.
- Merge method: `git merge --squash` of the PR branch into `main` (roadmap 17 sec. 1 rule 3), run locally because no GitLab host or branch protection exists yet. Branches are pushed to origin as well.

## PR 1 — [M0.1] Repo skeleton, workspaces, tooling, verify

- Branch `pr-01-repo-skeleton`; squash commit on main `43d2d20`.
- Done: npm workspaces (`apps/*`, `packages/*`), `.nvmrc`, `tsconfig.base.json` (strict, ESM), ESLint flat config + Prettier, Vitest root config, `.gitignore`, README, placeholder package + test in `shared`, `track-engine`, `server`. `npm run verify` = typecheck + lint (eslint + prettier check) + test.
- Lint rule: `track-engine/src` forbids `react-native`, `node:*`, `fs`, `path`, DB and network libs, `Date.now`, `Math.random`, `fetch`. Proven by `packages/track-engine/test/lint-rule.test.ts` (bad samples fail, same code passes outside track-engine).
- Tests: 12 passed. Size: about 297 changed lines excluding lockfile.
- Deviation: roadmap says this PR makes the repo's initial commit including `plans/`; the repo already had commits (plans committed earlier), so this is an ordinary commit.

## PR 2 — [M0.2] CI, VERSION, version.mjs

- Branch `pr-02-ci-version`; squash commit on main `fd6e4e1`.
- Done: `VERSION` (0.1.0; all package.json files synced to it), `scripts/version.mjs check|sync`, `npm run version:check` added to `verify`, `.gitlab-ci.yml` (runs `npm run verify` on `node:22.22.0-bookworm-slim`), branch protection notes in `infra/docs/branch-protection.md`.
- Tests: 16 passed (4 new for version.mjs: match, mismatch fails, malformed VERSION, sync). `verify` green on Node 22.22.0.
- **Blocker/owner action: no GitLab runner is registered yet and the GitLab project URL/path is not known; the pipeline is untested.** `origin` is a git server on the LAN (push works). Branch protection (`infra/docs/branch-protection.md`) must be applied by the owner; until then the `verify`-before-merge rule is enforced manually.
- Small additions beyond the PR text: ESLint node globals for `scripts/*.mjs`; root `package.json` now carries `version`.

## PR 3 — [M0.3] Module registry, dependency graph, event bus

- Branch `pr-03-module-registry`; squash commit on main `2577247`.
- Done in `packages/shared`: `defineModule`, `buildRegistry` (cycle, unknown/duplicate module, non-toggleable-off and missing-dependency refusal with plain messages; dependency-ordered start), `resolveModuleConfig` (default, `config/settings.json` `modules`, then `MILEWAGE_MODULE_<NAME>=0|1`), typed `createEventBus` with the nine event names of 08 section 16.4, `moduleMatrix` test helper (all-on, only-X-with-dependencies, missing-dependency).
- Tests: 33 passed in total (17 new). Disabled module: routes 404, no jobs, no subscriptions; events reach subscribers. Size 398 changed lines (trimmed to fit 400).
- Decisions where the spec was silent (smallest consistent choice): event payloads are minimal ids (`shiftId`, `deviceId`, ...), to be refined when emitters exist; a throwing event handler is isolated so it cannot break the publisher; `RouteHost` is a tiny interface (`route(method, path, handler)`) that the server will adapt to Fastify later; modules may set `toggleable: false` (for core) and `defaultEnabled`; module names are lowercase snake_case so env names map to `MILEWAGE_MODULE_EXPORT_CSV`.
- Not done (per PR text): the `stops` runtime guard, real modules, hot toggling, plugin loader.

## PR 4 — [M0.4] OpenAPI as source of truth

- Branch `pr-04-openapi`; squash commit on main `b87da35`.
- Done: 08 section 13 copied verbatim to `packages/shared/openapi/openapi.yaml` (excluded from Prettier to keep it a verbatim copy); `scripts/openapi-generate.mjs` (`generate`, `check`, `lint`) writes `packages/shared/generated/api-types.ts` and `schemas.json`; `npm run openapi:check` (drift check + `x-modules` lint) is part of `verify`.
- Tool choice (made in this PR as required): `openapi-typescript` v7 for types (maintained, OpenAPI 3.1, pure types, no runtime). JSON Schemas need no tool: 3.1 schemas are already JSON Schema 2020-12, so the script moves `components.schemas` to `$defs` and rewrites the refs. Parsing uses `yaml`.
- Tests: 39 passed in total (7 new): committed files match fresh generation; editing a generated file fails; editing the spec without regenerating fails; the real spec maps all 61 operations to exactly one module; unmapped / doubly mapped / unknown operations fail the lint.
- Size: about 185 changed lines excluding the verbatim spec copy, generated files and lockfile (the YAML copy is itself ~1,965 lines; treated as a verbatim copy of 08 section 13, not authored code).
- Deviation/open point: the `stops` module is mapped in `x-modules` as written in 08; `putTripOverride` sits in `tracking` there although 08 section 16.2's table lists it under none; kept as the spec's YAML says.

## Summary after PR 4 (M0 complete)

M0 exit: `npm run verify` passes (typecheck, lint, version check, OpenAPI drift + module lint, tests); the module registry refuses to start with a missing dependency (PR 3 tests); the OpenAPI file generates types and a drift check detects edits (PR 4 tests). CI exit is unproven until a GitLab runner exists.

## PR 8 — [M2.1] Server skeleton

- Branch `pr-08-server-skeleton`; squash commit on main `a14b77b`.
- Done in `apps/server`: `buildApp` (Fastify 5, module registry wired in, routes registered under `/api/v1`, disabled modules register nothing so they 404), `GET /healthz` outside `/api/v1` (`{"ok":true}`, or 503 `{"ok":false}` when the injected probe fails), RFC 9457 error model of 08 section 7.1 (full code catalog, `request_id` as a ULID, 422 `errors`, 400/413/415 mapped, unexpected errors become a generic `internal_error` with no internals), structured JSON logging with redaction (authorization, cookie, set-cookie, password fields, recovery key), `loadConfig` (`MILEWAGE_PORT/HOST/DATA_DIR/CONFIG_DIR/LOG_LEVEL`, optional `config/settings.json`), a `core` module (not toggleable, no routes yet).
- Tests: 92 passed in total on rebased main (new server tests: health, error shapes, redaction, module matrix with stub modules proving own-route-200 / other-route-404 / broken config refuses). Size 400 changed lines excluding lockfile.
- Decisions: modules receive `ServerRouteHost` (`RouteHost` plus `app`, the Fastify scope), because the tiny `RouteHost` handler cannot set cookies or status; `bodyLimit` is 64 KiB (the default JSON limit of 08 section 7.3); 503 health body is `{"ok":false}`.
- Trimmed to fit 400 lines: no `startServer` entry point yet (added when the DB layer needs a startup sequence); no `X-MileWage-*` response headers yet (need the instance row from PR 9/10).

## Needs the owner

- Register a GitLab runner (Docker executor) and give the project path; apply `infra/docs/branch-protection.md`. `.gitlab-ci.yml` is untested.
- Install Node 22.22 as the default on `coder` (currently extracted from Docker to `~/.local/node22`; default Node is 24.15).

## PR 5 — [M1.1] Engine types, integer helpers, stages 1-2

- Branch `pr-05-engine-types-stages`; squash commit on main `454417b`.
- Done in `packages/track-engine`: `Fix`, `ShiftInput`, `ShiftResult` (and the `Stop`, `Trip`, `TripEdit`, `Flag` types they reference) per 14 section 3; integer helpers (E7, `roundHalfUp`, `divRound`, decimetre/metre conversion rounded once); `algorithmVersion = 1`; stage 1 `normalize` and stage 2 `qualify`.
- Tests: 50 passed in total on verify (11 new): shuffle and duplicate invariance (seeded shuffles), empty/single input, window edges (-5 min / +10 min, inclusive), accuracy boundary 50 kept / 51 dropped, input not mutated.
- Decisions: sort ties beyond `(recordedAt, seq)` are broken by lat, lon, accuracy so any input order gives one output; "first occurrence of a seq" means first in that sorted order. Other types of 14 section 3 not yet needed (trip details) are declared as in 07 section 2.3 and unused until later PRs.
- Size: about 300 changed lines.

## PR 6 — [M1.2] Stage 3 gate, distance, live accumulator

- Branch `pr-06-gate-distance-accumulator`; squash commit on main `cd9abad`.
- Done: written-out haversine (R = 6,371,000 m, rounded once to decimetres), `gateStep`/`gate` per 14 section 5.3 (non-positive dt, speed over 420 dm/s, under 200 dm, anchor moves only on accept, integer comparisons), `measureDistance` (stages 1-3 batch), `createLiveAccumulator(startedAt)` running stages 1-3 one fix at a time with the same functions.
- Tests: 63 passed in total (13 new): straight line, closed square loop, single spike excluded, 20 m gate (19.9 dropped, 20 accepted, creep accumulates), 42 m/s boundary, non-positive dt, empty/single fix, low-accuracy fix never anchors, accumulator equals batch on clean and on messy in-order input, no `Date.now` calls.
- Decisions: the live accumulator checks only the lower window bound (shift end unknown) and expects fixes in time order; an out-of-order live fix is dropped as non-positive dt, which is why batch (which sorts) is the authority. `processShift` is not built here (later PRs).
- Size: about 275 changed lines.

## PR 7 — [M1.3] Seeded ride generator, golden fixtures, version-bump guard

- Branch `pr-07-ride-generator-golden`; squash commit on main `5e2c6b8`.
- Done: test-support generator `test/support/rides.ts` (mulberry32 seeds; straight, grid with turns, closed loop, stop-and-go with 3-minute jittered waits; each with an analytic truth length), `test/fixtures/golden.json` (expected outputs per ride plus an append-only ledger of one output digest per `algorithmVersion`), guard in `test/support/golden.ts`. Regenerate with `UPDATE_FIXTURES=1 npx vitest run golden`; it refuses to rewrite the entry of an existing version.
- Guard design: a digest ledger instead of comparing with a previous commit, so regenerating fixtures without bumping `algorithmVersion` is refused (a simple "fixtures match code" test would pass after a silent regeneration). Reviewers must still check that the ledger only ever gains lines (no CI diff check yet).
- Tests: 80 passed in total (17 new): determinism, seeds change noise not truth, engine totals within 2 m + 0.2% of analytic truth, jitter in waits adds nothing, guard fails on a simulated output change and on a simulated threshold change, bumped version demands regeneration, regeneration adds a ledger entry.
- Deviation: expected JSON is the stage 1-3 part of `ShiftResult` (version, `totals.totalM`, stats counters) because `processShift` does not exist yet; later PRs extend it. Size: about 315 changed lines excluding `golden.json`.

## Summary after PR 7

All of PRs 5-7 merged to main with `npm run verify` green on Node 22.22.0 each time. No blockers. Not started: PR 8+ (gaps, stops, trips are out of scope here).

## PR 9 — [M2.2] DB layer and migration runner

- Branch `pr-09-db-migrations`; squash commit on main `99d5701`.
- Done in `apps/server/src/db`: `openDatabase` (better-sqlite3 single write connection; PRAGMAs of 10 section 3.4 applied and read back on every open, failing if SQLite ignores one), forward-only `migrate` (`schema_migrations(module, id)`, one transaction for all pending so a failure rolls everything back, lock file `<db>.migrate.lock`, `beforeMigrate(pending)` no-op hook for the M3.4 pre-migration backup, refusal of a database that records an unknown migration), per-module SQL folders (`migrations/core/0001_identity.sql`: `users`, `settings`, `instance` exactly as in 07 section 2.1), Drizzle schema, `createUserRepository` (count, findByUsername, create) as the example repository, and `startServer` (config, module flags, open + migrate, then listen; a newer database refuses to start before the port is bound; `/healthz` now reads the database).
- Tests: 99 passed in total on rebased main (new: PRAGMAs, idempotent migrations and hook, failing migration leaves old schema, newer database refused by runner and by `startServer`, held lock blocks a second runner, repository).
- Deviations: migration SQL is hand-written to match 07 (Drizzle Kit generation is not wired; `drizzle-kit` is not installed, only `drizzle-orm`), so the SQL is the source of truth and `schema.ts` mirrors it; the 3.3 SQLite-version startup assertion is not in this PR text and is not done (bundled SQLite is 3.53.4 on this install); size is 404 changed lines counting `package.json`.

## PR 10 — [M2.3] Setup and login

- Branch `pr-10-setup-login`; squash commit on main `46d1aae`.
- Done (module `core`, all five operations are `core` in `x-modules`): `GET /setup/status`, `POST /setup` (one transaction: user, settings, `instance` row with a random install id; the transaction re-checks that no user exists, so concurrent requests cannot both win), `POST /auth/login`, `POST /auth/logout`, `POST /auth/password`. scrypt (N=32768, r=8, p=1, 16-byte salt, stored as `scrypt$salt$hash`, async, constant-time compare); opaque 256-bit session value, only its SHA-256 stored in `web_sessions` (migration `core/0002_web_sessions`), cookie `mw_session; HttpOnly; Secure; SameSite=Strict; Path=/`, sliding 30-day expiry; login failure limiter (5 per 15 minutes, per client IP and per account, in memory) answering 429 `rate_limited` with `Retry-After`; unknown user runs a dummy scrypt so response and timing match a wrong password; non-GET cookie routes require `Origin` equal to the request host (`origin_mismatch`); password change deletes all other sessions.
- Tests: 105 passed in total on main (new `auth.test.ts`: second owner refused (409), wrong password and unknown user identical, logout and Origin check, expiry plus sliding renewal with an injected clock, brute-force limit per IP and per account with `Retry-After` and recovery after the window, password change ends other sessions). Size 400 changed lines excluding lockfile.
- Deviations/decisions: `POST /setup` returns `{"state":"ready"}` without `recovery_key`, and `GET /setup/status` never returns `needs_confirmation`, because the recovery key and `POST /setup/confirm` are out of scope until M3.2 (the OpenAPI response schema still lists `recovery_key`; the M3.2 PR closes the gap). The `RateLimit-*` headers on successful responses are not sent yet. The timezone is not checked against the IANA database (left for the settings PR). `request.ip` is used as the client IP; `trustProxy` must be set when the server sits behind Caddy (deployment PR), otherwise every client shares the proxy address. Password length is capped at 1024 characters (the spec gives only the minimum of 10). scrypt parameters are fixed in code; the hash prefix `scrypt$` allows a later parameter change.
- Not done (per PR text): recovery key, pairing, settings, `X-MileWage-*` response headers, `setup_incomplete` guard.

## Summary after PR 10 (M2 server track: PRs 8-10)

`apps/server` boots from config, applies module flags, opens SQLite with the 10 section 3.4 PRAGMAs, migrates (refusing a newer database), and serves health, setup and login under the error model of 08 section 7.1. `npm run verify` is green on Node 22.22.0.

## chore-01 — ignore agent worktrees in lint

- Branch `chore-01-eslint-ignore`. Deviation outside the roadmap: agent worktrees live inside the repo folder, so `npm run verify` linted them. Added the agent-worktree folder to the ESLint ignores and `.prettierignore`, and to `.gitignore` (was absent). Config only, 3 lines.

## PR M2.9 — Server image, compose stack, Caddyfile

- Branch `pr-M2-9-server-image`. Done: `infra/docker/{Dockerfile,docker-compose.yml,Caddyfile,smoke.sh}`, `apps/server/src/main.ts` (process entry with SIGTERM/SIGINT close), `scripts/build-server.mjs` (esbuild bundle to `dist/server.mjs`, `better-sqlite3` external and pinned to the locked 13.0.3 through `dist/native-package.json`, migrations copied next to the bundle because `MIGRATIONS_DIR` resolves relative to the module), `.dockerignore`, scripts `build:server` and `smoke:docker`, `esbuild@0.28.2` as an exact devDependency (was only transitive).
- Image: `node:22.22.0-bookworm-slim` (three stages, non-root `node` user, `--max-old-space-size=96`, HEALTHCHECK on `/healthz`). Compose: `caddy:2.8.4-alpine` and `milewage-server:0.1.0`, Caddy published only on `127.0.0.1:${MILEWAGE_HOST_PORT:-8080}`, API publishes nothing, `mem_limit`/`cpus` caps (api 192m/1.0, caddy 64m/0.5), volumes `data`, `backups`, `config`, `caddy_data`, `caddy_config`. Caddyfile proxies only `/api/*` and `/healthz` (WebSocket upgrade works through `reverse_proxy`), everything else 404 until the web client PR; 2 MB body limit, gzip/zstd, basic security headers.
- Docker was available: `npm run smoke:docker` built the stack, got `{"ok":true}` through Caddy on a throwaway loopback port, checked 404 on unknown path, `/api/v1/setup/status` reachable, Caddy bound to loopback, API with no published port. The script exits 2 (skipped) when Docker is missing and 1 on any failed check. Not in `verify` (needs Docker).
- Tests: build-server test (bundle keeps `better-sqlite3` external, pins locked version, ships migrations).
- Not done: `trustProxy` for `request.ip` behind Caddy is still open (needs a change in `app.ts`/config, another track's files; do it in the deployment/hardening PR); idle RSS vs the 10 section 14 budget not measured here (Spike B's job); no ARM64 build tested; no `tiles` volume or static web yet.
- Merged to main as `e5bfd46` (verify green: 107 tests).

## PR M2.4 — Settings, vehicles, module flags

- Branch `pr-M2-4-settings-vehicles`; squash commit on main `7ac38dc`.
- Done (module `core`): `GET /settings` (preferences, `engine_version` from track-engine `algorithmVersion`, `diagnostics {level, verbose_until, capture: null}`, `modules` flags read from the registry, so an unregistered module is `false`), `PATCH /settings` (country against the configured country list, currency letters, IANA zone via `Intl`, retention >= 7, `diagnostics_level`; verbose stores `now + 7 days` and reads back as `basic` once past), `GET/POST/PATCH /vehicles` (archive instead of delete, `include_archived`), migration `core/0003_vehicles`. Routes take an `AuthFn(request, 'S' | 'SD')` so the devices PR only swaps the function.
- Tests: 113 passed in total (new: settings, flags follow the registry with a stub module, validation, verbose expiry, vehicle lifecycle and errors, plus a reusable test harness `test/support.ts`).
- Decisions/deviations: Fastify's default Ajv strips unknown fields when `additionalProperties:false`; it is now `removeAdditional:false` so unknown fields return 422 (08 section 1; this also fixes the M2.3 routes). `countries` defaults to US, CA, GB (uppercase, as stored) until a country-pack registry exists; `backup_download`, `exporters`, `stops` are false/empty until those modules exist. `POST /setup` still does not validate zone or country (smallest change; PATCH does). The `/odometer` year-reading routes are not in this PR text and are left for the logbook PRs. Size is about 450 changed lines, over the 400 cap (the test harness is 51 of them).

## PR M2.10 — DiagnosticsPort, event kinds, allowlist schemas, canary test

- Branch `pr-M2-10-diagnostics-port`. Done in `packages/shared/src/diagnostics/`: `DiagnosticsPort` (`record(kind, data)`) with a frozen `noopDiagnostics`; a small schema DSL (`int`, `bool`, `oneOf`, `str`, `ints`, `strs`, `obj`; undeclared fields rejected, strings only by pattern or enum); the envelope check `validateEvent` (kind, `at`, level, allowed `src` per kind, `seq`, `shift`/`cap` ids, `v`, then `data` against the kind's schema; reasons name a field path, never a value); the coordinate belt (decimal with 4+ places, standalone 9+ digit token) plus a credential belt (token prefixes, session cookie name, tailnet host suffix) on every string; `crashMessage` and the `msg` gate by class allowlist (16 section 4.3). Kinds in this PR: `service.event`, `track.window`, `crash`, `diag.self`.
- Tests: 114 passed in total (7 new in `packages/shared/test/diagnostics.test.ts`): every kind accepts its sample; canary strings (coordinates, E7 values, address, tailnet host, token prefixes) substituted into every string leaf are rejected or never reach the stored event; undeclared `lat`/`note`/`address` fields rejected at any depth; free text in enums rejected; non-integers in counts rejected; crash message gating and redaction; no-op port.
- Deviation: the 400-line cap forced a split. `app.start`, `upload.window`, `shift.summary`, `engine.run` (the rest of the A-rig set of 16 section 9.3) go in PR M2.10b, same PR text, before M2.11. Size is about 415 lines including this log entry.
- Decisions/limits: a payout canary (`12.34`, `1234`) and an alphanumeric `CANARY_NOTE` cannot be told from a version or a count by a pattern, so the defence is that no kind declares a money or label field and pattern fields stay narrow; the tests assert exactly that. Numbers are bounded integers, so a coordinate-sized count such as 436532000 is not refused (it is a legal count); only strings get the belt.
- Merged to main as `b806bd5` (verify green: 120 tests).

## PR M2.5 — Devices module

- Branch `pr-M2-5-devices`; squash commit on main `debdc3e`.
- Done (module `devices`, depends on `core`): `POST /pairing-tokens` (`mwp_` + 43 chars, 10 minutes, only the SHA-256 stored, `qr_payload` from `X-Forwarded-Proto/Host`), `POST /pairing/redeem` (public; token consumed and device created in one transaction; unknown, expired and used tokens give the same 401 `invalid_pairing_token`; 10 failures per 15 minutes per IP then 429 with `Retry-After`; 4 KiB body limit; returns `device_token` once plus `Settings`), `GET /devices`, `PATCH /devices/{id}`, `DELETE /devices/{id}` (idempotent revoke, 404 for unknown). Migration `devices/0001_devices`. New `Authenticator` (08 section 16.5): the devices module plugs in the `Authorization: Bearer mwd_...` branch; revoked gives 401 `device_revoked`, unknown or malformed gives 401 `auth_required`, `last_seen_at` is written at most once a minute. Scope matrix: `AuthFn(request, 'S' | 'SD')`; a device on an `S` route gets 403 `scope_forbidden`; bearer requests skip the Origin check. With the devices module off a bearer token is plain unauthenticated.
- Tests: 126 passed in total on rebased main (new `devices.test.ts`, 7 tests: QR payload, one-time and expired tokens, hashed storage, scope matrix over five write routes plus both read routes, revoke and rename and list, last-seen throttle, redeem limit per IP, module off).
- Decisions: `readSettings` (the `Settings` body returned at pairing) is a core service handed to the devices module, which does not import core routes. `app_version` is validated but not stored (no column in 07). `clock_skew_ms`/`online` on `Device` are optional and come with M2.8 / live. The `device.seen` event is not emitted yet (no listener exists). Size is about 450 changed lines, over the 400 cap.

## PR M2.10b — Remaining A-rig event kinds

- Branch `pr-M2-10b-diagnostics-kinds` (second half of M2.10, split for the 400-line cap). Added `app.start` (device make/model pattern also refuses a leading street number), `upload.window`, `shift.summary`, `engine.run` (stats counters of 14 section 8 as a fixed object, flags are `[a-z0-9_]` codes). The A-rig set of 16 section 9.3 is now complete (those four, `service.event`, `track.window`, `crash`) plus `diag.self`; the canary tests iterate every kind, so they cover the new ones.
## PR M4.1 — [M4.1] Phone app skeleton

- Branch `pr-M4-1-phone-skeleton` (pushed as `pr-M4-1-phone-skeleton-rebased` after a rebase onto parallel work); squash commit on main `e495c53`.
- Done: `apps/phone` workspace (Expo SDK 56.0.x, React Native 0.85.3, React 19.2.3, React Navigation native stack with `Home` and `Settings` placeholders, safe-area provider), design tokens in `packages/shared/src/tokens.ts` (05 section 1.1 dark palette, light theme with the `#15803D` accent, fonts, touch targets), `scripts/phone-release-build.sh` (Node 22.22 check, JDK 17, `expo prebuild` + `gradlew assembleRelease`), jest-expo + React Native Testing Library set up. `npm run verify` now also runs `typecheck:phone` and `test:phone`; the root `tsc` excludes `apps/phone` (different `lib`/`jsx`).
- Tests: render/navigation test and a dark/light token test (jest-expo, 3 tests), token test in vitest. 129 vitest + 3 jest in total on main.
- Build: the release script produced `app-release.apk` (75 MB, debug-keystore signed, Gradle 9.3.1, JDK 17) on `coder` in about 1m45s. Nothing was run on a device (no USB from this machine).
- Decisions/deviations: React Navigation instead of expo-router (simpler to test, no file routing needed). Light-theme `card` equals `background` (05 gives no separate light card colour; no hex was invented). Root `package.json` has `overrides` pinning `hermes-parser` and `babel-plugin-syntax-hermes-parser` to 0.35.0: with 0.33.3 jest cannot parse React Native 0.85's Flow `readonly` syntax; the lockfile was regenerated for those entries only. Android package `app.milewage.phone` is a placeholder decision. Size 367 changed lines excluding the lockfile.

## PR M4.2 — [M4.2] Copy Comma's native tracker verbatim

- Branch `pr-M4-2-copy-comma-tracker`.
- Done: `apps/phone/native/comma-tracker/` is a byte-identical copy (checked with `diff -r`) of `/home/coder/Production/commaApp/modules/comma-tracker` at Comma commit `968e4c7a4447357039d9208de7a6239de90c72ad`, plus `COPIED-FROM-COMMA.md` (source path, commit, date 2026-11-04, exact file list, what was left out). Not copied: `android/.gradle/**` and `android/build/**`, build caches that Comma tracks in git by mistake. Autolinking via `expo.autolinking.nativeModulesDir = "./native"` in `apps/phone/package.json`. Prettier ignores the directory until M4.3.
- Tests: provenance test (path, 40-hex hash, date; listed files equal files present). 
- Build: `scripts/phone-release-build.sh` still succeeds with the module autolinked (`:comma-tracker` tasks ran; 75.8 MB APK, 1m30s). The merged release manifest still carries `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (from the copy) and `SYSTEM_ALERT_WINDOW` (transitive from React Native); M4.3 removes both.
- Exempt from the 400-line limit (roadmap 17 section 1).
