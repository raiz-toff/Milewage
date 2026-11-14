# MileWage privacy policy

_Last updated: 2026-11-13. Applies to the MileWage Android app (`app.milewage.phone`) and the
MileWage server software._

MileWage is self-hosted software. The phone app talks only to a MileWage server that you (or
the person who set it up for you) run on your own machine. The developer of MileWage runs no
service, has no account for you and receives none of your data.

## What the phone app records

- **Location.** GPS is used only while a shift is running, from Start shift to End shift. Outside
  a shift the app records no location. During a shift it records your position at short
  intervals while you move, and checks less often while you stand still, to save battery.
  "Location all the time" lets a shift keep recording with the screen off or another app in
  front.
- **Your shifts.** Times, distances, trips, stops, a simplified route line, the vehicle and
  odometer readings, kept on the phone so its screens work without a connection.
- **A device token** your server gives the phone when you pair it, stored encrypted with a key
  from the Android Keystore.
- **Diagnostics**: counts, timings, versions, the phone's make and model, states and error codes.
  They never contain positions, addresses, amounts, notes, server addresses or tokens.
- **Settings** you choose on the phone, such as the theme and colour.

## Where it goes

- Shifts, positions and diagnostics are sent **only to the MileWage server this phone is paired
  with**, chosen by you when you scan its pairing code. Nothing is sent to the developer or to
  any other company.
- The connection is HTTPS, except on your own home network, where the app also accepts a plain
  `http://` address of your own server on the local network.
- The app contains no ads, no analytics and no crash-reporting service, and does not sell or
  share data.
- Android's location service (Google Play services on most phones) works out the position. What
  Google collects through it depends on your phone's location settings, not on MileWage. If you
  installed MileWage from Google Play, Google knows you installed it and delivers updates under
  its own terms.

## How long it is kept

- On the phone, raw positions are deleted 14 days after your server confirms it has them. A
  position the server has not confirmed is never deleted. Your shift list stays until you clear
  the app's data or uninstall it.
- On your server, retention is set by its owner (Settings, Tracking and privacy): raw positions
  for 90 days by default, then a simplified route line.
- The app's data is excluded from Android backups and phone transfers.

## Permissions

- **Location, including all the time**: recording a shift, as above.
- **Notifications**: the notice shown while a shift is recording.
- **Camera**: only to scan your server's pairing code. No photo is kept.
- **Network access**: to reach your own server.
- **Start at boot**: to resume a shift that was running when the phone restarted.

## Deleting your data

- On the phone: Android Settings, Apps, MileWage, Storage, Clear storage, or uninstall the app.
  Shifts not yet sent to your server are then lost.
- On your server: its owner deletes it there; the server's own Privacy page (`/privacy`) says how.
- In the app, Settings, Connect to a different server stops sending to the current one.

## Children

MileWage is made for adults who drive for work. It is not directed at children.

## Contact

MileWage is open source: <https://github.com/raiz-toff/Milewage>. Questions about this policy:
open an issue there. Questions about the data on a particular server go to the person who runs
that server.
