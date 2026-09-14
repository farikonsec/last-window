"""ARGO mothership (fictional crew vehicle waiting in lunar orbit). Run: blender -b -P tools/blender/build_argo.py

Blender frame: Z up, front -Y (glTF +Z). Origin: docking port face, so docking geometry is relative to (0, 0, 0).
About 58 m long: crew module and docking port at the front, a truss spine with propellant tanks and radiators, twin
solar array wings, a high-gain antenna, and the service module with the main engine at the back.
Nodes the game reads: dock_port, engine_main, solar_left, solar_right, hga, rcs_*.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (RAD, box, cone, crinkle, cylinder, empty, export, palette, reset, sphere, strut, torus)  # noqa: E402


def truss(P, parent, y0, y1, half=0.9, bay=3.0):
    """Square lattice spine between y0 and y1 with longerons, frames and diagonals."""
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    for i, (x, z) in enumerate(corners):
        strut(f'truss_longeron_{i}', (x, y0, z), (x, y1, z), 0.07, P['aluminium'], parent, verts=8)
    n = int((y1 - y0) / bay)
    for b in range(n + 1):
        y = y0 + b * (y1 - y0) / n
        for i in range(4):
            a, c = corners[i], corners[(i + 1) % 4]
            strut(f'truss_frame_{b}_{i}', (a[0], y, a[1]), (c[0], y, c[1]), 0.04, P['aluminium'], parent, verts=6)
            if b < n:
                y2 = y0 + (b + 1) * (y1 - y0) / n
                strut(f'truss_diag_{b}_{i}', (a[0], y, a[1]), (c[0], y2, c[1]), 0.03, P['aluminium'], parent, verts=6)


def solar_wing(P, parent, side, y):
    wing = empty(f'solar_{"left" if side < 0 else "right"}', (side * 1.2, y, 0), parent)
    strut(f'solar_mast_{side:+d}', (side * 0.9, y, 0), (side * 3.2, y, 0), 0.12, P['aluminium'], wing, verts=12)
    for k in range(4):
        x = side * (3.6 + k * 3.35)
        panel = box(f'solar_panel_{side:+d}_{k}', (3.2, 0.06, 3.6), (x, y, 0), P['cells'], wing, bevel_width=0.0)
        box(f'solar_frame_{side:+d}_{k}', (3.3, 0.05, 3.7), (x, y + 0.02, 0), P['silver'], wing, bevel_width=0.0)
        # Cell grid ribs: thin silver lines across the dark blue cells.
        for g in range(1, 6):
            box(f'solar_rib_{side:+d}_{k}_{g}', (3.2, 0.07, 0.025), (x, y, -1.8 + g * 0.6), P['silver'], wing, bevel_width=0.0)
    return wing


def rcs_quad(P, name, loc, parent, normal):
    group = empty(name, loc, parent)
    box(f'{name}_housing', (0.5, 0.5, 0.5), loc, P['grey'], parent)
    x, y, z = loc
    nx, nz = normal
    for tag, d in (('fore', (0, -1, 0)), ('aft', (0, 1, 0)), ('side_a', (-nz, 0, nx)), ('side_b', (nz, 0, -nx)), ('out', (nx, 0, nz))):
        from mathutils import Vector
        rot = Vector((0, 0, 1)).rotation_difference(Vector(d)).to_euler()
        cone(f'{name}_nozzle_{tag}', 0.12, 0.05, 0.3, (x + d[0] * 0.45, y + d[1] * 0.45, z + d[2] * 0.45), P['engine'], parent, rot=rot, verts=12)
    return group


def build():
    reset()
    P = palette()
    root = empty('ARGO', (0, 0, 0))
    # Docking port at the origin, pointing -Y.
    cylinder('dock_collar', 0.7, 1.0, (0, 0.5, 0), P['aluminium'], root, rot=(RAD(90), 0, 0), verts=32)
    torus('dock_ring', 0.62, 0.07, (0, 0.02, 0), P['silver'], root, rot=(RAD(90), 0, 0))
    cone('dock_probe_guide', 0.5, 0.12, 0.35, (0, 0.2, 0), P['engine'], root, rot=(RAD(-90), 0, 0))
    strut('dock_probe', (0, 0.1, 0), (0, -0.75, 0), 0.05, P['silver'], root, verts=10)
    empty('dock_port', (0, 0, 0), root, rot=(RAD(90), 0, 0))
    for sx, sz in ((1, 0), (0, 1), (-1, 0), (0, -1)):
        box(f'dock_target_{sx}{sz}', (0.05 + 0.4 * abs(sx), 0.03, 0.05 + 0.4 * abs(sz)), (sx * 1.05, 1.0, sz * 1.05), P['target'], root, bevel_width=0.0)
    # Crew module: nose cone and pressurised cylinder with a window band.
    cone('crew_nose', 1.2, 2.4, 2.4, (0, 2.2, 0), P['white'], root, rot=(RAD(-90), 0, 0), open_ends=False)
    crew = cylinder('crew_module', 2.4, 7.0, (0, 6.9, 0), P['white'], root, rot=(RAD(90), 0, 0), verts=48)
    for k in range(12):
        a = RAD(15 + 30 * k)
        box(f'crew_window_{k}', (0.5, 0.35, 0.05), (math.cos(a) * 2.42, 4.5, math.sin(a) * 2.42), P['glass'], root, rot=(0, -a + RAD(90), 0), bevel_width=0.01)
    for y in (3.6, 10.3):
        torus(f'crew_frame_{y}', 2.42, 0.08, (0, y, 0), P['grey'], root, rot=(RAD(90), 0, 0), major_segments=48)
    blanket = cylinder('crew_blanket', 2.45, 3.0, (0, 8.6, 0), P['silver'], root, rot=(RAD(90), 0, 0), verts=48)
    crinkle(blanket, strength=0.025, scale=0.12, subdivisions=2)
    for name, sx, sz in (('rcs_crew_up', 0, 1), ('rcs_crew_down', 0, -1), ('rcs_crew_left', -1, 0), ('rcs_crew_right', 1, 0)):
        rcs_quad(P, name, (sx * 2.7, 9.5, sz * 2.7), root, (sx, sz))
    sphere('nav_red', 0.1, (-2.5, 5.5, 0.6), P['red'], root)
    sphere('nav_green', 0.1, (2.5, 5.5, 0.6), P['green'], root)
    # Adapter to the truss.
    cone('crew_aft_adapter', 2.4, 1.4, 1.5, (0, 11.15, 0), P['grey'], root, rot=(RAD(-90), 0, 0), open_ends=False)
    truss(P, root, 11.9, 40.0)
    # Propellant tanks around the spine and radiators above and below it.
    for k in range(4):
        a = RAD(45 + 90 * k)
        tank = sphere(f'tank_{k}', 1.55, (math.cos(a) * 2.5, 30.0, math.sin(a) * 2.5), P['gold'], root, scale=(1, 1.3, 1), segments=32, rings=16)
        crinkle(tank, strength=0.03, scale=0.15, subdivisions=1)
    for sz in (1, -1):
        rad = box(f'radiator_{sz:+d}', (2.0, 9.0, 0.08), (0, 18.0, sz * 1.7), P['white'], root, bevel_width=0.0)
        for g in range(8):
            box(f'radiator_pipe_{sz:+d}_{g}', (0.04, 9.0, 0.1), (-0.9 + g * 0.26, 18.0, sz * 1.72), P['grey'], root, bevel_width=0.0)
    solar_wing(P, root, -1, 24.0)
    solar_wing(P, root, 1, 24.0)
    # High-gain antenna on a boom.
    hga = empty('hga', (0, 34.0, 5.0), root)
    strut('hga_boom', (0, 34.0, 0.9), (0, 34.0, 4.6), 0.1, P['aluminium'], hga)
    sphere('hga_dish', 1.6, (0, 34.0, 5.1), P['white'], hga, scale=(1, 1, 0.22), segments=32)
    strut('hga_feed', (0, 34.0, 5.1), (0, 34.0, 6.3), 0.04, P['aluminium'], hga, verts=8)
    # Service module and main engine.
    service = cylinder('service_module', 3.0, 7.0, (0, 43.5, 0), P['silver'], root, rot=(RAD(90), 0, 0), verts=48)
    crinkle(service, strength=0.03, scale=0.14, subdivisions=2)
    for y in (40.1, 46.9):
        torus(f'service_frame_{y}', 3.02, 0.1, (0, y, 0), P['black'], root, rot=(RAD(90), 0, 0), major_segments=48)
    for name, sx, sz in (('rcs_service_up', 0, 1), ('rcs_service_down', 0, -1), ('rcs_service_left', -1, 0), ('rcs_service_right', 1, 0)):
        rcs_quad(P, name, (sx * 3.3, 42.0, sz * 3.3), root, (sx, sz))
    cone('engine_mount', 2.6, 1.0, 1.4, (0, 47.7, 0), P['grey'], root, rot=(RAD(-90), 0, 0), open_ends=False)
    cone('engine_main_bell', 0.7, 2.2, 5.0, (0, 50.8, 0), P['engine'], root, rot=(RAD(-90), 0, 0))
    empty('engine_main', (0, 53.3, 0), root)
    export('argo.glb')


if __name__ == '__main__':
    build()
