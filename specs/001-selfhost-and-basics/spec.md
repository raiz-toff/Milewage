# Spec 001: self-host without cleverness, and the basics a driver expects

Status: in progress. Sources: three read-only audits (install journey, missing basics, public self-host reports), 2026-11-22.

## Principle

Fewer things, each one finished. Every item kept has its whole path done: the action, a confirm where it destroys, an error that says what to do, a test and the doc line. Anything that cannot be finished properly is cut and written under "Cut".

## Track A: manage your own records (apps/server, apps/web)

Evidence: the server has `DELETE /shifts/:ref` but the web never calls it; destructive actions in Expenses, Odometer, Platforms, Devices, Tax and Mileage rates run with no confirm.

- A1 One shared confirm dialog (built on `components/ui/dialog.tsx`), used by every destructive action in the web. Says what is lost; the shift dialog says that miles and money for it go too.
- A2 Delete a shift from its page. Active shift refused with a plain reason. Under 7 years old the server needs `confirm_recent=true`: the dialog is the deliberate yes and sends it. After deleting, go to the shifts list.
- A3 A shift stuck active can be ended from the web (End now), or deleted. Shown on the shift page and on the 409 `shift_already_active` path.
- A4 Correct a shift's start and end time (the common mistake is forgetting to stop). Server PATCH accepts `started_at`/`ended_at`, recomputes through the same path as recalculation, refuses finalized and active shifts, refuses end before start. Web form on the shift page.
- A5 Change a shift's vehicle in the web (the server already accepts `vehicle_id`).
- A6 Edit an odometer reading (`PATCH /odometer/:id`, web edit), so a typo is not delete and re-add.
- A7 Download a backup from the Backups page if the server already serves it; otherwise state in the page that downloads are by CLI. No new backup features.

## Track B: install, run, upgrade, diagnose (infra, docs)

Evidence: install.sh is bash and Linux only with no stated host list; checks come late and one Docker message covers three causes; compose tags are `0.1.0` while VERSION is 0.3.1; upgrade is a manual three steps; there is no health check; the pairing code can carry `127.0.0.1`.

- B1 Compose image tags follow VERSION, with a test that fails when they drift.
- B2 `install.sh` preflight, before anything is written: supported OS (Linux, or WSL2), 64-bit CPU, docker installed, daemon reachable vs permission denied (with the `usermod` hint), compose v2, free disk, free RAM warning. Each failure says the next command to run. `sed -i` and `ip` made portable or guarded.
- B3 `install.sh` ends by printing the exact address to open on the computer, never only `127.0.0.1`, and says to open that address when pairing a phone. LAN address detection skips Docker (`172.17.x`) and VPN interfaces.
- B4 `infra/upgrade.sh`: clean tree check, backup, `git pull --ff-only`, rebuild with `--remove-orphans`, wait healthy, print the version and anything the release notes flag. Refuses to run on a dirty or diverged tree with the fix.
- B5 `infra/doctor.sh`: containers up, `/healthz`, public and home URL answer, disk, host clock vs the server's, last backup age, Tailscale serve state. Green/red lines, a final "next step", exit code non-zero on failure. Runs without secrets in its output.
- B6 Docs: one "Supported hosts" line; every `v0.1.0` and stale statement fixed; Tailscale marked optional with the 443-taken case and the exact undo; first-time APK path is the GitHub release APK only; own-server APK publishing moves under Advanced.

## Track C: the small details (server, web, phone)

From the community and open-source research plus a code audit. Only gaps the audit found are listed.

- C1 Accidental shift. A shift that ends under 2 minutes, under 0.1 mi (160 m), with no earnings, costs, expenses or manual trips is "very short". The phone's End dialog says so and offers Discard (ask first, never an undo: delete stays a hard delete) or Keep. The web shift page uses the same rule, replacing the display-only 3-minute text, and offers Delete. One shared constant per side, same numbers.
- C2 Overlap. Saving or retiming a shift that overlaps another (start before the other's end and end after its start) flags it `shift_overlap` in the existing review notice, naming the other shift with a link. End equal to the next start is not an overlap. A flag, never a refusal: the phone's synced data must not be rejected.
- C3 Stale active shift. An active shift with nothing recorded for 12 hours gets a `stale_active_shift` review flag and a web notice with End now. The server never ends it on its own.
- C4 No signal on the phone. While a shift runs at full power with no location fix for 3 minutes, the Home screen says so and what to try (location on, battery setting). Reads the existing `lastFixAt`.
- C5 Midnight. A shift counts on the day it started, everywhere. The trip CSV gets a "Shift date" column (its own Date stays the trip's real date, which a mileage log needs). The rule is said once in `docs/help/shifts-and-trips.md` and as a caption on a shift that ends the next day.
- C6 Phone sync after Wi-Fi returns (own agent): Wi-Fi arrival wakes sending with the app closed, route re-picked after a network change, no stale "offline" banner.
- C7 Health page and update banner (own agent), see the plan in the conversation.

Deferred, with reasons, in TODO.md: add a missed shift on the web, soft delete with restore, a zone stored on each shift, merge trips, an odd-`TZ` startup warning.

## Cut (decided, not forgotten)

- Username change, delete-account / wipe-all in the app: one owner per server, `docker compose down -v` is the wipe and is documented.
- CSV import: large and unproven demand. Logged in TODO.md.
- Shift merge, split, global undo: confirmation dialogs are the safety net.
- Native Windows/macOS install scripts: WSL2 is the stated path.
- User-facing `--subnet` and gateway docs: keep defaults; doctor reports conflicts.
- The "run install.sh again" loop for Tailscale: print the one command instead.
- `POST /shifts/:ref/recalculate` and `/finalize` with no web caller: kept (phone and tests use them); decision recorded, not removed here.

## Done means

`npm run verify:js` green, new tests for every server change and for the shell scripts (infra/*.test.mjs style), docs updated, CHANGELOG entry, no new warnings.
