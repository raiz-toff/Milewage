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
