# Play Console answers

The forms Google keeps on the website (Play Console > your app > **Policy and programs > App
content**, and **Store settings**), answered for MileWage 0.3.1. Copy each answer in as written.
Re-read a section when the app changes what it records or asks for.

## Store settings

- **App or game:** App. **Category:** Maps & Navigation (alternative: Business).
- **Tags:** Mileage tracker, Business tools.
- **Contact details:** an email you read (shown publicly). Website:
  `https://github.com/raiz-toff/Milewage`.

## Privacy policy

`https://github.com/raiz-toff/Milewage/blob/main/PRIVACY.md`

## App access

Choose **All or some functionality is restricted**, then add one instruction set:

- **Name:** Demo mode (no server needed)
- **Instructions:**
  > MileWage normally pairs with a server the driver runs themselves. To review it without one,
  > open the app and tap "Try it without a server" on the first screen. Every screen then works
  > with sample data, and Start shift records a real shift with GPS (kept on the phone, never
  > sent). Settings > Leave demo returns to the first screen.

Demo mode is in every build made after 0.3.1 was tagged (#13). Never send Google a build without
it: Google would have no way in, and a review would most likely be rejected for missing access.

## Ads

**No**, the app does not contain ads.

## Advertising ID

**No**, the app does not use an advertising ID (no ads or analytics library; the merged manifest
has no `com.google.android.gms.permission.AD_ID`).

## Content rating (IARC questionnaire)

- **Category:** All other app types (utility, productivity).
- Violence, fear, sexuality, language, controlled substances, crude humour, gambling: **No** to
  every question.
- **Do users interact or exchange content with each other?** No.
- **Does the app share the user's current physical location with other users?** No.
- **Does the app allow users to purchase digital goods?** No.
- **Unrestricted internet access (a browser or search)?** No.

Expected rating: Everyone / PEGI 3.

## Target audience and content

- **Age groups:** 18 and over only.
- **Could the store listing unintentionally appeal to children?** No.

## News app

**No.**

## Government app

**No.**

## Financial features

**My app doesn't provide any financial features** (it records mileage and estimates a tax
deduction; it moves no money, gives no loans and holds no accounts).

## Health

**No** health features.

## Data safety

Google counts anything sent off the phone as "collected", even to a server the user runs, so
declare it. Nothing is "shared" (sent to a third party).

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** **No** (the app may
  use plain `http://` to the driver's own server on the home network).
- **Do you provide a way for users to request that their data is deleted?** Yes.

| Data type                                   | Collected | Shared | Processed ephemerally | Required or optional | Purpose           |
| ------------------------------------------- | --------- | ------ | --------------------- | -------------------- | ----------------- |
| Location > Precise location                 | Yes       | No     | No                    | Required             | App functionality |
| Location > Approximate location             | Yes       | No     | No                    | Required             | App functionality |
| App activity > Other user-generated content | Yes       | No     | No                    | Required             | App functionality |
| App info and performance > Diagnostics      | Yes       | No     | No                    | Optional             | App functionality |

("Other user-generated content" is the shift list and odometer readings. Diagnostics are
optional because the driver can turn them off on the server.)

Not collected: personal info (name, email: the account lives on the server's website, not in the
app), financial info, messages, photos (the camera only reads the pairing code), contacts, files,
calendar, web history, device or other IDs.

## Sensitive permissions

### Location permissions (background location)

Play Console asks when the first bundle with `ACCESS_BACKGROUND_LOCATION` is uploaded.

- **Main purpose of the app:** Records the distance a delivery or rideshare driver drives for
  work, shift by shift, for their tax deduction.
- **Feature that uses location in the background:** Shift recording.
- **Why it needs background location:** A driver starts a shift and then uses the delivery app,
  maps or the lock screen for hours. Recording must continue while MileWage is not on screen,
  or the shift's distance is wrong. Location is used only between Start shift and End shift; a
  notification shows the whole time.
- **Video (30 seconds or less, an unlisted YouTube link):** record the screen of the phone:
  1. MileWage's own explanation screen before Android's location question (the permissions
     screen), then Android's "Allow all the time" choice.
  2. Start shift on Home.
  3. Leave the app (Home button), open another app, show the "Recording" notification.
  4. Come back: the distance has grown. End shift.

### Foreground service (location)

- **Foreground service type:** location.
- **Task:** User-initiated location tracking during a work shift (choose the closest of Google's
  options, such as "Navigation" or "Other: mileage recording for a work shift").
- **Description:** The service runs only between Start shift and End shift, which the driver taps.
  It shows an ongoing notification and stops when the shift ends.
- **Video:** the same video as above.

## Play App Signing

On the first upload Play asks how to sign the app. Two choices:

- **Let Google manage the key (recommended, the default).** Play signs what it delivers with its
  own key; your keystore becomes the upload key. Drawback: an APK from GitHub and the Play app
  have different signatures, so a phone cannot update from one to the other; a driver switching
  uninstalls first (sending every shift before).
- **Use your own key** (export it with Google's PEPK tool when asked). Play-installed and GitHub
  APKs then update each other. Only if you keep handing out APKs on GitHub.
