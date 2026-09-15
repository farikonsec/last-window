"""Generic robotic-probe stand-ins for the world's lunar missions. Run: blender -b -P tools/blender/build_probes.py

Not museum-accurate per spacecraft — a believable four-leg lander and a six-wheel rover, sized realistically, used to
mark Luna/Surveyor/Chang'e/Chandrayaan/SLIM/etc. sites the buggy can drive to. Frame: Z up, front -Y; origin at ground.
"""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RAD, box, cone, cylinder, empty, export, material, palette, reset, sphere, strut, torus  # noqa: E402


def lander():
    reset()
    P = palette()
    P['gold'] = material('probe_gold', (0.62, 0.42, 0.12), metal=1.0, rough=0.35)
    root = empty('PROBE_LANDER', (0, 0, 0))
    legH = 0.55
    # Central body: a foil-wrapped octagonal bus on splayed legs with footpads.
    cylinder('bus', 0.6, 0.5, (0, 0, legH + 0.25), P['gold'], root, verts=8)
    box('deck', (0.9, 0.9, 0.08), (0, 0, legH + 0.52), P['silver'], root)
    for k in range(4):
        a = RAD(45 + 90 * k)
        foot = (math.cos(a) * 1.05, math.sin(a) * 1.05, 0)
        hip = (math.cos(a) * 0.45, math.sin(a) * 0.45, legH + 0.15)
        strut(f'leg_{k}', hip, foot, 0.045, P['aluminium'], root)
        cylinder(f'pad_{k}', 0.16, 0.06, foot, P['grey'], root, verts=12)
    # High-gain dish on a short mast, a couple of panels and an omni antenna.
    strut('mast', (0.2, 0.2, legH + 0.55), (0.35, 0.35, legH + 1.0), 0.03, P['aluminium'], root)
    cone('dish', 0.3, 0.05, 0.18, (0.4, 0.4, legH + 1.05), P['white'], root, rot=(RAD(40), 0, 0), open_ends=False)
    for s in (-1, 1):
        box(f'panel_{s}', (0.7, 0.02, 0.45), (s * 0.85, 0, legH + 0.5), P['cells'], root, rot=(0, 0, RAD(90)))
    strut('omni', (-0.25, 0.2, legH + 0.55), (-0.3, 0.25, legH + 1.1), 0.012, P['silver'], root)
    sphere('nav', 0.05, (0, -0.55, legH + 0.4), P['red'], root)
    export('probe-lander.glb')


def wheel(P, name, x, y, parent, r=0.28):
    hub = empty(name, (x, y, r))
    cylinder(f'{name}_tyre', r, 0.16, (x, y, r), P['black'], hub, rot=(0, RAD(90), 0), verts=16)
    cylinder(f'{name}_hub', r * 0.5, 0.18, (x, y, r), P['aluminium'], hub, rot=(0, RAD(90), 0), verts=10)


def rover():
    reset()
    P = palette()
    root = empty('PROBE_ROVER', (0, 0, 0))
    r = 0.28
    body = r + 0.18
    box('chassis', (0.7, 1.5, 0.28), (0, 0, body), P['white'], root)
    box('warm_box', (0.5, 0.6, 0.22), (0, -0.1, body + 0.22), P['gold'], root)
    # Solar deck angled up at the back.
    box('deck', (0.75, 0.9, 0.03), (0, 0.5, body + 0.2), P['cells'], root, rot=(RAD(-12), 0, 0))
    # Camera mast with a stereo head.
    strut('mast', (0, -0.55, body + 0.1), (0, -0.6, body + 0.75), 0.04, P['aluminium'], root)
    box('cam_head', (0.34, 0.12, 0.12), (0, -0.62, body + 0.8), P['black'], root)
    for s in (-1, 1):
        sphere(f'lens_{s}', 0.045, (s * 0.13, -0.69, body + 0.8), P['glass'], root)
    # Six wheels on rocker arms.
    for sy, yy in enumerate((-0.55, 0.0, 0.55)):
        for sx in (-1, 1):
            wheel(P, f'wheel_{sy}_{sx}', sx * 0.5, yy, root, r)
            strut(f'rocker_{sy}_{sx}', (sx * 0.28, yy, body - 0.05), (sx * 0.5, yy, r), 0.03, P['grey'], root)
    export('probe-rover.glb')


if __name__ == '__main__':
    lander()
    rover()
