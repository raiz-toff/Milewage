# MileWage

Self-hosted mileage and money tracking for one gig driver: a phone records each shift's GPS, and the driver's own server keeps the miles, the money and the backups. These are the words the code, the docs and the screens use for it.

## Language

### People and places

**Owner**:
The one person a MileWage server belongs to: the driver who set it up and signs in to the web app. A server has exactly one.
_Avoid_: user, admin, account

**Server**:
The owner's own MileWage installation, on a machine they control. It holds every shift and is the source of truth.
_Avoid_: instance, backend, cloud

**Platform**:
A company the driver takes orders from, such as a delivery or ride-hail app. MileWage has built-in ones and the driver can add their own.
_Avoid_: app, provider, service, client (and never the phone's operating system)

**Order**:
One job from a platform: a delivery or a ride.
_Avoid_: job, task, gig, trip (a trip is a stretch of driving)

**Work kind**:
The kind of platform work a driver does: delivery, ride-hailing, motorcycle taxi or courier.
_Avoid_: job type, work category

### Tracking

**Shift**:
One working period, from when the driver starts it on the phone to when they end it. Trips, stops, earnings and odometer readings all belong to a shift.
_Avoid_: session, trip log, run

**Running shift**:
A shift that has been started and not yet ended. Only one runs at a time.
_Avoid_: active shift (active describes miles with an order), open shift, live shift

**Finalized shift**:
A shift the driver has marked as reviewed. It can no longer be changed or recalculated.
_Avoid_: reviewed shift, locked shift, closed shift

**Fix**:
One GPS reading from the phone: a position, its time and its accuracy.
_Avoid_: point, position, telemetry point, sample, ping

**Minimum move**:
How far a fix must be from the last counted fix before the step counts: 20 metres, or the worse GPS accuracy of the two fixes when that is larger, up to 50 metres. Shorter steps are GPS drift and add nothing.
_Avoid_: jitter filter, gate threshold, min step

**Track**:
All the fixes recorded during one shift. Every distance is worked out from the track.
_Avoid_: GPS log, trace, breadcrumbs

**Route**:
The simplified line drawn through a shift's track on the map. It is for display only and never changes a distance.
_Avoid_: path, polyline, track (the track is the full set of fixes)

**Gap**:
A silence between fixes long enough to matter. It is flagged on the shift and never filled in by guessing.
_Avoid_: dropout, hole, missing segment

**Interruption**:
A period in which the phone itself stopped or restarted tracking during a shift.
_Avoid_: pause, outage

**Track engine**:
The code that turns a track into totals, trips and stops. The server runs it in TypeScript (`packages/track-engine`); the phone runs a Kotlin port that gives the same bytes. It uses whole-number maths for its results, so both get the same answer.
_Avoid_: algorithm, calculator, mileage engine

**Engine version**:
The number of the track engine release that produced a result. Results from different engine versions may differ.
_Avoid_: calc version, algorithm version

**Live distance**:
The approximate running total the phone shows while a shift runs. It is never stored; the shift's total replaces it.
_Avoid_: live total, live mileage

**Shift notification**:
The phone's ongoing notification while a shift runs, showing the live distance.
_Avoid_: pill, overlay, floating bubble

**Drive prompt**:
The phone's opt-in question "You seem to be driving. Start a shift?", asked when no shift runs and the phone seems to be driving. It never starts a shift by itself. Off unless the driver turns it on in the phone's Settings.
_Avoid_: auto-start, drive detection (in driver text), trip detection

**"Still on shift?" reminder**:
The phone's question during a shift after a long time without moving. It never ends a shift by itself.
_Avoid_: auto-stop, idle timeout

**Flag**:
A fact about a shift's data that the driver should know, such as a gap, an interruption or a phone clock that was off. A flag never changes a distance.
_Avoid_: warning, error, alert, check

### Miles

**Total miles**:
All the distance of a shift, worked out from its track, in the driver's unit (miles or kilometres). It never depends on stops or labels.
_Avoid_: gross miles, raw distance

**Business distance**:
Active miles plus deadhead miles: the distance driven for work.
_Avoid_: work miles, deductible miles

**Active miles**:
Distance driven while carrying an order.
_Avoid_: paid miles, loaded miles, engaged miles, active distance

**Deadhead miles**:
Distance driven for work without an order, such as the drive to the next pickup.
_Avoid_: empty miles, unpaid miles, dead miles

**Personal miles**:
Distance in trips the driver marked as personal, not driven for work.
_Avoid_: private miles, non-business miles

**Split**:
The division of a shift's business distance into active and deadhead miles. When it comes from stops it is an estimate and is always labelled so.
_Avoid_: classification, breakdown

**Trip**:
A stretch of driving inside a shift, cut where a stop changes the split. With stop detection off, a shift is one trip.
_Avoid_: leg, segment, ride (and never an order)

**Manual trip**:
A trip the driver added by hand on the web. It counts in the totals and the shift is flagged.
_Avoid_: custom trip, added trip

**Trip edit**:
The driver's change to a trip's kind (active, deadhead or personal) or purpose. It survives every recalculation and never changes the trip's distance or times.
_Avoid_: override, reclassification

**Stop**:
A place where the driver stayed for a while during a shift, found from the track afterwards. The driver never taps anything to make one.
_Avoid_: dwell, waypoint, visit

**Stop detection**:
The setting that has MileWage look for stops and estimate the split. When it is off, each shift is one trip with no split.
_Avoid_: segmenter, smart split

**Stop label**:
The driver's marking of a stop as a pickup, a dropoff or other, with an optional platform, place, fare and tip. Labels are made on the web only and correct the split from that stop on.
_Avoid_: tag, annotation

**Pickup**:
A stop where an order was collected. The driver is active from there.
_Avoid_: collection, restaurant stop

**Dropoff**:
A stop where an order was handed over. The driver is deadhead from there.
_Avoid_: delivery, destination

**Place**:
A spot the driver stops at often, saved on the web with a name, a centre, a radius and a stop label role. A stop inside it shows its name and takes its label unless the driver labelled that stop by hand; when places overlap, the nearest centre wins. Places are never sent to the phone.
_Avoid_: location, geofence, saved address, favourite

### Phone and server agreeing

**Phone result**:
The totals the phone works out with the track engine when a shift ends, sent to the server with the shift.
_Avoid_: client result, local total

**Recalculation**:
The server running the track engine again on the fixes it holds for a shift, keeping the driver's trip edits, stop labels and manual trips.
_Avoid_: recompute, reprocess, rerun

**Difference**:
The state of a shift whose phone result and server total disagree. MileWage shows both numbers and never overwrites either.
_Avoid_: mismatch, disagreement, conflict, recon

### Devices and pairing

**Device**:
A phone paired with the owner's server. Each one has its own name and device token and can be revoked on its own.
_Avoid_: client, handset, installation

**Pairing**:
Giving a phone a device token for one server, by scanning a pairing code or by typing a link code.
_Avoid_: registering, enrolling, linking (a phone paired with a link code is still paired)

**Pairing code**:
The one-time QR code the web app shows for a phone to scan.
_Avoid_: pairing token, QR token, invite

**Link code**:
The 6-digit code a phone on the home Wi-Fi shows after finding the server by itself. The owner types it on the web to pair that phone.
_Avoid_: PIN, confirmation code, device code

**Device token**:
The secret a paired phone holds. It lets the phone send shifts and read the last 14 days, and nothing more.
_Avoid_: password, API key, session

**Home address**:
The server's address on the owner's home network, used while the phone is on the home Wi-Fi. It is the only address that may be plain http.
_Avoid_: LAN URL, local IP (and never the driver's street address)

**Away address**:
The server's https address used everywhere else, normally its Tailscale address.
_Avoid_: public URL, remote address, tailnet URL

### Sending and sync

**Sent to the server**:
The state of a shift the server has accepted, end included.
_Avoid_: synced, uploaded

**On phone only**:
The state of a shift the server does not have yet. The phone holds the only copy.
_Avoid_: pending, unsynced, local

**Change log**:
The server's running list of which shifts, trips, odometer readings, vehicles and settings changed, which a phone reads to bring its own copy up to date.
_Avoid_: sync feed, event log, history

**Overwrite log**:
The server's record of each value that a newer edit replaced, so a later edit never silently loses an earlier one.
_Avoid_: conflict log, undo history

### Money

**Earnings**:
What the driver made from platforms after app fees: fares, tips, bonuses and corrections. Top-ups (money the driver pays into a platform wallet), tax withheld and cash in hand are not part of it.
_Avoid_: revenue, take-home, pay

**Earning entry**:
One signed line of a platform's money for a shift: a fare, tip, bonus, top-up, commission, platform fee, tax withheld, cash collected, payout or correction.
_Avoid_: transaction, ledger line

**Fare**:
What a platform paid for one order, before tips.
_Avoid_: payout (for one order), order pay

**App fees**:
The commission and fees a platform takes out of the driver's fares.
_Avoid_: platform cut, service fee

**Payout**:
Money a platform transfers to the driver to settle what it owes.
_Avoid_: transfer, deposit, cash-out

**Expense**:
Money the driver spent for work, with a category, a deductible share and, where it belongs to one, a vehicle or a shift.
_Avoid_: cost, spend, purchase

**Deductible share**:
The percentage of an expense that counts for work.
_Avoid_: deductible part, business percentage, business use

**Recurring expense**:
An expense that repeats on a set interval and comes back as due until the driver confirms or snoozes it.
_Avoid_: subscription, bill, standing expense

**Receipt**:
One photo or PDF attached to an expense, kept on the server and in every backup.
_Avoid_: attachment, proof, invoice

### Vehicles

**Vehicle**:
What the driver works with: a car, motorcycle, van, bicycle, e-bike or scooter, or on foot. Its kind decides which mileage rate applies, if any.
_Avoid_: car (for every kind), ride

**Vehicle ownership**:
Whether the driver owns the vehicle, is buying it in instalments, leases it or rents it.
_Avoid_: title, finance type

**Odometer reading**:
A vehicle's odometer value typed by the driver, at a shift's start or end or at the start or end of the year. It is evidence beside the GPS distance, never a replacement for it.
_Avoid_: mileage reading, odo

**Maintenance**:
A service done to a vehicle (oil change, tyres, brakes or other) with its date, odometer and cost. A cost can become a linked expense.
_Avoid_: service log, repair log

### Tax

**Country pack**:
Everything MileWage knows about one country's rules: mileage rates, regions, sales tax and, where there is one, the tax pack.
_Avoid_: country module, locale, jurisdiction

**Tax pack**:
The part of a country pack that works out a tax estimate. Only Canada has one.
_Avoid_: tax engine, tax module

**Region**:
The level below a country whose rules can differ, such as a province or a state. It is optional; without it national rules apply.
_Avoid_: province, state (as the general name), area

**Unverified**:
Said of a rate or tax figure that no person has yet checked against the tax office's own publication.
_Avoid_: draft, unofficial, estimated (an estimate is something else)

**Mileage rate**:
A country's published amount per mile or kilometre for a kind of vehicle, dated and sourced. Some rates drop after a distance threshold in the tax year.
_Avoid_: allowance, standard rate, official rate (unless it has been checked)

**Your mileage rate**:
A per-distance rate the driver sets, such as an employer's or an accountant's, in force from its own date until the next one. Once chosen it replaces the country's rate from that date; where a country has no rate it is used anyway. It is always shown as "your rate", never as official.
_Avoid_: own mileage rate, custom rate, override

**Deduction**:
An amount that lowers the income that tax is worked out on. It is never cash in hand.
_Avoid_: write-off (except where the tax office says so), credit, refund

**Mileage deduction**:
Business distance times the mileage rate, or your mileage rate, for a shift, a trip or a period. One shift is valued at one rate, the one in force on its date.
_Avoid_: mileage allowance, mileage claim

**Deduction method**:
How a vehicle is deducted in a tax year: by the mileage rate or by its actual expenses, never both.
_Avoid_: tax method

**Double-counted expense**:
A vehicle expense that the mileage rate already covers, so it must not be deducted as well.
_Avoid_: duplicate expense

**Tax year**:
The year a country counts its rates and tax by: the calendar year in Canada and the United States, and from 6 April in Great Britain.
_Avoid_: fiscal year, financial year

**Tax estimate**:
The tax and contributions a tax pack works out for a tax year, to bring to an accountant. It is not a return and nothing is filed.
_Avoid_: tax return, tax bill, tax owed, filing

**Set-aside**:
The amount the tax estimate suggests the driver put away for tax.
_Avoid_: reserve, tax savings

**Tax jar**:
The money the driver has actually put away for tax in a year, entry by entry.
_Avoid_: tax account, tax fund

### Planning and motivation

**Goal**:
A target the driver sets for earnings, hours, shifts or active miles over a day, week, month or year.
_Avoid_: quota, objective

**Analytics**:
Charts of the driver's own shifts, earnings and expenses by period.
_Avoid_: stats, insights, diagnostics

### Exports

**Export**:
A file made from a period of the driver's data, for an accountant or a map program.
_Avoid_: report, download, dump

**Export format**:
One kind of export: mileage log, expenses, tax summary, mileage and expenses report, GPX or GeoJSON. Each can be switched off.
_Avoid_: exporter

**Mileage log**:
The export of a period's trips or shifts with their dates, times, vehicle, platform, distances, deduction and notes, as tax offices ask drivers to keep.
_Avoid_: trip log, mileage report

**Mileage and expenses report**:
The PDF export for an accountant: a period's summary, the rates used, the mileage log by shift and the expenses, with the unverified-rates notice.
_Avoid_: PDF export, tax report, statement

### Backups and recovery

**Backup**:
An encrypted copy of all the server's data, made nightly, after a shift ends, before an upgrade or by hand.
_Avoid_: snapshot, dump, export

**Recovery key**:
The secret that opens backups. It is shown once, at setup or when a new one is made, and never stored on the server.
_Avoid_: encryption key, passphrase, age key, password

**Restore**:
Replacing a server's data with the contents of a backup.
_Avoid_: rollback, import, recovery

**Restore generation**:
A counter on the server that goes up with every restore, so a phone can tell the server went back in time and send its shifts again.
_Avoid_: epoch, restore count

**Offsite copy**:
A copy of a backup kept on a machine other than the server.
_Avoid_: external backup, cloud backup

### Modules and diagnostics

**Module**:
A part of MileWage the owner can switch off, such as expenses, receipts, tax, goals or analytics. Shifts, trips and backups are never switched off.
_Avoid_: plugin, add-on, feature flag

**Diagnostics**:
Records of how the phone and the server behave (battery, timing, errors), kept only on the owner's server and never carrying coordinates.
_Avoid_: telemetry, analytics, crash reports

**Capture**:
A time-limited, dense recording on one phone, for testing the track engine against real driving. It is off by default.
_Avoid_: debug recording, trace

**Assistant**:
An AI assistant the owner connects to their own server. Nothing is connected until the owner allows it, and it can read or change data only as far as its assistant token allows.
_Avoid_: MCP, bot, agent

**Assistant token**:
The code the owner makes for one assistant, with read or read-and-change access and an optional expiry. It can be revoked at any time.
_Avoid_: MCP token, API key

### Help

**Help**:
The section of the web app that explains MileWage to the owner in plain words, for the version their server runs. The owner can hide it in Settings; it is a preference, not a module.
_Avoid_: docs, documentation, guides, manual, knowledge base, help module

**Help page**:
One page of Help, about one topic. The same page can be read on GitHub.
_Avoid_: doc, article, guide (the operator guides in `infra/docs/` are different), help article

**What's new**:
The Help page that lists what changed in the version the server runs.
_Avoid_: release notes, changelog (in driver-facing text), updates

**Help link**:
A link on a screen to the Help page about what that screen shows.
_Avoid_: tooltip, contextual help, info icon, "learn more"
