"""Render a quick look-dev still of an exported model under a low lunar Sun.
Run: blender -b -P tools/blender/preview.py -- public/models/kestrel.glb out.png [distance] [azimuth] [elevation]
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
distance = float(args[2]) if len(args) > 2 else 14
azimuth = math.radians(float(args[3]) if len(args) > 3 else 35)
elevation = math.radians(float(args[4]) if len(args) > 4 else 12)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lo = Vector((min(min((o.matrix_world @ Vector(c)).x for c in o.bound_box) for o in objs),
             min(min((o.matrix_world @ Vector(c)).y for c in o.bound_box) for o in objs),
             min(min((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in objs)))
hi = Vector((max(max((o.matrix_world @ Vector(c)).x for c in o.bound_box) for o in objs),
             max(max((o.matrix_world @ Vector(c)).y for c in o.bound_box) for o in objs),
             max(max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in objs)))
centre = (lo + hi) / 2
print('bounds', tuple(round(v, 2) for v in lo), tuple(round(v, 2) for v in hi))

# Regolith-grey ground and a black sky, one hard Sun 19 degrees up.
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, lo.z))
ground = bpy.context.active_object
gm = bpy.data.materials.new('ground'); gm.use_nodes = True
g = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
g.inputs['Base Color'].default_value = (0.12, 0.115, 0.11, 1); g.inputs['Roughness'].default_value = 1.0
ground.data.materials.append(gm)
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(90 - 19), 0, math.radians(-60)))
sun = bpy.context.active_object
sun.data.energy = 6.0
sun.data.angle = math.radians(0.53)
world = bpy.data.worlds.new('space'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
bpy.context.scene.world = world

cam_pos = centre + Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation))) * distance
bpy.ops.object.camera_add(location=cam_pos)
cam = bpy.context.active_object
cam.rotation_euler = (centre - cam_pos).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 40
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.device = 'CPU'
scene.render.resolution_x, scene.render.resolution_y = 960, 720
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
