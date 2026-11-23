---
summary: What the Health page checks, what it cannot see, how MileWage looks for a new version once a day, and how you upgrade (by one command, never from the app).
group: problems
order: 15
---

# Health and updates

## The Health page

Settings > Health lists what your server can check about itself, one row each, with a status in words (OK, Warning or Problem), what was found and what to do about it.

- **Database**: SQLite's quick integrity check of the database file. A Problem here means the file is damaged. Stop making changes and restore the newest backup ([Backups and the recovery key](backups-and-recovery-key.md)).
- **Backups**: the age of the newest backup that passed its own check. A Warning after 36 hours, a Problem when there is none.
- **Free disk space**: on the volume that holds your data. A Warning under 2 GB, a Problem under 500 MB. Below 200 MB the server refuses new data.
- **Clock**: this browser's clock against the server's. A Warning when they differ by more than 2 minutes. Shift times come from the server's clock.
- **Version**: the version your server runs.
- **Update check**: whether the last look for a new version worked.

A small dot on Settings in the sidebar means one of these is a Warning or a Problem. It goes when they are all OK.

### What the page cannot see

MileWage runs in a container. It cannot see the computer around it: Docker itself, the ports, Tailscale, the home address. The Health page does not guess at them. Run `infra/doctor.sh` in the MileWage folder on the server computer: it prints one line for each and the next step. See [Troubleshooting](troubleshooting.md).

## Looking for a new version

Once a day your server asks GitHub's public list of MileWage releases for the newest version number. It sends nothing about you, your shifts or your server; GitHub sees the server's internet address, as with any request. The check never installs anything.

- **Switch it off** in Settings > Updates. It is on by default. Off, the server makes no daily request.
- **Check now** on the Health page asks at once, even while the daily check is off, because you pressed it.
- **A failed check is quiet.** Nothing interrupts you; the Health page's Update check row shows a Warning with the reason to try again later.

When a newer version exists, a banner says "Version X is available". **What's new** opens that version's release page on GitHub in a new tab. **Dismiss** hides the banner for that version on this browser; a still newer version shows it again. If the check is off or GitHub cannot be reached, there is no banner, and [What's new](../../CHANGELOG.md) shows the changelog of the version you run.

## Upgrading

MileWage cannot upgrade itself, and it has no access to Docker or to the server computer, on purpose. Upgrading is one command, run by you in the MileWage folder on the server computer:

```bash
./infra/upgrade.sh
```

The banner shows it with a Copy button. The script checks that you have a recent backup, copies it aside, pulls the new version, rebuilds, waits until the server is healthy and says which version notes to read. See [`infra/docs/upgrade.md`](../../infra/docs/upgrade.md). The phone app is updated separately, from where you installed it.
