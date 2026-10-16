"""Reproduce the small Wallet icons without third-party imaging packages."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "apps/web/public/assets"

def inside(x, y, points):
    hit = False
    for i, (ax, ay) in enumerate(points):
        bx, by = points[i - 1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            hit = not hit
    return hit

def png(size):
    glyph = [(25, 57), (25, 23), (43, 23), (54, 26), (58, 33), (57, 40), (48, 47), (60, 57), (46, 57), (34, 46), (34, 57)]
    hole = [(34, 28), (43, 28), (48, 31), (48, 34), (43, 37), (34, 37)]
    pixels = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = (x + .5) * 80 / size, (y + .5) * 80 / size
            ink = inside(px, py, glyph) and not inside(px, py, hole)
            row.extend((255, 248, 232, 255) if ink else (185, 79, 50, 255))
        pixels.append(row)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(pixels))) + chunk(b'IEND', b'')

for name, size in [('icon.png', 29), ('icon@2x.png', 58), ('icon@3x.png', 87)]:
    (ROOT / name).write_bytes(png(size))
