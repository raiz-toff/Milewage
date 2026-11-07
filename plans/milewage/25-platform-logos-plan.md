# 25 — Platform logos: show which app a row belongs to

**Status: plan, 2026-11-07.** Owner request: "research and plan about logo use, UI and UX on logo,
get ideas from Comma and implement it", then: "not the milewage logo, like other platform logo".
So this plan is about the **gig platforms' marks** (DoorDash, Uber Eats, Instacart, …) next to
their names in MileWage, as Comma shows them. It is not about a MileWage logo.

**Decision for the owner (section 5):** real logos for some platforms, or coloured initials for all.
The code supports both; switching is one constant (`SHOW_PLATFORM_LOGOS` in
`apps/web/src/platforms/logos.ts`) or one line of data per platform (`logo: true` in
`packages/shared/src/platforms.ts`).

## 1. Goal

When a driver scans a list of earnings, a select of platforms or a shift header, they find their
app by its colour and mark before they read the name. Comma does this with a small badge.
MileWage adds the same badge, without depending on it: the platform's **name is always written next
to it**, so the badge never carries meaning alone.

## 2. What exists today

- `packages/shared/src/platforms.ts`: the built-in list (slug and label only): DoorDash, Uber Eats,
  SkipTheDishes, Foodora, Instacart, Amazon Flex, Grubhub, Deliveroo, Just Eat, Other. A country's
  `platforms` slot (plan 21) picks from it.
- Server `platform_settings` (08 section 16.3): per driver, a nullable `color` (`#rrggbb`) and
  `emoji` for any platform (built-in or custom), plus custom platforms. `GET /platforms` returns
  `color` and `emoji` as stored, `null` when not set. No screen sets them yet.
- Web: platforms appear as plain text in Settings › Your platforms, the onboarding "apps" step
  (checkboxes), the shift page (header line, Earnings list and select, the entries ledger), and
  Analytics › Income sources (which shows the raw slug, e.g. `doordash`). The shifts list has no
  platform per shift in the API.
- Phone: no platform display today. Nothing here changes the phone.

### What Comma does (read, not copied)

- `src/registry/platforms/index.ts`: per platform `color`, `textColor`, `shortLabel` and an
  optional `logo` component. `src/registry/platforms/logos.tsx`: an inline SVG per platform in its
  brand colour. Some are the real marks (DoorDash, Instacart, Skip); Uber and Amazon Flex are
  made-up glyphs on a coloured square.
- `src/components/ui/PlatformBadge.tsx`: a logo when the platform has one (size 16 or 22), else a
  pill in the brand colour with the label in capitals; custom platforms from the database bring
  their own colour, text colour and emoji.
- Used in the header's platform filter, recent sessions, the shifts list and earnings.

Ideas taken: the badge itself, two sizes, logo-or-fallback, a custom platform's own colour, brand
colour per platform as data. Not taken: Comma's artwork, the made-up glyphs, the pill with the full
name in capitals (MileWage writes the name in normal text beside the badge), the platform filter.

## 3. Research (web, 2026-11-07)

### 3.1 Trademarks: what a third party may do with a platform's logo

- **Nominative fair use (US).** You may use another's mark to name their product if (1) the product
  is not readily identifiable without it, (2) you use only as much of the mark as needed, (3) you
  do nothing that suggests sponsorship. Courts note that the **word** weighs more in favour than the
  **logo**; there is no rule that a logo is never allowed, it is decided case by case.
  [Nominative use (Wikipedia)](https://en.wikipedia.org/wiki/Nominative_use);
  [New Kids on the Block v. News America (summary)](https://www.studicata.com/summaries/united-states-court-of-appeals-ninth-circuit/new-kids-on-the-block-v-new-america-pub-1992-t96waf);
  [DuetsBlog: nominative fair use of another's logo](https://www.duetsblog.com/2020/03/articles/advertising/nominative-fair-use-of-anothers-logo/).
- **Canada.** Besides confusion, section 22 of the Trademarks Act forbids use of a registered mark
  "likely to have the effect of depreciating the value of the goodwill"; it was applied to a
  competitor printing another's mark on its packs (Energizer v. Duracell, 2018–2020). A small badge
  inside a private tool, beside the name, is far from that, but the word is still the safer form.
  [Veuve Clicquot v. Boutiques Cliquot, 2006 SCC 23](https://ca.vlex.com/vid/veuve-clicquot-v-boutiques-681539665);
  [Norton Rose Fulbright on section 22](https://www.nortonrosefulbright.com/en/knowledge/publications/ec4a7c19/playtimes-over-toys-r-us-wins-trademark-depreciation-of-goodwill-claim-against-herbs-r-us).
- **The platforms' own terms.** None found grants a general licence for third-party apps.
  - DoorDash: its terms say no right or licence is granted to use DoorDash names or logos; no public
    brand-use page found. [DoorDash terms provision](https://conductatlas.com/platform/doordash/doordash-terms-of-service/provision/CA-P-026001/no-license-granted-to-use-doordash-trademarks/).
  - Uber / Uber Eats: a brand asset site with terms of use (linked by Simple Icons); the Partner
    Community terms ask for prior written consent; ads must not imply co-branding.
    [Uber brand assets, terms of use](https://assets.uber.com/d/k4nuxdZ8MC7E/user-guide#/user-guide/terms-of-use);
    [Uber ad guidelines](https://www.uber.com/gb/en/advertising/specs/guidelines/).
  - Instacart: published trademark guidelines for third parties without an agreement; no use that
    suggests endorsement without written approval.
    [Instacart developer messaging](https://docs.instacart.com/developer_platform_api/guide/terms_and_policies/developer_messaging).
  - Amazon (Flex): the Amazon logo needs approval; only the "available at Amazon" badge is open to
    affiliates. [Amazon trademark guidelines](https://affiliate-program.amazon.com/help/operating/amazonmarks/).
  - Deliveroo: a licence to its branding only for partner restaurants, by contract.
    [Deliveroo restaurant terms](https://restaurants.deliveroo.com/en-gb/terms).
  - Just Eat Takeaway (Just Eat, and the house mark SkipTheDishes adopted in 2020): a public brand
    box. [Just Eat brand box](https://brand-box.marketing.just-eat.com).
  - Grubhub, SkipTheDishes, Foodora: no public brand-use page found.

### 3.2 Simple Icons (where the artwork would come from)

- Simple Icons publishes one-colour SVG paths of brand marks with each brand's hex colour. The
  project is CC0, but "that doesn't mean to imply that all icons within the project are also CC0",
  trademarks stay with their owners, and users should check each brand's guidelines and "seek the
  correct permissions". [Simple Icons disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).
- In version 16.36.0 it has **DoorDash, Uber Eats, Instacart, Deliveroo, Just Eat** (none carries a
  separate licence entry). It has no SkipTheDishes or Foodora.
- It **removed Amazon** in version 15 because it could not confirm permission ("do not explicitly
  confirm/deny permission") and **removed Grubhub** because Grubhub's branding became the Just Eat
  house mark. [Release 15.0.0](https://github.com/simple-icons/simple-icons/releases/tag/15.0.0),
  [PR 13056 (Amazon)](https://github.com/simple-icons/simple-icons/pull/13056),
  [PR 13317 (Grubhub)](https://github.com/simple-icons/simple-icons/pull/13317).

### 3.3 How other driver apps do it

- Gridwise, Solo and Stride all name the platforms they work with (Uber, DoorDash, Instacart,
  Grubhub, Amazon Flex, …) and show their logos on marketing pages; they are commercial apps with
  account links to those platforms. [Gridwise DoorDash tracker](https://gridwise.io/mileage-tracker/doordash),
  [Solo](https://worksolo.com/blog/ubereats-vs-doordash),
  [Stride and Roadie](https://www.roadie.com/press-releases/stride-and-roadie-partner-to-empower-drivers-with-financial-tool).
  Comma does the same inside the app. Common practice, but not proof of permission.

### 3.4 Accessibility

- [WCAG 1.4.1 Use of colour](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html): colour
  must not be the only way to tell platforms apart, so the name is always written.
- [WCAG 1.4.3 Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) (4.5:1
  for text) and [1.4.11 Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  (3:1): the initials and the mark on the tile are held to 4.5:1 even though the badge is
  decorative.
- [W3C decorative images](https://www.w3.org/WAI/tutorials/images/decorative/): an image next to
  text that says the same thing gets an empty text alternative, so screen readers do not say the
  name twice. When the badge stands alone it gets the platform name as its label (`role="img"`).

## 4. Design

### 4.1 The badge

A small rounded square ("tile") in the platform's colour, holding one of:

1. the platform's **mark** (one-colour Simple Icons path), when logos are on and the platform has
   one;
2. an **emoji**, when the driver set one for the platform (`platform_settings.emoji`);
3. **initials**: one or two capital letters.

The mark or letters are white or asphalt (`#101214`), whichever contrasts more with the tile. A
thin inset ring (10 % of the text colour) keeps the tile's edge visible when its colour is close to
the page (Amazon Flex's near-black on the dark theme). Brand colours do not change between light
and dark themes: they are the platforms' identity, and the ring handles the edge.

Sizes: **sm** 20 px (rows, selects, table cells), **md** 28 px (settings list, headers).
Initials 9 / 12 px semibold; the mark fills 60 % of the tile.

Accessibility: `aria-hidden` by default (the name is next to it); `labelled` gives `role="img"`
and the name as `aria-label` for a badge on its own.

### 4.2 Data

`packages/shared/src/platforms.ts` gets, per built-in platform:

- `color`: the brand colour, `#rrggbb`, or `null` for "Other" (neutral, the theme's muted colour);
- `initials`: one or two letters;
- `logo: true` when the web has the mark's artwork (section 5).

Only hex strings and booleans go into `packages/shared`, which the phone bundles; the SVG paths stay
in the web app (`apps/web/src/platforms/logos.ts`).

A platform's colour is chosen in this order: the driver's stored `color` → the built-in brand
colour → for a custom platform, a colour picked from the slug (a stable hash into six colours that
are not the brand's yellow or blue and not Earned green or Spent red: teal, violet, magenta, slate,
brown, cyan; all pass 4.5:1 with white text). Custom platforms get initials from their name: the
first letters of the first two words ("Spark Driver" → SD), or the first letter of a one-word name
("Lyft" → L). No server or API change.

### 4.3 Colours and contrast

| Platform      | Tile      | Source                                                        | Mark / letters | Contrast |
| ------------- | --------- | ------------------------------------------------------------- | -------------- | -------- |
| DoorDash      | `#FF3008` | Simple Icons (doordash.com/about)                             | asphalt        | 5.08     |
| Uber Eats     | `#06C167` | Simple Icons (Uber brand assets)                              | asphalt        | 7.89     |
| SkipTheDishes | `#FF8000` | Just Eat Takeaway orange, adopted by Skip in 2020 (assumption) | asphalt        | 7.46     |
| Foodora       | `#D70F64` | Delivery Hero pink (foodpanda's published value; assumption)  | white          | 5.07     |
| Instacart     | `#43B02A` | Simple Icons (instacart.com/press)                            | asphalt        | 6.69     |
| Amazon Flex   | `#232F3E` | Amazon "squid ink" (assumption)                               | white          | 13.57    |
| Grubhub       | `#FF8000` | Simple Icons (Grubhub uses the Just Eat house brand)          | asphalt        | 7.46     |
| Deliveroo     | `#00CCBC` | Simple Icons (deliveroo.com)                                  | asphalt        | 9.26     |
| Just Eat      | `#FF8000` | Simple Icons (Just Eat brand box)                             | asphalt        | 7.46     |
| Other         | muted     | theme                                                         | muted text     | theme    |

DoorDash's own mark is white on red, but white on `#FF3008` is only 3.70:1, so MileWage uses
asphalt. Skip, Grubhub and Just Eat share one orange; their initials tell them apart (and the name
is beside them).

### 4.4 Where the badge goes (web)

| Place                                  | Size | Notes                                          |
| -------------------------------------- | ---- | ---------------------------------------------- |
| Settings › Your platforms              | md   | each row; the emoji moves into the badge       |
| Onboarding › apps step                 | sm   | inside each checkbox's label                   |
| Shift page header (context line)       | sm   | each platform with earnings                    |
| Shift page › Earnings list and select  | sm   | rows, and each option of the Platform select   |
| Shift page › entries ledger            | sm   | each platform row, and the "Line platform" select |
| Analytics › Income sources             | sm   | also shows the name instead of the raw slug    |
| Dashboard (recent shifts)              | —    | not here: another builder is redesigning it; `PlatformBadge` is exported to drop in |
| Shifts list                            | —    | the API has no platforms per shift; add when it does |

The phone shows no platforms today; when it does, the shared colour and initials are there to use
(`react-native-svg` is already in the phone app for marks, if the owner wants them there).

## 5. Real logos or initials only — trade-off and recommendation

**Real logos**

- For: drivers recognise their app at a glance; every comparable app (Gridwise, Solo, Stride,
  Comma) shows them; the use is nominative (the logo sits next to the name, to say which platform
  a figure came from), nothing is sold, nothing suggests a partnership; MileWage runs on the
  driver's own server.
- Against: no platform grants a licence for this; courts treat a logo as harder to justify than the
  name; the artwork ships in a public repository and in every installed copy; Amazon is explicit
  that its logo needs approval, and Simple Icons dropped it for that reason.

**Initials only**

- For: no artwork of anyone else's; only the platform names (clear nominative use) and colours.
- Against: less recognisable; looks less finished than the apps drivers compare it with.

**Recommendation:** logos **on** for the five platforms whose mark Simple Icons publishes and keeps
(DoorDash, Uber Eats, Instacart, Deliveroo, Just Eat), drawn unchanged in one colour, never
altered, never larger than 28 px, always next to the name; **initials** for Amazon Flex (Amazon
requires approval), Grubhub and SkipTheDishes (their own marks are not in Simple Icons; the shared
Just Eat house mark may not be theirs any more), Foodora (no source), Other and every custom
platform. Settings › Your platforms carries one line: "Platform names and logos belong to their
owners. MileWage is not affiliated with them."

- Assumption (owner to confirm): logos on as above. To turn every logo off: set
  `SHOW_PLATFORM_LOGOS = false` in `apps/web/src/platforms/logos.ts`. To turn one off or on: its
  `logo: true` in `packages/shared/src/platforms.ts` (adding one also needs its path in `logos.ts`).
- Not legal advice; if MileWage is ever sold or offered as a hosted service, ask the platforms or a
  lawyer first.

## 6. Pull requests

| PR  | Branch                           | Contents                                                                                     |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| PL0 | `pr-PL0-platform-logos-plan`     | this plan                                                                                    |
| PL1 | `pr-PL1-platform-badge`          | shared `color` / `initials` / `logo`; web `PlatformBadge`, the five marks, tests             |
| PL2 | `pr-PL2-platform-badges-in-ui`   | the badge in the places of section 4.4, the "not affiliated" line, tests, visual check       |

Tests (fail without the change): the badge shows the mark for DoorDash and initials for Amazon
Flex; with logos off, initials for all; a custom platform's stored colour wins and a missing one is
stable for the same slug; letters and marks reach 4.5:1 on every built-in and fallback colour; the
badge is hidden from screen readers next to the name and labelled when alone; each screen of
section 4.4 shows the badge.
