"""Convert downloaded NASA data in data-raw/ into compact game files in public/.

Run: python3 tools/prepare_data.py   (needs numpy and Pillow)
Longitude convention of the SVS Moon Kit DEM: column 0 is 180 W, verified against the
lowest point (Antoniadi, ~70.3 S 172.5 W) and highest point (~5.4 N 158.7 W).
"""
import gzip, struct
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / 'data-raw', ROOT / 'public'

def dem():
    km = np.array(Image.open(RAW / 'ldem_16.tif'), dtype=np.float32)  # km above 1737.4 km, 16 px/deg
    H, W = km.shape
    # Globe: 8 px/deg (~3.8 km), block mean.
    globe = km.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
    (OUT / 'data/moon-dem-8ppd.i16').write_bytes(np.round(globe * 1000).astype('<i2').tobytes())
    # Landing region: full 16 px/deg (~1.9 km) over 16..36 N, 6.4 W..13.6 E around Hadley-Apennine.
    y0, y1 = int((90 - 36) * 16), int((90 - 16) * 16)
    x0, x1 = int((180 - 6.4) * 16), int((180 + 13.6) * 16)
    region = km[y0:y1, x0:x1]
    (OUT / 'data/hadley-dem-16ppd.i16').write_bytes(np.round(region * 1000).astype('<i2').tobytes())
    print('dem globe', globe.shape, 'region', region.shape, 'range m', round(km.min() * 1000), round(km.max() * 1000))

def stars():
    """Yale Bright Star Catalogue, 5th ed. -> float32 [ra rad, dec rad, vmag, b-v] for V <= 6.5."""
    rows = []
    for line in gzip.open(RAW / 'ybsc5.gz', 'rt', encoding='latin-1'):
        line = line.rstrip('\n').ljust(197)
        if not line[75:77].strip() or not line[102:107].strip():
            continue  # a handful of entries (novae, removed objects) have no J2000 position or magnitude
        ra = (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15
        dec = int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600
        if line[83] == '-':
            dec = -dec
        vmag = float(line[102:107])
        bv = float(line[109:114]) if line[109:114].strip() else 0.6
        if vmag <= 6.5:
            rows.append((np.radians(ra), np.radians(dec), vmag, bv))
    (OUT / 'data/stars-bsc5.f32').write_bytes(np.array(rows, dtype='<f4').tobytes())
    print('stars', len(rows))



SLDEM_TILE = ('https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/'
              'sldem2015_512_00n_30n_000_045_float.img')

def sldem_hadley(lat0=24.6, lat1=27.6, lon0=2.1, lon1=5.1):
    """SLDEM2015 (LOLA + Kaguya TC, 512 px/deg, ~59 m) crop around Hadley-Apennine, fetched with HTTP byte ranges.

    Tile: 0-30 N, 0-45 E, 15360 lines x 23040 samples of little-endian float32 km above 1737.4 km, pixel registered,
    line 0 at 30 N, sample 0 at 0 E. Output: data/hadley-sldem-512ppd.i16, little-endian int16 metres, row 0 north.
    """
    import urllib.request
    ppd, samples = 512, 23040
    l0, l1 = int(round((30 - lat1) * ppd)), int(round((30 - lat0) * ppd))
    s0, s1 = int(round(lon0 * ppd)), int(round(lon1 * ppd))
    cache = RAW / f'sldem_hadley_{l0}_{l1}_{s0}_{s1}.f32'
    if not cache.exists():
        start, end = l0 * samples * 4, l1 * samples * 4 - 1
        request = urllib.request.Request(SLDEM_TILE, headers={'Range': f'bytes={start}-{end}'})
        cache.write_bytes(urllib.request.urlopen(request, timeout=600).read())
    rows = np.frombuffer(cache.read_bytes(), dtype='<f4').reshape(l1 - l0, samples)[:, s0:s1]
    (OUT / 'data/hadley-sldem-512ppd.i16').write_bytes(np.round(rows * 1000).astype('<i2').tobytes())
    print('sldem hadley', rows.shape, 'lines', l0, l1, 'samples', s0, s1, 'range m', round(rows.min() * 1000), round(rows.max() * 1000))


if __name__ == '__main__':
    dem()
    stars()
    sldem_hadley()
