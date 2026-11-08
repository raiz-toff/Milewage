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
- It tells you the server was restored.

It does not yet send the points again by itself. That part is not built in this version. Your shifts stay on the phone, marked "on phone only". Do not clear the app's data until you have checked your server.
