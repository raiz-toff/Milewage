# MileWage logo concepts

Status: **decided and applied (2026-11-08): Coin Road.** Main mark `coin-thin/`; `coin-small/` for anything under 24 px. The other concept folders and `preview.html` / `preview.png` are kept as the record of the decision; nothing uses them.

## What the owner's three references told me

Liked: a road or route as the idea, the lane-yellow centre line, a navigation arrow, an end-of-road block, bold geometric letters.
Not working: the long wavy ribbon is hard to read when small and looks busy; it says neither "earnings" nor "mile"; the arrow and the end block feel added on. So none of the five below is a polished version of those drawings. Each one makes the road, the arrow or the letter the whole mark.

## The five concepts

| Folder     | Name          | One line                                                                               |
| ---------- | ------------- | -------------------------------------------------------------------------------------- |
| `rise/`    | **Rise**      | A route that spells W and climbs into an arrowhead; lane dashes run along it.          |
| `pin/`     | **Pin M**     | A map pin with the M of MileWage as its centre.                                        |
| `horizon/` | **Horizon**   | The road ahead in perspective on a road-coloured tile; the trapezoid is also an arrow. |
| `coin/`    | **Coin Road** | A coin with a road climbing across its face; no single currency sign.                  |
| `receipt/` | **Receipt**   | A torn-edge slip with a route on it, the log you take to an accountant.                |

**Rise.** The W is the second half of the name, the climb is earnings going up, and the arrow is the navigation arrow the owner kept coming back to, now the end of the line instead of a separate piece. It keeps the lane-yellow dashes. It is the most ownable mark and the closest to the references. Cost: it is the most detailed, so below about 24 px the dashes are dropped (`symbol-simple.svg`) and it becomes a plain W with an arrow.

**Pin M.** The simplest and strongest at small sizes: the pin silhouette survives at 16 px even when the M inside blurs. It says "places and distance" immediately and the M ties it to the name. Cost: a map pin is a common shape, so it is the least distinctive on its own; the M and the yellow carry it.

**Horizon.** A road narrowing toward the horizon on an Asphalt tile with lane dashes that shrink with distance. It reads as "road" at once and the tile makes it a ready-made app icon. Cost: the tile makes it look like an app badge more than a mark, and a yellow triangle-ish shape can read as a road-works sign.

**Coin Road.** A yellow coin crossed by a climbing road with a dashed centre line: money and road in one disc, deliberately with no `$` so it works in every country (see the country plan, `21`). Cost: the road is a thin diagonal at 16 px, and a coin is a common money symbol.

**Receipt.** A slip with a torn bottom edge, two text bars and a rising route ending in a dot: the mileage log and the tax paperwork. Distinct silhouette, tells the "records you can hand over" story. Cost: it is the most "finance app" of the five, and the route inside is fine detail that disappears below 32 px.

## Round 1 recommendation (written before Round 2)

1. **Rise** as the main mark. It is the one that is not a stock shape, it carries every idea the owner liked (route, lane stripe, arrow, bold letter) in a single stroke, and it says W/wage and up/earnings. Use `symbol-simple.svg` for the favicon and notification icon.
2. **Pin M** as the runner-up. Choose it instead if small-size recognition (favicon, notification icon) matters more than having a distinctive shape.

Not recommended as the main mark: Horizon (reads as a warning sign), Receipt (too narrow in meaning). Coin Road is a good badge for the earnings screens, not the brand.

## Round 2: more ideas in the spirit of Coin Road

The owner loves Coin Road because two meanings are fused into one simple shape (coin = wage, road = mile), there is no currency sign, and it is bold and flat. Round 2 looks for the same thing: a familiar money object with the road inside it, or a road object with a wage idea inside it. Everything below keeps Lane yellow and Asphalt, uses no blue and no currency signs.

| Folder     | Name           | One line                                              |
| ---------- | -------------- | ----------------------------------------------------- |
| `climb/`   | **Coin Climb** | A coin with a road that climbs and ends in an arrow.  |
| `tag/`     | **Tag Road**   | A price tag with a road climbing across it.           |
| `wheel/`   | **Wheel Coin** | A coin struck with a steering wheel.                  |
| `meter/`   | **Meter Coin** | A coin with a speedometer struck on it.               |
| `coinpin/` | **Coin Pin**   | A map pin whose head is a coin with a road across it. |
| `range/`   | **Range**      | A battery bar whose charge is coins.                  |

**Coin Climb.** The closest relative of Coin Road. The coin stays, the road becomes a short climbing route that ends in an arrowhead, so "earnings up" is said outright while the dashed road keeps "miles". It is bold, flat, reads in one colour, and survives to 24 px. Risk: a rising arrow in a circle is a familiar "growth" icon, so the lane dashes (which fade below 32 px) are what make it MileWage's.

**Tag Road.** A price tag (wage, price, rate) with the same kinked road across it and the tag's hole kept. A different silhouette from the round family, still one idea. Risk: a yellow tag on white has weak edges, and it leans more to "pricing" than "earnings".

**Wheel Coin.** A yellow coin with a steering wheel struck into it: drive and pay in one disc. Very legible and bold. Risk: it reads as a steering wheel first and a coin second, so it suits drive-related screens better than the brand mark.

**Meter Coin.** A coin whose face is a speedometer, the needle standing for both speed and the climb in earnings. Clean at every size. Risk: the wage idea is the weakest of the six; it reads as a gauge.

**Coin Pin.** A map pin whose head is a coin with the road across it (pin = place and distance, coin = wage). Good silhouette at 16 px. Risk: close to Pin M from Round 1, and the kinked road inside the head can read as an S at small size.

**Range.** A battery whose charge is three coins: how far you can go, what it earns. Reads as a battery at once. Risk: it has no road in it and a row of three discs can look like a traffic light, so it is the weakest fit of the six.

### Dropped in Round 2 because they read as something unintended

Tyre Coin (a poker chip), Dial (a horseshoe; the coin end was unclear), Waypoints (a node graph), Loop (an infinity sign, too busy), Route Coin (a lollipop), Banknote Road (an escalator or road sign), Sunrise Road (a hard hat on a cone, then a person), Roundabout Coin (a poker chip again). Coin Road variants dropped: a straight road (a "no entry" sign), a turning road (the letter J), and a road held inside a rim ring (the road ends looked cut off).

### Coin Road, compared

`preview.html` shows the original and three variants side by side, with real 16/32/48 px renders (`coin/`, `coin-thin/`, `coin-edge/`, `coin-small/`).

- **Original.** Works. The kink and dashes keep it from reading as a "no entry" sign at 32 px and up. At 16 px it is a yellow disc with a black diagonal bar: the coin still reads (the bar is black on yellow, not red on white), the road does not.
- **A. Thinner road (`coin-thin/`).** Road 19 wide instead of 25. More yellow, so the coin is recognised before the road, and the dashes still show at 48 px. **Recommended change to the main mark.**
- **B. Edge line (`coin-edge/`).** A fine line near the rim. It makes the disc read as a struck coin at 48 px, but at 16 and 32 px it adds noise and breaks up the road. Not recommended.
- **C. Small-size cut (`coin-small/`).** No dashes, road 24 wide. The cleanest at 16 to 24 px. **Recommended as the small version** for the favicon and notification icon, like `rise/symbol-simple.svg`.
- **Rim.** A rim ring that holds the road inside the coin was tried and dropped: the road ends look cut off and it shrinks the road.
- **Does the road need to cross?** Yes, and it should run off the edge. That is what says "road" instead of "ribbon", and it is why the variant with the road stopping inside a ring looked wrong.

Summary for Coin Road itself: use road width of about 19 to 21 (variant A), keep the kink, keep the road running off the edge, no rim, and supply variant C below 24 px.

## Top 3 across both rounds

1. **Coin Road** (with variant A for the main mark and C as the small version). The owner's pick, and still the best balance: the simplest shape, the clearest two meanings, no currency sign, bold at 16 px.
2. **Coin Climb.** The same formula with "earnings up" said more directly. If the owner wants the mark to carry growth as well as wage and mile, this is the one.
3. **Rise** (`rise/`, Round 1). The most distinctive and ownable of all eleven: a route that spells W and climbs. It is the pick if the owner prefers a mark that is not a coin at all; use `rise/symbol-simple.svg` below 24 px.

Best of the rest: **Tag Road** (best new silhouette), **Wheel Coin** (good as an in-app badge for drive screens), **Pin M** (best at 16 px).

## Standards and practice applied

Checked 2026-11-08; built only the gap (SVG sources, no new tooling).

- **Android adaptive icon** ([Android docs](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)): two 108 dp layers, foreground and background; the masked safe zone is 66 dp, centred. Artwork is 56 dp inside that (`app/adaptive-foreground.svg`), so it clears the 66 dp zone, and also the 72 dp visible area that one secondary source quotes. Android 13 themed icon: a one-colour layer on the same 108 dp canvas (`app/adaptive-monochrome.svg`). The background layer is plain Asphalt, matching `adaptiveIcon.backgroundColor` already in `apps/phone/app.config.js`.
- **App icon:** 1024 x 1024, opaque (`app/app-icon.svg`), content about 57 % of the canvas so rounded masks do not clip it. The opaque-square rule for iOS is general practice and was not re-checked this session; the app is Android only today.
- **Web favicon:** an SVG favicon plus PNG fallbacks (32, 180 apple-touch, 192 and 512 for a manifest, one maskable). From blog guides, not an authoritative standard; the "Safari lacks SVG favicons" claim in one of them should be re-checked before relying on it ([guide](https://dev.to/albert_nahas_cdc8469a6ae8/favicon-best-practices-for-modern-web-apps-in-2025-3jkd)).
- **Notification small icon:** Android draws it as a single colour from the alpha channel, so it must be one-colour with transparency (`app/notification-icon.svg`).
- **Legibility at 16 px:** one dominant silhouette, no hairlines (every stroke at least 1 px at 16 px except the dashes, which are treated as optional detail), solid shapes against a clear background, and a one-colour version that works by knockout. The preview shows real 16, 32 and 48 px renders of each.
- **SVG hygiene:** hand-structured SVG, one 100 x 100 box, `viewBox` only (no fixed width), no raster, no external fonts: the wordmark is Geist Bold (700) converted to outlines, upper case, tracking 0.2 em, so the files do not need the font installed. Knockouts use `<mask>`, so the one-colour files are truly transparent.

## Colour tokens

Only existing brand tokens are used (`src/theme/colors.ts`, `src/global.css`):

| Role                               | Value              |
| ---------------------------------- | ------------------ |
| Lane yellow (primary)              | `#FFC21F`          |
| Asphalt (ink and phone background) | `#101214`          |
| Off-white (wordmark on dark)       | `#ECEEF0`          |
| Light page (web)                   | white / near-white |

Earned green and Spent red are for money in the app and are not in any logo.

**Decision flagged: blue.** The owner's references use a blue arrow. Blue is currently unassigned (the live map that used it was removed), so none of these concepts uses blue. Adding it to the logo would assign it a meaning; it needs an owner decision first.

On a light background the logos use Asphalt as the main colour with yellow only inside (yellow on white is about 1.6:1 contrast, too weak to carry a shape alone). On the phone the reversed versions put yellow on Asphalt.

## Clear space and minimum size

- **Clear space:** one quarter of the symbol height on every side (for a lockup, measured from the symbol), nothing else inside it.
- **Minimum size, symbol:** Pin M, Horizon, Coin Road, Receipt: 16 px. Rise: 24 px with dashes, 16 px using `symbol-simple.svg`.
- **Minimum size, lockup:** 120 px wide (the wordmark capitals are then about 8 px tall; narrower than that they stop being legible).
- **Do not:** stretch, rotate, outline, add shadows or gradients, put the colour version on a busy photo, or set the wordmark in another font.

## Files

Each concept folder holds:

- `symbol.svg`, `symbol-reverse.svg` (for Asphalt), `symbol-mono.svg` (one colour, knockout)
- `lockup.svg`, `lockup-reverse.svg`, `lockup-mono.svg` (symbol plus MILEWAGE, horizontal)
- `app/app-icon.svg` (1024), `app/adaptive-foreground.svg`, `app/adaptive-background.svg`, `app/adaptive-monochrome.svg` (108 dp), `app/splash.svg` (1080 x 1920), `app/notification-icon.svg` (96)
- Rise also has `symbol-simple.svg` (no dashes).

`preview.html` shows all concepts in light and dark with real 16/32/48 px renders, a Round 2 section (Coin Road repeated first), a Coin Road comparison, and app-icon, adaptive-icon, themed-icon, notification and splash mock-ups for the top three (Coin Road, Coin Climb, Rise). Every other concept has the same app files; they just are not mocked up.

## What changed in the app (Coin Road chosen 2026-11-08)

Applied in PRs B1, B1b, B1c and B1d (`plans/milewage/progress.md`):

- **Phone:** `apps/phone/assets/icon.png`, the three Android adaptive layers and `splash-icon.png` rendered from `coin-thin/app/`; the status-bar icon `milewage_notification.xml` redrawn from `coin-thin` with the lane dashes (one colour); `ui/Logo.tsx` on the Home header.
- **Web:** `LogoMark` (`apps/web/src/components/logo.tsx`) in the sidebar header and above the sign-in, setup, recovery-key and restore cards. The installable-app icons (`apps/web/public/icons/*`, `apple-touch-icon.png`) are generated by `apps/web/icons/generate.py` from `apps/web/icons/source.png`, which is `coin-thin/app/app-icon.svg` rendered at 1024 px; `favicon.ico` (16/32/48) is the `coin-small` cut from `web/favicon.ico`.
- **To change the logo later:** edit the SVGs here, render `coin-thin/app/app-icon.svg` to `apps/web/icons/source.png` (1024 px), run `python3 apps/web/icons/generate.py`, copy `web/favicon.ico` to `apps/web/public/favicon.ico`, and re-render the phone assets.

## How the SVGs were made

Generated by a small script (not kept in the repo, to avoid adding lint-checked code to `npm run lint`); the wordmark outlines come from `@expo-google-fonts/geist` Geist Bold with opentype.js. The SVGs are the source of truth; edit them directly.
