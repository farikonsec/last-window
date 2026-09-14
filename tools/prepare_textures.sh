#!/bin/sh
# Resize and re-encode downloaded NASA imagery (data-raw/) into public/textures/. Needs ImageMagick and Blender.
set -e
cd "$(dirname "$0")/.."
magick data-raw/lroc_color_16bit_srgb_8k.tif -depth 8 -quality 90 public/textures/moon-lroc-8k.jpg
magick data-raw/world.topo.bathy.200412.3x5400x2700.jpg -resize 4096x2048 -quality 90 public/textures/earth-day-4k.jpg
magick data-raw/BlackMarble_2016_3km.jpg -resize 4096x2048 -colorspace Gray -quality 90 public/textures/earth-night-4k.jpg
magick data-raw/cloud_combined_8192.tif -resize 4096x2048 -colorspace Gray -quality 88 public/textures/earth-clouds-4k.jpg
blender -b -P tools/milkyway_to_jpg.py
