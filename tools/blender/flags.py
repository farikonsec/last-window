"""Procedural national flags as small textures, baked onto the mission models so each probe carries its country's flag.

Flags are public-domain national symbols; these are original geometric approximations (stripes, discs, stars) drawn from
their published descriptions, not traced artwork. Colours are sRGB; the in-game hardware shader converts to linear.
"""
import math

import bpy
import numpy as np

W, H = 120, 80


def _star(a, cx, cy, r, colour, points=5, inner=0.42, rot=-math.pi / 2):
    """Rasterise a filled n-point star centred at (cx, cy) pixels, radius r, into array a."""
    verts = []
    for k in range(points * 2):
        ang = rot + k * math.pi / points
        rr = r if k % 2 == 0 else r * inner
        verts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
    _fill_poly(a, verts, colour)


def _fill_poly(a, verts, colour):
    ys = [v[1] for v in verts]
    xs = [v[0] for v in verts]
    y0, y1 = max(0, int(min(ys))), min(a.shape[0], int(max(ys)) + 1)
    x0, x1 = max(0, int(min(xs))), min(a.shape[1], int(max(xs)) + 1)
    n = len(verts)
    for py in range(y0, y1):
        for px in range(x0, x1):
            inside = False
            j = n - 1
            for i in range(n):
                xi, yi = verts[i]; xj, yj = verts[j]
                if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi:
                    inside = not inside
                j = i
            if inside:
                a[py, px] = colour


def _disc(a, cx, cy, r, colour):
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    a[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = colour


def _ring(a, cx, cy, r, w, colour):
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    a[(d <= r) & (d >= r - w)] = colour


def _flag_array(country):
    a = np.ones((H, W, 3), dtype=np.float32)
    red = (0.82, 0.09, 0.11); gold = (1.0, 0.82, 0.0); blue = (0.05, 0.16, 0.5)
    if country == 'USSR':
        a[:] = (0.78, 0.06, 0.06)
        _star(a, W * 0.18, H * 0.26, 9, gold)
    elif country == 'China':
        a[:] = (0.87, 0.12, 0.14)
        _star(a, W * 0.17, H * 0.3, 11, gold)
        for dx, dy in [(0.30, 0.14), (0.36, 0.26), (0.36, 0.42), (0.30, 0.54)]:
            _star(a, W * dx, H * dy, 4, gold)
    elif country == 'India':
        a[0:int(H / 3)] = (0.93, 0.6, 0.2)
        a[int(2 * H / 3):] = (0.07, 0.53, 0.27)
        _ring(a, W / 2, H / 2, 11, 2.2, blue)
        for k in range(12):
            ang = k * math.pi / 6
            a[int(H / 2 + math.sin(ang) * 9), int(W / 2 + math.cos(ang) * 9)] = blue
    elif country == 'Japan':
        _disc(a, W / 2, H / 2, 20, (0.74, 0.02, 0.15))
    elif country == 'Israel':
        a[int(H * 0.16):int(H * 0.3)] = (0.0, 0.2, 0.6)
        a[int(H * 0.7):int(H * 0.84)] = (0.0, 0.2, 0.6)
        _star(a, W / 2, H / 2, 13, (0.0, 0.2, 0.6), points=3, inner=1.0, rot=-math.pi / 2)
        _star(a, W / 2, H / 2, 13, (0.0, 0.2, 0.6), points=3, inner=1.0, rot=math.pi / 2)
    elif country == 'UAE':
        bar = int(W * 0.28)
        a[0:int(H / 3), bar:] = (0.0, 0.45, 0.24)
        a[int(2 * H / 3):, bar:] = (0.02, 0.02, 0.02)
        a[:, 0:bar] = (0.82, 0.09, 0.11)
    elif country == 'USA':
        for s in range(13):
            if s % 2 == 0:
                a[int(s * H / 13):int((s + 1) * H / 13)] = red
        a[0:int(H * 7 / 13), 0:int(W * 0.4)] = (0.05, 0.09, 0.35)
        for r in range(5):
            for c in range(6):
                a[int((r + 0.7) * H / 13 * 7 / 5), int((c + 0.6) * W * 0.4 / 6)] = (1, 1, 1)
    else:
        a[:] = (0.7, 0.7, 0.7)
    return a


def flag_material(country):
    """Create (or reuse) a material whose base colour is the country's flag texture."""
    name = f'flag_{country}'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    arr = _flag_array(country)
    img = bpy.data.images.new(name, W, H)
    rgba = np.concatenate([arr, np.ones((H, W, 1), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba[::-1].reshape(-1))  # flip Y for image convention
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.85
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat
