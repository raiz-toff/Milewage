import qrcode from 'qrcode-generator';

/** A QR code as inline SVG rects. Dark modules are `currentColor` over a light plate. */
export function Qr({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cells: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) cells.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }
  const size = n + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="h-56 w-56 rounded bg-white"
      shapeRendering="crispEdges"
    >
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}
