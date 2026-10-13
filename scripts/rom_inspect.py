#!/usr/bin/env python3
"""List the files in a MAME ROM zip (size + CRC32) and guess which game/board it is.

Usage: python rom_inspect.py path/to/game.zip

The guesses are starting points only - confirm CPU, memory map and sound hardware
against the MAME driver source named in the output before writing any emulation.
"""
import sys, zipfile, zlib, re

# filename regex -> (game, MAME driver source, hardware summary)
KNOWN = [
    (r'^gg1[_-]', 'Galaga (Namco 1981)', 'src/mame/namco/galaga.cpp',
     '3x Z80 @3.072MHz sharing RAM; Namco 06XX/51XX/54XX customs; Namco WSG 3-voice (pacman_sound_w layout); ROT90'),
    (r'^dd1', 'Dig Dug (Namco 1982)', 'src/mame/namco/galaga.cpp (digdug)',
     '3x Z80 like Galaga; 06XX/51XX/53XX; WSG; extra playfield ROMs; ROT90'),
    (r'^xvi', 'Xevious (Namco 1982)', 'src/mame/namco/xevious.cpp',
     '3x Z80; 06XX/50XX/51XX/54XX; WSG + samples; two tilemaps; ROT90'),
    (r'^bos', 'Bosconian (Namco 1981)', 'src/mame/namco/bosco.cpp',
     '3x Z80; 06XX/50XX/51XX/52XX(samples)/54XX; WSG; radar; ROT0'),
    (r'^(pacman|namcopac|puckman|pm1)', 'Pac-Man / Puck Man (Namco 1980)', 'src/mame/pacman/pacman.cpp',
     '1x Z80; IM2 vector written via OUT port 0; Namco WSG 3-voice; ROT90'),
    (r'^(boot\d|u5|u6|u7)', 'Ms. Pac-Man (bootleg/aux board?)', 'src/mame/pacman/pacman.cpp (mspacman)',
     '1x Z80 + auxiliary board decryption/patching; WSG; ROT90'),
    (r'^(galmidw|7f\.bin|galaxian)', 'Galaxian (Namco 1979)', 'src/mame/galaxian/galaxian.cpp',
     '1x Z80; discrete sound; starfield; ROT90'),
    (r'^(c_5et|c_5ct|c_5bt|c_5at|s_3i|s_3j|v_5h|v_3pt|l_4m)', 'Donkey Kong (Nintendo 1981)', 'src/mame/nintendo/dkong.cpp',
     'Z80 + i8035 sound MCU (+ discrete); ROT90'),
    (r'^frogger', 'Frogger (Konami 1981)', 'src/mame/galaxian/galaxian.cpp (frogger)',
     'Z80 main + Z80 sound + AY-3-8910; ROT90'),
    (r'^(136001|136002|035)', 'Atari vector/6502 era game', 'src/mame/atari/*',
     '6502 - needs a 6502 core, vector or bitmap video'),
]


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    with zipfile.ZipFile(path) as z:
        infos = sorted(z.infolist(), key=lambda i: i.filename.lower())
        print(f'{path}: {len(infos)} files')
        print(f'{"name":<24}{"size":>8}  crc32')
        names = []
        for i in infos:
            data = z.read(i)
            names.append(i.filename.lower().split('/')[-1])
            print(f'{i.filename:<24}{len(data):>8}  {zlib.crc32(data) & 0xffffffff:08x}')
    print()
    hits = []
    for pat, game, src, hw in KNOWN:
        n = sum(1 for nm in names if re.search(pat, nm))
        if n:
            hits.append((n, game, src, hw))
    if hits:
        hits.sort(reverse=True)
        for n, game, src, hw in hits:
            print(f'guess: {game}  ({n} matching files)')
            print(f'  MAME driver : {src}')
            print(f'  hardware    : {hw}')
    else:
        print('guess: unknown set - identify it from the MAME driver whose ROM_START lists these file names/CRCs')
    # size-based role hints
    print('\nrole hints (by size, verify in the driver ROM_START):')
    print('  32-byte PROMs are usually palettes; 256-byte PROMs are colour lookup tables or sound waveforms;')
    print('  4K/8K/16K files are program or graphics ROMs - the driver ROM_REGION tells which.')


if __name__ == '__main__':
    main()
