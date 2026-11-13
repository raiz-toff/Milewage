# Google Play

Everything Play shows about MileWage lives here, and `scripts/play.mjs` sends it to Play through
the Play Developer API. Nothing here is secret: the signing key and the API key stay in
`$HOME/.milewage/`, outside the repository.

```
play/
  listings/en-US/          title.txt (30), short-description.txt (80), full-description.txt (4000)
                           icon.png (512 x 512), feature-graphic.png (1024 x 500)
                           phone-screenshots/*.png (2 to 8, long side at most twice the short)
  release-notes/en-US/     <version>.txt, what's new, 500 characters at most
  console-answers.md       the forms that exist only on the website, answered
```

`npm run play:check` says what Play would refuse, without sending anything.

## Every new version (three commands)

1. Bump the version and write what changed:
   ```bash
   npm run version:bump -- 0.3.2
   ```
   This sets VERSION, every package.json, the lockfile and the Android versionCode (one up), and
   creates `release-notes/en-US/0.3.2.txt`. Fill that in (what a driver notices, 500 characters)
   and add the CHANGELOG section. Commit, PR, merge.
2. Build and sign, on your machine:
   ```bash
   bash scripts/phone-release-build.sh
   ```
   It makes `milewage-<version>.apk` (GitHub) and `milewage-<version>.aab` (Play).
3. Send it to testers, then to everyone when it's good:
   ```bash
   npm run play:release
   ```
   ```bash
   npm run play:promote -- --from internal --track production --rollout 0.2
   ```
   The first goes to the internal testing track. The second moves that same build to production
   for 20 % of users; run it again with `--rollout 1` (or `--status completed`) for everyone.

Changed the store text or pictures? `npm run play:listing`.

## Once

In this order. The steps marked **you** need your Google account; everything else is ready.

1. **Upload key** (if `$HOME/.milewage/keystore.env` doesn't exist yet):
   ```bash
   bash scripts/phone-keystore.sh
   ```
   Back up `$HOME/.milewage/` somewhere safe. Losing it means asking Google to reset the upload
   key.
2. **You: create the app.** Play Console > Create app. Name `MileWage`, default language English
   (United States) - en-US, App, Free. Accept the declarations.
3. **You: the forms.** Policy and programs > App content, and Store settings: copy the answers
   from [console-answers.md](console-answers.md). The privacy policy is
   `https://github.com/raiz-toff/Milewage/blob/main/PRIVACY.md`.
4. **Build:** `bash scripts/phone-release-build.sh`.
5. **You: the first bundle by hand.** Google's API refuses uploads until the app has one. Testing >
   Internal testing > Create new release. Choose Play App Signing (console-answers.md, "Play App
   Signing"), upload `apps/android/app/build/outputs/bundle/release/milewage-0.3.1.aab`, paste
   `release-notes/en-US/0.3.1.txt`, save and roll out to internal testing. Add yourself as a
   tester (Testers tab, an email list).
6. **You: the API key.**
   1. <https://console.cloud.google.com/>: create a project (or use one), then APIs & Services >
      Library > **Google Play Android Developer API** > Enable.
   2. IAM & Admin > Service accounts > Create service account (name `milewage-play`, no roles).
      Open it > Keys > Add key > JSON. Save the downloaded file as
      `$HOME/.milewage/play-service-account.json` (or set `MILEWAGE_PLAY_KEY` to its path).
   3. Play Console > Users and permissions > Invite new users: the service account's email
      (`...@...iam.gserviceaccount.com`). App permissions: MileWage, with **Release to production,
      exclude devices, and use Play App Signing**, **Release apps to testing tracks** and
      **Manage store presence**. Invite.
7. **Listing:** `npm run play:listing` sends the text, icon, feature graphic and screenshots.

From then on, only "Every new version".

## Before production

- **New personal developer accounts** (made after 13 November 2023) must run a closed test with
  at least 12 testers for 14 days in a row before Play allows production. Use the closed testing
  track: `npm run play:release -- --track alpha`, and add the testers' emails there.
- **Reviewers need a way in.** MileWage does nothing without a server, so the build must have the
  demo mode before it goes to review (console-answers.md, "App access").
- **Background location** needs the declaration and a short video (console-answers.md).

## If Play refuses

- `Only releases with status draft may be created on draft app`: the app has never been
  published; add `-- --status draft` and roll it out in Play Console.
- `APK specifies a version code that has already been used`: bump the version (step 1).
- `The caller does not have permission`: step 6.3 (permissions can take a few minutes to apply).
