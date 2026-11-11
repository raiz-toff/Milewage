#!/usr/bin/env node
// Writes app/src/main/kotlin/app/milewage/phone/ui/icons/Icons.kt: the app's Material Symbols
// (Rounded, weight 400, grade 0, 24 px), the same icons and names as the web's apps/web/src/ui/icons.tsx,
// from the same data (@iconify-icons/material-symbols, Apache-2.0, installed at the repository root).
// Offline: no font, no download. Run from anywhere with Node 22:
//   node apps/android/scripts/material-symbols.mjs
// Each entry: Kotlin name, outlined symbol, the filled symbol for a selected navigation item (or
// null), and whether it mirrors in right-to-left layouts (arrows and chevrons).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const data = join(root, 'node_modules', '@iconify-icons', 'material-symbols', 'data');
const out = join(
  here,
  '..',
  'app',
  'src',
  'main',
  'kotlin',
  'app',
  'milewage',
  'phone',
  'ui',
  'icons',
  'Icons.kt',
);

/** [name, outlined, filled, mirrored]. Names follow the web's `<Name>Icon` exports without "Icon". */
const ICONS = [
  // Actions (web: Actions).
  ['Add', 'add-rounded'],
  ['Edit', 'edit-outline-rounded'],
  ['Delete', 'delete-outline-rounded'],
  ['Close', 'close-rounded'],
  ['Check', 'check-rounded'],
  ['Copy', 'content-copy-outline-rounded'],
  ['Paste', 'content-paste-rounded'],
  ['Download', 'download-rounded'],
  ['Refresh', 'refresh-rounded'],
  ['Play', 'play-arrow-outline-rounded'],
  ['Send', 'send-outline-rounded', null, true],
  ['Share', 'share-outline-rounded'],
  ['OpenInNew', 'open-in-new-rounded', null, true],
  ['QrScanner', 'qr-code-scanner-rounded'],
  ['TorchOn', 'flashlight-on-outline-rounded'],
  ['TorchOff', 'flashlight-off-outline-rounded'],
  ['Keyboard', 'keyboard-outline-rounded'],
  ['Link', 'link-rounded'],
  // Arrows and chevrons.
  ['Back', 'arrow-back-rounded', null, true],
  ['ChevronRight', 'chevron-right-rounded', null, true],
  // Status.
  ['Info', 'info-outline-rounded'],
  ['Warning', 'warning-outline-rounded'],
  ['Error', 'error-outline-rounded'],
  ['Help', 'help-outline-rounded'],
  ['WifiOff', 'wifi-off-rounded'],
  ['Wifi', 'wifi-rounded'],
  ['CheckCircle', 'check-circle-rounded'],
  ['Circle', 'radio-button-unchecked-rounded'],
  ['Flag', 'flag-outline-rounded'],
  ['Location', 'location-on-outline-rounded'],
  ['LocationOff', 'location-off-outline-rounded'],
  ['MyLocation', 'my-location-outline-rounded'],
  ['AllTheTime', 'near-me-outline-rounded'],
  ['Battery', 'battery-charging-full-rounded'],
  ['BatterySaving', 'eco-outline-rounded'],
  ['LocalNetwork', 'router-outline-rounded'],
  ['CameraOff', 'no-photography-outline-rounded'],
  ['Server', 'dns-outline-rounded'],
  ['Tailscale', 'vpn-key-outline-rounded'],
  ['Timer', 'timer-outline-rounded'],
  ['Palette', 'palette-outline-rounded'],
  ['LightMode', 'light-mode-outline-rounded'],
  ['DarkMode', 'dark-mode-outline-rounded'],
  ['SystemMode', 'mobile-outline-rounded'],
  ['Units', 'straighten-outline-rounded'],
  ['Code', 'code-rounded'],
  ['Licences', 'description-outline-rounded'],
  ['Privacy', 'privacy-tip-outline-rounded'],
  ['Key', 'key-outline-rounded'],
  // Pictures in an icon tile (web: ui/visuals.tsx).
  ['Route', 'route-outline-rounded'],
  ['Savings', 'savings-outline-rounded'],
  ['Time', 'schedule-outline-rounded'],
  ['Odometer', 'speed-outline-rounded'],
  ['Globe', 'language'],
  ['Payments', 'payments-outline-rounded'],
  // Navigation destinations (with a filled form for the selected one).
  ['Home', 'home-outline-rounded', 'home-rounded'],
  ['Shifts', 'calendar-month-outline-rounded', 'calendar-month-rounded'],
  ['Settings', 'settings-outline-rounded', 'settings-rounded'],
  ['Notifications', 'notifications-outline-rounded', 'notifications-rounded'],
  ['Devices', 'mobile-outline-rounded', 'mobile-rounded'],
  ['Vehicles', 'directions-car-outline-rounded', 'directions-car-rounded'],
  ['Maintenance', 'build-outline-rounded'],
];

function read(name) {
  const text = readFileSync(join(data, name[0], `${name}.js`), 'utf8');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const icon = JSON.parse(json);
  if ((icon.width ?? 24) !== 24 || (icon.height ?? 24) !== 24)
    throw new Error(`${name}: not 24 x 24`);
  const body = icon.body.trim();
  const paths = [];
  const tag = /<path\b([^>]*)\/>/g;
  let m;
  let rest = body;
  while ((m = tag.exec(body)) !== null) {
    const attrs = m[1];
    const d = /\bd="([^"]+)"/.exec(attrs)?.[1];
    if (!d) throw new Error(`${name}: a path without d`);
    for (const a of attrs.matchAll(/([a-z-]+)="/g)) {
      if (!['d', 'fill', 'fill-rule'].includes(a[1]))
        throw new Error(`${name}: unsupported attribute ${a[1]}`);
    }
    const fill = /\bfill="([^"]+)"/.exec(attrs)?.[1];
    if (fill && fill !== 'currentColor') throw new Error(`${name}: fill ${fill}`);
    paths.push({ d, evenOdd: /fill-rule="evenodd"/.test(attrs) });
    rest = rest.replace(m[0], '');
  }
  if (rest.trim() !== '' || paths.length === 0)
    throw new Error(`${name}: unsupported markup ${rest.slice(0, 80)}`);
  return paths;
}

const kt = (paths) =>
  paths.map((p) => `P(${JSON.stringify(p.d)}${p.evenOdd ? ', evenOdd = true' : ''})`).join(', ');

const lines = [];
for (const [name, outlined, filled, mirrored] of ICONS) {
  const m = mirrored ? ', mirrored = true' : '';
  lines.push(
    `    val ${name}: ImageVector by lazy { symbol("${name}", listOf(${kt(read(outlined))})${m}) }`,
  );
  if (filled)
    lines.push(
      `    val ${name}Filled: ImageVector by lazy { symbol("${name}Filled", listOf(${kt(read(filled))})${m}) }`,
    );
}

const source = `// Generated by apps/android/scripts/material-symbols.mjs from @iconify-icons/material-symbols (Apache-2.0).
// Do not edit: add the icon to the script's list and run it again.
package app.milewage.phone.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The app's icons: Material Symbols, Rounded, weight 400, the 24 dp optical size, the same set and
 * names as the web (\`apps/web/src/ui/icons.tsx\`, \`AddIcon\` there is \`Icons.Add\` here). Outlined by
 * default; \`...Filled\` is the filled form, only for the selected navigation item. Drawn as vectors
 * from the symbols' path data: no font and no download. Tinted by \`Icon\` with the content colour.
 */
object Icons {
${lines.join('\n')}
}

private class P(val d: String, val evenOdd: Boolean = false)

private fun symbol(name: String, paths: List<P>, mirrored: Boolean = false): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f, autoMirror = mirrored).apply {
        for (p in paths) {
            addPath(addPathNodes(p.d), fill = SolidColor(Color.Black), pathFillType = if (p.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero)
        }
    }.build()
`;
writeFileSync(out, source);
console.log(`${ICONS.length} icons -> ${out}`);
