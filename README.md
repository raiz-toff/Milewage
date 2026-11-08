<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/coin-thin/lockup-reverse.svg" />
    <img src="branding/coin-thin/lockup.svg" alt="MileWage" height="72" />
  </picture>
</p>

# MileWage

Self-hosted mileage tracking for gig riders and drivers. All planning documents are in [`plans/milewage/`](plans/milewage/README.md); the build order is [`17-gate4-execution-roadmap.md`](plans/milewage/17-gate4-execution-roadmap.md).

Requires Node 22.22.x (see `.nvmrc`). Run `npm install`, then `npm run verify` (typecheck + lint + tests).

Running it: [`infra/docs/install.md`](infra/docs/install.md) (home lab with Tailscale, `infra/install.sh`) and [`infra/docs/upgrade.md`](infra/docs/upgrade.md) (upgrade, failure and rollback).

Documentation: [guides for drivers](docs/README.md), [`CHANGELOG.md`](CHANGELOG.md), [`SECURITY.md`](SECURITY.md) and the index of owner decisions, [`DECISIONS.md`](DECISIONS.md).

Releases: the phone app is signed with an upload key made once by `scripts/phone-keystore.sh` (kept in `~/.milewage`, never in git; back it up). CI (`.gitlab-ci.yml`) verifies every merge request and, on a `v*` tag, builds the server and Caddy images for amd64 and arm64 (`infra/docker/docker-compose.release.yml` runs them). It needs a GitLab runner, which is not registered yet.

Dependency updates: `renovate.json` asks for one weekly pull request with the minor and patch updates and for Docker images pinned by digest. It runs only when a Renovate bot (self-hosted, or the Mend Renovate app) is pointed at the project; nothing happens until then.
