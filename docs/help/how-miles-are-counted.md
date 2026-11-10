---
summary: What the phone records, what is filtered out, and why the phone and the server agree.
group: using
order: 20
---

# How miles are counted

## What the phone records

While a shift is running, the phone asks for a GPS fix about every 10 seconds, or after you have moved 20 metres. When no shift is running, it records nothing.

## What is left out of the total

Raw GPS is noisy. Before any distance is added up, MileWage removes bad data. The rules are the same everywhere:

- A fix whose accuracy is worse than 50 metres is dropped.
- Movement of less than 20 metres from the last accepted point is ignored. When GPS reports a weaker accuracy for the new point or the last accepted one, the movement must be at least that far, up to 50 metres. At 35 metres accuracy, a move of 30 metres is ignored. A parked car whose GPS drifts adds nothing.
- A point held back by this rule is not lost. When you drive on, the whole distance from the last accepted point is counted.
- A jump that would need a speed above 42 metres per second (about 150 km/h) is cut. It is a glitch, not driving.
- A long silence between fixes is not guessed at. It is flagged on the shift, so you can see that part of the route is missing.

These rules decide what is counted. They do not delete your recorded points.

## Why the phone and the server agree

The phone and the server run the same piece of code, called the track engine. It uses whole numbers for all its maths, so rounding cannot differ between devices. Each result also carries the engine's version number.

When a shift ends, the phone shows you its total. The server then works the total out again from the points it received. If the two totals match, the shift is marked as matching. If they do not, MileWage flags the shift and shows the difference. It does not quietly overwrite either number. The usual reasons are a different engine version, points that arrived late, or edits made on the web.

## When the total is worked out again

The server runs the engine again on the points it holds when a shift ends, when points arrive late, and when you add or edit a trip or label a stop. Your corrections are kept: trip edits, stop labels and trips you added by hand. There is no Recalculate button in the web app. After an upgrade changes the engine, `milewage-cli recalc --dry-run` lists the shifts whose totals would change. It changes nothing. Shifts keep the figures they have until one of those things happens.

A finalized shift is never worked out again. The web app shows it as "Reviewed". Finalizing a shift is not available in the app yet.

## The map line can differ from the mileage

The mileage comes from your GPS points only. The map draws a simplified line through them.

Snapping that line to the roads is planned. It is not built in this version. When it exists, it will be for display only. It will never change a distance, a total or an export. It would need an outside routing service, so the plan gives it a visible switch and a plain note about what leaves your server. A snapped line can look a little different from the mileage figure. The mileage figure is the one that counts.
