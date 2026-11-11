---
summary: What to do when the server does not answer, shifts stay on the phone, the phone stops recording, totals differ, the map is blank or the server has moved.
group: problems
order: 10
---

# Troubleshooting

## "MileWage is not answering"

The web app shows this when it cannot reach your server. Usually the server machine is off, Tailscale is off on this computer, or you opened the home address away from home. Fix that, then choose "Try again". If it still fails, check on the server machine that the two containers run and read the API log, as the install guide shows in [Where things live](../../infra/docs/install.md#5-where-things-live).

## "You are offline"

This device has no network. Your data is safe on your server, and the web app tries again by itself when the connection comes back. Reconnect, or choose "Try again". The phone app keeps recording shifts offline.

## Tailscale is off or signed out on the phone

Away from your home Wi-Fi, the phone reaches your server only through Tailscale. When it cannot, the phone's home screen says "Offline. Saved on your phone." To see why, open Settings on the phone and tap Check next to the server. If it says "Tailscale is off on this phone. Open Tailscale, connect, then try again.", tap "Open Tailscale" and connect.

If Tailscale is on and the server still does not answer, the phone and the server may be signed in to different Tailscale accounts, or Tailscale is off on the server. Sign both in to the same account, as the install guide says in [section 3](../../infra/docs/install.md#3-reach-it-from-the-phone-tailscale-on-the-host).

If the phone was paired with a home address only, its Settings show "Away" as "Not set up. Shifts are sent when the phone is on your home Wi-Fi." Its shifts are sent when you are back. To send them from anywhere, set up Tailscale on the server, then pair the phone again so it learns the away address. See [Phones and devices](phones-and-devices.md#home-and-away-addresses).

## Shifts are on phone only

The phone's home screen counts what is not on the server yet: "Not yet on server", with the number of shifts and points and the age of the oldest. The phone sends them by itself as soon as it reaches your server, and keeps trying every minute or less. "Send now" sends at once. After 3 days the phone also shows a notification, "Shifts only on this phone", once a day, with stronger words after 7 days. To stop it, turn off its Reminders channel in the phone's notification settings for MileWage.

If it says "Some items could not be sent", tap "Open shifts" and open that shift to see why. If it says "This phone was removed from your server", the phone was revoked: tap "Pair this phone" and pair it again as [Phones and devices](phones-and-devices.md#pair-a-phone-again) says. Do not clear the app's storage meanwhile: see [If your phone is lost](if-your-phone-is-lost.md).

## The phone stopped recording

Phone makers stop apps in the background to save battery, and a stopped app records nothing. If the phone could not keep recording, it shows a notification: "Your shift is not recording. Open MileWage to keep recording it." Open MileWage: recording starts again. The shift's checks then say "Tracking stopped or restarted on the phone."

If Home says "This shift is not recording", tap "Resume recording". If you stopped working a while ago, tap "End it at its last point" instead: the shift ends at the last place the phone recorded, not now.

To stop it happening again, open Settings > Permissions on the phone: location "Allow all the time", notifications, and battery use without limits. Some makers have their own battery setting as well; the permissions screen says where, and [dontkillmyapp.com](https://dontkillmyapp.com) lists the steps for each make.

After a restart the phone carries on recording a running shift by itself, if location is allowed all the time. Without it, it shows the same notification, and opening MileWage resumes the shift.

## The phone does not ask to start a shift

The question "You seem to be driving." comes only when Settings > "Ask to start a shift when I seem to be driving" is on, location is allowed all the time and no shift is running. A car is noticed within about a minute, a bicycle or scooter within about 4 minutes; walking never asks. After "Not now" the phone does not ask again during that drive or for an hour after it. If Settings says "The drive prompt needs location all the time", fix it in Settings > Permissions.

## The phone and the server totals differ

The phone and the server each work out a shift's total. If they disagree, the shift's Checks on the web say "The phone and the server worked out different totals." On the phone the shift is marked "On server (total differs)" and shows both numbers. Neither is overwritten. The web app, the exports and the tax figures use the server's total.

The usual reasons are points that reached the server late, a different engine version, or edits on the web. Open MileWage on the phone while it has a connection, so it sends anything it still holds. If the totals still differ, nothing is broken: compare them with [How miles are counted](how-miles-are-counted.md#why-the-phone-and-the-server-agree) in mind.

## The map is blank

The web app's maps are drawn on map tiles from OpenFreeMap, which your browser fetches over the internet. When they cannot load, the map shows a plain background with the route and says "Basemap unavailable; showing the route only." Your miles are not affected. Check this device's internet connection and reload the page.

If the page says "The map could not start in this browser", the timeline beside it lists the same trips and stops. Try another browser for the map.

The phone app always draws routes on a plain background, so it needs no tiles.

## You forgot your password

Use your recovery key. On the sign-in page choose "Forgot your password?", paste the recovery key you saved at setup (it starts with `AGE-SECRET-KEY-1`) and type a new password. You are signed in at once. Every other browser is signed out. Paired phones keep working, and your data and recovery key do not change. After 5 wrong keys, wait 15 minutes.

There is no "forgot password" email: there is no MileWage cloud to send one.

**Lost the recovery key too?** Whoever runs the server makes a new password on the server machine. Stop the server, run the reset command, then start it again:

```bash
docker compose -f infra/docker/docker-compose.yml stop api
docker compose -f infra/docker/docker-compose.yml run --rm --no-deps api milewage-cli reset-password
docker compose -f infra/docker/docker-compose.yml up -d --wait api
```

It prints a new random password once. Sign in with it, then choose your own in Settings > Account and security. Every browser is signed out. Paired phones keep working, and your data and recovery key do not change.

## "A new version of MileWage is ready"

After your server is upgraded, the web app fetches the new version in the background. Choose "Reload" to switch to it. "Later" hides the offer until your next visit. This works only when the web app is open at an https address, such as your Tailscale address. At a plain http address, reload the page yourself after an upgrade.

The phone app is updated separately. After a server upgrade, install the matching phone app, as the install guide says in [The phone app from your own server](../../infra/docs/install.md#3a-the-phone-app-from-your-own-server).

## The server moved

**A new address on your home network**, for example after the router gave the server machine a new one. On your Wi-Fi, when the old home address stops answering, the phone looks for your server, at most once every 10 minutes. If your server announces itself at a new address, the phone switches to it by itself. Then give the server a fixed address on your router and run `infra/install.sh --lan` again, so new pairing codes carry the right home address. See [Home network access](../../infra/docs/install.md#2a-home-network-access-optional-recommended-for-a-home-server).

**A new machine.** Restore your latest backup onto it, as [Backups and the recovery key](backups-and-recovery-key.md#restore-onto-a-new-server) says. A restored server is still the same server to your phones. If its Tailscale address changed, pair each phone again.

If you set up the new machine without restoring, the phone stops and says "This address now points to a different MileWage server than the one this phone was paired with. Nothing was sent." Restore your backup onto the new server first. Or pair the phone with the new server: in the phone's Settings, "Connect to a different server", then pair it again.
