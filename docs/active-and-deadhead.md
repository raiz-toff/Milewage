# Active and deadhead miles

Active miles are driven with an order. Deadhead miles are driven without one, such as the drive to the next restaurant. Some drivers want to see the two separately.

## How stops are found

You never tap anything during a shift. MileWage looks at the recorded track afterwards and finds the places where you stayed for a while. Each one is a stop. The same code finds the same stops on the phone and on the server.

## The split is an estimate

From the pattern of stops, MileWage guesses when you were carrying an order and when you were not. It starts a shift as deadhead. A stop of about three minutes or more flips the state. The first one is taken as a pickup, the next as a dropoff, and so on.

That guess assumes one order at a time. If you stack orders, it can understate your active miles. This is why the split is labelled "estimated" everywhere it appears: on shift pages, in the mileage log and in the exports. The estimate has not been checked against real rides yet.

## Total miles never depend on it

Your total miles for a shift come from the whole track. They are the same whether stops are on, off, labelled or not. Your mileage deduction uses the total.

## Labelling a stop fixes the estimate

On a shift page in the web app, you can mark a stop as a pickup or a dropoff. You can also add the platform, place, payout and tip. A pickup label means you were active from there, and a dropoff label means you were not. The rest of the shift is worked out from your label, so one correction can fix later stops too.

Labelling is optional and only done on the web. Nothing here is needed for your total miles.

## Turning stops off

In Settings there is a switch, "Detect stops and estimate active vs deadhead". When it is off, MileWage does not look for stops. Each shift is one trip, with a total and no split. The setting applies to shifts you start afterwards. Shifts already stored keep their stops and labels.
