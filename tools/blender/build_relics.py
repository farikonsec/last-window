"""Hardware left on the Moon, plus the new crew's UN flag. Run: blender -b -P tools/blender/build_relics.py

Simplified but correctly sized. Origins at ground contact. Frame: Z up, front -Y.
- apollo-lm-descent.glb  Apollo lunar module descent stage (the ascent stage lifted off): 4.2 m octagon, 9.4 m across legs.
- lrv.glb                Lunar Roving Vehicle: 3.1 m long, 2.3 m wheelbase, 1.8 m track, 0.82 m wire-mesh wheels.
- alsep.glb              ALSEP central station with sunshade, RTG, passive seismometer and laser retroreflector.
- flag-us.glb            US flag on a 2 m pole with crossbar, sun-bleached to white (as LROC images suggest).
- flag-un.glb            The new crew's UN flag.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (RAD, box, cone, crinkle, cylinder, empty, export, material, palette, reset, sphere, strut, torus)  # noqa: E402
from build_kestrel import descent_stage  # noqa: E402


def apollo_descent():
    reset()
    P = palette()
    root = empty('APOLLO_LM_DESCENT', (0, 0, 0))
    deck = descent_stage(P, root, width=2.1, height=1.65, deck=2.45, leg_reach=4.5)
    # Deck left behind at liftoff: the interstage fittings, scorched by the ascent engine, and a black blast shield.
    cylinder('blast_shield', 1.2, 0.04, (0, 0, deck + 0.02), P['black'], root, verts=8)
    for k in range(4):
        a = RAD(45 + 90 * k)
        box(f'interstage_fitting_{k}', (0.2, 0.2, 0.25), (math.cos(a) * 1.0, math.sin(a) * 1.0, deck + 0.12), P['aluminium'], root)
    # MESA equipment bay door hanging open on the front-left face.
    box('mesa_door', (1.1, 0.05, 0.8), (-1.7, -1.5, deck - 1.2), P['silver'], root, rot=(RAD(40), 0, RAD(45)))
    export('apollo-lm-descent.glb')


def wire_wheel(P, name, loc, parent):
    x, y, z = loc
    torus(f'{name}_tyre', 0.36, 0.07, loc, P['wheel'], parent, rot=(0, RAD(90), 0), major_segments=40, minor_segments=10)
    cylinder(f'{name}_hub', 0.1, 0.18, loc, P['aluminium'], parent, rot=(0, RAD(90), 0), verts=16)
    for k in range(10):  # chevron treads
        a = RAD(36 * k)
        box(f'{name}_tread_{k}', (0.24, 0.03, 0.05), (x, y + math.cos(a) * 0.43, z + math.sin(a) * 0.43), P['aluminium'], parent, rot=(-a, 0, 0), bevel_width=0.0)
    # Fender above the wheel.
    box(f'{name}_fender', (0.3, 0.8, 0.02), (x, y, z + 0.47), P['fender'], parent, bevel_width=0.005)


def lrv():
    reset()
    P = palette()
    P['wheel'] = material('wire_mesh', (0.35, 0.33, 0.3), metal=0.8, rough=0.6)
    P['fender'] = material('fender_orange', (0.55, 0.25, 0.08), metal=0.0, rough=0.6)
    P['seat'] = material('seat_webbing', (0.45, 0.45, 0.42), metal=0.0, rough=0.9)
    root = empty('LRV', (0, 0, 0))
    wheel_z = 0.41
    for name, x, y in (('wheel_fl', -0.9, -1.15), ('wheel_fr', 0.9, -1.15), ('wheel_rl', -0.9, 1.15), ('wheel_rr', 0.9, 1.15)):
        wire_wheel(P, name, (x, y, wheel_z), root)
    # Chassis: three-part aluminium frame, floor panel, suspension arms.
    for sx in (-1, 1):
        strut(f'chassis_rail_{sx:+d}', (sx * 0.55, -1.55, 0.55), (sx * 0.55, 1.55, 0.55), 0.035, P['aluminium'], root, verts=8)
        for y in (-1.15, 1.15):
            strut(f'arm_{sx:+d}_{y:+.1f}', (sx * 0.55, y - 0.2, 0.55), (sx * 0.9, y, wheel_z), 0.025, P['aluminium'], root, verts=6)
    box('floor', (1.1, 3.0, 0.03), (0, 0, 0.52), P['grey'], root, bevel_width=0.0)
    # Seats, control console with its T-handle, and the high-gain umbrella antenna and TV camera up front.
    for sx in (-0.3, 0.3):
        box(f'seat_{sx:+.1f}', (0.45, 0.5, 0.04), (sx, 0.1, 0.75), P['seat'], root, bevel_width=0.0)
        box(f'seat_back_{sx:+.1f}', (0.45, 0.04, 0.45), (sx, 0.37, 0.97), P['seat'], root, rot=(RAD(-12), 0, 0), bevel_width=0.0)
        strut(f'seat_frame_{sx:+.1f}', (sx - 0.22, 0.35, 0.55), (sx - 0.22, 0.35, 1.2), 0.015, P['aluminium'], root, verts=6)
    box('console', (0.4, 0.12, 0.3), (0, -0.55, 1.05), P['black'], root)
    strut('console_post', (0, -0.5, 0.55), (0, -0.55, 0.95), 0.03, P['aluminium'], root, verts=8)
    strut('hga_mast', (0.35, -1.35, 0.55), (0.35, -1.35, 1.75), 0.02, P['aluminium'], root, verts=8)
    sphere('hga_umbrella', 0.46, (0.35, -1.35, 1.8), P['white'], root, scale=(1, 1, 0.22))
    strut('lga_antenna', (-0.35, -1.35, 0.55), (-0.35, -1.35, 1.6), 0.012, P['aluminium'], root, verts=6)
    strut('camera_mast', (0, -1.5, 0.55), (0, -1.55, 1.15), 0.02, P['aluminium'], root, verts=8)
    box('tv_camera', (0.16, 0.3, 0.14), (0, -1.6, 1.22), P['white'], root)
    box('rear_pallet', (1.0, 0.45, 0.35), (0, 1.35, 0.78), P['silver'], root)
    export('lrv.glb')


def alsep():
    reset()
    P = palette()
    root = empty('ALSEP', (0, 0, 0))
    box('central_station', (0.6, 0.4, 0.32), (0, 0, 0.16), P['silver'], root)
    box('sunshade', (0.65, 0.05, 0.45), (0, 0.22, 0.52), P['white'], root, rot=(RAD(-15), 0, 0))
    strut('antenna_mast', (0.2, -0.1, 0.32), (0.2, -0.1, 1.05), 0.012, P['aluminium'], root, verts=6)
    cone('antenna_helix', 0.05, 0.05, 0.4, (0.2, -0.1, 1.25), P['aluminium'], root, verts=8)
    cylinder('rtg', 0.2, 0.46, (2.8, 1.2, 0.32), P['black'], root, verts=16)
    for k in range(8):
        a = RAD(45 * k)
        box(f'rtg_fin_{k}', (0.02, 0.2, 0.44), (2.8 + math.cos(a) * 0.28, 1.2 + math.sin(a) * 0.28, 0.32), P['black'], root, rot=(0, 0, a), bevel_width=0.0)
    strut('rtg_cable', (0.3, 0.2, 0.02), (2.6, 1.1, 0.02), 0.01, P['black'], root, verts=6)
    sphere('seismometer_shroud', 0.55, (-2.4, 1.6, 0.0), P['silver'], root, scale=(1, 1, 0.35))
    box('lrrr_array', (0.46, 0.46, 0.06), (1.8, -2.5, 0.35), P['aluminium'], root, rot=(RAD(-40), 0, 0))
    strut('lrrr_leg', (1.8, -2.35, 0.0), (1.8, -2.45, 0.3), 0.02, P['aluminium'], root, verts=6)
    export('alsep.glb')


def flag(name, filename, colours):
    reset()
    P = palette()
    root = empty(name, (0, 0, 0))
    strut('pole', (0, 0, -0.3), (0, 0, 2.05), 0.018, P['aluminium'], root, verts=10)
    strut('crossbar', (0, 0, 2.0), (1.2, 0, 2.0), 0.012, P['aluminium'], root, verts=8)
    # Fabric: a subdivided plane hung from the crossbar, rippled where it was folded for flight.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.6, 0, 1.6), rotation=(RAD(90), 0, 0))
    cloth = bpy.context.active_object
    cloth.name = 'fabric'
    cloth.scale = (1.2, 0.8, 1)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    sub = cloth.modifiers.new('sub', 'SUBSURF'); sub.subdivision_type = 'SIMPLE'; sub.levels = 4
    wave = cloth.modifiers.new('ripple', 'WAVE')
    wave.use_normal = True; wave.height = 0.03; wave.width = 0.25; wave.narrowness = 1.0; wave.use_y = False
    solid = cloth.modifiers.new('thickness', 'SOLIDIFY'); solid.thickness = 0.004
    cloth.data.materials.append(colours['fabric']())
    for poly in cloth.data.polygons:
        poly.use_smooth = True
    cloth.parent = root
    for part in colours.get('emblem', []):
        part(root)
    export(filename)


def build():
    apollo_descent()
    lrv()
    alsep()
    # Six decades of unfiltered ultraviolet have bleached the Apollo flags white.
    # Materials are created inside each build (reset() clears the file), hence the small factories.
    flag('FLAG_US', 'flag-us.glb', {'fabric': lambda: material('bleached_nylon', (0.72, 0.71, 0.68), rough=0.85)})

    def emblem(root):
        # Stylised globe emblem: a white ring and disc on the blue field.
        white = material('un_white', (0.8, 0.8, 0.8), rough=0.8)
        torus('emblem_ring', 0.19, 0.018, (0.6, -0.012, 1.6), white, root, rot=(RAD(90), 0, 0))
        cylinder('emblem_globe', 0.12, 0.012, (0.6, -0.012, 1.6), white, root, rot=(RAD(90), 0, 0), verts=32)
    flag('FLAG_UN', 'flag-un.glb', {'fabric': lambda: material('un_blue', (0.13, 0.33, 0.66), rough=0.8), 'emblem': [emblem]})


if __name__ == '__main__':
    build()
