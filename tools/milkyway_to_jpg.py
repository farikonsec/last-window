"""Blender headless: convert the SVS Milky Way EXR (linear) to an sRGB JPEG.
Run: blender -b -P tools/milkyway_to_jpg.py
"""
import bpy
from pathlib import Path
root = Path(bpy.path.abspath('//')) if bpy.data.filepath else Path(__file__).resolve().parent.parent
img = bpy.data.images.load(str(root / 'data-raw/milkyway_2020_8k.exr'))
img.scale(4096, 2048)
scene = bpy.context.scene
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 90
img.save_render(str(root / 'public/textures/milkyway-4k.jpg'), scene=scene)
print('saved milkyway')
