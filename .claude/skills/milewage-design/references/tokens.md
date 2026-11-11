# Tokens

Sources of truth:

- `apps/web/scripts/m3-theme.mjs` generates `apps/web/src/theme/m3-scheme.css` (the roles as
  `--md-sys-color-*`, money and chart colours as `--md-extended-color-*`, light on `:root`, dark
  on `.dark`) and `m3-scheme.json` (the same values plus the palettes, the override table and the
  custom colours' tones, read by `theme.ts`, `map/style.ts` and Android's test). Never edit these
  two by hand.
- `apps/web/src/index.css` holds the other Material tokens (type, shape, elevation, state, motion),
  maps the roles to Tailwind colours, and maps shadcn's names onto the roles (the surface model).
- Android: `ui/theme/BrandColors.kt` (generated, pinned by `BrandSchemeTest`), `ExtendedColors.kt`
  and `Theme.kt` under `apps/android/app/src/main/kotlin/app/milewage/phone/`.

## Brand constants

| Name        | Hex       | Where it is used directly                                                     |
| ----------- | --------- | ----------------------------------------------------------------------------- |
| Lane yellow | `#FFC21F` | The scheme's seed and `primary-container`; the logo                           |
| Asphalt     | `#101214` | The logo's ink, the Android adaptive-icon tile; the neutrals' hue and chroma  |
| Earned      | `#34D399` | Seed of `earned`, not harmonised                                              |
| Spent       | `#EA6A0A` | Seed of `spent`, not harmonised: an orange, held apart from `error`           |
| Signal blue | `#4C8DFF` | Seed of `signal`, not harmonised; reserved for a live position marker, unused |

Everything in the UI uses the generated roles below, not these hex values. Spent's seed moved on
2026-11-10 from the brand guide's `#FF6B5E`, which has the hue of Material's `error`.

## How the scheme is built ("Asphalt and lane", 2026-11-10)

Material 3's role model and Google's material-color-utilities, with explicit palettes instead of
one seed (`DynamicScheme`, Fidelity variant, spec 2021, standard contrast):

| Palette         | HCT hue / chroma | Gives                                                                                      |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| primary         | the seed's       | `primary-container` = `#FFC21F` exactly, inverse-primary, the fixed roles (the map casing) |
| neutral         | 243 / 4          | Every surface, on-surface, the ink (Asphalt's own hue and chroma)                          |
| neutral variant | 243 / 8          | Outlines, on-surface-variant, surface-variant                                              |
| secondary       | 243 / 8          | Selection: the active navigation pill, chosen chips and segments, tonal buttons            |
| tertiary, error | Material's       | Tertiary (teal) unused; error is Material's red                                            |

Then a short table of overrides, each with its reason in the script (`OVERRIDES`):

- `primary`, `on-primary`, `surface-tint`: **ink, not gold**. Neutral tone 15 in light, 90 in
  dark. Text buttons, links, checked controls, progress, the tab indicator, a focused field and
  the focus ring are Asphalt ink in light and near-white in dark. `surface-tint` follows so
  Android's tonal elevation never turns yellow.
- `on-primary-container`: Asphalt (neutral tone 6) on Lane yellow, the logo's pairing (11:1),
  instead of Fidelity's brown.
- `on-secondary-container`: tone 10 / 90 of the secondary palette, a crisp label on the grey
  selection pill (Fidelity's mid tone read weak).
- `background`: **the page**. Light: neutral tone 95, a cool grey under white cards. Dark: tone 6,
  Asphalt, equal to `surface`. Android's Scaffold paints `background`, so the page carries over.
- Money: `earned` and `spent` are custom colours that are not harmonised, with Material's tones
  except spent at tone 44 in light and both at tone 70 in dark (their `tones` are in the JSON).

## The surface model

Light and dark build depth differently, as Material's own apps do. `index.css` maps shadcn's
names per theme:

| Level                                     | Light                                    | Dark                                         |
| ----------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Page, top bar, drawer (`bg-background`)   | background `#f0f0f3`                     | background = surface `#111416` (Asphalt)     |
| Card, section, stat tile (`bg-card`)      | surface-container-lowest `#ffffff`       | surface-container `#1e2022`                  |
| A fill on a card (`bg-muted`, `accent`)   | surface-container-high                   | surface-container-highest                    |
| Menu, popover, dialog, date picker, sheet | `bg-popover`: lowest (white), shadow 2–3 | `bg-popover`: surface-container-high, shadow |

On Android the same levels are `MaterialTheme.surfaces` (`ui/theme/Theme.kt`, `Surfaces.of(scheme,
isDark)`): `page` (background), `card` (lowest / surface-container), `fill` (high / highest),
`popover` (lowest / high), plus `road` (inverse-surface in light, lowest in dark), the dark ribbon
under the route sketch's yellow lane. `CardSurface` is the card; dialogs pass
`containerColor = MaterialTheme.surfaces.popover`.

A card reads by lightness alone: no border, no shadow, no tint. Tables have no header fill, only
a hairline under the header. An `Alert` is the card colour inside an outline-variant hairline.

## Colour roles

Generated by `node .claude/skills/milewage-design/scripts/tokens-table.mjs` from the JSON; paste
its output between the markers after `npm run theme -w apps/web`. For `primary`, `earned`,
`spent` and `signal` the Tailwind stem goes through the shadcn alias of the same name.

<!-- tokens-table:start -->

### Material roles

| Role                                     | Tailwind                    | Light     | Dark      |
| ---------------------------------------- | --------------------------- | --------- | --------- |
| background (the page, override)          | `background`                | `#f0f0f3` | `#111416` |
| surface                                  | `surface`                   | `#f9f9fc` | `#111416` |
| surface-container-lowest                 | `surface-container-lowest`  | `#ffffff` | `#0c0e11` |
| surface-container-low                    | `surface-container-low`     | `#f3f3f6` | `#1a1c1e` |
| surface-container                        | `surface-container`         | `#edeef1` | `#1e2022` |
| surface-container-high                   | `surface-container-high`    | `#e8e8eb` | `#282a2d` |
| surface-container-highest                | `surface-container-highest` | `#e2e2e5` | `#333537` |
| surface-variant                          | `surface-variant`           | `#dde3ea` | `#41474d` |
| surface-dim                              | `surface-dim`               | `#d9dadd` | `#111416` |
| surface-bright                           | `surface-bright`            | `#f9f9fc` | `#37393c` |
| on-surface                               | `on-surface`                | `#1a1c1e` | `#e2e2e5` |
| on-surface-variant                       | `on-surface-variant`        | `#41474d` | `#c1c7ce` |
| outline                                  | `outline`                   | `#72787e` | `#8b9198` |
| outline-variant                          | `outline-variant`           | `#c1c7ce` | `#41474d` |
| primary (ink, override)                  | `primary`                   | `#242628` | `#e2e2e5` |
| on-primary (override)                    | `on-primary`                | `#ffffff` | `#1a1c1e` |
| primary-container (Lane yellow)          | `primary-container`         | `#ffc21f` | `#ffc21f` |
| on-primary-container (Asphalt, override) | `on-primary-container`      | `#111416` | `#111416` |
| inverse-primary                          | `inverse-primary`           | `#f9bd17` | `#795900` |
| secondary                                | `md-secondary`              | `#595f65` | `#c1c7ce` |
| on-secondary                             | `on-secondary`              | `#ffffff` | `#2b3137` |
| secondary-container                      | `secondary-container`       | `#dde3ea` | `#41474d` |
| on-secondary-container (override)        | `on-secondary-container`    | `#161c21` | `#dde3ea` |
| tertiary (unused)                        | `tertiary`                  | `#006877` | `#b7f1ff` |
| on-tertiary                              | `on-tertiary`               | `#ffffff` | `#00363f` |
| tertiary-container                       | `tertiary-container`        | `#00dffe` | `#00dffe` |
| on-tertiary-container                    | `on-tertiary-container`     | `#005f6d` | `#005f6d` |
| error                                    | `error`                     | `#ba1a1a` | `#ffb4ab` |
| on-error                                 | `on-error`                  | `#ffffff` | `#690005` |
| error-container                          | `error-container`           | `#ffdad6` | `#93000a` |
| on-error-container                       | `on-error-container`        | `#93000a` | `#ffdad6` |
| inverse-surface                          | `inverse-surface`           | `#2e3133` | `#e2e2e5` |
| inverse-on-surface                       | `inverse-on-surface`        | `#f0f0f3` | `#2e3133` |
| surface-tint (override)                  | (CSS variable only)         | `#242628` | `#e2e2e5` |
| scrim                                    | `scrim`                     | `#000000` | `#000000` |

### Fixed roles (the same in both themes; CSS variables only)

| Role                       | Light     | Dark      |
| -------------------------- | --------- | --------- |
| primary-fixed              | `#ffdf9e` | `#ffdf9e` |
| primary-fixed-dim          | `#f9bd17` | `#f9bd17` |
| on-primary-fixed           | `#261a00` | `#261a00` |
| on-primary-fixed-variant   | `#5b4300` | `#5b4300` |
| secondary-fixed            | `#dde3ea` | `#dde3ea` |
| secondary-fixed-dim        | `#c1c7ce` | `#c1c7ce` |
| on-secondary-fixed         | `#161c21` | `#161c21` |
| on-secondary-fixed-variant | `#41474d` | `#41474d` |
| tertiary-fixed             | `#a5eeff` | `#a5eeff` |
| tertiary-fixed-dim         | `#00daf8` | `#00daf8` |
| on-tertiary-fixed          | `#001f25` | `#001f25` |
| on-tertiary-fixed-variant  | `#004e5a` | `#004e5a` |

### Extended colours (Material custom colours, not harmonised)

| Role                | Tailwind              | Light     | Dark      |
| ------------------- | --------------------- | --------- | --------- |
| earned              | `earned`              | `#006c4b` | `#11c28a` |
| on-earned           | `on-earned`           | `#ffffff` | `#002114` |
| earned-container    | `earned-container`    | `#68fcbf` | `#005137` |
| on-earned-container | `on-earned-container` | `#002114` | `#68fcbf` |
| spent               | `spent`               | `#ac4b00` | `#ff8d4a` |
| on-spent            | `on-spent`            | `#ffffff` | `#331100` |
| spent-container     | `spent-container`     | `#ffdbca` | `#783200` |
| on-spent-container  | `on-spent-container`  | `#331100` | `#ffdbca` |
| signal              | `signal`              | `#005ac3` | `#aec6ff` |
| on-signal           | `on-signal`           | `#ffffff` | `#002e6a` |
| signal-container    | `signal-container`    | `#d8e2ff` | `#004395` |
| on-signal-container | `on-signal-container` | `#001a42` | `#d8e2ff` |

### Chart colours (`--md-extended-color-chart-*`, Tailwind `chart-*`)

| Token            | Light     | Dark      |
| ---------------- | --------- | --------- |
| `chart-series-1` | `#2a78d6` | `#3987e5` |
| `chart-series-2` | `#d4561f` | `#d95926` |
| `chart-series-3` | `#0f8a72` | `#199e70` |
| `chart-series-4` | `#a07000` | `#c98500` |
| `chart-series-5` | `#c4487b` | `#d55181` |
| `chart-series-6` | `#2f7d00` | `#008300` |
| `chart-series-7` | `#6250d6` | `#9085e9` |
| `chart-series-8` | `#d03b3b` | `#e66767` |
| `chart-earned`   | `#006c4b` | `#11c28a` |
| `chart-spent`    | `#ac4b00` | `#ff8d4a` |
| `chart-measure`  | `#5c6c7b` | `#a2b3c3` |
| `chart-other`    | `#8b9198` | `#656b72` |
| `chart-grid`     | `#c1c7ce` | `#41474d` |
| `chart-axis`     | `#72787e` | `#8b9198` |

### Overrides (palette and tone per theme)

| Role                   | Light        | Dark         |
| ---------------------- | ------------ | ------------ |
| primary                | neutral 15   | neutral 90   |
| on-primary             | neutral 100  | neutral 10   |
| surface-tint           | neutral 15   | neutral 90   |
| on-primary-container   | neutral 6    | neutral 6    |
| on-secondary-container | secondary 10 | secondary 90 |
| background             | neutral 95   | neutral 6    |

<!-- tokens-table:end -->

Chart rules: assign `chart-series-1` … `8` in order for identity, never cycled; past eight, fold
into `chart-other`. Every series reaches 3:1 on the card in both themes, and neighbours are apart
for colour-blind readers (validated with the data-viz skill: adjacent CVD ΔE ≥ 10.4 light / 8.4
dark). Money series use `chart-earned` and `chart-spent`; distance and time use the steel
`chart-measure`. Grid lines are `chart-grid` (outline-variant), axes `chart-axis` (outline). Text
in a chart wears the text roles, never a series colour. The brand yellow is not a chart colour.
Derived steps are a `color-mix` of a token with the card in OKLab (`tint()` in `ui/charts`),
validated with the data-viz skill in both themes: tips at 50 % of `chart-earned` beside pay;
deadhead at 45 % of `chart-measure` beside active, with personal distance in `chart-series-7`
(three greys cannot be told apart; adjacent CVD ΔE ≥ 19 light, ≥ 22 dark); the heatmap's five
steps at 48, 61, 74, 87 and 100 % (monotone, ΔL ≥ 0.06, the light end at 2:1 on the card) for
`chart-earned` and `chart-measure`. The tints sit under 3:1, which the legend, the 2 px gaps and
the table relieve.

## shadcn names → roles (`index.css`)

| shadcn                                   | Light                                        | Dark (`.dark`)              |
| ---------------------------------------- | -------------------------------------------- | --------------------------- |
| `background` / `foreground`              | background / on-surface                      | (same roles)                |
| `card` / `card-foreground`               | surface-container-lowest / on-surface        | surface-container           |
| `popover` / `popover-foreground`         | surface-container-lowest / on-surface        | surface-container-high      |
| `primary` / `primary-foreground`         | primary / on-primary (ink, not the yellow)   | (same roles)                |
| `secondary` / `secondary-foreground`     | secondary-container / on-secondary-container | (same roles)                |
| `muted`, `accent`                        | surface-container-high                       | surface-container-highest   |
| `muted-foreground`                       | on-surface-variant                           | (same)                      |
| `accent-foreground`                      | on-surface                                   | (same)                      |
| `destructive` / `destructive-foreground` | error / on-error                             | (same)                      |
| `border` / `input`                       | outline-variant / outline                    | (same)                      |
| `ring`, `sidebar-ring`                   | primary (ink)                                | (same: near-white)          |
| `chart-1` … `chart-5`                    | measure, earned, spent, series-1, other      | (same tokens)               |
| `sidebar` / `sidebar-foreground`         | surface (a step lighter than the page) / on-surface-variant | surface-container-low / (same) |
| `sidebar-primary` (+ foreground)         | primary-container / on-primary-container     | (same)                      |
| `sidebar-accent` (+ foreground)          | secondary-container / on-secondary-container | (same: the active pill)     |
| `sidebar-border`                         | outline-variant                              | (same)                      |
| `qr-ink` / `qr-plate`                    | `#000000` / `#ffffff`                        | the same (scanners need it) |

Old classes (`bg-card`, `text-muted-foreground`, `border`) keep working. For new work, prefer the
role names when you mean a specific step, and `bg-card` / `bg-popover` / `bg-muted` when you mean
a level of the surface model: they follow the theme.

## Type

- Faces (`index.css` `:root`): `--md-ref-typeface-brand` and `--md-ref-typeface-plain` are
  `'Roboto Flex Variable'`, `--md-ref-typeface-mono` is `'Roboto Mono Variable'`, all bundled by
  `@fontsource-variable/*`. `font-heading`, `font-sans` and `font-mono` read them.
- Scale utilities, each setting size, line height, tracking and weight (px):

| Utility                | Size/line | Weight | Used for                                        |
| ---------------------- | --------- | ------ | ----------------------------------------------- |
| `text-display-large`   | 57/64     | 400    | Unused                                          |
| `text-display-medium`  | 45/52     | 400    | A page's hero figure from `sm`                  |
| `text-display-small`   | 36/44     | 400    | Hero figure on phones (Dashboard, Shifts, Tax)  |
| `text-headline-large`  | 32/40     | 400    | Unused                                          |
| `text-headline-medium` | 28/36     | 400    | Page title from `md` (`PageHeader`)             |
| `text-headline-small`  | 24/32     | 400    | Page title on phones, sign-in card title        |
| `text-title-large`     | 22/28     | 400    | `StatCard` figure (with `font-medium`)          |
| `text-title-medium`    | 16/24     | 500    | `Section` and card titles                       |
| `text-title-small`     | 14/20     | 500    | Table headers, drawer group labels              |
| `text-body-large`      | 16/24     | 400    | Field text, list-row titles, `CheckField`       |
| `text-body-medium`     | 14/20     | 400    | Body, descriptions, table cells, `FormError`    |
| `text-body-small`      | 12/16     | 400    | Hints (supporting text), captions under figures |
| `text-label-large`     | 14/20     | 500    | Buttons, chips, segments, menu items            |
| `text-label-medium`    | 12/16     | 500    | Badges, `StatCard` label                        |
| `text-label-small`     | 11/16     | 500    | The `count` badge                               |

- `cn()` (`apps/web/src/lib/utils.ts`) knows these utilities, so `cn('text-title-medium',
'text-on-surface')` keeps both. Export `typeScale` lists them.
- Android: `MaterialTheme.typography.displayLarge` … `labelSmall` (`Typography()` defaults, system
  font). `StatTile` uses `labelLarge` / `headlineSmall` / `bodySmall`.
- The wordmark in the logo is outlined Geist Bold artwork. Never set it as live text.

**To swap the typeface:** change `--md-ref-typeface-brand` and `--md-ref-typeface-plain` in
`index.css` and its `@import '@fontsource-variable/…'` line. The comment there names Google Sans
Flex as the drop-in. On Android, pass a `FontFamily` into `MileWageTypography` in `Theme.kt`.

## Shape

| Material token (px)    | Utility               | Tailwind names moved onto it | Android `MaterialTheme.shapes`           |
| ---------------------- | --------------------- | ---------------------------- | ---------------------------------------- |
| extra-small 4          | `rounded-extra-small` | `rounded-xs`, `rounded-sm`   | `extraSmall`                             |
| small 8                | `rounded-small`       | `rounded-md`                 | `small`                                  |
| medium 12 (`--radius`) | `rounded-medium`      | `rounded-lg`, `rounded-xl`   | `medium`                                 |
| large 16               | `rounded-large`       | `rounded-2xl`                | `large`                                  |
| extra-large 28         | `rounded-extra-large` | `rounded-3xl`, `rounded-4xl` | `extraLarge`                             |
| full                   | `rounded-full`        |                              | `CircleShape` / `RoundedCornerShape(50)` |

## Elevation

`shadow-elevation-0` … `shadow-elevation-5` (`--md-sys-elevation-level*`, key and ambient shadows
from `shadow`). Tailwind's `shadow-xs`/`sm` = level 1, `md` = 2, `lg` = 3, `xl` = 4, `2xl` = 5.
Elevation follows the surface model above: in light a raised thing is whiter, in dark it is
lighter. Add a shadow only as Material does: elevated button/card 1, menu/popover/map control
group 2, dialog/date picker 3, and the Settings save bar while it holds changes.
On Android, use the components' defaults (`CardDefaults`, `AlertDialog`), which are tonal.

## State layers

`--md-sys-state-hover-state-layer-opacity` 0.08, `focus` 0.10, `pressed` 0.10, `dragged` 0.16.

- `state-layer`: a `::before` wash of `currentColor` at those opacities on hover, `:focus-visible`,
  `[data-highlighted]` and open state. The control needs `relative` (or `absolute`).
- `withRipple(onPointerDown)` / `ripple` (`components/ui/ripple.ts`): the press ripple, on the Web
  Animations API. `data-ripple="off"` opts a control out (a button drawn as a text field).
- `focus-ring`: a 3 px outline in `ring` (primary: ink in light, near-white in dark), offset 2 px.
- Android: Material components draw their own ripples and state layers. Use `Modifier.clickable`
  (which ripples) for a custom tappable row, as `ListRow` does.

## Motion

Durations `--md-sys-motion-duration-short1` (50 ms) … `extra-long4` (1000 ms), in steps of 50 to 100. Easing utilities: `ease-standard`, `ease-standard-accelerate`, `ease-standard-decelerate`,
`ease-emphasized`, `ease-emphasized-accelerate`, `ease-emphasized-decelerate`. Use standard for
small state changes (≈150–200 ms) and emphasized-decelerate for things entering (menus, sheets,
dialogs). `prefers-reduced-motion` cuts every transition to near zero and skips the ripple.

## Android equivalents

| Web                                                  | Android (Compose)                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bg-background`, `bg-card`, `bg-muted`, `bg-popover` | `MaterialTheme.surfaces.page`, `.card`, `.fill`, `.popover`; a card is `CardSurface` (`ui/components/Rows.kt`) |
| `bg-surface-container-low` etc.                      | `MaterialTheme.colorScheme.surfaceContainerLow` etc. (prefer the levels above)                                 |
| `text-earned`, `bg-spent-container`                  | `MaterialTheme.extendedColors.earned`, `.spentContainer` (import `app.milewage.phone.ui.theme.extendedColors`) |
| `text-title-medium`                                  | `MaterialTheme.typography.titleMedium`                                                                         |
| `rounded-medium`                                     | `MaterialTheme.shapes.medium`                                                                                  |
| `tabular-nums`                                       | `style.tabular()` (`ui/components/StatTile.kt`)                                                                |
| `theme.ts` (light default, choice)                   | `isSystemInDarkTheme()`; `MileWageTheme(wallpaperColours = …)`                                                 |

`signal` has no Android role. With wallpaper colours on, `extendedColors(isDark, harmonizeWith =
primary)` re-harmonises earned and spent toward the wallpaper's primary (the brand scheme does not
harmonise them), and the brand button takes the wallpaper's primary-container, so nothing is
yellow in that mode but the logo and the notification accent.

**Android's one exception: `inversePrimary`.** The web has no snackbar and leaves inverse-primary
as Fidelity computes it (`#f9bd17` light, a gold `#795900` dark). Android's snackbar draws its
action in it, which would put the yellow on a message and gold in dark, so Android takes the
secondary palette's steel instead: tone 80 `#c1c7ce` on the light theme's dark snackbar (7.7:1),
tone 40 `#595f65` on the dark theme's light snackbar (5.0:1). `BrandSchemeTest.ANDROID_ONLY` holds
the reason and pins the web's value too, so a web change brings the exception back for review.

The window and splash background before Compose draws is `window_background`
(`res/values/colors.xml` `#F0F0F3`, `res/values-night/colors.xml` `#111416`): the page, checked by
`ContrastTest`. `MainActivity` sets the status and navigation bar icons from the app's own theme
choice (`SystemBarStyle.auto(...) { dark }`), the status bar clear over the page-coloured top bar,
three-button navigation over the page colour at 90 %. The adaptive icon's tile stays Asphalt
`#101214`; the notification accent stays Lane yellow.

## Regenerating, and changing the scheme

- `npm run theme -w apps/web` rewrites `m3-scheme.css` and `.json`. `node scripts/m3-theme.mjs
--check` (from `apps/web`) fails when they are stale. So does `apps/web/test/m3-theme.test.ts`,
  which also checks that the seed stays the primary container, that no neutral role carries
  yellow (OKLCH chroma under 0.02), that `primary` is ink, that every override has a reason, and
  that every role `index.css` reads exists in both themes.
- `apps/web/test/m3-contrast.test.ts` holds the floors in both themes: text on each container
  4.5:1 (the brand button's Asphalt label included), text roles and error on every surface 4.5:1,
  earned and spent as text 4.5:1 wherever money is shown, marks (outline, primary, which is also
  the focus ring, earned, spent) 3:1 on every surface, every chart colour 3:1 on the card,
  neighbouring series apart, and `spent` at least ΔE 7 from `error`.
- Then update this file's tables:
  `node .claude/skills/milewage-design/scripts/tokens-table.mjs`, pasted between the markers.
- `BrandSchemeTest` (`apps/android/app/src/test/.../ui/theme/`) pins Android to `m3-scheme.json`
  three ways: its recipe (palettes, overrides, money seeds and tones) equals the JSON's; the
  generated `BrandColors` is what that recipe gives with materialkolor (it writes the source to
  `app/build/brand-colors/BrandColors.kt` to copy over); and every role is the JSON's hex in both
  themes except `ANDROID_ONLY`. It fails when the JSON is missing. `ContrastTest` holds the pairs
  the app draws at 4.5:1 text and 3:1 marks on the Android surface levels.
- **To change a palette, an override or a money seed:** edit `PALETTES`, `OVERRIDES` or `CUSTOM`
  in `m3-theme.mjs` with the reason beside it, run the theme script and the web tests, then
  bring Android in line: the recipe constants in `BrandSchemeTest` and `ExtendedSeeds`, then the
  generated `BrandColors.kt`, then `window_background` if `background` moved. The `window_background` and `theme-color` values (`index.html`,
  `manifest.webmanifest`; `test/theme.test.ts` and `test/manifest.test.ts` check them) follow
  `background`.
