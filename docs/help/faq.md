---
summary: Battery, privacy, countries, backups and more.
group: reference
order: 20
---

# Questions and answers

## How much battery does it use?

The target is under 3.5 percent per hour of tracking. It has not been measured on a real phone yet, so treat that as a goal, not a result. While you are stopped for more than 2½ minutes, the phone checks your position once a minute instead of every 5 seconds.

## Does it track me when I am off shift?

No. Nothing records until you start a shift, and it stops when you end it.

## Who can see my data?

Only you, on your own server. There is no MileWage cloud. A few things do leave your setup:

- **Map tiles.** When a map is shown, your browser loads tiles from OpenFreeMap. OpenFreeMap can see which area you looked at. It does not get your shifts.
- **Tailscale.** It carries the traffic between your phone and your server, except on your home Wi-Fi when LAN access is on.

Your server also serves a Privacy page at `/privacy`. Open it from the account menu at the foot of the web app's sidebar.

## Which countries work?

Canada, the United States and Great Britain have country packs, and they are the only countries you can choose today. All of their rates are unverified. Only Canada has a tax estimate. You can use your own mileage rate instead of the country's from a date you choose, in Settings > Mileage rate. See [Mileage rates and tax](mileage-rates-and-tax.md).

## Can I use it without Tailscale?

At home, yes, once LAN access is on ([`infra/docs/install.md`](../../infra/docs/install.md), section 2a). On your home Wi-Fi the phone can reach the server over plain http at its home address. Away from home it needs an https address, and the release app refuses plain http there. Tailscale gives your home server a safe https address without opening anything on your router.

To pair the phone, scan the QR code from the web's Devices page. On the home Wi-Fi the app can also find the server by itself and ask for the link code shown there instead.

## Can I run it on a Raspberry Pi?

That is the aim. Each release builds the server images for arm64 as well as amd64, but they have not been tested on a Raspberry Pi or any ARM host yet.

## Does it work on an iPhone?

Not yet. The phone app is Android only, for Android 8.0 or later. An iPhone app is planned.

## Does it need Google services on the phone?

No. The phone app uses the phone's own location service and reads QR codes itself. Phones without Google services, such as LineageOS or GrapheneOS, work. It has not yet been tried on one.

## How do I update?

Follow [`infra/docs/upgrade.md`](../../infra/docs/upgrade.md). Take a backup first. The server takes its own backup before changing the database, and it stays read-only if an upgrade fails.

## Are my data backed up?

Yes. The server makes an encrypted backup every night and after a shift ends. You can download a copy from the Backups page. Keep a copy on another machine, because a backup on the same disk is not a safe backup.

## What if I forget the recovery key?

Then the backups locked with it cannot be read, by you or by anyone else. The server never stores the key. The data on the running server is not affected. You can make a new key on the Backups page; it protects the backups made from then on. See [If you lose your recovery key](if-you-lose-your-recovery-key.md).

## Can several drivers share one server?

No. There is one owner account. Each driver should run their own server.

## Is the active and deadhead split exact?

No. It is an estimate and is labelled that way. Your total miles do not depend on it. See [Active and deadhead miles](active-and-deadhead.md).

## Where is the source code, and what is the licence?

The code is public on GitHub at [raiz-toff/Milewage](https://github.com/raiz-toff/Milewage). It is free software under the GNU Affero General Public License, version 3 only (AGPL-3.0-only). See [`LICENSE`](../../LICENSE).
