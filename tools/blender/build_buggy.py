"""The crew's high-tech surface buggy. Run: blender -b -P tools/blender/build_buggy.py

A purpose-built fast rover, nothing like the 1971 wire-wheel LRV parked at Apollo 15: a low angular carbon
chassis, a bubble canopy, four deep-tread wheels on visible suspension arms, a sensor mast with a lidar dome, cyan
accent light strips, and three rear turbo nozzles. Frame: Z up, front -Y; origin at ground contact so the wheels
touch z=0. Wheels are named nodes (wheel_fl/fr/rl/rr) so the game can spin and steer them.
"""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RAD, box, cylinder, empty, export, material, palette, reset, sphere, strut, torus  # noqa: E402

TRACK = 1.15   # half-distance between left and right wheels (centre to wheel)
BASE = 1.05    # half-wheelbase (centre to axle)
WHEEL_R = 0.52
WHEEL_W = 0.34
DECK = WHEEL_R + 0.12  # chassis floor height above ground


def wheel(P, name, x, y):
    """A deep-tread wheel with a bright hub, centred at (x, y). Spins about the local X axis."""
    hub = empty(f'{name}', (x, y, WHEEL_R))
    torus(f'{name}_tyre', WHEEL_R - 0.12, 0.14, (x, y, WHEEL_R), P['black'], hub, rot=(0, RAD(90), 0), major_segments=28, minor_segments=10)
    # Chunky tread blocks around the tyre.
    for k in range(14):
        a = RAD(k * 360 / 14)
        box(f'{name}_tread_{k}', (WHEEL_W * 1.02, 0.12, 0.1), (x, y + math.cos(a) * (WHEEL_R - 0.02), WHEEL_R + math.sin(a) * (WHEEL_R - 0.02)), P['grey'], hub, rot=(a, 0, 0), bevel_width=0)
    cylinder(f'{name}_rim', WHEEL_R - 0.14, WHEEL_W * 0.9, (x, y, WHEEL_R), P['aluminium'], hub, rot=(0, RAD(90), 0), verts=20)
    cylinder(f'{name}_hub', 0.14, WHEEL_W + 0.02, (x, y, WHEEL_R), P['cyan'], hub, rot=(0, RAD(90), 0), verts=12)
    return hub


def suspension(P, root, x, y):
    inner = (math.copysign(0.42, x), y, DECK - 0.15)
    outer = (x, y, WHEEL_R)
    strut(f'susp_upper_{x:.0f}_{y:.0f}', (inner[0], inner[1], inner[2] + 0.18), outer, 0.05, P['aluminium'], root)
    strut(f'susp_lower_{x:.0f}_{y:.0f}', inner, outer, 0.06, P['grey'], root)
    # Coil-over damper.
    strut(f'susp_shock_{x:.0f}_{y:.0f}', (inner[0], inner[1], inner[2] + 0.3), (outer[0], outer[1], outer[2] + 0.12), 0.04, P['silver'], root)


def build():
    reset()
    P = palette()
    P['cyan'] = material('accent_cyan', (0.02, 0.35, 0.4), metal=0.3, rough=0.3, emit=(0.1, 0.9, 1.0), strength=6.0)
    P['carbon'] = material('carbon', (0.05, 0.055, 0.065), metal=0.4, rough=0.5)
    P['turbo'] = material('turbo_glow', (0.3, 0.12, 0.02), metal=0.5, rough=0.4, emit=(1.0, 0.45, 0.12), strength=5.0)
    root = empty('BUGGY', (0, 0, 0))

    # Main chassis: a low, wide, angular tub, tapered at the nose.
    box('chassis', (TRACK * 1.35, 2.5, 0.42), (0, 0, DECK + 0.05), P['carbon'], root)
    box('nose', (TRACK * 0.95, 0.9, 0.26), (0, -1.55, DECK + 0.02), P['carbon'], root, rot=(RAD(-14), 0, 0))
    box('tail', (TRACK * 1.15, 0.7, 0.4), (0, 1.5, DECK + 0.12), P['grey'], root)
    # Cyan light strips down each flank (tucked between the wheels) and across the nose.
    for s in (-1, 1):
        box(f'strip_{s}', (0.04, 1.6, 0.06), (s * TRACK * 1.34, 0, DECK + 0.16), P['cyan'], root)
    box('strip_nose', (TRACK * 0.9, 0.05, 0.06), (0, -1.98, DECK + 0.02), P['cyan'], root)

    # Bubble canopy: a smoked-glass dome over a lit cockpit, set slightly back of centre.
    sphere('canopy', 0.62, (0, -0.15, DECK + 0.5), P['glass'], root, scale=(0.85, 1.15, 0.7))
    box('seat_back', (0.5, 0.1, 0.5), (0, 0.35, DECK + 0.4), P['black'], root)

    # Sensor mast behind the canopy: a post, a spinning lidar dome and two camera pods.
    strut('mast', (0, 0.55, DECK + 0.2), (0, 0.7, DECK + 1.15), 0.06, P['aluminium'], root)
    sphere('lidar_dome', 0.16, (0, 0.7, DECK + 1.2), P['silver'], root)
    for s in (-1, 1):
        box(f'cam_pod_{s}', (0.12, 0.16, 0.1), (s * 0.22, 0.6, DECK + 1.02), P['black'], root)
        sphere(f'cam_lens_{s}', 0.05, (s * 0.22, 0.52, DECK + 1.02), P['glass'], root)
    # Whip antenna.
    strut('antenna', (0.45, 0.9, DECK + 0.2), (0.6, 1.1, DECK + 1.4), 0.015, P['silver'], root)

    # Roll hoop over the canopy.
    for s in (-1, 1):
        strut(f'hoop_{s}', (s * TRACK * 0.7, 0.5, DECK + 0.1), (s * 0.35, 0.1, DECK + 1.05), 0.05, P['aluminium'], root)
    strut('hoop_top', (-0.35, 0.1, DECK + 1.05), (0.35, 0.1, DECK + 1.05), 0.05, P['aluminium'], root)

    # Headlight pods on the nose.
    for s in (-1, 1):
        cylinder(f'head_{s}', 0.11, 0.08, (s * 0.5, -1.98, DECK + 0.02), P['target'], root, rot=(RAD(90), 0, 0), verts=16)
    # Nav lights: red port, green starboard, at the tail corners.
    box('nav_red', (0.07, 0.07, 0.07), (-TRACK * 1.1, 1.82, DECK + 0.28), P['red'], root)
    box('nav_green', (0.07, 0.07, 0.07), (TRACK * 1.1, 1.82, DECK + 0.28), P['green'], root)

    # Three rear turbo nozzles that glow.
    for i, s in enumerate((-0.55, 0, 0.55)):
        cylinder(f'turbo_{i}', 0.15, 0.35, (s, 1.9, DECK + 0.14), P['engine'], root, rot=(RAD(90), 0, 0), verts=16)
        cylinder(f'turbo_glow_{i}', 0.1, 0.06, (s, 2.06, DECK + 0.14), P['turbo'], root, rot=(RAD(90), 0, 0), verts=16)

    # Wheels and suspension at the four corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * TRACK, sy * BASE
            wheel(P, f'wheel_{"f" if sy < 0 else "r"}{"l" if sx < 0 else "r"}', x, y)
            suspension(P, root, x, y)

    export('buggy.glb')


if __name__ == '__main__':
    build()
