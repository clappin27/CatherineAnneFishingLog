"""Draws the Billfish Log app icons (a yellow marlin on deep navy) with only the Python standard library.

Run:  python3 tools/make_icons.py
Writes app/icons/icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png (180px).
"""
import os
import struct
import zlib

NAVY = (13, 33, 49)
YELLOW = (255, 198, 46)
SEA = (10, 90, 140)

# Shapes on a 512 x 512 grid. Marlin swims left; bill on the left, tail on the right.
BODY = [(118, 292), (160, 272), (215, 260), (270, 258), (325, 266), (372, 282), (396, 296),
        (372, 312), (325, 326), (270, 336), (215, 336), (160, 326), (118, 306)]
BILL = [(34, 297), (124, 288), (124, 306)]
SAIL = [(170, 272), (188, 205), (214, 160), (246, 140), (284, 150), (316, 186), (332, 266)]
TAIL = [(384, 299), (462, 214), (440, 299), (462, 384)]
FIN = [(214, 330), (262, 384), (250, 330)]
EYE_CENTER, EYE_R = (150, 290), 7
WAVE_Y = 410


def scan_fill(mask, size, poly, scale):
    pts = [(x * scale, y * scale) for x, y in poly]
    n = len(pts)
    ys = [p[1] for p in pts]
    for y in range(max(0, int(min(ys))), min(size, int(max(ys)) + 1)):
        yc = y + 0.5
        xs = []
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            if (y1 <= yc < y2) or (y2 <= yc < y1):
                xs.append(x1 + (yc - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            row = mask[y]
            for x in range(max(0, int(a + 0.5)), min(size, int(b + 0.5))):
                row[x] = 1


def circle(mask, size, center, r, scale, value):
    cx, cy, rr = center[0] * scale, center[1] * scale, r * scale
    for y in range(int(cy - rr), int(cy + rr) + 1):
        for x in range(int(cx - rr), int(cx + rr) + 1):
            if 0 <= x < size and 0 <= y < size and (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= rr * rr:
                mask[y][x] = value


def render(out_px, art_scale=1.0, wave=True):
    ss = 4                                   # supersampling
    big = out_px * ss
    scale = big / 512.0
    mask = [bytearray(big) for _ in range(big)]   # 0 navy, 1 yellow, 2 sea

    def tf(poly):  # shrink artwork toward the centre (for maskable icons)
        return [(256 + (x - 256) * art_scale, 256 + (y - 256) * art_scale) for x, y in poly]

    if wave:  # a band of sea under the fish
        top = int((256 + (WAVE_Y - 256) * art_scale) * scale)
        for y in range(max(0, top), big):
            mask[y][:] = bytes([2]) * big
    for poly in (BODY, BILL, SAIL, TAIL, FIN):
        scan_fill(mask, big, tf(poly), scale)
    ex, ey = tf([EYE_CENTER])[0]
    circle(mask, big, (ex, ey), EYE_R * art_scale, scale, 0)

    colors = {0: NAVY, 1: YELLOW, 2: SEA}
    raw = bytearray()
    for oy in range(out_px):
        raw.append(0)
        rows = mask[oy * ss:(oy + 1) * ss]
        for ox in range(out_px):
            r = g = b = 0
            for row in rows:
                for v in row[ox * ss:(ox + 1) * ss]:
                    c = colors[v]
                    r += c[0]; g += c[1]; b += c[2]
            n = ss * ss
            raw += bytes((r // n, g // n, b // n))
    return raw


def write_png(path, px, raw):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', px, px, 8, 2, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'app', 'icons')
    os.makedirs(out, exist_ok=True)
    for name, px, sc in (('icon-512.png', 512, 1.0), ('icon-192.png', 192, 1.0),
                         ('apple-touch-icon.png', 180, 0.92), ('icon-maskable-512.png', 512, 0.72)):
        write_png(os.path.join(out, name), px, render(px, sc))
        print('wrote', name)
