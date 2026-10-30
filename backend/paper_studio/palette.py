"""Slide palette from a catalog template's cover image (ppttemplate.ai, CC BY 4.0).

The catalog's .pptx files are flat slide pictures, so we take their colours, not their layout: quantize the cover,
pick a dark ink, a saturated accent and three supporting hues, then nudge each for text contrast on white/dark slides.
"""
from __future__ import annotations

import colorsys
import io

import httpx
from PIL import Image

_ALLOWED = "https://cdn.ppttemplate.ai/"


def _hex(rgb) -> str:
    return "".join(f"{max(0, min(255, round(c))):02X}" for c in rgb)


def _lum(rgb) -> float:
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b) -> float:
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _hls(rgb):
    return colorsys.rgb_to_hls(*(c / 255 for c in rgb))


def _from_hls(h, l, s):
    return tuple(c * 255 for c in colorsys.hls_to_rgb(h, l, s))


def _darken_until(rgb, bg, ratio):
    h, l, s = _hls(rgb)
    while _contrast(_from_hls(h, l, s), bg) < ratio and l > 0.05:
        l -= 0.03
    return _from_hls(h, l, s)


def _mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def palette_from_image(data: bytes) -> dict:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((240, 240))
    q = im.quantize(colors=16, method=Image.Quantize.FASTOCTREE)
    pal = q.getpalette()[:48]
    counts = sorted(q.getcolors(), reverse=True)   # (count, index)
    total = sum(c for c, _ in counts)
    cols = [(c / total, tuple(pal[i * 3: i * 3 + 3])) for c, i in counts]

    white = (255, 255, 255)
    darks = [c for w, c in cols if _hls(c)[1] < 0.35 and w > 0.01]
    ink = min(darks, key=lambda c: _hls(c)[1]) if darks else (31, 27, 58)
    h, l, s = _hls(ink)
    ink = _from_hls(h, min(l, 0.16), min(s, 0.6))

    vivid = [c for _, c in sorted(((w, c) for w, c in cols if _hls(c)[2] > 0.25 and 0.2 < _hls(c)[1] < 0.8 and w > 0.004),
                                  key=lambda wc: -(_hls(wc[1])[2] * wc[0] ** 0.5))]
    hues: list[tuple] = []
    for c in vivid:
        if all(min(abs(_hls(c)[0] - _hls(x)[0]), 1 - abs(_hls(c)[0] - _hls(x)[0])) > 0.07 for x in hues):
            hues.append(c)
    # fill missing supporting hues by rotating the accent
    base = hues[0] if hues else (232, 69, 127)
    bh, bl, bs = _hls(base)
    while len(hues) < 4:
        k = len(hues)
        hues.append(_from_hls((bh + [0, 0.42, 0.13, 0.7][k]) % 1, 0.45, max(0.45, bs * 0.85)))
    accent, amber, teal, violet = (_darken_until(c, white, 3.2) for c in hues[:4])

    ih, il, isat = _hls(ink)
    return {
        "ink": _hex(ink), "accent": _hex(accent), "amber": _hex(_darken_until(amber, white, 2.2)), "teal": _hex(teal), "violet": _hex(violet),
        "slate": _hex(_from_hls(ih, 0.34, min(isat, 0.18))), "soft": _hex(_mix(white, accent, 0.06)), "line": _hex(_mix(white, ink, 0.14)),
        "onDark": _hex(_mix(ink, white, 0.78)), "onDark2": _hex(_mix(ink, white, 0.9)), "chip": _hex(_mix(ink, white, 0.12)),
        "chipLine": _hex(_mix(ink, white, 0.25)), "panel": _hex(_mix(ink, white, 0.07)), "grid": _hex(_mix(white, ink, 0.08)),
        "head": "Cambria", "body": "Calibri",
    }


async def palette_for(template: dict) -> dict:
    url = template.get("cover") or ""
    if not url.startswith(_ALLOWED):
        raise ValueError("unsupported template image")
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as c:
        r = await c.get(url)
        r.raise_for_status()
        if len(r.content) > 6_000_000:
            raise ValueError("image too large")
    out = palette_from_image(r.content)
    out.update(id=f"tpl:{template['slug']}", name=template["title"][:40], blurb="Colours from a ppttemplate.ai design (CC BY 4.0)",
               source=template["url"])
    return out
