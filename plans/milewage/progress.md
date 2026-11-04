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
