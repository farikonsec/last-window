"""KESTREL two-stage lander (fictional, LM-inspired). Run: blender -b -P tools/blender/build_kestrel.py

Blender frame: Z up, front -Y. Origin: centre of the footpad contact plane.
Descent stage stays on the Moon as the launch pad; the ascent stage (crew cabin) lifts off from its top deck.
Nodes the game reads: descent_stage, ascent_stage, engine_main, engine_descent, dock_port,
rcs_front_left, rcs_front_right, rcs_aft_left, rcs_aft_right, window_left, window_right.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (RAD, box, cone, crinkle, cylinder, empty, export, material, palette, reset, sphere, strut, torus)  # noqa: E402


def descent_stage(P, parent, width=2.15, height=1.55, deck=2.25, leg_reach=4.1, pad_z=0.08):
    """Octagonal descent stage in gold and amber foil with four cantilever legs. Returns the deck height."""
    base_z = deck - height
    core = cylinder('descent_core', width, height, (0, 0, base_z + height / 2), P['gold'], parent, rot=(0, 0, RAD(22.5)), verts=8)
    crinkle(core, strength=0.05, scale=0.13, subdivisions=3)
    # Amber foil blankets on alternate faces and black thermal bands top and bottom.
    for k in range(4):
        a = RAD(45 * k)
        panel = box(f'descent_blanket_{k}', (1.45, 0.05, height * 0.82), (math.cos(a) * width * 0.93, math.sin(a) * width * 0.93, base_z + height / 2),
                    P['amber'], parent, rot=(0, 0, a + RAD(90)), bevel_width=0.0)
        crinkle(panel, strength=0.035, scale=0.07, subdivisions=3)
    cylinder('descent_band_top', width * 1.01, 0.1, (0, 0, deck - 0.05), P['black'], parent, rot=(0, 0, RAD(22.5)), verts=8)
    cylinder('descent_band_bottom', width * 1.01, 0.12, (0, 0, base_z + 0.06), P['black'], parent, rot=(0, 0, RAD(22.5)), verts=8)
    # Equipment on the flat faces between the legs: a science pallet, a battery box, propellant plumbing.
    for k, (name, size) in enumerate((('pallet', (1.1, 0.35, 0.6)), ('battery', (0.7, 0.3, 0.45)), ('water_tank', (0.5, 0.3, 0.9)), ('antenna_box', (0.6, 0.3, 0.35)))):
        a = RAD(90 * k)
        box(f'descent_{name}', size, (math.cos(a) * (width + 0.12), math.sin(a) * (width + 0.12), base_z + height * 0.45), P['black' if k % 2 else 'silver'], parent, rot=(0, 0, a + RAD(90)))
    for k in range(8):
        a = RAD(22.5 + 45 * k)
        strut(f'descent_pipe_{k}', (math.cos(a) * width * 0.97, math.sin(a) * width * 0.97, base_z + 0.2), (math.cos(a) * width * 0.97, math.sin(a) * width * 0.97, deck - 0.15), 0.025, P['aluminium'], parent, verts=6)
    # Descent engine and its skirt.
    cone('engine_descent_bell', 0.78, 0.28, 0.9, (0, 0, base_z - 0.2), P['engine'], parent)
    empty('engine_descent', (0, 0, base_z - 0.65), parent)
    # Legs on the diagonals: primary strut, two secondaries, a footpad and a contact probe.
    for k in range(4):
        a = RAD(45 + 90 * k)
        c, s = math.cos(a), math.sin(a)
        hip = (c * width * 0.92, s * width * 0.92, deck - 0.25)
        knee = (c * (leg_reach - 0.35), s * (leg_reach - 0.35), pad_z + 0.62)
        # The lower strut ends on the footpad's top face, through a ball joint (no gap between leg and pad).
        foot = (c * leg_reach, s * leg_reach, pad_z + 0.07)
        strut(f'leg_{k}_primary', hip, knee, 0.075, P['gold'], parent)
        strut(f'leg_{k}_lower', knee, (foot[0], foot[1], foot[2] + 0.06), 0.06, P['aluminium'], parent)
        sphere(f'leg_{k}_ball_joint', 0.09, (foot[0], foot[1], foot[2] + 0.06), P['aluminium'], parent, segments=16, rings=8)
        side = (-s, c)
        for sgn, tag in ((1, 'a'), (-1, 'b')):
            low = (c * width * 0.95 + side[0] * 0.75 * sgn, s * width * 0.95 + side[1] * 0.75 * sgn, base_z + 0.25)
            strut(f'leg_{k}_brace_{tag}', low, knee, 0.035, P['aluminium'], parent)
        pad = cylinder(f'leg_{k}_footpad', 0.46, 0.14, (foot[0], foot[1], pad_z), P['aluminium'], parent, verts=24)
        sphere(f'leg_{k}_pad_dome', 0.46, (foot[0], foot[1], pad_z - 0.02), P['aluminium'], parent, scale=(1, 1, 0.25))
        if k != 1:  # no probe on the ladder leg, as on the LM
            # Contact probes fold up and back when the pads touch down; shown bent over the footpad.
            root = (foot[0] - c * 0.2, foot[1] - s * 0.2, pad_z + 0.1)
            bend = (foot[0] + c * 0.45, foot[1] + s * 0.45, pad_z + 0.05)
            strut(f'leg_{k}_probe', root, bend, 0.012, P['aluminium'], parent, verts=6)
            strut(f'leg_{k}_probe_tip', bend, (bend[0] + c * 0.5 - s * 0.3, bend[1] + s * 0.5 + c * 0.3, pad_z + 0.3), 0.012, P['aluminium'], parent, verts=6)
    # Ladder on the front-left leg (k = 1 sits at 135 degrees, i.e. front when -Y is forward).
    a = RAD(135)
    for rail in (-0.22, 0.22):
        top = (math.cos(a) * width + math.sin(a) * rail, math.sin(a) * width - math.cos(a) * rail, deck - 0.3)
        bottom = (math.cos(a) * (leg_reach - 0.5) + math.sin(a) * rail, math.sin(a) * (leg_reach - 0.5) - math.cos(a) * rail, 0.75)
        strut(f'ladder_rail_{rail:+.2f}', top, bottom, 0.02, P['aluminium'], parent, verts=6)
    for i in range(7):
        t = (i + 0.5) / 7
        r = width + (leg_reach - 0.5 - width) * t
        z = deck - 0.3 + (0.75 - (deck - 0.3)) * t
        l = (math.cos(a) * r + math.sin(a) * 0.22, math.sin(a) * r - math.cos(a) * 0.22, z)
        rr = (math.cos(a) * r - math.sin(a) * 0.22, math.sin(a) * r + math.cos(a) * 0.22, z)
        strut(f'ladder_rung_{i}', l, rr, 0.014, P['aluminium'], parent, verts=6)
    # Porch at the top of the ladder.
    box('porch', (0.9, 0.9, 0.05), (math.cos(a) * (width + 0.4), math.sin(a) * (width + 0.4), deck - 0.2), P['aluminium'], parent, rot=(0, 0, a))
    return deck


def rcs_quad(P, name, loc, parent, outward):
    """Four-nozzle RCS cluster: up, down, and two sideways thrusters."""
    group = empty(name, loc, parent)
    box(f'{name}_housing', (0.26, 0.26, 0.26), loc, P['grey'], parent)
    x, y, z = loc
    ox, oy = outward
    for tag, direction in (('up', (0, 0, 1)), ('down', (0, 0, -1)), ('side_a', (ox, 0, 0)), ('side_b', (0, oy, 0))):
        d = direction
        tip = (x + d[0] * 0.26, y + d[1] * 0.26, z + d[2] * 0.26)
        rot = __import__('mathutils').Vector((0, 0, 1)).rotation_difference(__import__('mathutils').Vector(d)).to_euler()
        cone(f'{name}_nozzle_{tag}', 0.07, 0.03, 0.18, tip, P['engine'], parent, rot=rot, verts=12)
    return group


def triangle_window(P, name, loc, spin, parent, size=0.62, rake=14):
    """Triangular window on the raked front face. `spin` turns the triangle within the face (apex direction)."""
    parts = []
    for part, radius, depth, mat in (('frame', size * 0.64, 0.05, P['black']), ('glass', size * 0.54, 0.07, P['glass'])):
        o = cylinder(f'{name}_{part}', radius, depth, loc, mat, parent, verts=3)
        # Spin within the face first, then tilt the prism axis to the face normal (-Y raked back by `rake`).
        o.rotation_mode = 'ZXY'
        o.rotation_euler = (RAD(90 - rake), 0, spin)
        parts.append(o)
    return parts


def ascent_stage(P, parent, deck):
    """LM-inspired ascent stage: a horizontal crew cylinder with a faceted front face, triangular windows, a forward
    docking tunnel, midsection and aft equipment bay, four RCS quads, antennas and the ascent engine."""
    z0 = deck
    cz = z0 + 1.2
    # Crew compartment: cylinder along X, wrapped in silver foil, with black thermal end caps.
    crew = cylinder('crew_cylinder', 1.05, 2.3, (0, -0.25, cz), P['silver'], parent, rot=(0, RAD(90), 0), verts=10)
    crinkle(crew, strength=0.02, scale=0.08, subdivisions=2)
    for sx in (-1, 1):
        cylinder(f'crew_endcap_{sx:+d}', 1.07, 0.06, (sx * 1.16, -0.25, cz), P['black'], parent, rot=(0, RAD(90), 0), verts=10)
    # Faceted front face plate, raked back, carrying the windows.
    face = box('front_face', (2.0, 0.12, 1.5), (0, -1.22, cz + 0.2), P['silver'], parent, rot=(RAD(-14), 0, 0), bevel_width=0.04)
    crinkle(face, strength=0.012, scale=0.05, subdivisions=2)
    for side, sx in (('left', -1), ('right', 1)):
        # Long edge on top, apex pointing down, canted slightly inward, as on the LM.
        triangle_window(P, f'window_{side}', (sx * 0.5, -1.32, cz + 0.42), RAD(180) + sx * RAD(8), parent, size=0.8)
        empty(f'window_{side}', (sx * 0.5, -1.36, cz + 0.42), parent)
    # Midsection and aft equipment bay with gold foil and black radiators.
    mid = box('midsection', (1.9, 1.3, 1.8), (0, 0.75, cz + 0.05), P['gold'], parent, bevel_width=0.04)
    crinkle(mid, strength=0.03, scale=0.09, subdivisions=2)
    box('aft_bay', (1.7, 0.9, 1.3), (0, 1.8, cz - 0.1), P['black'], parent, bevel_width=0.03)
    for sx in (-1, 1):
        box(f'aft_radiator_{sx:+d}', (0.04, 0.8, 1.1), (sx * 0.9, 1.8, cz - 0.1), P['white'], parent, bevel_width=0.0)
        cylinder(f'rcs_tank_{sx:+d}', 0.28, 1.1, (sx * 1.05, 0.7, cz - 0.55), P['aluminium'], parent, rot=(RAD(90), 0, 0), verts=16)
    # Docking tunnel on the front, below the windows: black collar, silver ring, drogue and a lit target cross.
    port_z = cz - 0.55
    cylinder('dock_tunnel', 0.36, 0.5, (0, -1.35, port_z), P['black'], parent, rot=(RAD(90), 0, 0), verts=24)
    torus('dock_ring', 0.38, 0.045, (0, -1.61, port_z), P['silver'], parent, rot=(RAD(90), 0, 0))
    cone('dock_drogue', 0.32, 0.06, 0.24, (0, -1.5, port_z), P['engine'], parent, rot=(RAD(-90), 0, 0))
    box('dock_target_vertical', (0.025, 0.025, 0.3), (0, -1.36, cz + 1.05), P['target'], parent, bevel_width=0.0)
    box('dock_target_horizontal', (0.3, 0.025, 0.025), (0, -1.36, cz + 1.05), P['target'], parent, bevel_width=0.0)
    empty('dock_port', (0, -1.64, port_z), parent, rot=(RAD(90), 0, 0))
    # Overhead hatch, rendezvous radar dish, S-band antenna and VHF blades.
    torus('top_hatch', 0.32, 0.04, (0, -0.1, cz + 1.06), P['aluminium'], parent)
    strut('radar_mast', (-0.55, -0.75, cz + 0.95), (-0.75, -1.05, cz + 1.45), 0.03, P['aluminium'], parent)
    sphere('radar_dish', 0.3, (-0.78, -1.1, cz + 1.5), P['white'], parent, scale=(1, 1, 0.3))
    strut('hga_mast', (0.6, 1.3, cz + 0.95), (1.0, 1.8, cz + 1.8), 0.03, P['aluminium'], parent)
    sphere('hga_dish', 0.38, (1.02, 1.85, cz + 1.9), P['white'], parent, scale=(1, 1, 0.26))
    for sx in (-1, 1):
        strut(f'vhf_blade_{sx:+d}', (sx * 0.8, 1.2, cz + 0.95), (sx * 1.1, 1.3, cz + 1.65), 0.01, P['aluminium'], parent, verts=6)
    sphere('nav_light_red', 0.045, (-1.2, -0.9, cz + 0.8), P['red'], parent)
    sphere('nav_light_green', 0.045, (1.2, -0.9, cz + 0.8), P['green'], parent)
    # RCS quads on outriggers at the four corners.
    for name, x, y in (('rcs_front_left', -1.5, -0.75), ('rcs_front_right', 1.5, -0.75), ('rcs_aft_left', -1.5, 1.15), ('rcs_aft_right', 1.5, 1.15)):
        strut(f'{name}_boom', (math.copysign(1.0, x), y, cz + 0.55), (x, y, cz + 0.7), 0.04, P['aluminium'], parent, verts=8)
        rcs_quad(P, name, (x, y, cz + 0.75), parent, (math.copysign(1, x), math.copysign(1, y)))
    # Ascent engine, recessed under the cabin (fires down through the descent stage deck).
    cone('engine_main_bell', 0.4, 0.17, 0.55, (0, 0.3, z0 - 0.05), P['engine'], parent)
    empty('engine_main', (0, 0.3, z0 - 0.33), parent)


def technical_package(P, parent, deck):
    """KESTREL Mk II: ceramic shell, serviceable cooling loops and optical navigation."""
    import bpy
    cyan = material('guidance_cyan', (0.025, 0.22, 0.28), rough=0.35,
                    emit=(0.08, 0.8, 1.0), strength=2.5)
    ceramic = material('ceramic_ivory', (0.7, 0.76, 0.77), metal=0.12, rough=0.48)
    cz = deck + 1.2
    for sx in (-1, 1):
        # Armoured shoulder plates and contrasting inset service panels.
        box(f'ceramic_shoulder_{sx}', (0.35, 1.85, 0.65), (sx * 1.12, -0.12, cz + 0.72), ceramic, parent,
            rot=(0, sx * RAD(18), 0), bevel_width=0.08)
        box(f'service_panel_{sx}', (0.06, 0.88, 0.62), (sx * 1.36, 0.18, cz + 0.12), P['black'], parent)
        for j in range(6):
            box(f'cooling_fin_{sx}_{j}', (0.18, 0.055, 0.53), (sx * 1.43, -0.18 + j * 0.14, cz + 0.12), P['aluminium'], parent, bevel_width=0.005)
        for y in (-0.36, 0.62):
            strut(f'coolant_riser_{sx}_{y}', (sx * 1.4, y, cz - 0.36), (sx * 1.4, y, cz + 0.6), 0.025, P['amber'], parent)
        box(f'cockpit_brow_{sx}', (0.87, 0.15, 0.11), (sx * 0.55, -1.39, cz + 0.88), ceramic, parent, rot=(0, sx * RAD(8), 0))
        box(f'guidance_strip_{sx}', (0.66, 0.025, 0.027), (sx * 0.55, -1.48, cz + 0.83), cyan, parent, bevel_width=0.008)
        box(f'optical_pod_{sx}', (0.26, 0.3, 0.25), (sx * 1.12, -1.27, cz - 0.35), ceramic, parent)
        cylinder(f'lidar_lens_{sx}', 0.075, 0.035, (sx * 1.12, -1.44, cz - 0.35), cyan, parent, rot=(RAD(90), 0, 0), verts=16)
    for k in range(8):
        a = k * math.tau / 8
        box(f'dock_latch_{k}', (0.07, 0.09, 0.09), (math.sin(a) * 0.43, -1.64, cz - 0.55 + math.cos(a) * 0.43), ceramic, parent)
    # Perforated aft radiator rack supported by diagonal braces.
    for sx in (-1, 1):
        strut(f'radiator_brace_{sx}', (sx * 0.65, 1.5, cz + 0.4), (sx * 1.3, 2.1, cz + 1.1), 0.035, P['aluminium'], parent)
    box('radiator_rack', (2.7, 0.09, 0.66), (0, 2.1, cz + 1.1), P['black'], parent)
    for j in range(14):
        box(f'radiator_channel_{j}', (0.065, 0.07, 0.57), (-1.22 + j * 0.188, 2.16, cz + 1.1), ceramic, parent, bevel_width=0.005)
    # Real mesh lettering survives the runtime material conversion.
    bpy.ops.object.text_add(location=(0, -1.38, cz - 0.05), rotation=(RAD(90), 0, 0))
    text = bpy.context.object
    text.name = 'hull_identification'
    text.data.body = 'KESTREL  /  02'
    text.data.align_x = 'CENTER'
    text.data.size = 0.16
    text.data.extrude = 0.001
    text.data.materials.append(P['black'])
    bpy.ops.object.convert(target='MESH')
    text.parent = parent


def build():
    reset()
    P = palette()
    root = empty('KESTREL', (0, 0, 0))
    descent = empty('descent_stage', (0, 0, 0), root)
    ascent = empty('ascent_stage', (0, 0, 0), root)
    deck = descent_stage(P, descent)
    ascent_stage(P, ascent, deck)
    technical_package(P, ascent, deck)
    export('kestrel.glb')


if __name__ == '__main__':
    build()
