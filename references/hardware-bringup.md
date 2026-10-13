# Hardware bring-up: from MAME driver to a booting board

The goal of this phase is a board that runs the **unmodified** program ROMs and reaches
the game's own attract screen, verified with a 2D reference renderer. Nothing 3D yet.

## Contents
1. What to read in the MAME driver
2. Building the board object
3. Scheduler and interrupts
4. Custom chips (I/O, sound helpers) - high-level emulation
5. The verification ladder
6. Galaga worked example (numbers that were confirmed)

---

## 1. What to read in the MAME driver

Find the driver with `scripts/rom_inspect.py` (it prints a guess), then fetch the source from
`https://github.com/mamedev/mame/tree/master/src/mame/<maker>/<driver>.cpp` (plus its
`_v.cpp` video file and any `machine/` helpers). Extract, in this order:

| Item | Where in the driver | Why it matters |
|---|---|---|
| ROM regions | `ROM_START(game)` / `ROM_LOAD` | which file goes to which CPU / gfx / PROM, at what offset |
| CPU list + clocks | `machine_config` (`Z80(config, ...)`) | number of cores, cycles per frame |
| Address maps | `void ..._map(address_map &map)` | RAM, video RAM, sprite RAM, I/O, latches - per CPU |
| Interrupts | `vblank_irq`, timers, `set_input_line` | which CPU gets IRQ/NMI, when, and how it is acknowledged |
| Latches | `LS259` / `ls259_device` callbacks | IRQ enables, sub-CPU reset lines, flip screen, star control |
| Screen | `set_raw(clock, htotal, hbend, hbstart, vtotal, vbend, vbstart)` + `ROT90/ROT270` | frame rate, visible area, monitor rotation |
| Inputs + DIPs | `INPUT_PORTS_START` | active-low bits, default DIP values |
| Graphics | `gfx_layout` structs + `GFXDECODE` | tile/sprite pixel layout (feed to `scripts/gfx_sheet.py`) |
| Palette | `palette_init` / `..._palette` | resistor weights, lookup PROMs, transparent pens |
| Video update | `screen_update_*`, `draw_sprites` | draw order, sprite RAM format, coordinate offsets, tilemap scan |
| Sound | sound device + its `_w` handler | register layout the program writes |

Copy the *logic* of these functions into JavaScript; do not paraphrase from memory. When a
detail is unclear, prefer what makes the program boot and the 2D view match MAME screenshots.

## 2. Building the board object

Keep the board a plain classic-script class (so `index.html` works from `file://` too):

```
class Board {
  constructor(files)        // ROM files from the zip; throw a clear error listing missing files
  read(cpu, addr)           // one shared memory map, ROM region chosen by cpu index
  write(cpu, addr, v)
  runFrame()                // emulate exactly one video frame, render audio for that frame
  sprites(), tileAt(c, r)   // video RAM decoded into plain objects for the renderers
  decodeSprite/decodeChar   // gfx_layout decoding (same as gfx_sheet.py)
  in0/in1 ...               // input ports as raw active-low bytes
}
```

`assets/galaga-reference/js/galaga.js` is a complete instance of this shape. Reuse
`js/z80.js` (verified by booting Galaga) and `js/rom.js` (ZIP reader) as-is for Z80 boards.
For other CPUs (6502, 6809, 68000, i8080...) write or adapt a core with the same
`step()/run(cycles)/irq/nmi()` interface; budget real effort for flags and DAA - score
counters almost always use BCD.

## 3. Scheduler and interrupts

- Cycles per frame = `cpu_clock / frame_rate`; frame rate = `pixel_clock / (htotal * vtotal)`.
- Interleave CPUs that share RAM in **slices of one scanline** (`cpu_clock / (frame_rate * vtotal)`
  cycles), carrying over the overshoot ("debt") so long-run timing stays exact.
- Model level-triggered IRQs as a flag that stays set until the acknowledging latch write
  clears it; NMIs as edge events. Honour the EI delay (no interrupt right after `EI`).
- Sub-CPUs held in reset by a latch: do not run them; call `reset()` on the 1→0 edge.
- Periodic NMIs from I/O chips (Namco 06XX) are counted in CPU cycles inside the slice.

## 4. Custom chips - high-level emulation

Many boards have custom MCUs whose internal ROMs are **not** in the game zip (Namco 50XX-54XX,
Nintendo i8035 sound programs are separate sets, etc.). Emulate their *protocol* at a high level:

- Find the command/response behaviour in the MAME device source or older MAME versions
  (pre-0.140 Namco `namcoio.c` had full HLE for 51XX/53XX).
- Inputs/coins chips: implement credit counting and the edge-detected fire bit exactly; the
  program usually depends on them.
- Sound-effect chips (Namco 54XX explosions, samples boards): log the command bytes during
  play, find which game event each command belongs to (e.g. correlate with sprite codes on
  screen at that frame), then synthesise an approximation. Tell the user it is approximated.

## 5. The verification ladder

Climb one rung at a time; each rung has evidence you can print or look at.

1. **ROM decode sheet** - `gfx_sheet.py` with the driver's layout and `--rotate`. Characters
   must read as `0-9 A-Z`; sprites must look like the game's objects upright.
2. **CPU runs** - PC histogram over ~20k steps. A tight loop that writes the watchdog and
   walks memory is the RAM test (normal for several hundred frames). A loop on a RAM flag
   usually means a missing interrupt or a sub-CPU still in reset.
3. **Text dump** - decode the tilemap into ASCII (`0-9` = 0x00-0x09, `A-Z` = 0x0A-0x23 on Namco
   boards; other makers differ). Seeing "HIGH SCORE" / "CREDIT 0" proves boot + video RAM layout
   without trusting any renderer.
4. **2D reference renderer** - a straight port of the driver's `screen_update`. Compare with a
   MAME screenshot of the attract mode; sprite icons must line up with their text rows.
5. **Inputs** - coin then start (wait until boot finished first), scripted move/fire for a few
   thousand frames, read the score from the tilemap. A rising score = real gameplay.

Run these checks by calling `runFrame()` in a loop from the browser console/JS tool -
hundreds of frames per second - instead of waiting in real time.

## 6. Galaga worked example (confirmed values)

- 3x Z80 @ 3.072 MHz; frame 264 lines x 192 cycles = 60.606 Hz; VBLANK IRQ at line 224.
- Shared map: ROM 0000-3FFF (per CPU), DIP 6800-6807 read (bit0 = DSWB>>n, bit1 = DSWA>>n),
  WSG 6800-681F write, latch 6820-6827 (0: main IRQ en, 1: sub IRQ en, 2: sound NMI *disable*,
  3: sub+sound CPUs run), 06XX data 7000 / ctrl 7100, video 8000-87FF, RAM 8800-8BFF,
  9000-93FF, 9800-9BFF (sprite RAM at +0x380 of each), stars A000-A007.
- Sound CPU NMI at lines 64 and 192 when enabled. 06XX NMI period = 64 * 2^((ctrl>>5)&7) cycles.
- DIP defaults DSWA 0xF7, DSWB 0x97 (3 lives, 1 coin 1 credit).
- Boot: RAM test ~700 frames (sub CPUs held), crosshatch until ~frame 863 (stars switch on),
  then attract. Coins inserted before that are ignored.
- Sprite RAM: code/colour at 8B80, y/x at 9380, flags at 9B80 (flipx, flipy, sizex, sizey);
  `sx = x - 40 + 256*(hi&3)`, `sy = ((256 - y + 1 - 16*sizey) & 0xff) - 32`.
- Tilemap 36x28 with the Namco scan (`row+=2; col-=2; col&0x20 ? row+((col&0x1f)<<5) : col+(row<<5)`).
- ROT90 display mapping: native (x, y) → display (223 - y, x).
