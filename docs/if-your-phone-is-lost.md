# If your phone is lost

## What is on the phone

- The raw GPS points of your shifts. They stay until your server confirms it has them, and for up to 14 days after that.
- The results of your shifts: totals, trips, stops and odometer readings. Shifts that have not reached the server are the only copy.
- The device token. It is the key that lets the phone talk to your server. It is kept in the phone's protected storage, not in a plain file.

The token is not your password. With it, someone can send data to your server and read the last 14 days. It cannot export your data or download backups.

## What to do

1. Open the web app on a computer.
2. Go to the Devices page.
3. Revoke the lost phone.

The token stops working at once. Anything the phone tries to send after that is refused. Lock or wipe the phone with Google's Find My Device or your phone maker's tool as well. MileWage cannot do that for you.

If you find the phone, pair it again from the Devices page. Pairing the same phone to the same server lets it send what it was still holding.

## What is lost

Shifts that never reached the server are lost with the phone. Shifts that did reach it are safe on your server. The phone shows a banner that counts the shifts not yet on the server, so you can check how much is at risk.

## After your server is restored from an older backup

A restore can leave the server behind what the phone has already sent. The phone notices when the server's "restore generation" goes up. Then it does this:

- It marks the shifts it holds as "on phone only", since the server may not have them any more.
- It stops deleting its own copies of points, so nothing it still holds is thrown away.
- It tells you the server was restored: "MileWage is re-sending the last 14 days from your phone."
- It sends its shifts to the server again by itself, oldest first, the next time it reaches the server. You do not need to do anything. The banner's "Sync now" button starts it at once.

Each shift goes the same way as the first time: the shift, then all its points still on the phone, then its odometer readings, its end and your trip edits. A shift the server still has is not doubled. The server answers what it already has, and only what is missing is added.

Each shift is marked "on server" again once the server has accepted its end. When all of them are back, the message goes away and the phone may delete old points again.

Some things to know:

- If the connection drops, the phone carries on from the last batch the server accepted. Closing the app does not lose its place.
- If a shift is running, the older shifts wait until you end it. The server allows one running shift at a time.
- If the server is restored again while this runs, the phone starts over. Nothing is lost.
- Points are kept on the phone for 14 days after the server first confirmed them. Older points cannot be sent again. Their shifts are still sent, with odometer readings and trip edits, but the server may then show a lower distance for them. Such a shift is marked as differing, and the phone keeps its own numbers so you can compare.
- Shifts the phone only knows from the server (recorded on another phone, or before the app was reinstalled) are not sent. The phone never held their points.
- A shift older than 14 days that the server still has is left as it is. The phone cannot reach it any more, and it is already on the server.

Do not clear the app's data until the banner says everything is on the server.
