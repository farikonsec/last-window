"""Distinct, roughly-accurate models for the real lunar missions the buggy can visit, each with its country's flag and
sized from published figures. Run: blender -b -P tools/blender/build_missions.py

Not engineering CAD — recognisable silhouettes at real scale (a Lunokhod tub on eight wheels, a Surveyor tripod, a
Chang'e gold lander, SLIM tipped nose-down, Odysseus on its side), good enough to drive up to and identify.
"""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RAD, box, cone, cylinder, empty, export, material, palette, reset, sphere, strut, torus  # noqa: E402
from flags import flag_material  # noqa: E402


def flag(country, loc, parent, w=0.5, h=0.33, pole=1.5):
    x, y, z = loc
    strut('flagpole', (x, y, z), (x, y, z + pole), 0.02, palette()['silver'], parent)
    box('flagcloth', (w, 0.012, h), (x + w / 2 + 0.02, y, z + pole - h / 2 - 0.03), flag_material(country), parent, bevel_width=0)


def wheel(P, name, x, y, parent, r=0.3, w=0.2, mat='black'):
    hub = empty(name, (x, y, r))
    cylinder(f'{name}_t', r, w, (x, y, r), P[mat], hub, rot=(0, RAD(90), 0), verts=16)
    cylinder(f'{name}_h', r * 0.45, w + 0.02, (x, y, r), P['aluminium'], hub, rot=(0, RAD(90), 0), verts=10)


def lunokhod():  # USSR Luna 17 / 21 — 2.3 m, 756 kg, 8 wire wheels, convex radiator lid
    reset(); P = palette()
    root = empty('LUNOKHOD', (0, 0, 0))
    body = 0.55
    box('tub', (0.9, 1.35, 0.55), (0, 0, 0.42 + 0.2), P['aluminium'], root)
    # Convex ribbed lid (the radiator, tipped up to the Sun at night it closed).
    sphere('lid', 0.72, (0, 0, 0.42 + 0.5), P['silver'], root, scale=(1.0, 1.5, 0.4))
    for k in range(7):
        box(f'rib_{k}', (0.9, 0.02, 0.06), (0, -0.6 + k * 0.2, 0.42 + 0.62), P['grey'], root)
    # Cone helical antenna forward, a whip, and the imaging port.
    cone('cone_ant', 0.16, 0.02, 0.5, (0, -0.85, 0.42 + 0.55), P['silver'], root, rot=(RAD(70), 0, 0), open_ends=False)
    strut('whip', (0.35, 0.5, 0.42 + 0.6), (0.5, 0.7, 0.42 + 1.4), 0.012, P['silver'], root)
    box('camera', (0.16, 0.16, 0.2), (0, -0.75, 0.42 + 0.35), P['black'], root)
    for sx in (-1, 1):
        for i, yy in enumerate((-0.75, -0.25, 0.25, 0.75)):
            wheel(P, f'w_{sx}_{i}', sx * 0.62, yy, root, r=0.4, w=0.18, mat='grey')
    flag('USSR', (-0.5, 0.6, 0.42 + 0.55), root, pole=1.1)
    export('mission-lunokhod.glb')


def luna_lander():  # USSR Luna 9/24 — a petalled sphere on a braking-stage cylinder
    reset(); P = palette()
    root = empty('LUNA', (0, 0, 0))
    cylinder('stage', 0.55, 0.9, (0, 0, 0.45), P['aluminium'], root, verts=16)
    for k in range(4):
        a = RAD(90 * k)
        strut(f'leg_{k}', (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.1), (math.cos(a) * 0.9, math.sin(a) * 0.9, 0.0), 0.04, P['grey'], root)
    sphere('capsule', 0.35, (0, 0, 1.05), P['silver'], root)
    # Four opened petals.
    for k in range(4):
        a = RAD(45 + 90 * k)
        box(f'petal_{k}', (0.34, 0.02, 0.3), (math.cos(a) * 0.35, math.sin(a) * 0.35, 1.05), P['aluminium'], root, rot=(RAD(55), 0, a))
    for k in range(4):
        a = RAD(90 * k)
        strut(f'ant_{k}', (0, 0, 1.15), (math.cos(a) * 0.4, math.sin(a) * 0.4, 1.5), 0.01, P['silver'], root)
    flag('USSR', (0.4, 0.4, 0.4), root, pole=1.1)
    export('mission-luna.glb')


def surveyor():  # NASA Surveyor 1/6 — 3 m tall aluminium tripod
    reset(); P = palette()
    root = empty('SURVEYOR', (0, 0, 0))
    deck = 1.1
    for k in range(3):
        a = RAD(90 + 120 * k)
        foot = (math.cos(a) * 1.35, math.sin(a) * 1.35, 0)
        strut(f'leg_{k}', (math.cos(a) * 0.35, math.sin(a) * 0.35, deck), foot, 0.05, P['aluminium'], root)
        strut(f'brace_{k}', (0, 0, deck * 0.5), foot, 0.03, P['aluminium'], root)
        cylinder(f'pad_{k}', 0.2, 0.06, foot, P['grey'], root, verts=12)
    box('bus', (0.5, 0.5, 0.4), (0, 0, deck + 0.2), P['white'], root, rot=(0, 0, RAD(45)))
    strut('mast', (0, 0, deck + 0.4), (0.1, 0, deck + 1.7), 0.05, P['aluminium'], root)
    box('panel', (0.9, 0.02, 0.6), (0.1, 0, deck + 1.9), P['cells'], root, rot=(RAD(20), 0, 0))
    cone('dish', 0.28, 0.04, 0.16, (0.5, 0, deck + 1.4), P['white'], root, rot=(RAD(60), 0, 0), open_ends=False)
    flag('USA', (-0.4, 0.3, deck + 0.2), root, pole=1.0)
    export('mission-surveyor.glb')


def change_lander():  # CNSA Chang'e 3/5/6 — gold four-leg lander with panels and a ramp
    reset(); P = palette()
    root = empty('CHANGE', (0, 0, 0))
    deck = 0.75
    box('bus', (1.0, 1.0, 0.7), (0, 0, deck + 0.35), P['gold'], root)
    box('top', (0.7, 0.7, 0.2), (0, 0, deck + 0.8), P['silver'], root)
    for k in range(4):
        a = RAD(45 + 90 * k)
        foot = (math.cos(a) * 1.15, math.sin(a) * 1.15, 0)
        strut(f'leg_{k}', (math.cos(a) * 0.5, math.sin(a) * 0.5, deck), foot, 0.06, P['aluminium'], root)
        cylinder(f'pad_{k}', 0.18, 0.07, foot, P['grey'], root, verts=12)
    for s in (-1, 1):
        box(f'panel_{s}', (0.05, 1.1, 0.7), (s * 0.85, 0, deck + 0.4), P['cells'], root)
    box('ramp', (0.5, 0.8, 0.03), (0, 0.95, deck - 0.15), P['grey'], root, rot=(RAD(20), 0, 0))
    strut('mast', (0.3, 0, deck + 0.9), (0.4, 0, deck + 1.5), 0.03, P['aluminium'], root)
    cone('dish', 0.24, 0.04, 0.14, (0.45, 0.1, deck + 1.35), P['white'], root, rot=(RAD(55), 0, 0), open_ends=False)
    flag('China', (-0.55, 0.4, deck + 0.4), root, pole=1.1)
    export('mission-change.glb')


def yutu():  # CNSA Yutu / Yutu-2 rover — box body, six wheels, two solar wings, mast
    reset(); P = palette()
    root = empty('YUTU', (0, 0, 0))
    r = 0.3; body = r + 0.2
    box('bus', (0.7, 1.0, 0.5), (0, 0, body + 0.1), P['gold'], root)
    for s in (-1, 1):
        box(f'wing_{s}', (0.85, 0.9, 0.02), (s * 0.75, 0, body + 0.35), P['cells'], root, rot=(0, RAD(s * 18), 0))
    strut('mast', (0, -0.4, body + 0.2), (0, -0.45, body + 0.8), 0.035, P['aluminium'], root)
    box('cam', (0.3, 0.1, 0.1), (0, -0.47, body + 0.82), P['black'], root)
    for i, yy in enumerate((-0.4, 0, 0.4)):
        for sx in (-1, 1):
            wheel(P, f'w_{i}_{sx}', sx * 0.5, yy, root, r=0.3, w=0.16, mat='grey')
    flag('China', (0.3, 0.45, body + 0.2), root, pole=0.8)
    export('mission-yutu.glb')


def vikram():  # ISRO Chandrayaan-3 Vikram lander + Pragyan rover
    reset(); P = palette()
    root = empty('VIKRAM', (0, 0, 0))
    deck = 0.7
    box('bus', (1.1, 1.1, 0.7), (0, 0, deck + 0.35), P['gold'], root)
    for k in range(4):
        a = RAD(45 + 90 * k)
        foot = (math.cos(a) * 1.0, math.sin(a) * 1.0, 0)
        strut(f'leg_{k}', (math.cos(a) * 0.55, math.sin(a) * 0.55, deck), foot, 0.06, P['aluminium'], root)
        cylinder(f'pad_{k}', 0.16, 0.06, foot, P['grey'], root, verts=10)
    box('panel', (0.05, 1.0, 0.9), (-0.7, 0, deck + 0.6), P['cells'], root, rot=(0, RAD(-25), 0))
    strut('ant', (0.4, 0, deck + 0.7), (0.5, 0, deck + 1.4), 0.03, P['aluminium'], root)
    cone('dish', 0.22, 0.03, 0.12, (0.55, 0, deck + 1.25), P['white'], root, rot=(RAD(55), 0, 0), open_ends=False)
    # Pragyan: a small six-wheel rover parked beside it.
    prag = empty('PRAGYAN', (1.4, 0.6, 0), root)
    box('prag_body', (0.4, 0.55, 0.25), (1.4, 0.6, 0.3), P['gold'], root)
    box('prag_panel', (0.42, 0.5, 0.02), (1.4, 0.6, 0.45), P['cells'], root)
    for i, yy in enumerate((0.35, 0.6, 0.85)):
        for sx in (-1, 1):
            wheel(P, f'pw_{i}_{sx}', 1.4 + sx * 0.28, yy, root, r=0.14, w=0.08, mat='grey')
    flag('India', (-0.55, 0.45, deck + 0.4), root, pole=1.0)
    export('mission-vikram.glb')


def slim():  # JAXA SLIM — small lander that came to rest tipped nose-down
    reset(); P = palette()
    root = empty('SLIM', (0, 0, 0))
    tilt = empty('tilt', (0, 0, 0.5), root, rot=(RAD(-40), 0, 0))
    box('bus', (0.8, 1.1, 0.6), (0, 0, 0.6), P['gold'], tilt)
    for s in (-1, 1):
        sphere(f'tank_{s}', 0.22, (s * 0.5, 0.3, 0.6), P['silver'], tilt)
    box('panel', (0.7, 0.02, 0.5), (0, -0.4, 0.75), P['cells'], tilt, rot=(RAD(10), 0, 0))
    for k in range(2):
        strut(f'leg_{k}', (0.3 - k * 0.6, 0.5, 0.3), (0.4 - k * 0.8, 0.9, 0.0), 0.04, P['grey'], tilt)
    cone('nozzle', 0.16, 0.05, 0.2, (0, 0.55, 0.4), P['engine'], tilt, rot=(RAD(90), 0, 0))
    flag('Japan', (-0.45, -0.2, 0.6), tilt, pole=0.7)
    export('mission-slim.glb')


def beresheet():  # SpaceIL Beresheet — small round-ish four-leg lander
    reset(); P = palette()
    root = empty('BERESHEET', (0, 0, 0))
    deck = 0.5
    cylinder('bus', 0.6, 0.5, (0, 0, deck + 0.25), P['gold'], root, verts=8)
    box('top', (0.5, 0.5, 0.15), (0, 0, deck + 0.55), P['cells'], root)
    for k in range(4):
        a = RAD(45 + 90 * k)
        foot = (math.cos(a) * 0.95, math.sin(a) * 0.95, 0)
        strut(f'leg_{k}', (math.cos(a) * 0.45, math.sin(a) * 0.45, deck), foot, 0.045, P['aluminium'], root)
        cylinder(f'pad_{k}', 0.14, 0.05, foot, P['grey'], root, verts=10)
    cone('nozzle', 0.14, 0.05, 0.25, (0, 0, deck - 0.1), P['engine'], root, rot=(RAD(180), 0, 0))
    flag('Israel', (0.35, 0.35, deck + 0.25), root, pole=0.9)
    export('mission-beresheet.glb')


def rashid():  # UAE Rashid on ispace Hakuto-R M1 — lander plus a tiny four-wheel rover
    reset(); P = palette()
    root = empty('RASHID', (0, 0, 0))
    deck = 0.7
    box('bus', (0.9, 0.9, 0.8), (0, 0, deck + 0.4), P['gold'], root)
    for k in range(4):
        a = RAD(45 + 90 * k)
        foot = (math.cos(a) * 0.95, math.sin(a) * 0.95, 0)
        strut(f'leg_{k}', (math.cos(a) * 0.45, math.sin(a) * 0.45, deck), foot, 0.05, P['aluminium'], root)
        cylinder(f'pad_{k}', 0.15, 0.05, foot, P['grey'], root, verts=10)
    box('panel', (0.9, 0.02, 0.5), (0, 0, deck + 1.0), P['cells'], root)
    # Rashid rover beside it.
    box('rov', (0.35, 0.5, 0.2), (1.2, 0.4, 0.24), P['silver'], root)
    box('rov_p', (0.36, 0.45, 0.02), (1.2, 0.4, 0.36), P['cells'], root)
    for i, yy in enumerate((0.2, 0.6)):
        for sx in (-1, 1):
            wheel(P, f'rw_{i}_{sx}', 1.2 + sx * 0.22, yy, root, r=0.11, w=0.07, mat='grey')
    flag('UAE', (-0.5, 0.4, deck + 0.4), root, pole=1.0)
    export('mission-rashid.glb')


def odysseus():  # Intuitive Machines IM-1 — tall hexagonal lander, came to rest on its side
    reset(); P = palette()
    root = empty('ODYSSEUS', (0, 0, 0))
    tilt = empty('tilt', (0, 0, 0.7), root, rot=(RAD(-65), 0, 0))
    cylinder('bus', 0.7, 2.6, (0, 0, 1.3), P['gold'], tilt, verts=6)
    box('deck', (1.0, 1.0, 0.15), (0, 0, 2.65), P['silver'], tilt)
    for k in range(6):
        a = RAD(60 * k)
        strut(f'leg_{k}', (math.cos(a) * 0.6, math.sin(a) * 0.6, 0.2), (math.cos(a) * 1.05, math.sin(a) * 1.05, -0.1), 0.05, P['aluminium'], tilt)
    for s in (-1, 1):
        box(f'panel_{s}', (0.05, 0.7, 1.6), (s * 0.75, 0, 1.4), P['cells'], tilt)
    flag('USA', (0.0, 0.6, 0.5), root, pole=1.2)
    export('mission-odysseus.glb')


if __name__ == '__main__':
    for fn in (lunokhod, luna_lander, surveyor, change_lander, yutu, vikram, slim, beresheet, rashid, odysseus):
        fn()
