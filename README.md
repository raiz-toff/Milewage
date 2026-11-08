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
