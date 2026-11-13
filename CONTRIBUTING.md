# Contributing

This is a one-person project, and pull requests are welcome. Open an issue first for anything larger than a fix, so the work is not done twice.

- Branch from `main`. A pull request needs the `verify` check green; the template asks what changed, how it was checked and what the owner should confirm.
- Commits on `main` are squashed, titled `[ID] Area: what changed`, as the log in [`PROGRESS.md`](PROGRESS.md) shows.
- Before UI work, read the [design skill](.claude/skills/milewage-design/SKILL.md). Driver-facing text follows its voice: short sentences, plain words, every problem message with one way forward.
- Dependency security updates arrive through Dependabot. `renovate.json` asks for one weekly pull request with the minor and patch updates, but it runs only when a Renovate bot is pointed at the project; nothing happens until then.

How to run, check and release the code is in [`docs/development.md`](docs/development.md). Vulnerabilities go through [`SECURITY.md`](SECURITY.md), not a public issue.
