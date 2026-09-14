# Data and imagery credits

Raw downloads live in `data-raw/` (gitignored). They are rebuilt into `public/` by `python3 tools/prepare_data.py` and `tools/prepare_textures.sh`. All sources were downloaded on 2026-09-14.

## Moon

- `textures/moon-lroc-8k.jpg`: LROC WAC colour mosaic from the **CGI Moon Kit**, NASA's Scientific Visualization Studio (credit: *NASA's Scientific Visualization Studio*), https://svs.gsfc.nasa.gov/4720/ — `lroc_color_16bit_srgb_8k.tif`, reduced to 8-bit JPEG. The colour is enhanced and normalised; the game scales it to physical albedo in the shader.
- `data/moon-dem-8ppd.i16`, `data/hadley-dem-16ppd.i16`: LOLA elevation from the same kit, `ldem_16.tif` (float km above 1737.4 km, 16 px/deg). The globe file is a 2×2 block mean at 8 px/deg (2880×1440). The region file is unmodified 16 px/deg over 16–36° N, 6.4° W–13.6° E (320×320). Both are little-endian int16 metres, row 0 = north, column 0 = west edge. Column 0 of the source is 180° W, checked against the lowest (Antoniadi, ~70.3° S 172.5° W) and highest (~5.4° N 158.7° W) points.
- These are roughly 3.8 km (globe) and 1.9 km (region) grid spacings, not landing-scale survey detail. Close-range detail is procedural and disclosed as such.

## Earth

- `textures/earth-day-4k.jpg`: **Blue Marble: Next Generation**, December 2004, topography and bathymetry. NASA Earth Observatory (Reto Stöckli, NASA GSFC). https://visibleearth.nasa.gov/collection/1484/blue-marble — `world.topo.bathy.200412.3x5400x2700.jpg`, resized to 4096×2048.
- `textures/earth-night-4k.jpg`: **Black Marble 2016**, NASA Earth Observatory (Joshua Stevens, Miguel Román, NASA GSFC). `BlackMarble_2016_3km.jpg`, resized and made grey.
- `textures/earth-clouds-4k.jpg`: **Blue Marble clouds**, NASA Earth Observatory. `cloud_combined_8192.tif`, resized.

## Sky

- `textures/milkyway-4k.jpg`: **Deep Star Maps 2020**, NASA's Scientific Visualization Studio (Ernie Wright), https://svs.gsfc.nasa.gov/4851/ — `milkyway_2020_8k.exr`, the Milky Way background with the bright Hipparcos/Tycho stars removed. It uses celestial (J2000 equatorial) coordinates, centred on 0h RA with RA increasing to the left. Converted to sRGB JPEG with Blender (`tools/milkyway_to_jpg.py`).
- `data/stars-bsc5.f32`: **Yale Bright Star Catalogue, 5th revised edition** (Hoffleit & Warren 1991), http://tdc-www.harvard.edu/catalogs/bsc5.html. The 8,404 stars with V ≤ 6.5 are stored as little-endian float32 records [RA rad, Dec rad, V mag, B−V] (J2000).

## Software

- `astronomy-engine` 2.1.19 (MIT), Don Cross: Sun/Earth/Moon positions and lunar orientation.
- `three` 0.185.1 (MIT).

## Usage note

NASA imagery is generally not subject to copyright in the United States. NASA's media guidelines ask for credit and forbid implying NASA endorsement: https://www.nasa.gov/nasa-brand-center/images-and-media/. This game is not affiliated with or endorsed by NASA.
