"""The crew's high-tech surface buggy. Run: blender -b -P tools/blender/build_buggy.py

A purpose-built fast rover, nothing like the 1971 wire-wheel LRV parked at Apollo 15: a low angular carbon
chassis, a faceted pressurised cockpit, four deep-tread wheels on visible suspension arms, a sensor mast with lidar,
exposed avionics and cooling hardware, cyan guidance strips, and three rear turbo nozzles. Frame: Z up, front -Y; origin at ground contact so the wheels
touch z=0. Wheels are named nodes (wheel_fl/fr/rl/rr) so the game can spin and steer them.
"""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RAD, box, cylinder, empty, export, material, palette, reset, sphere, strut, torus  # noqa: E402

TRACK = 1.15   # half-distance between left and right wheels (centre to wheel)
BASE = 1.20    # half-wheelbase (centre to axle); shared 1.25 export scale makes the visible wheelbase 3 m
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
    P['screen'] = material('diagnostic_display', (0.01, 0.15, 0.2), metal=0.1, rough=0.2, emit=(0.05, 0.8, 1.0), strength=8.0)
    P['ceramic'] = material('ceramic_armour', (0.55, 0.58, 0.57), metal=0.05, rough=0.72)
    root = empty('BUGGY', (0, 0, 0))

    # Main chassis: a low, wide, angular tub, tapered at the nose.
    box('chassis', (TRACK * 1.35, 2.5, 0.42), (0, 0, DECK + 0.05), P['carbon'], root)
    box('nose', (TRACK * 0.95, 0.9, 0.26), (0, -1.55, DECK + 0.02), P['carbon'], root, rot=(RAD(-14), 0, 0))
    box('tail', (TRACK * 1.15, 0.7, 0.4), (0, 1.5, DECK + 0.12), P['grey'], root)
    # Cyan light strips down each flank (tucked between the wheels) and across the nose.
    for s in (-1, 1):
        box(f'strip_{s}', (0.04, 1.6, 0.06), (s * TRACK * 1.34, 0, DECK + 0.16), P['cyan'], root)
    box('strip_nose', (TRACK * 0.9, 0.05, 0.06), (0, -1.98, DECK + 0.02), P['cyan'], root)

    # Low, faceted pressure cabin. The old spherical dome read as a balloon once the runtime material was applied;
    # flat panes, armour ribs and a solid pressure shell make this look engineered and keep the crew volume clear.
    box('pressure_cabin', (1.5, 1.35, 0.48), (0, -0.05, DECK + 0.43), P['carbon'], root, bevel_width=0.08)
    box('windshield', (1.08, 0.035, 0.34), (0, -0.74, DECK + 0.56), P['glass'], root, rot=(RAD(-13), 0, 0), bevel_width=0.01)
    for s in (-1, 1):
        box(f'side_window_{s}', (0.035, 0.68, 0.3), (s * 0.76, -0.08, DECK + 0.56), P['glass'], root, rot=(0, RAD(s * 7), 0), bevel_width=0.01)
        box(f'cabin_armour_{s}', (0.09, 1.15, 0.16), (s * 0.81, -0.02, DECK + 0.29), P['ceramic'], root, bevel_width=0.025)
    box('cabin_roof', (1.3, 1.0, 0.1), (0, 0.0, DECK + 0.78), P['ceramic'], root, bevel_width=0.04)
    box('seat_back', (0.52, 0.12, 0.46), (0, 0.3, DECK + 0.42), P['black'], root)
    # Exposed diagnostics and redundant compute modules are readable from the chase camera.
    for i, x in enumerate((-0.48, -0.16, 0.16, 0.48)):
        box(f'diagnostic_{i}', (0.11, 0.025, 0.07), (x, -0.765, DECK + 0.31), P['screen'], root, bevel_width=0.006)
    for s in (-1, 1):
        box(f'avionics_bank_{s}', (0.22, 0.55, 0.32), (s * 1.05, 0.55, DECK + 0.42), P['grey'], root, bevel_width=0.035)
        for k in range(4):
            box(f'avionics_led_{s}_{k}', (0.025, 0.035, 0.018), (s * 1.275, 0.36 + k * 0.13, DECK + 0.48), P['cyan'], root, bevel_width=0.004)
        # Twin external coolant loops: deliberately visible, repairable plumbing rather than hidden decoration.
        strut(f'coolant_upper_{s}', (s * 0.98, 0.2, DECK + 0.66), (s * 1.18, 1.25, DECK + 0.64), 0.025, P['cyan'], root)
        strut(f'coolant_lower_{s}', (s * 1.18, 1.25, DECK + 0.64), (s * 0.98, 1.5, DECK + 0.37), 0.025, P['cyan'], root)

    # Sensor mast behind the cabin: a post, a spinning lidar head and two stereo navigation cameras.
    strut('mast', (0, 0.55, DECK + 0.2), (0, 0.7, DECK + 1.15), 0.06, P['aluminium'], root)
    sphere('lidar_dome', 0.16, (0, 0.7, DECK + 1.2), P['silver'], root)
    for s in (-1, 1):
        box(f'cam_pod_{s}', (0.12, 0.16, 0.1), (s * 0.22, 0.6, DECK + 1.02), P['black'], root)
        sphere(f'cam_lens_{s}', 0.05, (s * 0.22, 0.52, DECK + 1.02), P['glass'], root)
    cylinder('lidar_ring', 0.23, 0.06, (0, 0.7, DECK + 1.2), P['cyan'], root, verts=20)
    # Whip antenna.
    strut('antenna', (0.45, 0.9, DECK + 0.2), (0.6, 1.1, DECK + 1.4), 0.015, P['silver'], root)

    # Roll hoop over the canopy.
    for s in (-1, 1):
        strut(f'hoop_{s}', (s * TRACK * 0.7, 0.5, DECK + 0.1), (s * 0.35, 0.1, DECK + 1.05), 0.05, P['aluminium'], root)
    strut('hoop_top', (-0.35, 0.1, DECK + 1.05), (0.35, 0.1, DECK + 1.05), 0.05, P['aluminium'], root)

    # Roof antenna array and a tiny forward terrain radar give the silhouette a technical, expedition-built profile.
    box('sensor_rail', (1.05, 0.08, 0.06), (0, -0.02, DECK + 0.91), P['aluminium'], root)
    for s in (-1, 1):
        sphere(f'terrain_radar_{s}', 0.09, (s * 0.48, -0.76, DECK + 0.45), P['silver'], root, scale=(1, 0.35, 0.7))

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
