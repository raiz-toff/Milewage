# Branch protection (GitLab)

Settings to apply on the `main` branch once the self-hosted GitLab project and a runner exist (roadmap 17 T12):

1. Settings, Repository, Protected branches: `main` allowed to merge: Maintainers; allowed to push: No one.
2. Settings, Merge requests: merge method "Merge commit with semi-linear history" is not used; enable **Squash commits** set to "Require".
3. Settings, Merge requests: **Pipelines must succeed** (the pipeline runs `npm run verify`).
4. Settings, Merge requests: all threads must be resolved; delete source branch after merge.
5. Branch and MR title convention: `m<M>.<n>-short-name` / `[M<M>.<n>] what` (17 T15).

Each PR is at most 400 changed lines (excluding lockfiles, generated files, fixture data) and must keep `npm run verify` green.
