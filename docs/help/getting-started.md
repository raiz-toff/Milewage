---
summary: From a running server to your first shift, step by step.
group: start
order: 10
---

# Getting started

From a running server to your first shift. If the server is not installed yet, follow [the install guide](../../infra/docs/install.md) first. The phone app has not yet been tried in a real shift on a real phone.

## Create the owner account

Open the web app in a browser. The first screen is "Set up MileWage". Fill in:

- a username, and a password of at least 10 characters;
- your country, distance unit, currency and time zone. Choosing a country fills in its unit and currency. The time zone starts as your browser's.

Choose Create account. To move an old server's data here, choose "Restore from a backup instead" and see [Backups and the recovery key](backups-and-recovery-key.md).

## Write down the recovery key

The next screen shows your recovery key, once. Every backup is locked with it. The server keeps only its public half, so nobody can show you the key again.

Save it in a password manager or on paper. Then type its last 6 characters and choose "I saved it". Until you do, setup is not finished. If the page reloads before that, the key is not shown again: type the last 6 characters of the key you saved.

## Answer the setup questions

Next, setup asks one question per step. You can leave and come back later.

1. Where you drive, where your country has regions.
2. Your apps: tick every platform you work for. "Another app" adds one by name.
3. Your vehicle: a name, a type and who owns it. Every shift needs a vehicle, so you cannot finish without one. See [Vehicles and the odometer](vehicles-and-odometer.md).
4. Get the app, then Pair your phone: see below.
5. Check your answers, then choose Finish.

The vehicle step names the mileage rate your vehicle gets. No rate in MileWage has yet been checked against the tax offices' own publications. See [Mileage rates and tax](mileage-rates-and-tax.md).

To go through the questions again later: Settings > Profile and region > Run setup again.

## Install the phone app

The phone app is for Android 8.0 or later. It is not on Google Play yet. It needs nothing from Google, so a phone without Google services works too. Get it in one of two ways:

- From the [latest GitHub release](https://github.com/raiz-toff/Milewage/releases/latest): the file `milewage-<version>.apk`, with the version of your server.
- From your own server, if the app file was put there ([install guide, section 3a](../../infra/docs/install.md#3a-the-phone-app-from-your-own-server)). The setup step Get the app shows a QR code for your server's download page. Scan it with the phone's camera.

The first time, Android asks to let your browser install apps. Tap Settings, turn on Allow from this source, go back, then tap Install.

## Pair the phone

Open MileWage on the phone and tap "I have a server". The screen "Connect to your server" offers two ways to pair.

**On your home Wi-Fi.** This needs home network access on the server ([install guide, section 2a](../../infra/docs/install.md#2a-home-network-access-optional-recommended-for-a-home-server)). The phone finds the server under "On this Wi-Fi". Tap it, and the phone shows a 6-digit code under "Link this phone". On the computer, the setup step Pair your phone, or the Devices page, lists the phone under "Link a phone on your Wi-Fi". Type the code and choose Link.

**With the QR code.** The setup step shows a pairing code; on the Devices page, "Pair a phone" makes one. On the phone, tap "Scan the code" and allow the camera. A code works once, for 10 minutes. Without the camera, use "Paste the code" with the code text from under the QR code.

Under the code, the page says where the phone will connect: the home address on your Wi-Fi, and the https address, normally Tailscale, everywhere else. Plain http is allowed only on the home address. With no away address, shifts wait on the phone until you are back home. If an address is wrong, choose Change address. More in [Phones and devices](phones-and-devices.md).

The phone then shows "Connected", with your country, region and vehicles. If Vehicles says "None yet", add a vehicle on the web and tap Check again.

## Allow what the phone asks

Next comes one screen, Permissions, with everything MileWage needs to record a shift with the screen off. Each row says what it is for and has its own button:

- **Location switch**: the phone's Location must be on.
- **Precise location**: choose Precise and While using the app.
- **Location all the time**: Android opens MileWage's location settings. Choose "Allow all the time" there, then come back. It lets recording start again by itself after a restart.
- **Notifications**: the shift's time and distance and the reminders.
- **Battery use**: in the list that opens, find MileWage and choose not to optimise it. Some phones have their own setting as well; the row says where.

Allow them all. When a row says "Allowed", go on to the next. Then tap Next, and on "You're ready" tap Go to home. Anything you did not allow stays on Home's checklist, "Finish setting up".

## Your first shift

On Home, choose the vehicle if you have more than one. Tap Start shift before your first pickup. About twice a month the phone first asks for an odometer reading ("Odometer check"): type the reading on your dashboard and tap "Save and start", or tap "Start without it".

The screen shows the time, the distance and the deduction so far. The distance is approximate; the server works out the final one. Recording goes on with the app closed, and starts again by itself after the phone restarts.

After your last drop, tap End shift. The phone asks "End this shift?"; tap End shift again. That shift cannot be restarted. It is sent to the server. If the server cannot be reached, the shift stays on the phone and is sent later. The phone says so.

If you gave a start reading, or a check is due, the phone then asks for the end reading. Type it and tap "Save reading", or tap Not now.

## See it on the web

On the computer, open Shifts. This week's list shows your new shift. Open it for the map, the trips, the stops and the checks. See [Shifts and trips](shifts-and-trips.md). While a shift is still running, its page says "Shift in progress".

If a step does not work, see [Troubleshooting](troubleshooting.md).
