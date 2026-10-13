#!/usr/bin/env python3
"""Decode tile/sprite graphics from a MAME ROM zip using a MAME-style gfx_layout and
write a PNG sheet, so you can SEE whether the layout, plane order and rotation are right
before writing any renderer code.

Usage:
  python gfx_sheet.py ZIP --files gg1_11.4d,gg1_10.4f --layout namco-sprite16 --out sheet.png
  python gfx_sheet.py ZIP --files gg1_9.4l --layout namco-char8 --scale 4 --out chars.png
  python gfx_sheet.py ZIP --files a.bin --layout-json my_layout.json --rotate 90 --out s.png

Options:
  --files      comma-separated ROM files concatenated into one region (in this order)
  --layout     preset name (see PRESETS) or --layout-json FILE with the same keys
  --rotate     0/90/270: display rotation (ROT90 games: 90) applied to every tile
  --palette / --lut / --lut-offset / --pal-base / --color   colour tiles with real PROM colours:
               pen = lut[lut_offset + color*4 + v] & 0x0f, rgb = palette[pen + pal_base]
               (Namco-style resistor PROM; Galaga chars use --pal-base 16).
               Without these, pens are drawn in fixed debug colours (0 = black).
  --cols       tiles per row (default 16); tile index = row*cols + col

Bit numbering follows MAME: offsets count bits from the MSB of each byte.
Plane order follows MAME: planeoffset[0] is the most significant bit of the pen.
No third-party packages needed (PNG is written with zlib).
"""
import sys, json, zipfile, zlib, struct, argparse

PRESETS = {
    # Namco Galaga-family 16x16 sprites (verified on galaga.zip)
    'namco-sprite16': dict(w=16, h=16, planes=[0, 4],
                           x=[0, 1, 2, 3, 64, 65, 66, 67, 128, 129, 130, 131, 192, 193, 194, 195],
                           y=[0, 8, 16, 24, 32, 40, 48, 56, 256, 264, 272, 280, 288, 296, 304, 312], inc=512),
    # Namco 8x8 2bpp characters (Galaga / Pac-Man; verified on galaga.zip)
    'namco-char8': dict(w=8, h=8, planes=[0, 4], x=[64, 65, 66, 67, 0, 1, 2, 3],
                        y=[0, 8, 16, 24, 32, 40, 48, 56], inc=128),
    # Pac-Man 16x16 sprites (from MAME pacman.cpp - verify with a sheet before relying on it)
    'pacman-sprite16': dict(w=16, h=16, planes=[0, 4],
                            x=[64, 65, 66, 67, 128, 129, 130, 131, 192, 193, 194, 195, 0, 1, 2, 3],
                            y=[0, 8, 16, 24, 32, 40, 48, 56, 256, 264, 272, 280, 288, 296, 304, 312], inc=512),
}
DEBUG = [(0, 0, 0), (255, 80, 80), (80, 255, 80), (80, 120, 255), (255, 255, 0), (255, 0, 255), (0, 255, 255), (255, 255, 255)]


def png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def namco_rgb(b):
    r = 0x21 * (b & 1) + 0x47 * ((b >> 1) & 1) + 0x97 * ((b >> 2) & 1)
    g = 0x21 * ((b >> 3) & 1) + 0x47 * ((b >> 4) & 1) + 0x97 * ((b >> 5) & 1)
    bl = 0x47 * ((b >> 6) & 1) + 0x97 * ((b >> 7) & 1)
    return (r, g, bl)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zip'); ap.add_argument('--files', required=True)
    ap.add_argument('--layout'); ap.add_argument('--layout-json')
    ap.add_argument('--rotate', type=int, default=0, choices=[0, 90, 270])
    ap.add_argument('--scale', type=int, default=3); ap.add_argument('--cols', type=int, default=16)
    ap.add_argument('--palette'); ap.add_argument('--lut'); ap.add_argument('--lut-offset', type=int, default=0)
    ap.add_argument('--color', type=int, default=0); ap.add_argument('--pal-base', type=int, default=0); ap.add_argument('--out', default='sheet.png')
    a = ap.parse_args()
    L = json.load(open(a.layout_json)) if a.layout_json else PRESETS[a.layout]
    with zipfile.ZipFile(a.zip) as z:
        names = {i.filename.lower().split('/')[-1]: i for i in z.infolist()}
        data = b''.join(z.read(names[f.lower()]) for f in a.files.split(','))
        pal = [namco_rgb(b) for b in z.read(names[a.palette.lower()])] if a.palette else None
        lut = z.read(names[a.lut.lower()]) if a.lut else None
    bit = lambda o: (data[o >> 3] >> (7 - (o & 7))) & 1
    n = len(data) * 8 // L['inc']
    w, h, cols, S = L['w'], L['h'], a.cols, a.scale
    tw, th = (h, w) if a.rotate in (90, 270) else (w, h)
    rows_n = (n + cols - 1) // cols
    W, H = cols * (tw * S + 2), rows_n * (th * S + 2)
    img = [bytearray([40] * (W * 3)) for _ in range(H)]
    for t in range(n):
        base = t * L['inc']
        ox, oy = (t % cols) * (tw * S + 2), (t // cols) * (th * S + 2)
        for y in range(h):
            for x in range(w):
                o = base + L['y'][y] + L['x'][x]
                v = 0
                for p in L['planes']: v = (v << 1) | bit(o + p)
                if lut is not None:
                    pen = lut[a.lut_offset + a.color * (1 << len(L['planes'])) + v] & 0x0f
                    rgb = pal[pen + a.pal_base] if v else (0, 0, 0)
                else:
                    rgb = pal[v] if pal and not lut else DEBUG[v % len(DEBUG)]
                if a.rotate == 90: dx, dy = h - 1 - y, x
                elif a.rotate == 270: dx, dy = y, w - 1 - x
                else: dx, dy = x, y
                for sy in range(S):
                    row = img[oy + dy * S + sy]
                    for sx in range(S):
                        i = (ox + dx * S + sx) * 3
                        row[i:i + 3] = bytes(rgb)
    png(a.out, W, H, img)
    print(f'{n} tiles of {w}x{h} -> {a.out} ({W}x{H}); tile index = row*{cols}+col')


if __name__ == '__main__':
    main()
