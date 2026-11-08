#!/usr/bin/env python3
"""Makes every web app icon from one picture (plan 27 section 4.1).

To change the logo: replace apps/web/icons/source.png (a square PNG, at least 1024 x 1024,
opaque, with the mark inside the centre circle of 80 % of the width, the maskable safe zone),
set MARK and BACKGROUND below if the colours change, then run

    python3 apps/web/icons/generate.py

and commit what it writes under apps/web/public. Needs Pillow (`pip install Pillow`). The
manifest (apps/web/public/manifest.webmanifest) and index.html already point at these names.
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
SOURCE = HERE / "source.png"

# Lane yellow, the mark; Asphalt, the background (05 section 2).
MARK = (0xFF, 0xC2, 0x1F)
BACKGROUND = (0x10, 0x12, 0x14)
# Corner radius of the "any" icons, as a share of the side (they are shown as they are).
CORNER = 0.1875


def resized(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.Resampling.LANCZOS)


def rounded(img: Image.Image) -> Image.Image:
    """The picture with round corners on a transparent ground, for icons shown unmasked."""
    size = img.width * 4  # draw the mask large, then shrink it, for smooth edges
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * CORNER), fill=255
    )
    out = img.convert("RGBA")
    out.putalpha(mask.resize(img.size, Image.Resampling.LANCZOS))
    return out


def monochrome(img: Image.Image) -> Image.Image:
    """Only the mark, white, its shape in the alpha channel (the manifest's `monochrome`)."""
    rgb = img.convert("RGB")
    # Edge pixels are blends of the two colours, so the red channel says how much is mark.
    lo, hi = BACKGROUND[0], MARK[0]
    lut = [max(0, min(255, round(255 * (v - lo) / (hi - lo)))) for v in range(256)]
    alpha = rgb.getchannel("R").point(lut)
    out = Image.new("RGBA", rgb.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    return out


def main() -> None:
    src = Image.open(SOURCE).convert("RGB")
    if src.width != src.height or src.width < 1024:
        raise SystemExit("source.png must be square and at least 1024 x 1024")
    (PUBLIC / "icons").mkdir(parents=True, exist_ok=True)

    def save(img: Image.Image, name: str) -> None:
        img.save(PUBLIC / name, optimize=True)
        print(f"wrote apps/web/public/{name}")

    for size in (192, 512):
        save(rounded(resized(src, size)), f"icons/icon-{size}.png")
        # Full bleed: the platform cuts its own shape (circle, squircle) out of it.
        save(resized(src, size), f"icons/maskable-{size}.png")
    save(resized(monochrome(src), 512), "icons/monochrome-512.png")
    # iOS rounds the corners itself and shows transparency as black: opaque, full bleed.
    save(resized(src, 180), "apple-touch-icon.png")
    rounded(resized(src, 256)).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote apps/web/public/favicon.ico")


if __name__ == "__main__":
    main()
