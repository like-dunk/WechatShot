#!/usr/bin/env python3
"""Generate Chrome extension icons (16, 48, 128 px) as PNG using only stdlib."""
import math
import struct
import zlib
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent


def make_png(width, height, pixels):
    """Create a minimal PNG file from RGBA pixel data."""

    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx : idx + 4])
    idat = chunk(b"IDAT", zlib.compress(raw, 9))
    iend = chunk(b"IEND", b"")
    return header + ihdr + idat + iend


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(len(c1)))


def gradient_bg(x, y, size):
    t = (x + y) / (2 * size)
    if t < 0.5:
        return lerp_color((79, 70, 229), (124, 58, 237), t * 2)
    return lerp_color((124, 58, 237), (168, 85, 247), (t - 0.5) * 2)


def rounded_rect_mask(x, y, w, h, r, cx, cy):
    """Return alpha (0-255) for point (cx,cy) in rounded rect at (x,y,w,h) with radius r."""
    px, py = cx - x, cy - y
    if px < 0 or py < 0 or px >= w or py >= h:
        return 0
    dx = max(r - px, 0, px - (w - 1 - r))
    dy = max(r - py, 0, py - (h - 1 - r))
    if dx > 0 and dy > 0:
        dist = math.sqrt(dx * dx + dy * dy)
        if dist > r + 0.5:
            return 0
        if dist > r - 0.5:
            return int(255 * (r + 0.5 - dist))
    return 255


def circle_mask(cx, cy, r, px, py):
    dist = math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
    if dist > r + 0.5:
        return 0
    if dist > r - 0.5:
        return int(255 * (r + 0.5 - dist))
    return 255


def in_triangle(px, py, x1, y1, x2, y2, x3, y3):
    def sign(ax, ay, bx, by, cx, cy):
        return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)

    d1 = sign(px, py, x1, y1, x2, y2)
    d2 = sign(px, py, x2, y2, x3, y3)
    d3 = sign(px, py, x3, y3, x1, y1)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def draw_line_segment(pixels, size, x0, y0, x1, y1, thickness, color):
    half = thickness / 2
    length = math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)
    if length < 0.01:
        return
    dx, dy = (x1 - x0) / length, (y1 - y0) / length
    nx, ny = -dy, dx
    min_x = max(0, int(min(x0, x1) - half - 1))
    max_x = min(size - 1, int(max(x0, x1) + half + 1))
    min_y = max(0, int(min(y0, y1) - half - 1))
    max_y = min(size - 1, int(max(y0, y1) + half + 1))
    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            rx = px - x0
            ry = py - y0
            along = rx * dx + ry * dy
            across = abs(rx * nx + ry * ny)
            if along < -half or along > length + half:
                continue
            dist_edge = half - across
            dist_cap0 = along + half
            dist_cap1 = length + half - along
            alpha_factor = min(1.0, max(0.0, dist_edge), max(0.0, dist_cap0), max(0.0, dist_cap1))
            if alpha_factor <= 0:
                continue
            idx = (py * size + px) * 4
            a = int(alpha_factor * 255)
            blend_pixel(pixels, idx, color[0], color[1], color[2], a)


def blend_pixel(pixels, idx, r, g, b, a):
    if a <= 0:
        return
    if a >= 255:
        pixels[idx] = r
        pixels[idx + 1] = g
        pixels[idx + 2] = b
        pixels[idx + 3] = 255
        return
    af = a / 255.0
    old_a = pixels[idx + 3] / 255.0
    new_a = af + old_a * (1 - af)
    if new_a < 0.001:
        return
    pixels[idx] = int((r * af + pixels[idx] * old_a * (1 - af)) / new_a)
    pixels[idx + 1] = int((g * af + pixels[idx + 1] * old_a * (1 - af)) / new_a)
    pixels[idx + 2] = int((b * af + pixels[idx + 2] * old_a * (1 - af)) / new_a)
    pixels[idx + 3] = int(new_a * 255)


def render_icon(size):
    pixels = bytearray(size * size * 4)
    s = size / 128.0
    corner_r = 28 * s

    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            a = rounded_rect_mask(0, 0, size, size, corner_r, x, y)
            if a > 0:
                bg = gradient_bg(x, y, size)
                pixels[idx] = bg[0]
                pixels[idx + 1] = bg[1]
                pixels[idx + 2] = bg[2]
                pixels[idx + 3] = a

    white = (255, 255, 255)
    lw = max(2, 5 * s)
    cl = 20 * s
    m = 30 * s
    e = size - m

    corners = [
        [(m, m + cl), (m, m), (m + cl, m)],
        [(e - cl, m), (e, m), (e, m + cl)],
        [(m, e - cl), (m, e), (m + cl, e)],
        [(e, e - cl), (e, e), (e - cl, e)],
    ]
    for pts in corners:
        draw_line_segment(pixels, size, pts[0][0], pts[0][1], pts[1][0], pts[1][1], lw, white)
        draw_line_segment(pixels, size, pts[1][0], pts[1][1], pts[2][0], pts[2][1], lw, white)

    tx1, ty1 = 54 * s, 46 * s
    tx2, ty2 = 54 * s, 82 * s
    tx3, ty3 = 82 * s, 64 * s
    for y in range(int(ty1 - 1), int(ty2 + 2)):
        for x in range(int(tx1 - 1), int(tx3 + 2)):
            if 0 <= x < size and 0 <= y < size:
                if in_triangle(x + 0.5, y + 0.5, tx1, ty1, tx2, ty2, tx3, ty3):
                    idx = (y * size + x) * 4
                    blend_pixel(pixels, idx, 255, 255, 255, 242)

    badge_cx, badge_cy, badge_r = 98 * s, 100 * s, 16 * s
    green = (34, 197, 94)
    for y in range(max(0, int(badge_cy - badge_r - 2)), min(size, int(badge_cy + badge_r + 2))):
        for x in range(max(0, int(badge_cx - badge_r - 2)), min(size, int(badge_cx + badge_r + 2))):
            a = circle_mask(badge_cx, badge_cy, badge_r, x, y)
            if a > 0:
                idx = (y * size + x) * 4
                blend_pixel(pixels, idx, green[0], green[1], green[2], a)

    plus_hw = 7 * s
    plus_th = max(1.5, 2 * s)
    draw_line_segment(pixels, size, badge_cx - plus_hw, badge_cy, badge_cx + plus_hw, badge_cy, plus_th, white)
    draw_line_segment(pixels, size, badge_cx, badge_cy - plus_hw, badge_cx, badge_cy + plus_hw, plus_th, white)

    return bytes(pixels)


def main():
    for size in (16, 48, 128):
        print(f"Generating icon-{size}.png ...")
        pixels = render_icon(size)
        png = make_png(size, size, pixels)
        (OUTPUT_DIR / f"icon-{size}.png").write_bytes(png)
    print("Done.")


if __name__ == "__main__":
    main()
