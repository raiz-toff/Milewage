# Tokens

Sources of truth:

- `apps/web/scripts/m3-theme.mjs` generates `apps/web/src/theme/m3-scheme.css` (the roles as
  `--md-sys-color-*` and `--md-extended-color-*`, light on `:root`, dark on `.dark`) and
  `m3-scheme.json` (the same values, read by `theme.ts`, `map/style.ts` and Android's test). Never
  edit these two by hand.
- `apps/web/src/index.css` holds the other Material tokens (type, shape, elevation, state, motion),
  maps the roles to Tailwind colours, and maps shadcn's names onto the roles.
- Android: `ui/theme/BrandColors.kt` (generated, pinned by `BrandSchemeTest`), `ExtendedColors.kt`
  and `Theme.kt` under `apps/android/app/src/main/kotlin/app/milewage/phone/`.

## Brand constants

| Name        | Hex       | Where it is used directly                                                     |
| ----------- | --------- | ----------------------------------------------------------------------------- |
| Lane yellow | `#FFC21F` | The scheme's seed and `primary-container`; the logo                           |
| Asphalt     | `#101214` | The logo's ink, the Android adaptive-icon tile (`ic_launcher_background`)     |
| Earned      | `#34D399` | Seed of `earned`, harmonised toward the yellow                                |
| Spent       | `#FF6B5E` | Seed of `spent`, harmonised (it comes out red-orange)                         |
| Signal blue | `#4C8DFF` | Seed of `signal`, not harmonised; reserved for a live position marker, unused |

Everything in the UI uses the generated roles below, not these hex values.

## Colour roles (seed `#FFC21F`, Fidelity, spec 2021, contrast 0)

Tailwind class stem in the second column (`bg-…`, `text-…`, `border-…`). For `primary`, `earned`,
`spent` and `signal` the stem goes through the shadcn alias of the same name.

| Role                      | Tailwind                    | Light     | Dark      |
| ------------------------- | --------------------------- | --------- | --------- |
| primary                   | `primary`                   | `#795900` | `#ffe5b3` |
| on-primary                | `on-primary`                | `#ffffff` | `#402d00` |
| primary-container         | `primary-container`         | `#ffc21f` | `#ffc21f` |
| on-primary-container      | `on-primary-container`      | `#6e5100` | `#6e5100` |
| inverse-primary           | `inverse-primary`           | `#f9bd17` | `#795900` |
| secondary                 | `md-secondary`              | `#745b22` | `#e3c27f` |
| on-secondary              | `on-secondary`              | `#ffffff` | `#402d00` |
| secondary-container       | `secondary-container`       | `#fedb95` | `#5c460d` |
| on-secondary-container    | `on-secondary-container`    | `#785f26` | `#d4b472` |
| tertiary (unused)         | `tertiary`                  | `#006877` | `#b7f1ff` |
| on-tertiary               | `on-tertiary`               | `#ffffff` | `#00363f` |
| tertiary-container        | `tertiary-container`        | `#00dffe` | `#00dffe` |
| on-tertiary-container     | `on-tertiary-container`     | `#005f6d` | `#005f6d` |
| error                     | `error`                     | `#ba1a1a` | `#ffb4ab` |
| on-error                  | `on-error`                  | `#ffffff` | `#690005` |
| error-container           | `error-container`           | `#ffdad6` | `#93000a` |
| on-error-container        | `on-error-container`        | `#93000a` | `#ffdad6` |
| surface                   | `surface`                   | `#fff8f2` | `#171309` |
| on-surface                | `on-surface`                | `#201b11` | `#ece1d1` |
| surface-variant           | `surface-variant`           | `#f0e1c7` | `#4f4633` |
| on-surface-variant        | `on-surface-variant`        | `#4f4633` | `#d3c5ac` |
| surface-dim               | `surface-dim`               | `#e4d9c8` | `#171309` |
| surface-bright            | `surface-bright`            | `#fff8f2` | `#3f382d` |
| surface-container-lowest  | `surface-container-lowest`  | `#ffffff` | `#120e05` |
| surface-container-low     | `surface-container-low`     | `#fef2e1` | `#201b11` |
| surface-container         | `surface-container`         | `#f8ecdc` | `#241f15` |
| surface-container-high    | `surface-container-high`    | `#f2e7d6` | `#2f291f` |
| surface-container-highest | `surface-container-highest` | `#ece1d1` | `#3a3429` |
| outline                   | `outline`                   | `#817660` | `#9c8f79` |
| outline-variant           | `outline-variant`           | `#d3c5ac` | `#4f4633` |
| inverse-surface           | `inverse-surface`           | `#363025` | `#ece1d1` |
| inverse-on-surface        | `inverse-on-surface`        | `#fbefdf` | `#363025` |
| scrim / shadow            | `scrim` / `shadow`          | `#000000` | `#000000` |

The scheme also has `background`/`on-background` (equal to surface/on-surface), `surface-tint`
and the `*-fixed*` roles. They are CSS variables only, with no Tailwind class. The map's route
casing reads `onPrimaryFixed` from the JSON.

## Extended colours (Material custom colours)

| Role                | Tailwind              | Light     | Dark      | For                |
| ------------------- | --------------------- | --------- | --------- | ------------------ |
| earned              | `earned`              | `#006e2e` | `#72dc86` | Money in, only     |
| on-earned           | `on-earned`           | `#ffffff` | `#003914` |                    |
| earned-container    | `earned-container`    | `#8ef99f` | `#005321` |                    |
| on-earned-container | `on-earned-container` | `#002109` | `#8ef99f` |                    |
| spent               | `spent`               | `#a63b00` | `#ffb599` | Money out, only    |
| on-spent            | `on-spent`            | `#ffffff` | `#5a1c00` |                    |
| spent-container     | `spent-container`     | `#ffdbce` | `#7f2b00` |                    |
| on-spent-container  | `on-spent-container`  | `#370e00` | `#ffdbce` |                    |
| signal (+ 3 roles)  | `signal`, ...         | `#005ac3` | `#aec6ff` | Reserved; web only |

## shadcn names → roles (`index.css`, `:root`)

| shadcn                                   | Role                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| `background` / `foreground`              | surface / on-surface                                       |
| `card` / `card-foreground`               | surface-container-low / on-surface                         |
| `popover` / `popover-foreground`         | surface-container / on-surface                             |
| `primary` / `primary-foreground`         | primary / on-primary (not the yellow)                      |
| `secondary` / `secondary-foreground`     | secondary-container / on-secondary-container               |
| `muted`, `accent`                        | surface-container-highest                                  |
| `muted-foreground`                       | on-surface-variant                                         |
| `accent-foreground`                      | on-surface                                                 |
| `destructive` / `destructive-foreground` | error / on-error                                           |
| `border` / `input`                       | outline-variant / outline                                  |
| `ring`, `sidebar-ring`                   | secondary (Material's focus colour)                        |
| `chart-1`                                | primary in light, primary-container (the yellow) in dark   |
| `chart-2` / `3` / `4` / `5`              | earned / signal / spent / outline                          |
| `sidebar` / `sidebar-foreground`         | surface-container-low / on-surface-variant                 |
| `sidebar-primary` (+ foreground)         | primary-container / on-primary-container                   |
| `sidebar-accent` (+ foreground)          | secondary-container / on-secondary-container (active pill) |
| `sidebar-border`                         | outline-variant                                            |
| `qr-ink` / `qr-plate`                    | `#000000` / `#ffffff` in both themes (scanners need it)    |

Old classes (`bg-card`, `text-muted-foreground`, `border`) keep working. For new work, prefer the
role names: they say which surface you mean.

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
| `text-headline-large`  | 32/40     | 400    | Progress level                                  |
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
Elevation is tonal first: higher means a higher `surface-container-*`. Add a shadow only as
Material does: elevated button/card 1, menu/popover/map control group 2, dialog/date picker 3.
On Android, use the components' defaults (`CardDefaults`, `AlertDialog`), which are tonal.

## State layers

`--md-sys-state-hover-state-layer-opacity` 0.08, `focus` 0.10, `pressed` 0.10, `dragged` 0.16.

- `state-layer`: a `::before` wash of `currentColor` at those opacities on hover, `:focus-visible`,
  `[data-highlighted]` and open state. The control needs `relative` (or `absolute`).
- `withRipple(onPointerDown)` / `ripple` (`components/ui/ripple.ts`): the press ripple, on the Web
  Animations API. `data-ripple="off"` opts a control out (a button drawn as a text field).
- `focus-ring`: a 3 px outline in `ring` (secondary), offset 2 px.
- Android: Material components draw their own ripples and state layers. Use `Modifier.clickable`
  (which ripples) for a custom tappable row, as `ListRow` does.

## Motion

Durations `--md-sys-motion-duration-short1` (50 ms) … `extra-long4` (1000 ms), in steps of 50 to 100. Easing utilities: `ease-standard`, `ease-standard-accelerate`, `ease-standard-decelerate`,
`ease-emphasized`, `ease-emphasized-accelerate`, `ease-emphasized-decelerate`. Use standard for
small state changes (≈150–200 ms) and emphasized-decelerate for things entering (menus, sheets,
dialogs). `prefers-reduced-motion` cuts every transition to near zero and skips the ripple.

## Android equivalents

| Web                                 | Android (Compose)                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bg-surface-container-low` etc.     | `MaterialTheme.colorScheme.surfaceContainerLow` etc.                                                           |
| `text-earned`, `bg-spent-container` | `MaterialTheme.extendedColors.earned`, `.spentContainer` (import `app.milewage.phone.ui.theme.extendedColors`) |
| `text-title-medium`                 | `MaterialTheme.typography.titleMedium`                                                                         |
| `rounded-medium`                    | `MaterialTheme.shapes.medium`                                                                                  |
| `tabular-nums`                      | `style.tabular()` (`ui/components/StatTile.kt`)                                                                |
| `theme.ts` (light default, choice)  | `isSystemInDarkTheme()`; `MileWageTheme(wallpaperColours = …)`                                                 |

`signal` has no Android role. With wallpaper colours on, `extendedColors(sourceArgb, isDark)`
re-harmonises earned and spent toward the wallpaper's primary, using tones 40/100/90/10 in light
and 80/20/30/90 in dark. The window background before Compose draws is `window_background`
(`res/values/colors.xml`, the light surface `#FFF8F2`). The dark window comes from
`values-night/themes.xml` on the platform's dark Material theme.

## Regenerating, and changing the seed

- `npm run theme -w apps/web` rewrites `m3-scheme.css` and `.json`. `node scripts/m3-theme.mjs
--check` (from `apps/web`) fails when they are stale. So does `apps/web/test/m3-theme.test.ts`,
  which also checks that the seed stays the primary container and that every role `index.css`
  reads exists in both themes.
- `apps/web/test/m3-contrast.test.ts` holds the contrast floors (text on each container 4.5:1,
  text roles on every surface 4.5:1, marks 3:1, `chart-1` 3:1 on cards).
- `BrandSchemeTest` (`apps/android/app/src/test/.../ui/theme/`) regenerates Android's scheme with
  materialkolor. It writes the expected source to `app/build/brand-colors/BrandColors.kt`, which
  you copy over `BrandColors.kt` when it fails. `matchesTheWebScheme` compares every role with
  `m3-scheme.json`.
- **To change the seed or the variant:** edit `SEED` / `VARIANT` / `CUSTOM` in `m3-theme.mjs`, run
  the theme script, run the web tests, then run `./gradlew :app:test` in `apps/android` and copy
  the generated `BrandColors.kt`. Also change `SEED` in `BrandSchemeTest` and `ExtendedSeeds` if
  the money seeds moved. The `window_background` and `theme-color` values (`index.html`,
  `manifest.webmanifest`; `test/theme.test.ts` checks them) follow the new surface.
