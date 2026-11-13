# The story behind MileWage

MileWage is where a Google Sheet ended up.

## A spreadsheet

Through 2025 I logged every DoorDash week in a spreadsheet: hours, deliveries, pay, tips. The sheet did the sums, but it only knew what I typed in.

## Macadam

So I built a small site for it, and that became Macadam, a financial tracker named after John Loudon McAdam, the engineer who changed how roads are built. It started with a small server and a database. Then I rebuilt it to run entirely in the browser, with no server and no account: "the private vault for independent drivers". The idea that the data belongs to the driver and stays with the driver comes from there.

## Comma

Macadam became [Comma](https://github.com/raiz-toff/Comma). As a web app it hit a wall: a browser cannot record GPS in the background, so it cannot track a shift. I rebuilt Comma as a web app plus a phone app, got sync working, and used it for more than six months, writing down what was good and what was bad.

## MileWage

MileWage is built from that list. On 3 November 2026 I started a new repository with a different shape. The server is the single source of truth, it runs on a machine you own, and the phone reaches it over Tailscale. There is one driver per server, and no location history sits on someone else's computer.

I planned before any code: about twenty spec documents and four review gates, each signed off by me. AI agents did the build under those gates, with one rule. A feature must save a driver tax money, capture miles accurately, protect the battery or protect privacy, or it goes.

The first commit landed on 4 November. Eight days and about 450 commits later, version 0.3.0 was out. It did not go in a straight line:

- **The look changed three times.** I ported Comma's styling and rejected it the same day. Then came shadcn/ui, and finally Material Design 3 with MileWage's own colours: asphalt surfaces, with lane yellow only where it matters.
- **The phone app was rewritten.** It began as an Expo app with Comma's tracker copied in. On 10 November I replaced it with a native Kotlin app that needs nothing from Google, so de-Googled phones work.
- **I cut eleven features in one day.** Badges, a schedule, an AI assistant, goals, imports and more went on 11 November. Less and stable is better than lots of bloat.

## Where it stands

Version 0.3.0 is public under the AGPL. A real shift on a real road is next: the field test in [`TODO.md`](../TODO.md).

This is the one I am staying with.

## Read more

- [`DECISIONS.md`](../DECISIONS.md): every decision, with its date.
- [`PROGRESS.md`](../PROGRESS.md): the build log, one entry per change.
- [`CHANGELOG.md`](../CHANGELOG.md): what each version brought.
