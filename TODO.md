# To-do (owner list)

Small items noticed while testing. Each becomes its own PR when picked up. Newest first.

## Open

- [ ] **Findings from the Help writers, not yet fixed** (2026-11-09; details in PROGRESS.md, DG0 to
      DG2). (a) Done 2026-11-10: the owner decided a driver may override the pack's rate, with
      dates; Settings > Mileage rate (ADR 0007). (b) The unverified notice shows on the Tax page and in the tax summary export
      only; dashboard, shift pages and the phone show deductions without it. (c) The country list
      says "United Kingdom" (CLDR via `Intl.DisplayNames`), the docs say "Great Britain". (d) Setting
      Repeats on a saved expense hides it from the list and totals; repeating expenses have no list,
      edit or stop on the web. (e) `tax_credit_cents` has no web field. (f) Analytics: "Gross" is after
      app fees, "Per hour (online time)" never shows, pay per mile is computed but never shown.
      (g) The platform colour the API accepts has no picker (also PL4b above).
- [ ] **Flaky under load: `infra/install.test.mjs`** (2026-11-09). In one full `npm run verify` on a
      busy machine, "no, --no-tailscale, not signed in, or certificates off" saw the "not signed in"
      output instead of "HTTPS Certificates"; alone it passes 12 of 12 and the files have not changed
      since H4b. Probably two cases sharing the fake host's state when vitest runs files in parallel;
      give each case its own fake-host directory.
- [ ] **Look at Help in a browser** (DG3, 2026-11-09): light and dark, 360 px wide, keyboard focus
      through the side list, a long page's anchors, Settings > Help pages off and on. No browser was
      available to the builder. Then decide on more Help links (Tax, Expenses, Backups, Settings >
      Tracking); the pages exist.
- [ ] **Try the sending module on the phone** (AR5, 2026-11-09). (1) Add a trip on the phone's
      shift detail: it must reach the web (before, every phone-added trip was parked). (2) End a
      shift with the server reachable: the home screen sends it within the round. (3) Offline: "Offline.
      Saved on your phone." then sent when back. (4) After a server restore, the banner and the
      resend of older shifts. (5) "Deduction so far" with a personal trip is lower than without.
- [ ] **Great Britain tax year** (AR4, 2026-11-09). Only the mileage rate tier follows 6 April; the
      deduction method, double-counted expenses, the tax report, exports, analytics set-aside, goals
      and the odometer year check use the calendar year. Decide whether GB figures should follow the
      6 April year everywhere (then the Tax page, exports and `expense-math.ts` change together).
- [ ] **Run `milewage-cli recalc` once after upgrading to 0.2.0** if shifts were ever created by CSV import
      (AR4): earlier imports left `calculated_at` empty, so their trips never reached the phone.
- [ ] **Try the re-pairing fixes on the phone** (AR3, 2026-11-09). (1) Revoke the phone on the web,
      pair again with a new QR code: every queued shift (create and end, not only points) should be
      sent within a minute. (2) The same with a link code on the home Wi-Fi. (3) Scan the QR with the
      camera app, open the page, "Open in the MileWage app": Settings should show both addresses.
      (4) After the "different MileWage server" banner, re-pair to the new server: sending should
      resume without a restart.
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
- [ ] Badge colour picker for platforms; the API already accepts a colour (PL4b).
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
- [ ] **Places and the MileIQ import: owner checks** (2026-11-10). (1) The MileIQ layout was read
      from a third-party reader and template, not from MileIQ itself; import one real report and
      check the preview (header names, the KM column of a kilometre account, the day order of a
      Canadian or British report, 12-hour times). (2) Look at Places on a phone browser and drag
      the marker on a touch screen. (3) Unclassified MileIQ drives default to personal; say if
      "Leave out" should be the default.
- [ ] When the app is on Google Play: set `MILEWAGE_APP_STORE_URL` and replace the plain "Get it
      on Google Play" button with Google's official badge file (A2).
- [ ] A public install-guide URL for the phone's "Set up your server" screen (currently hidden;
      PO1/X2).
- [ ] **OS notifications on the phone need a backend** (N1, 2026-11-08). `expo-notifications` was
      installed, inspected and removed: it always brings Firebase Cloud Messaging and Google's
      datatransport logging, which the Q1 decision (plan 24 section 6) ruled out for the camera. The
      port, the unsynced-data reminder logic and the tests are in place; nothing fires on a device
      until the owner picks: (a) accept Firebase, (b) a small local Expo module on
      `NotificationManagerCompat` plus an inexact `AlarmManager` alarm (recommended, same route as
      the ZXing scanner), or (c) exclude Firebase in Gradle (unsupported by Expo).

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
  by hand, and `MILEWAGE_VERSION_CODE` must be raised for every build uploaded (v0.1.0 is 1);
  Renovate groups Expo and React Native minors with everything else.
- N1 phone: the unsynced-data reminder has no on/off switch yet (plan 15 section 13 names one).
