---
summary: What a shift page shows, adding a trip by hand, changing a trip, and what the checks mean.
group: using
order: 10
---

# Shifts and trips

A shift runs from Start shift to End shift on the phone. Its trips are the stretches of driving inside it.

## The Shifts page

Shifts opens on this week; the arrows move a week at a time. The large figure is what you earned, or the distance when no earnings are entered. Choose a day's bar to list that day only. Under the bars are the week's hours, distance, deduction and hourly earnings. A badge on a shift says "Reviewed", or how many checks are "to review".

## What a shift page shows

The header has the date, times, vehicle and platforms. Then the figures:

- **Distance**: the total, from the GPS track.
- **Business**: active plus deadhead miles. Where stops are on, the split is shown with a `*`. It is an estimate. See [Active and deadhead miles](active-and-deadhead.md).
- **Earned**: your earnings after app fees, or "not entered". See [Earnings and platforms](earnings-and-platforms.md).
- **Deduction**: the mileage deduction, or "Deduction (your rate)" with your mileage rate. No rate has yet been checked against the tax offices' own publications.

Below the figures:

- **The map**: a simplified line through your route, for display only.
- **The timeline**: each trip with its time, distance, kind and purpose, and each stop. Choose one to find it on the map.
- **Checks**: facts about the recording, with "What to do" under them. Ones marked Review come first.
- **Odometer**, **Notes**, **Export this shift**, and **Label stops** where stops were found.

While a shift runs, the page says "Shift in progress". Trips and stops appear when it ends.

## When nothing was recorded

If the phone sent no location points, the page says "No route for this shift" and lists what the checks found. A shift with no distance adds nothing to your totals. The web app has no button to delete a shift. If you know the distance, add it as a trip.

## Adding a trip by hand

For driving the phone missed, on an ended shift that is not Reviewed.

1. Next to Timeline, choose "Add a trip".
2. Change From and To if needed.
3. Type the distance and a purpose. Both are needed.
4. Choose the kind: Business or Personal. A business trip counts as active.
5. Choose Add trip.

The trip counts in your totals and shows as "edited" in the timeline. The web app has no button to remove it afterwards.

On the phone, open Shifts, then the shift. Under Corrections, "Add a trip" takes a distance only and counts it as active.

## Changing a trip

A trip edit changes a trip's kind: active, deadhead or personal. In this version you do it on the phone, not on the web. Open Shifts, then the shift. Each trip has a button such as "change to Deadhead"; each tap moves it on to the next kind. The change is sent to the server.

A trip edit never changes the trip's distance or times. It is kept every time the shift is worked out again. If a later recalculation no longer finds that trip, the checks say "A trip edit no longer matches a trip." Look at the timeline and make the edit again on the trip that replaced it.

Labelling stops on the web is the other way to correct the split. See [Active and deadhead miles](active-and-deadhead.md).

## How the server works out a shift

The server runs the same track engine as the phone on the GPS points it received. It does this when the shift ends, when late points arrive, and when you add a trip, change a trip or label a stop. It keeps your trip edits, stop labels and trips added by hand. See [How miles are counted](how-miles-are-counted.md).

The web app has no Recalculate button in this version. After an upgrade, stored shifts keep their figures until one of those things happens.

## When the phone and the server differ

At the end of a shift the phone sends its own totals, and the server compares them with its own. The checks then say whether the phone and the server agree, worked out different totals, or the phone's result never arrived.

MileWage never overwrites either number. The web shows the server's figures. The phone keeps its own and shows both on the shift, with the reason. The usual reasons are points that never reached the server, a different engine version, an edit made on the web, or late points. To send points the phone still holds, open MileWage on the phone while it has a connection.

If the server's figures differ with the same points and the same engine version, the checks say "The server's figures differ from the phone's." and mark it Review. That is a fault in MileWage. Report it with the bug template in the project's [Issues](https://github.com/raiz-toff/Milewage/issues).

## What "Reviewed" means

A Reviewed shift is finalized: it is your tax record. It is never worked out again, and its trips, stop labels and odometer readings cannot be changed. The web app has no button to mark a shift reviewed in this version. A shift only reaches this state through the server's API.
