---
summary: What can and cannot be recovered, and how to make a new key.
group: problems
order: 30
---

# If you lose your recovery key

## What the key does

The recovery key is the `AGE-SECRET-KEY-1...` line the server showed you once, at setup. Every backup is locked with it. The server keeps only its public half. That half can lock new backups but cannot open any. So nobody can show you the key again: not MileWage, not the server.

The key is only for backups. Your server keeps working without it. Shifts, trips, exports and the web app do not need it.

## What cannot be recovered

- The old key. It was never stored, so there is no reset.
- Backups locked with the old key, if you do not have that key. Nobody can open them, you included. This also goes for copies you downloaded or synced to another machine.

## What to do

1. Open the web app on a computer.
2. Go to the Backups page.
3. Under "Lost your recovery key?", choose "Make a new recovery key".
4. Enter your password.
5. Save the new key in a password manager or on paper. It is shown once.
6. Type its last 6 characters and choose "I saved it".

From then on every new backup uses the new key. The server makes one backup with it straight away, so you have at least one you can open.

Until you type the last 6 characters, nothing changes and backups keep the old key. If you close the window before that, start again. A key you never confirmed is never used.

Then download that new backup from the Backups page and keep it on another machine.

## Your older backups

Backups made before the change are not locked again with the new key. They still need the old key. If you find the old key later, it still opens them.

They stay on the server until they get too old. The server keeps the last 7 days, 4 Sundays and 12 first days of the month, so the last old one is gone after about a year. A backup made earlier on the same day as the change is replaced by the new one.

## If someone else may have the key

Make a new key the same way. New backups are then safe from the old key. A new key cannot change files that already left the server: anyone with the old key and a copy of an old backup can still read that copy. Once you have downloaded a backup with the new key, delete the older copies you keep elsewhere.
