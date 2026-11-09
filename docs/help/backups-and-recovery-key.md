---
summary: When your server makes backups, how to keep a copy elsewhere, how to restore one, and what the recovery key is for.
group: using
order: 90
---

# Backups and the recovery key

## What a backup is

A backup is an encrypted copy of all your records and receipt files. Your server makes one every night at 03:30, in the time zone set in Settings > Units and format. It also makes one after a shift ends, before an upgrade changes the database and before a restore.

"Back up now" on the Backups page makes one at any time. It shares a limit with the backups made after a shift: one every 15 minutes. If one was made a moment ago, wait a few minutes and try again.

Each backup is checked after it is written. A backup that fails its check is thrown away, and the older ones stay.

The server keeps the newest backup of each of the last 7 days, 4 Sundays and 12 first days of the month, and deletes older ones.

## When a backup cannot be made

A backup is skipped when the free disk space is less than twice the size of the database. The Backups page then says "Disk space is too low to make a backup. Free some space." Free space on the server machine, then choose "Back up now".

With Settings > Alerts > "Backup problems" on, the Notifications page tells you when a backup failed, or when none was made for 36 hours. Choose "Back up now" on the Backups page. If it fails again, check the disk space.

## Keep a copy somewhere else

Your backups sit on the same disk as your data. If that disk fails, both are lost. So now and then, choose Download next to the newest backup and keep the file on another computer or drive. The file stays encrypted with your recovery key.

After 30 days without a download, the page says "No copy of your backups has left this server recently." If another tool already copies your backup folder elsewhere, tick "My backup folder is copied to another place". You are asked again after 90 days.

If there is no Download link, downloads are turned off on the server. Turn `backup.download` back on as the [configuration guide](../../infra/docs/configuration.md) says.

## Restore onto a new server

A restore replaces a server's data with the contents of a backup.

**On a new, empty server.** Install MileWage there with the [install guide](../../infra/docs/install.md). Then:

1. Open the web app. On the setup screen, choose "Restore from a backup instead".
2. Choose the backup file. Its name ends in `.db.gz.age`.
3. Type the recovery key and choose Restore.
4. Check what the server found: the number of shifts, stop labels and recorded points.
5. Choose "Continue to sign in" and sign in with the account from the backup.

This works only while the server has no account. New backups there use the same recovery key. Phones that reach the new server at their old address keep their pairing and send again what they still hold ([If your phone is lost](if-your-phone-is-lost.md#after-your-server-is-restored-from-an-older-backup)). Other phones need to be paired again.

If the server says "The recovery key does not open this file, or the file is damaged", find the key that was in use when the backup was made.

**Over the data of a running server**, for example to undo an upgrade. The web app cannot do this; the `milewage-cli restore` command on the server machine can. You stop the server, run the command with the backup file, then type the recovery key and `yes`. It checks the backup first and changes nothing if the key or the file is wrong. Your current data is not deleted: it is moved into a folder named `before-restore-<time>` in the data volume. Paired phones then send again what they still hold. The exact commands are in the upgrade guide, under [Roll back to the previous version](../../infra/docs/upgrade.md#roll-back-to-the-previous-version).

## What the recovery key is for

The recovery key is the `AGE-SECRET-KEY-1...` line shown once when you created your account. Every backup is locked with it, using age encryption. The server keeps only the public half. That half can lock new backups but cannot open any, so nobody can show you the key again.

You need the key only to restore. Keep it in a password manager or on paper, away from the server.

## Make a new recovery key

On the Backups page, under "Lost your recovery key?", choose "Make a new recovery key". New backups then use the new key, and one is made straight away. Backups made before still need the old key. The steps, and what to do when the old key is lost, are in [If you lose your recovery key](if-you-lose-your-recovery-key.md).

## What an upgrade does with your data

Before an upgrade, make a backup and download it, as the [upgrade guide](../../infra/docs/upgrade.md) says. When the new version changes the database, the server first makes its own backup, then makes the change in one step.

If that backup fails, the change is not made. If the change fails, it is undone and your data stays as it was. Either way the server starts read-only, and the Backups page says "The server is read-only after a failed upgrade. Nothing can be saved." Phones keep their shifts and try again later. Follow [If the upgrade fails](../../infra/docs/upgrade.md#if-the-upgrade-fails) in the upgrade guide.
