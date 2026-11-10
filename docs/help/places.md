---
summary: Saving the places you stop at often, so their stops are named and labelled for you.
group: using
order: 35
module: stops
---

# Places

A place is a spot you stop at often: a restaurant you pick up from, a depot, your home. You give it a name, a centre, a radius and a label. From then on, a stop inside the place shows its name, and it gets the place's label unless you labelled that stop yourself.

Places are made on the web only, like stop labels. The phone never sees them.

## Saving a place

There are three ways to set the centre. None of them looks anything up on the internet.

- **From a stop.** On a shift page, under Label stops, choose "Save as a place" on the stop. The Places page opens with the stop's centre and its label filled in. Type a name and choose Save place.
- **On the map.** Open Places in the menu and click the map where the place is. Drag the marker to move it.
- **By typing.** Type a latitude and a longitude in "Centre", for example `43.65107, -79.34702`.

Then:

1. Give it a name.
2. Choose the label for stops there: **Pickup**, **Dropoff** or **Other**.
3. Set the radius. It is 100 m unless you change it, and can be 25 to 1000 m. A stop this close to the centre is in the place.
4. Choose Save place.

## What each label does

The labels are the same as when you label a stop yourself.

- **Pickup**: you are active from that stop.
- **Dropoff**: you are deadhead from that stop.
- **Other**: the stop changes nothing. Use it for home, a gas station or a break spot, so a long stop there is not taken as a pickup or a dropoff.

The split stays an estimate. See [Active and deadhead miles](active-and-deadhead.md). Your total miles never change, whatever the places say.

## Which label wins

- A label you set on a stop always wins over a place. The place's name is still shown.
- When places overlap, the place whose centre is nearest to the stop wins. If two centres are exactly as near, the place you saved first wins.

## Changing or deleting a place

On Places, use the "..." menu of a place to edit or delete it. You can rename it, move it, change its radius or its label.

When you add, change or delete a place, MileWage works out again every ended shift with a stop inside it, as it does when you label a stop. The page says how many shifts were worked out again. Two kinds of shift keep their figures:

- A Reviewed (finalized) shift. It is your tax record and never changes.
- A shift whose raw GPS points were already replaced by a simplified line.

A shift that is still running uses the places when it ends.

## The phone and the server

The phone works out its own totals at the end of a shift, without places. Places only move the line between active and deadhead miles, never the total, so the phone and the server still agree on the total and no difference is shown. The phone gets the server's new trips the next time it reads changes from your server, as it does after you label a stop.

## When stops are off

Places work on stops, so they need Settings > Tracking and privacy > "Detect stops and estimate active vs deadhead". With it off, Places is not in the menu and new shifts have no stops for places to label.

## Your privacy

Places are location data. They stay in your server's database and in its encrypted backups. They are never written to diagnostics or logs, and the assistant connection cannot read them. The GeoJSON export names the place of each stop, as it already lists the stops.
