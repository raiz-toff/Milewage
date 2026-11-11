---
summary: Pairing a phone by QR code or link code, the home and away addresses, what a paired phone can do, and revoking one.
group: using
order: 100
module: devices
---

# Phones and devices

## What pairing does

A phone must be paired with your server before it can send shifts. Pairing gives the phone a secret of its own for your server, kept in the phone's protected storage. It is not your password.

The Devices page lists every paired phone with its name, its platform, when it was last seen and its state: active or revoked. Rename one from its row menu.

## Pair with the QR code

This works from anywhere the phone can reach the server.

1. On a computer, open the Devices page and choose "Pair a phone".
2. A QR code appears. It works once, for 10 minutes. The page says until when.
3. Open MileWage on the phone, tap "I have a server", then "Scan the code". Allow the camera and point the phone at the screen. In the dark, "Turn torch on" helps.
4. The phone connects and shows "Connected".

The phone's camera app works too: it opens a page with "Open in the MileWage app", and the phone asks "Connect to this server?"; tap "Yes, connect". Or copy the text under "Show code text" and use "Paste the code" on the phone. MileWage reads the code itself, without Google services, so this works on a phone without them.

If the phone says the code is not valid, has expired or was already used, choose "Pair a phone" again for a new code.

## Link a phone on your home Wi-Fi

When your server has home network access on, the phone finds it by itself. The install guide explains it in [Home network access](../../infra/docs/install.md#2a-home-network-access-optional-recommended-for-a-home-server).

1. Put the phone on your home Wi-Fi, open MileWage and tap "I have a server".
2. Under "On this Wi-Fi", tap your server. The phone shows a 6-digit link code under "Link this phone".
3. On a computer, open the Devices page. Under "Link a phone on your Wi-Fi" the phone appears as "wants to link", with its name and address.
4. Type the code in "Code shown on the phone" and choose Link.

If the phone on the list is not yours, choose "Not my phone". A waiting phone is dropped after 10 minutes, or when the server restarts. Then tap "Get a new code" on the phone.

If the phone finds nothing, tap "Look again". If it still finds nothing, pair with the QR code instead. On Android 17 the phone first asks to let MileWage look for devices on your local network: allow it.

## Home and away addresses

A paired phone can know two addresses for your server:

| Address      | Example                                | Used                               |
| ------------ | -------------------------------------- | ---------------------------------- |
| Home address | `http://192.168.1.20:8080`             | On your home Wi-Fi                 |
| Away address | `https://milewage-box.tail1234.ts.net` | Everywhere else, through Tailscale |

The pairing code carries both when the server knows both. Under the QR code the page shows them as "At home" and "Away".

On Wi-Fi the phone first tries the home address. If your own server answers there within a second and a half, it uses it. Otherwise it uses the away address. It remembers the choice for a minute, and looks again as soon as a request gets no answer.

Plain http is allowed only for a home address: a private network address, or a name ending in `.local`, `.lan` or `.home.arpa`. Everywhere else the phone uses https only. Plain http is not encrypted on your home network, so do not turn home access on for a shared or public Wi-Fi.

If the page says "Away: not set up", the phone sends shifts only when it is back on your Wi-Fi. To send them from anywhere, set up Tailscale as the install guide says in [section 3](../../infra/docs/install.md#3-reach-it-from-the-phone-tailscale-on-the-host).

If the address in the code is wrong, choose "Change address" under the code, type the right one and choose "Make a new code". If a warning says the address only works on this computer, open the web app at its Tailscale address and pair from there.

## What a paired phone can do

A paired phone can:

- Send shifts, their GPS points, odometer readings and trip edits.
- Read the shifts and trips of the last 14 days, your vehicles and your settings.

It cannot export your data, download backups, read expenses or earnings, or change your settings or password.

## Revoke a phone

Revoke a phone you lost, sold or replaced:

1. Open the Devices page.
2. Open the phone's row menu and choose Revoke.
3. Choose "Confirm revoke".

The phone's secret stops working at once. It stays on the list, marked revoked. The phone itself says "This phone was removed from your server. Re-pair to send your saved data." Nothing on the phone is deleted.

For a lost phone, read [If your phone is lost](if-your-phone-is-lost.md) as well.

## Pair a phone again

A revoked phone says "This phone was removed from your server. Re-pair to send your saved data." with a "Pair this phone" button. A phone after "Connect to a different server" in its own Settings shows the connect screens again. Pair it with a new QR code or link code.

A phone paired again with the same server sends the shifts it was still holding. The old entry stays on the Devices page. If it still says active, revoke it, so only the phone's new pairing works.

A shift is only ever sent to the server it was recorded for. If you pair the phone with a different server, shifts not yet sent to the old one stay on the phone. Home and Settings show them as "recorded for another server", and the shifts list marks each one "Recorded for another server". You have two ways forward: "Connect to that server" to pair with the old server again, which sends them, or "Delete from this phone", which asks first and removes them for good.

## What the phone keeps

The phone keeps the shifts it has not sent yet, and the GPS points of sent shifts for up to 14 days. The details, and what is lost with the phone, are in [If your phone is lost](if-your-phone-is-lost.md#what-is-on-the-phone).

## Moving from the old phone app

Version 0.2.0 and earlier had a different phone app. The new app installs over it and keeps its place on the phone, but it starts empty: nothing is carried over from the old app.

1. Before you update, open the old app on a connection to your server and let it send everything. Its banner says when everything is on the server. Shifts it never sent are lost with the update.
2. End any running shift first.
3. Install the new app over the old one.
4. Open it and pair it again, as above. On the Devices page, revoke the old entry for this phone.

Shifts already on your server stay there. Once paired, the new app reads the last 14 days of them from your server.

## Supported phones

Android 8.0 or later. The app uses the phone's own location service and reads QR codes itself, so it needs no Google Play Services: phones without Google services, such as LineageOS or GrapheneOS, work. There is no iPhone app yet.
