"""Shared helpers for the headless Blender model builders.

Conventions (see PLAN.md §5):
- Metres. Blender Z is up and the vehicle front is -Y; the glTF exporter turns that into +Y up and +Z front, which is
  the game's body frame (thrust +Y, docking port +Z).
- The model origin is the ground contact plane centre for landed hardware, the docking-port axis for ships.
- Attach points are empties with fixed names (engine_main, dock_port, rcs_*, window_*) that the game looks up.
Everything is procedural, so any model can be rebuilt from its script; nothing is clicked in by hand.
"""
import math
from pathlib import Path

import bpy
from mathutils import Euler, Vector

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / 'public' / 'models'


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, colour, metal=0.0, rough=0.5, emit=None, strength=0.0):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    return m


# A small palette of spacecraft materials (linear colours).
def palette():
    return {
        'gold': material('gold_foil', (0.62, 0.42, 0.12), metal=1.0, rough=0.32),
        'amber': material('amber_foil', (0.55, 0.30, 0.06), metal=1.0, rough=0.45),
        'silver': material('silver_foil', (0.75, 0.75, 0.76), metal=1.0, rough=0.28),
        'aluminium': material('aluminium', (0.62, 0.63, 0.65), metal=0.9, rough=0.42),
        'grey': material('grey_paint', (0.36, 0.37, 0.39), metal=0.2, rough=0.6),
        'white': material('white_paint', (0.80, 0.80, 0.78), metal=0.0, rough=0.55),
        'black': material('black_thermal', (0.025, 0.025, 0.028), metal=0.0, rough=0.7),
        'engine': material('engine_niobium', (0.18, 0.17, 0.16), metal=1.0, rough=0.35),
        'glass': material('window_glass', (0.01, 0.012, 0.016), metal=0.0, rough=0.04, emit=(1.0, 0.72, 0.42), strength=0.04),
        'cells': material('solar_cells', (0.02, 0.035, 0.09), metal=0.4, rough=0.22),
        'red': material('nav_red', (0.3, 0.01, 0.01), emit=(1.0, 0.05, 0.03), strength=8.0),
        'green': material('nav_green', (0.01, 0.3, 0.02), emit=(0.05, 1.0, 0.1), strength=8.0),
        'target': material('dock_target', (0.9, 0.9, 0.9), metal=0.0, rough=0.5, emit=(1.0, 1.0, 1.0), strength=1.5),
    }


def smooth(obj, angle=40):
    """Smooth shading with edges sharper than `angle` kept crisp (round parts stop looking faceted)."""
    if obj.type != 'MESH':
        return obj
    for poly in obj.data.polygons:
        # N-gon caps are flat: smoothing their exported triangle fan draws radial streaks under a point light.
        poly.use_smooth = len(poly.vertices) <= 4
    obj.data.set_sharp_from_angle(angle=math.radians(angle))
    return obj


def _finish(obj, name, mat, parent):
    obj.name = name
    if obj.data is not None and mat is not None:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def _apply_transform(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def bevel(obj, width=0.02, segments=2):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    return obj


def box(name, size, loc, mat, parent=None, rot=(0, 0, 0), bevel_width=0.015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    _apply_transform(o)
    if bevel_width:
        bevel(o, bevel_width)
    return _finish(o, name, mat, parent)


def cylinder(name, radius, depth, loc, mat, parent=None, rot=(0, 0, 0), verts=24, bevel_width=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    if bevel_width:
        bevel(o, bevel_width)
    smooth(o)
    return _finish(o, name, mat, parent)


def cone(name, r1, r2, depth, loc, mat, parent=None, rot=(0, 0, 0), verts=32, open_ends=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot,
                                    end_fill_type='NOTHING' if open_ends else 'NGON')
    o = bpy.context.active_object
    # Engine bells are thin shells seen from both sides.
    solid = o.modifiers.new('shell', 'SOLIDIFY')
    solid.thickness = 0.02
    smooth(o)
    return _finish(o, name, mat, parent)


def sphere(name, radius, loc, mat, parent=None, scale=(1, 1, 1), segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    _apply_transform(o)
    smooth(o)
    return _finish(o, name, mat, parent)


def torus(name, major, minor, loc, mat, parent=None, rot=(0, 0, 0), major_segments=32, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=major_segments, minor_segments=minor_segments)
    o = bpy.context.active_object
    smooth(o)
    return _finish(o, name, mat, parent)


def strut(name, a, b, radius, mat, parent=None, verts=10):
    """Cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    return cylinder(name, radius, d.length, (a + b) / 2, mat, parent=parent, rot=rot, verts=verts)


def empty(name, loc, parent=None, rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    o.rotation_euler = Euler(rot)
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o


def crinkle(obj, strength=0.012, scale=0.06, subdivisions=2):
    """Crinkled multilayer insulation: subdivide and displace with fine noise (baked into the exported mesh)."""
    sub = obj.modifiers.new('subdivide', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = subdivisions
    sub.render_levels = subdivisions
    # Voronoi cells read as crumpled facets; cloud noise looked like a pixel checkerboard at this resolution.
    tex = bpy.data.textures.new(f'{obj.name}_crinkle', 'VORONOI')
    tex.noise_scale = scale
    tex.distance_metric = 'DISTANCE'
    disp = obj.modifiers.new('crinkle', 'DISPLACE')
    disp.texture = tex
    disp.strength = strength
    disp.mid_level = 0.5
    # Smooth shading so the displaced facets read as creased foil rather than a grid of flat squares.
    for poly in obj.data.polygons:
        # N-gon caps are flat: smoothing their exported triangle fan draws radial streaks under a point light.
        poly.use_smooth = len(poly.vertices) <= 4
    return obj


def export(filename):
    MODELS.mkdir(parents=True, exist_ok=True)
    path = MODELS / filename
    # Shared presentation scale, including attach points; preserve each model's origin.
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.scale *= 1.25
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False)
    print('exported', path)
    return path


RAD = math.radians
