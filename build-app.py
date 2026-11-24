#!/usr/bin/env python3
"""Package the butterchurn page as a webOS app (.ipk) that opens over the input.

The app is `defaultWindowType: overlay`, the type LG's Settings app uses to draw over an
HDMI input while its picture and sound keep playing.

    ./build-app.py   ->  dist/org.joelmgallant.butterchurn_<version>_all.ipk
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
BUILD = os.path.join(HERE, 'dist', 'app')
DIST = os.path.join(HERE, 'dist')
ARES_PACKAGE = os.path.join(HERE, 'tools', 'node_modules', '.bin', 'ares-package')

APP_INFO = {
    'id': 'org.joelmgallant.butterchurn',
    'version': '0.1.2',
    'vendor': 'Joel Gallant',
    'type': 'web',
    'main': 'index.html',
    'title': 'Butterchurn',
    'icon': 'icon.png',
    'defaultWindowType': 'overlay',
}


def solid_png(size, rgb):
    """A plain square PNG, so the build needs no image library."""
    row = b'\x00' + bytes(rgb) * size
    raw = row * size

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def main():
    shutil.rmtree(BUILD, ignore_errors=True)
    os.makedirs(BUILD)
    for name in os.listdir(WEB):
        shutil.copy(os.path.join(WEB, name), BUILD)
    with open(os.path.join(BUILD, 'appinfo.json'), 'w') as handle:
        json.dump(APP_INFO, handle, indent=2)
    with open(os.path.join(BUILD, 'icon.png'), 'wb') as handle:
        handle.write(solid_png(80, (90, 30, 140)))
    subprocess.check_call([ARES_PACKAGE, '--no-minify', BUILD, '-o', DIST])
    ipk = os.path.join(DIST, '%s_%s_all.ipk' % (APP_INFO['id'], APP_INFO['version']))
    if not os.path.exists(ipk):
        sys.exit('ares-package did not write ' + ipk)
    print(ipk)


if __name__ == '__main__':
    main()
