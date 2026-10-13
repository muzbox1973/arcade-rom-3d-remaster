# Sound: the original performance, rendered in high quality

The program ROM (often a dedicated sound CPU) still decides every note, volume, waveform and
timing by writing sound-chip registers. The remaster only changes how register values become
samples. Always keep an **original** mode (`O` key) that reproduces the chip as-is, so the
user can A/B.

## Contents
1. Emulate the register interface exactly
2. Remaster techniques by chip type
3. Pipeline: board → synth → AudioWorklet → effects
4. Pacing emulation by the audio clock
5. Verifying audio without ears

---

## 1. Emulate the register interface exactly

Port the chip's write handler from MAME (Namco WSG: `pacman_sound_w` - 3 voices, 20-bit
frequency for voice 0 / 16-bit others, 4-bit volume, 3-bit waveform; output rate 96 kHz;
`hz = freq * 96000 / 2^20`; waveform = 32 4-bit samples from the sound PROM). The board
records the current voice state; the synth reads it once per scanline-sized chunk of samples
(sample-accurate enough and cheap).

## 2. Remaster techniques by chip type

**Wavetable chips (Namco WSG, Konami SCC)**
- Band-limited tables: DFT the 32-sample PROM waveform, keep harmonics up to
  `0.45 * sampleRate / f`, precompute 16 mip levels of 2048-sample tables, linear-interpolate.
  This keeps the exact timbre while removing aliasing/step buzz.
- De-click: one-pole smoothing (~1.5 ms) on volume changes.
- Ensemble: a second read of the same table at +4.5 cents, ~0.3 gain, panned opposite.
- Stereo: spread the voices (e.g. centre, -0.32, +0.32).
- Gentle `tanh` saturation on the mix for analog warmth.

**PSG / square-wave chips (AY-3-8910, SN76489)**: PolyBLEP band-limited squares, smoothed
envelopes, noise through a light low-pass; same stereo/room treatment.

**Discrete / sample hardware**: if MAME uses samples or discrete circuits, synthesise layered
approximations (filtered noise sweeps, pitch-dropping thumps) triggered by the same writes, and
say so to the user.

**Mix bus (Web Audio)**: low-shelf +4 dB @160 Hz → high-shelf +1.5 dB @7 kHz →
compressor (-16 dB, 3:1, 4 ms / 180 ms) → master, plus a convolver send (~0.2 wet) with a
generated stereo room impulse (~1.5 s). Original mode sets shelves and wet to 0.

## 3. Pipeline

`board.runFrame()` → synth renders stereo into arrays → after each frame
`node.port.postMessage([L, R], [L.buffer, R.buffer])` → an inline `AudioWorkletProcessor`
(created from a Blob URL) plays a queue of chunks, outputting silence on underrun.

**Gotcha (cost hours once):** after transferring `L.buffer` the array is detached and
`L.length` is 0. Read the length *before* `postMessage`, or your "samples sent" counter never
grows and the pacing loop below runs the emulator flat out.

AudioContext needs a user gesture: create it on the first keydown/pointerdown and say so in the
boot toast.

## 4. Pacing emulation by the audio clock

Run the emulator from `setInterval(pump, 5)`, not from `requestAnimationFrame` - browsers
throttle rAF (hidden panes, battery saver, 30 Hz displays) and the game would slow down.
- With audio: `ahead = sent/sampleRate - (ctx.currentTime - t0)`; run frames while
  `ahead < 0.09` (max ~12 per call); if `ahead < -0.03`, flush the worklet queue and reset
  `t0`/`sent` (recover from stalls).
- Without audio: accumulate wall-clock time and run `1/frame_rate` steps (cap per call).
- rAF only renders the current board state.
Expected result: emulated fps ≈ the arcade's frame rate measured against both
`performance.now()` and `ctx.currentTime`, and `ahead` steady around 0.09-0.10 s.

## 5. Verifying audio without ears

You cannot listen, so measure. Run a second board offline (boot ~1300 frames first, then
coin + start so the start jingle and gameplay sounds play), attach a synth per mode and compute:
- voices active per frame (all channels should be used during the jingle),
- RMS and peak (non-silent, peak < 1), NaN count (0),
- high-frequency ratio `Σ(Δs)² / Σs²` - the remaster should be clearly lower than original
  (Galaga: 0.073 → 0.030),
- stereo difference `mean |L-R|` > 0 in remaster, 0 in original.
Report these numbers and state plainly that the result was not listened to.
