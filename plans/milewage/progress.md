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
