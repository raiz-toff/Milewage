# Tokens

Source of truth: `apps/web/src/index.css` (web, light and dark), `apps/phone/src/global.css` (phone,
HSL, dark only) and `apps/phone/src/theme/colors.ts` (hex mirror for native places). The phone's
`test/tokens.test.ts` compares the last two; the web has no such test, so compare by hand when a
value changes.

## Brand constants

| Name        | Hex       | Used as                                                     |
| ----------- | --------- | ----------------------------------------------------------- |
| Lane yellow | `#FFC21F` | primary, ring, sidebar primary, phone notification tint     |
| Asphalt     | `#101214` | phone canvas; web ink in light, web canvas in dark          |
| Signal blue | `#4C8DFF` | live position only (reserved, unused today)                 |
| Earned      | `#34D399` | money in (dark); `#0F9F6E` in light                         |
| Spent       | `#FF6B5E` | money out and destructive (dark); `#D93F33` in light        |
| Off-white   | `#ECEEF0` | text on dark, wordmark on dark                              |

## Web, light (default)

| Token                | Value     | Notes                                   |
| -------------------- | --------- | --------------------------------------- |
| background           | `#f5f6f8` | page                                    |
| foreground           | `#101214` | text                                    |
| card / popover       | `#ffffff` |                                         |
| primary              | `#ffc21f` | foreground `#101214`                    |
| secondary / muted / accent | `#eceef0` | foreground `#101214`               |
| muted-foreground     | `#5c636b` | secondary text, 4.5:1 on white          |
| destructive          | `#d93f33` |                                         |
| border               | `#e1e4e8` |                                         |
| input                | `#d3d7dc` |                                         |
| ring                 | `#ffc21f` | focus ring                              |
| earned               | `#0f9f6e` |                                         |
| spent                | `#d93f33` |                                         |
| signal               | `#2f6fe0` |                                         |
| chart-1              | `#b88600` | darker amber, 3.3:1 on a white card     |
| chart-2 / 3 / 4 / 5  | `#0f9f6e` / `#2f6fe0` / `#d93f33` / `#8b939c` |     |
| sidebar              | `#ffffff` | sidebar-border `#e1e4e8`, accent `#eceef0` |

## Web, dark (`.dark` on `<html>`)

| Token                | Value     |
| -------------------- | --------- |
| background           | `#101214` |
| foreground           | `#eceef0` |
| card / popover       | `#181b1e` |
| primary              | `#ffc21f` (foreground `#101214`) |
| secondary / muted / accent / border / input | `#262a2f` |
| muted-foreground     | `#8b939c` |
| destructive / spent  | `#ff6b5e` |
| ring                 | `#ffc21f` |
| earned               | `#34d399` |
| signal               | `#4c8dff` |
| chart-1 / 2 / 3 / 4 / 5 | `#ffc21f` / `#34d399` / `#4c8dff` / `#ff6b5e` / `#8b939c` |
| sidebar              | `#101214`, border and accent `#262a2f` |

`color-scheme` follows the theme so native scroll bars and form controls match.

## Phone (always dark)

`global.css` holds the same dark values as HSL triplets under shadcn names, consumed by NativeWind
through `tailwind.config.js` (`hsl(var(--name) / <alpha-value>)`). Neutrals: canvas `#101214`,
surface `#181B1E`, line `#262A2F`, secondary text `#8B939C`, text `#ECEEF0`. `PALETTE` in
`colors.ts` is the hex mirror; `destructive` on the phone is Spent.

## Type

- Web: `--font-sans: 'Geist Variable'`, `--font-mono: 'Geist Mono Variable'` (fontsource imports in
  `index.css`); `--font-heading` is the sans. No other font anywhere.
- Phone: `Geist_400Regular`, `Geist_500Medium`, `Geist_600SemiBold`, `Geist_700Bold`,
  `GeistMono_400Regular` as separate families (Android loads one file per weight).
- Scale in use: page title `text-2xl font-semibold tracking-tight`; section title as shadcn's
  CardTitle; body `text-base` (`md:text-sm` in dense inputs); supporting text `text-sm
  text-muted-foreground`; hints and tick labels `text-xs text-muted-foreground`; big figures in
  `StatCard`. Numbers in columns: `tabular-nums`.
- The wordmark is Geist Bold, upper case, outlined in the SVGs; never set it live in another font.

## Shape and space

- `--radius: 0.625rem`. Derived: `rounded-sm` 6 px, `md` 8, `lg` 10, `xl` 14, `2xl` 18 (the phone
  pins these pixel values). Cards and `TableBox`: `rounded-xl border`. Bars in charts: 4 px tops.
- Gaps: 16 between cards and as card padding; 8 between related rows; 2 between chart columns.
- Hit targets: 56 dp list rows and a 48 dp header bar on the phone; shadcn's `h-8` inputs and
  `size="sm"` buttons on dense web tables, default sizes elsewhere.
- The installed web app respects `env(safe-area-inset-*)`; keep content out of notches.

## Icons and images

- `lucide-react`, 16 px (`size-4`) in buttons and menus. On the phone the tracker's status icon is
  one colour from the alpha channel (Android draws it that way).
- The logo is `LogoMark` on the web (`apps/web/src/components/logo.tsx`) and `Logo` on the phone;
  below 24 px use the small variant (no lane dashes). Clear space: a quarter of the symbol's height.
- Platform logos are not shipped (trademarks); drivers upload their own, 256 KB max.
