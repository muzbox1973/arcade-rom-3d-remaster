---
name: arcade-rom-3d-remaster
description: Turn a classic arcade ROM set (MAME .zip such as galaga.zip, pacman.zip, digdug.zip, xevious.zip) that the user provides into a browser 3D remaster - the original program ROMs run unmodified on an emulated board, only the picture is replaced by a Three.js voxel renderer, and the original sound-chip performance is re-rendered in high quality. Use this whenever the user hands over a MAME/arcade ROM file or zip and wants it renewed, remastered, rebuilt in 3D, "리뉴얼", "리마스터", "3D로 만들어", "롬파일로 게임 만들어", or wants an old arcade game to look modern while playing exactly like the original - even if they do not mention emulation, Three.js or MAME by name.
---

# Arcade ROM → 3D remaster

Build a web page where the **original arcade program runs instruction-for-instruction** on an
emulated board, while the screen is redrawn in 3D with Three.js and the sound chip's output is
re-rendered in high quality. Gameplay, enemy patterns, timing, scoring and music all come from
the ROM; the remaster only changes how the board's video and audio *outputs* are presented.

Why this shape: users who ask to "renew" a ROM want the game they remember. A hand-made
look-alike always plays differently (this was tried first and rejected); running the real code
guarantees the feel, and the 3D layer can be as ambitious as you like because it can't break
the game.

A complete working example (Galaga) lives in `assets/galaga-reference/` - read it before
writing code for a new game; most of it transfers.

## Ground rules

- **Only use ROMs the user supplied.** Never download ROM sets. Never embed ROM bytes or
  ROM-derived assets (sprite PNGs, palettes, sample WAVs) in the deliverable; decode at runtime
  from the user's zip (auto-fetch `rom/<set>.zip` over http, or drag-and-drop / file picker).
  Remind the user not to publish the ROM, and that the game's name/logo are trademarks.
- **Never patch the program ROMs** to make things work; fix the emulation instead.
- **Everything visual is triggered by board state** (video RAM, sprite RAM, latches, sound
  commands). Effects can be extra, but never invent gameplay events.
- **Measure, don't assume.** Each phase below ends in evidence. Rendering looks plausible long
  before it is right (see `references/pitfalls.md`).

## Workflow

Track phases as goals if a goal tool is available; report evidence at each checkpoint.

### 1. Intake and identification
- Put the zip in `<project>/rom/` (copy, don't move). Extract to a scratch folder only for analysis.
- Run `python scripts/rom_inspect.py rom/<set>.zip` → file list with CRC32 and a hardware guess.
- Read the MAME driver for that set (GitHub mamedev/mame). Use `references/hardware-bringup.md`
  §1 as the checklist of what to extract. If the CPU is not a Z80, plan for a new core with the
  same interface as `js/z80.js`.
- Tell the user briefly what the board is (CPUs, video, sound) and what will be approximated
  (custom chips whose ROMs aren't in the set).

### 2. Graphics decode check
`python scripts/gfx_sheet.py rom/<set>.zip --files <gfx roms> --layout <preset>|--layout-json <file> --rotate <90|270|0> [--palette .. --lut .. --color N] --out sheet.png`
Look at the PNG: characters must read as text, sprites must stand upright in display
orientation. Note sprite code numbers for each object and for rotation-frame groups.

### 3. Board bring-up (2D first)
Follow `references/hardware-bringup.md`: board class, scheduler, interrupts, latches, DIP
defaults, custom-chip HLE, and a 2D reference renderer ported from the driver's
`screen_update`. Gate: the attract screen appears (prove it with a tilemap text dump, then a
2D screenshot), and a scripted coin → start → move/fire run raises the score.

### 4. Audio
Follow `references/audio-remaster.md`: exact register emulation, remaster synth with an
original-mode toggle, AudioWorklet pipeline, emulation paced by the audio clock from a timer
(not rAF). Gate: numeric audio report (voices active, RMS/peak, NaN = 0, HF ratio lower in
remaster, stereo spread) and a stable `ahead` buffer during live play.

### 5. Three.js renderer
Follow `references/renderer-3d.md`: display-space mapping, voxel sprite models with caching,
rotation-frame groups replaced by one model + heading (**prove the heading mapping with the
IoU test**), tilemap on a text plane + 2D HUD rows, effects keyed to board state, boot
fast-forward, tilt presets with auto-fit, `V` toggle to the 2D view.
Gate: screenshots of attract, gameplay, an explosion and any special effect (tractor beam
etc.), each compared with the 2D view of the same paused frame.

### 6. Integrate, polish, verify live
- Controls (keep this mapping so all remasters feel the same):

| Key | Action |
|---|---|
| 5 / C | coin |
| 1 / Enter, 2 | 1P / 2P start |
| ← → (↑ ↓) / A D | move |
| Space / Z | fire / button 1 |
| P | pause · M mute · O sound original/remaster |
| V | original 2D ↔ 3D · T tilt preset (Shift+T back) |

  Hold every press for ≥3 emulated frames. Add touch buttons for coarse pointers.
- Overlay: ROM prompt (button + drag-and-drop) when no ROM; toast after load explaining coin,
  start and "first key enables sound".
- Serving: copy `assets/galaga-reference/serve.py` + `start.bat` + `start.sh` and set `GAME_ID`
  (MAME set name) and `TITLE` in `serve.py`. Do **not** use `python -m http.server`: on Windows it
  lets a second server silently share a port, so the browser keeps showing the *previous*
  remaster. `serve.py` derives a per-game default port, binds exclusively, moves to the next
  free port, disables caching and opens the URL it actually got. Point `.claude/launch.json`
  at `serve.py --port <that game's default> --no-browser`.
- Identity: put the game name in `<title>`, the overlay and the `serve.py` console line, and
  prefix every `localStorage` key with `GAME_ID` (`STORE('tilt')`), so two remasters never
  share settings and the user can see at a glance which game is open.
- Live check with real key events in the browser: coin → credit 1 → start → shots fired;
  emulated fps ≈ arcade frame rate vs wall clock and audio clock; no console errors; `file://`
  open shows the ROM prompt; with another remaster's server already running, `start.bat`
  still opens *this* game (check the URL port and the page title).

### 7. Report to the user (in their language)
Lead with how to run it. Then: what is original (all game logic and timing, which sound parts),
what is 3D, what is approximated and why, what was verified with which evidence, and what was
**not** verified (e.g. stages you couldn't reach in automated play, sound not listened to).

## Project layout to produce

```
<project>/
  index.html            Three.js renderer, input, audio graph, overlay, tilt bar
  js/z80.js             CPU core (copy from assets for Z80 boards)
  js/rom.js             ZIP reader (copy as-is)
  js/<board>.js         board emulation for this game (adapt from galaga.js)
  js/<chip>-remaster.js sound synth (adapt from wsg-remaster.js)
  rom/<set>.zip         user's ROM (not distributed)
  serve.py              per-game launcher (exclusive port, no-cache, opens browser)
  start.bat, start.sh   double-click launchers that run serve.py
  .claude/launch.json   preview config pointing at serve.py
```
Keep JS as classic scripts (globals) and only Three.js as an ES module via importmap
(`three@0.160.0` from jsdelivr), so the page also opens from `file://` with a dropped ROM.

## Reference files
- `references/hardware-bringup.md` - driver checklist, scheduler, custom-chip HLE, verification ladder, Galaga numbers
- `references/renderer-3d.md` - sprite→voxel, heading mapping + IoU check, tilemap plane, effects, boot fast-forward, camera auto-fit
- `references/audio-remaster.md` - register emulation, remaster techniques per chip type, worklet pipeline, audio-clock pacing, numeric audio checks
- `references/pitfalls.md` - every bug hit while building the reference, with how it was detected
- `assets/galaga-reference/` - the full working Galaga remaster (index.html + js/)
- `scripts/rom_inspect.py`, `scripts/gfx_sheet.py` - identification and graphics decode sheets (no dependencies)
