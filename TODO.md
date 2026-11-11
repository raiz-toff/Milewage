# To-do (owner list)

Small items noticed while testing. Each becomes its own PR when picked up. Newest first.

## Open

- [ ] **Field test of the native Android app** (owner, on a real phone; 2026-11-10). Nothing in
      `apps/android` has run on a phone yet. Build with `scripts/phone-release-build.sh`, then in
      this order:
  - [ ] Before installing, open the old Expo app, let it send everything and end any shift.
        Install the new APK over it: it installs (same id and key) and starts empty. Pair it again;
        revoke the old entry on the Devices page.
  - [ ] First run on the home Wi-Fi: the server appears under "On this Wi-Fi", the 6-digit code
        links it from the Devices page. Then unpair (Settings > "Connect to a different server")
        and pair with the QR scanner (try the torch), and once with "Paste the code".
  - [ ] Scan the QR with the phone's camera app, open the page, "Open in the MileWage app":
        "Connect to this server?", and Settings shows both addresses.
  - [ ] The permissions screen: each row's button opens the right system page, "Allow all the
        time" comes back as Allowed, the battery list, Next leads to "You're ready". Skip one:
        Home's checklist shows it.
  - [ ] A shift in a car: 5 km with stops. The notification distance grows and is close to the
        final total; the odometer prompt at the start when due; End shift with the confirm; the end
        reading. The shift reaches the web within the send round.
  - [ ] A shift on a bicycle or scooter: 20 minutes with traffic lights.
  - [ ] A 3-minute stop and a 30-minute stop: the stops show; the drive away is recorded from its
        start (no long straight line out of the stop; note how fast it woke). "Still on shift?"
        comes once in the 30-minute stop: try Keep going, and End shift on a second one.
  - [ ] A tunnel or underground car park: recording carries on after it, a straight line through.
  - [ ] Kill the app mid-shift (swipe from recents; then force stop from Settings): recording
        resumes after the swipe; after a force stop, opening the app resumes it.
  - [ ] Reboot mid-shift: recording resumes after unlock without opening the app.
  - [ ] Location switch off for a minute mid-shift, then on: recording resumes.
  - [ ] A shift in airplane mode, then reconnect: "Offline. Saved on your phone.", then sent.
        Add a trip on the phone's shift detail: it reaches the web. "Deduction so far" with a
        personal trip is lower than without.
  - [ ] Revoke the phone on the web: "This phone was removed from your server." and "Pair this
        phone"; pair again: every queued shift is sent within a minute. After a server restore:
        the banner and the resend of older shifts.
  - [ ] Settings > Diagnostics shows "Mileage maths check: Passed".
  - [ ] Battery: the share used over a long shift.
  - [ ] A phone without Google services (LineageOS without microG, or GrapheneOS), if one is at
        hand: pairing, a car shift, a stop, a reboot.
  - [ ] Compare the phone's total for each test shift with the server's: they match, or the shift
        says why not.
- [ ] **Owner decisions left open by the native app and the openmiles features** (2026-11-10).
      (1) Joining two trips: a new engine edit kind, engine version 5 (item below). (2) A
      device-scoped endpoint so the phone can add parking and tolls and read your own rates
      (`POST /expenses` and `GET /own-mileage-rates` are web-session only). (3) Country mileage
      rates on the phone: its estimate for unsent shifts still takes the rate from `GET /settings`.
      (4) Does a server on ARM (Raspberry Pi) give the same bits? Run the two `vite-node` steps of
      `npm run crosscheck:engine` on the Pi and the Gradle check here
      (`apps/android/engine/README.md`). (5) Font coverage of the PDF (Roboto: Latin, Greek,
      Cyrillic, Vietnamese) for names in other scripts, such as Arabic, Hindi or Chinese. (6) Remove the `brotli` decoder from the server bundle
      (1.36 MB; item (6) below). (7) The warm cream surface tint of the Material scheme: keep it or
      go neutral. (8) The GB tax year (item below, still open). (9) Kotlin Multiplatform and the
      iPhone app: when to start.
- [ ] **Findings from the Help writers, not yet fixed** (2026-11-09; details in PROGRESS.md, DG0 to
      DG2). (a) Done 2026-11-10: the owner decided a driver may override the pack's rate, with
      dates; Settings > Mileage rate (ADR 0007). (b) The unverified notice shows on the Tax page and in the tax summary export
      only; dashboard, shift pages and the phone show deductions without it. (c) The country list
      says "United Kingdom" (CLDR via `Intl.DisplayNames`), the docs say "Great Britain". (d) Setting
      Repeats on a saved expense hides it from the list and totals; repeating expenses have no list,
      edit or stop on the web. (e) `tax_credit_cents` has no web field. (f) Done 2026-11-10: Analytics says
      "Earned, after app fees", shows online-time pay only when recorded, and shows pay per mile or km.
      (g) Done 2026-11-10: the platform badge colour picker (PL4b).
- [ ] **Flaky under load: `infra/install.test.mjs`** (2026-11-09). In one full `npm run verify` on a
      busy machine, "no, --no-tailscale, not signed in, or certificates off" saw the "not signed in"
      output instead of "HTTPS Certificates"; alone it passes 12 of 12 and the files have not changed
      since H4b. Probably two cases sharing the fake host's state when vitest runs files in parallel;
      give each case its own fake-host directory.
- [x] **Look at Help in a browser** (DG3, 2026-11-09). Done 2026-11-11 in headless Chromium: every
      page at 1280 and 360 px (a title, no sideways scroll, every anchor and cross-page link lands),
      light and dark, the page menu at 360 px, Tab through the side list with a focus ring on each
      link, an unknown page, and Settings > Help pages off (Help leaves the menu and its address
      opens the Dashboard) and on. One fix came out of it: the app shell had a `<main>` inside a
      `<main>`. Not checked: a real phone browser and a screen reader.
- [ ] **More Help links: owner to decide** (DG3). Tax, Expenses, Backups and Settings > Tracking
      have guides but no link to them from their pages.
- [ ] **Great Britain tax year** (AR4, 2026-11-09). Only the mileage rate tier follows 6 April; the
      deduction method, double-counted expenses, the tax report, exports, analytics set-aside, goals
      and the odometer year check use the calendar year. Decide whether GB figures should follow the
      6 April year everywhere (then the Tax page, exports and `expense-math.ts` change together).
- [ ] **Run `milewage-cli recalc` once after upgrading to 0.2.0** if shifts were ever created by CSV import
      (AR4): earlier imports left `calculated_at` empty, so their trips never reached the phone.
- [ ] **Make Node 22.22 the default on `coder`** (owner, 2026-11-08). `node --version` is v24.15.0;
      `.nvmrc` says 22.22.0. Verify runs use Node 22 only because `~/.local/node22/bin` is put first
      on `PATH`; a shell without it runs Node 24. Install 22.22 as the default (nvm is not
      installed), or put `~/.local/node22/bin` first on `PATH` in the shell profile.
- [ ] **Run spikes A, B and D, or record that the field test replaces them** (owner, 2026-11-08).
      Only S0 has run; E is optional. Status table in
      plan 12 section 2, "Spike status (2026-11-08)".
- [ ] **Time zone picker with every time zone** (owner, 2026-11-07). Setup and Settings show a
      plain text field ("America/Toronto"). Make it a searchable list of all IANA time zones
      (`Intl.supportedValuesOf('timeZone')`, the standard list browsers and Node ship), shadcn
      Combobox style, default to the browser's zone
      (`Intl.DateTimeFormat().resolvedOptions().timeZone`), the zones of the chosen country first,
      and the current UTC offset shown next to each name. Server keeps validating the name.
- [x] Badge colour picker for platforms; the API already accepts a colour (PL4b).
- [ ] Shifts list cannot show platform badges: the shifts API has no platforms per shift (PL2).
- [x] Edit and delete a hand-made trip on the web (W2i). Done 2026-11-10: the "..." menu of a
      manual trip in a shift's timeline. Joining trips is not built: it needs a new engine edit kind
      (see the next item).
- [ ] **Joining two trips: owner to decide** (2026-11-10). No existing trip edit can join two
      engine trips: an edit changes only a trip's kind or purpose, and trips are cut where a stop
      changes the split, so the only lever (labelling the stop between them "Other") re-estimates
      every later stop. A real join is a new engine edit kind: `TripEdit` gains a join (the two
      trip keys), stage 7 merges the two drafts before keys are made, the digest's canonical text
      gets a new line, the Kotlin port in `apps/android` does the same bit for bit, the algorithm
      version goes to 5 with new golden ledgers and phone conformance fixtures, the server stores
      the join with the overrides and sends it in the change feed. Joining two manual trips is
      plain data; today it is "edit one to the total, delete the other".
- [ ] When the app is on Google Play: set `MILEWAGE_APP_STORE_URL` and replace the plain "Get it
      on Google Play" button with Google's official badge file (A2).
- [ ] A public install-guide URL for the phone's "Set up your server" screen (currently hidden;
      PO1/X2).
- [ ] **Your rate, the PDF report, parking and tolls: owner checks** (2026-11-10). (1) Your rate
      is one flat amount for cars, vans and motorcycles together, with no tier and no tax year of
      its own (ADR 0007); say if a per-vehicle rate is wanted. (2) Parking and Tolls stay
      deductible in full and outside what the mileage rate covers; no pack says so and nobody has
      checked it against the IRS (Publication 463), CRA or HMRC pages. (3) The PDF's default period
      is the calendar year, like the tax summary (the GB year question above decides it too).
      (4) The phone's estimate for shifts not yet sent still prefers the pack's rate where one
      exists; the native app should follow `rateSourceAt` and read `GET /own-mileage-rates` (a
      web-session route today: a device-scoped read is needed). (5) Adding parking or a toll from
      the phone needs a device-scoped endpoint: `POST /expenses` is web-session only. (6) The PDF
      library added 2.7 MB to `dist/server.mjs`, 1.36 MB of it the `brotli` decoder fontkit
      imports for WOFF2 fonts, which the report never uses; an esbuild alias in
      `scripts/build-server.mjs` could drop it. (7) Look at the PDF in a real viewer and print one.

## Owner to confirm

Decisions builders made and wrote as "Assumption (owner to confirm)" in `progress.md`. The main
ones: existing vehicles count as owned; "earnings" means after app fees; Nova Scotia HST 14 % vs
15 %; the dashboard opens on Week. (The own mileage rate now has dates: ADR 0007.)

Added 2026-11-08 by the integration pass (details in `progress.md` under each PR):

- R1 `milewage-cli restore`: the old data is parked at `<data>/before-restore-<time>/` inside the
  `data` volume (not beside it), kept until the owner deletes it; no extra `pre-restore/` backup is
  written; `diagnostics.db` is left in place.
- F1 money: every stored amount is read as integer minor units of `settings.currency`, so a stored
  JPY `1250` shows as ¥1,250 (the old display divided by 100 regardless of currency). Schedule's
  time field offers 5-minute steps.
- S1 privacy page: `/privacy` on the owner's own address is the Google Play privacy-policy URL and
  names no developer contact; HSTS is one year without `includeSubDomains`; the page suggests
  `tailscale serve reset`, which clears every serve setting on that machine.
- C1 releases: tags are `v<VERSION>`; GitHub Actions builds the images on the tag; the APK is built
  by hand, and `MILEWAGE_VERSION_CODE` must be raised for every build uploaded (v0.1.0 is 1,
  v0.2.0 is 2; the native app's default is 3); Renovate puts the Android Gradle updates in a pull
  request of their own.
- N1 phone: the unsynced-data reminder has no switch in the app; the native app posts it on its own
  Reminders channel, which the driver can turn off in Android's settings, and the web's "on the
  phone" switches do not reach it yet.
