---
summary: What a shift page shows, adding a trip by hand, changing a trip, and what the checks mean.
group: using
order: 10
---

# Shifts and trips

A shift runs from Start shift to End shift on the phone. Its trips are the stretches of driving inside it.

## The Shifts page

Shifts opens on this week; the arrows move a week at a time. The large figure is what you earned, or the distance when no earnings are entered. Choose a day's bar to list that day only. To go to other dates, choose the dates above the large figure. In the calendar pick the first day, then the last, and choose OK: the page shows that range, with a bar per day, or per month for more than 31 days, and the arrows move by the range's length. One day and OK opens its week with that day chosen. Cancel changes nothing, and "This week" brings you back. Under the bars are the week's hours, distance, deduction and hourly earnings. Each shift in the list shows its day and times, its time and distance, and on the right what it earned, its tips and its deduction. A badge on a shift says "Reviewed", or how many checks are "to review".

## What a shift page shows

The header has the date, times, vehicle and platforms. Then the figures:

- **Distance**: the total, from the GPS track.
- **Business**: active plus deadhead miles. Where stops are on, the split is shown with a `*`. It is an estimate. See [Active and deadhead miles](active-and-deadhead.md).
- **Earned**: your earnings after app fees, or "not entered". See [Earnings and platforms](earnings-and-platforms.md).
- **Deduction**: the mileage deduction, or "Deduction (your rate)" when your mileage rate was in force on the shift's day. No rate has yet been checked against the tax offices' own publications.

Below the figures:

- **The map**: a simplified line through your route, for display only.
- **The timeline**: each trip with its time, distance, kind and purpose, and each stop. Choose one to find it on the map.
- **Checks**: facts about the recording, with "What to do" under them. Ones marked Review come first.
- **Odometer**, **Parking and tolls**, **Notes**, **Export this shift**, and **Label stops** where stops were found.

The menu in the header (the three dots) edits or deletes the shift. See [Correcting or deleting a shift](#correcting-or-deleting-a-shift).

## A shift counts on the day it started

A shift counts on the day it started, everywhere: in the Shifts list, the week's totals, the Tax page and the exports. A shift that starts at 11 pm and ends at 2 am is the first day's, and its page says so. In the trip CSV each trip keeps its own real date in `date`, which a mileage log needs, and `shift_date` is the day its shift started.

## Parking and tolls

Paid for parking or a toll during a shift? Add it on the shift page, under Parking and tolls (shown when the expenses module runs).

1. Choose **Parking** or **Toll**.
2. Type the amount and, if you like, where.
3. Choose **Add parking** or **Add toll**.

It is saved as an ordinary expense on the shift's day, with the shift's vehicle, and appears in Expenses like any other. Add a receipt or change it there. The shift page shows the shift's parking and toll total; the trash button removes one, after asking. A running shift takes them too. The phone app cannot add them yet.

While a shift runs, the page says "Shift in progress". Trips and stops appear when it ends.

## When nothing was recorded

If the phone sent no location points, the page says "No route for this shift" and lists what the checks found. A shift with no distance adds nothing to your totals. If you know the distance, add it as a trip. If the shift was started by mistake, delete it (see below).

## Started by mistake

A shift under 2 minutes and under 160 m (0.1 mi), with no earnings, parking or tolls, expenses or trips you added, is "very short". Nothing is deleted for you.

- **On the phone**, End shift on such a shift asks "Started by mistake?". Discard deletes it for good. Keep ends it like any shift. Closing the box keeps recording. If the phone cannot reach the server, the shift stays on the phone, marked as waiting, until the server confirms the delete.
- **On the web**, the shift's page says "This shift is 40 seconds and 0 mi. Started by mistake?" with a Delete button. It asks first, and it cannot be undone.

## Shifts that overlap

If a shift starts before another one ends and ends after that one starts, the Checks on its page say "This shift overlaps" and link to the other shift, marked Review. MileWage never refuses or changes either of them. Open the shifts and correct a time with "Edit times and vehicle", or delete the one that is a mistake. The check goes away when they no longer overlap. A shift that ends exactly when the next one starts does not overlap.

## A shift left running

A shift with nothing recorded for 12 hours is probably one that was never ended (a flat battery, a forgotten stop). Its page and the dashboard say so, with End now. MileWage never ends it for you. After End now, correct the end time if it was earlier.

## Correcting or deleting a shift

Open the shift and use the menu in the header.

**Edit times and vehicle.** The usual slip is forgetting to stop the shift. Choose "Edit times and vehicle", change the start or end date and time, and choose Save changes. The distance, trips and stops are worked out again from the GPS points inside the new times, so a later end can add distance and an earlier one can remove it. The phone's own figure is kept; if the two now differ, the checks say the shift was edited on the web. Times can be changed on a shift that has ended and is not Reviewed. They cannot be set to a time that has not happened yet, and the end cannot come before the start. If the raw points of an old shift were archived, the times cannot be changed, because they cannot be worked out again. The same form changes the vehicle, and that works while a shift is running too.

**A shift that is still "in progress".** If the phone never ended it (a flat battery, a forgotten stop), the page says so and offers "End now". It ends the shift at this moment. If it really ended earlier, choose "Edit times and vehicle" afterwards and correct the end time.

**Delete shift.** The box says what goes: the shift's distance, trips, stops, odometer readings and the earnings you entered for it. They stop counting in your totals, reports and tax figures, on the web and on your phone. Parking and tolls stay in Expenses. Choose "Delete shift" to confirm; this cannot be undone, and a shift less than 7 years old needs that confirmation. A running shift cannot be deleted: use End now first. After deleting you are taken back to the Shifts list.

## Adding a trip by hand

For driving the phone missed, on an ended shift that is not Reviewed.

1. Next to Timeline, choose "Add a trip".
2. Change From and To if needed.
3. Type the distance and a purpose. Both are needed.
4. Choose the kind: Business or Personal. A business trip counts as active.
5. Choose Add trip.

The trip counts in your totals and shows as "edited" in the timeline.

On the phone, open Shifts, then an ended shift, and tap "Add a trip". It takes a distance only, is added at the end of the shift and counts as business. Its purpose is "Business driving"; change it with Change.

## Changing or deleting a trip you added

A trip added by hand, on the web or on the phone, has a "..." menu in the timeline while the shift is not Reviewed.

- **Edit** opens the same form, filled in. Change the times, the distance, the kind or the purpose, then choose Save changes.
- **Delete** asks first, and says the distance and times of the trip. Choose Delete trip. Its distance leaves the shift's totals.

Either change reaches your phone the next time it reads changes from your server. Trips the phone recorded have no such menu: their distance comes from the GPS track and cannot be changed, only their kind.

### Joining trips

There is no way to join two trips. A recorded trip is cut where a stop changes the split, and only the track engine can cut it differently. Labelling the stop between two trips "Other" removes that cut, but it also changes how every later stop is worked out. To join two trips you added by hand, edit one to the total distance and delete the other.

## Changing a trip

A trip edit changes a trip's kind and its purpose. In this version you do it on the phone, not on the web. Open Shifts, then the shift. Each trip has a Change button. It opens "Trip at" the trip's start time, with the kinds: "Business, on an order" (active), "Business, between orders" (deadhead) and Personal; with stop detection off, Business and Personal. The purpose is a short text, for example "Deliveries". Save sends the change to the server.

A trip edit never changes the trip's distance or times. It is kept every time the shift is worked out again. If a later recalculation no longer finds that trip, the checks say "A trip edit no longer matches a trip." Look at the timeline and make the edit again on the trip that replaced it.

Labelling stops on the web is the other way to correct the split. See [Active and deadhead miles](active-and-deadhead.md).

## How the server works out a shift

The server runs the same track engine as the phone on the GPS points it received. It does this when the shift ends, when late points arrive, and when you add, change or delete a trip, or label a stop. It keeps your trip edits, stop labels and trips added by hand. See [How miles are counted](how-miles-are-counted.md).

The web app has no Recalculate button in this version. After an upgrade, stored shifts keep their figures until one of those things happens.

## When the phone and the server differ

At the end of a shift the phone sends its own totals, and the server compares them with its own. The checks then say whether the phone and the server agree, worked out different totals, or the phone's result never arrived.

MileWage never overwrites either number. The web shows the server's figures. The phone keeps its own and shows both on the shift, with the reason. The usual reasons are points that never reached the server, a different engine version, an edit made on the web, or late points. To send points the phone still holds, open MileWage on the phone while it has a connection.

If the server's figures differ with the same points and the same engine version, the checks say "The server's figures differ from the phone's." and mark it Review. That is a fault in MileWage. Report it with the bug template in the project's [Issues](https://github.com/raiz-toff/Milewage/issues).

## What "Reviewed" means

A Reviewed shift is finalized: it is your tax record. It is never worked out again, and its times, vehicle, trips, stop labels and odometer readings cannot be changed. It can still be deleted, after the same confirmation. The web app has no button to mark a shift reviewed in this version. A shift only reaches this state through the server's API.
