"""Generate the AjoAI cover banner (public/cover.png).

Used as the ERC-8004 agent card's `cover` (the wide banner AIGORA renders above a listing) and as
the site's OpenGraph image. Market Blocks brand, §9: hard ink borders, offset shadows, the Circle
& Baton ring, colour = meaning (green members, ochre baton).

Run:  python miniapp/scripts/make_cover.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "public" / "cover.png"

# Brand palette (mirrors public/icon.svg).
INK = (26, 26, 26)
PAPER = (244, 236, 216)
GREEN = (31, 122, 77)
OCHRE = (217, 142, 43)

W, H = 1200, 630
BORDER = 10  # scaled-up equivalent of the 2.5px ink border
SHADOW = 14

FONTS = ("C:/Windows/Fonts/seguibl.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf")


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def ring(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    """The Circle & Baton: seven members around an agent, with the active baton at the top."""
    for i in range(1, 8):
        a = -math.pi / 2 + i * (2 * math.pi / 8)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        d.ellipse((x - 15, y - 15, x + 15, y + 15), fill=GREEN)
    d.ellipse((cx - 23, cy - r - 23, cx + 23, cy - r + 23), fill=OCHRE, outline=INK, width=5)
    d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), fill=INK)
    d.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=PAPER)


def main() -> None:
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # Offset shadow, then the ink-bordered panel sitting on top of it.
    d.rectangle((BORDER + SHADOW, BORDER + SHADOW, W - BORDER, H - BORDER), fill=INK)
    d.rectangle((BORDER, BORDER, W - BORDER - SHADOW, H - BORDER - SHADOW), fill=PAPER, outline=INK, width=BORDER)

    ring(d, cx=282, cy=H / 2 - 6, r=132)

    x = 500
    d.text((x, 196), "AjoAI", font=font(104), fill=INK)
    d.text((x, 312), "Save like your village", font=font(40), fill=INK)
    d.text((x, 360), "always has.", font=font(40), fill=INK)

    # Ochre rule + strapline, echoing the baton colour.
    d.rectangle((x, 424, x + 96, 434), fill=OCHRE)
    d.text((x, 458), "Autonomous rotating savings on Celo", font=font(27), fill=(70, 70, 70))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes, {W}x{H})")


if __name__ == "__main__":
    main()
