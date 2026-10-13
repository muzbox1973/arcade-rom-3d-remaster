# Pitfalls seen in practice (and how each was detected)

| Symptom | Real cause | How it was found / fixed |
|---|---|---|
| Screen is garbage after 600 frames | Not a bug: the RAM self-test runs ~700 frames | PC histogram showed a memory-walk loop with watchdog writes; dumping the tilemap later showed "HIGH SCORE" |
| Coin/start ignored | Coin inserted during the self-test | Wait for boot (Galaga: frame ≥ 1300) in scripted tests |
| Browser screenshot shows an old frame | The pane was hidden; rAF paused | Check `document.visibilityState`; front the tab; verify via JS state (frame counter, text dump) |
| Rotated enemies look "about right" but are mirrored | Frame rotation direction assumed wrong | Numeric IoU test over every frame × flip (232/240 wrong before, 202/240 exact after) |
| Emulator ran ~16x too fast with sound on | `L.length` read after transferring `L.buffer` (detached → 0) | Counters showed pump always in audio branch with 12 frames/call while `sent` stayed 0 |
| Game ran at ~10 fps in the preview | rAF throttled to 5/s; emulation tied to rAF | Measured rAF/s; moved emulation to `setInterval` paced by the audio clock |
| `geometry undefined` render error on first frame | rAF timestamp earlier than `performance.now()` → negative dt → negative frame index | Clamp dt to `[0, 0.05]`; `Math.abs` frame index |
| Quick taps (and automated key presses) lost | Key down/up within one emulated frame; input chip samples once per frame | Hold every press for ≥3 emulated frames, release later in the pump |
| Giant glowing cone over the whole screen at start | Boot garbage tiles matched the beam tile codes | Require a compact dense cluster; fast-forward boot; hide tile plane while booting |
| White crosshatch grid glowing at start | The original post-test crosshatch pattern | Extend "booting" until the game enables the starfield |
| Shell edit refused ("Remove-Item on system path") | A JS snippet containing `rm` inside a PowerShell here-string tripped a safety parser | Do multi-line source edits with a small Python patch script or the Edit tool |
| A new remaster opens the **previous** game | `python -m http.server` enables address reuse; on Windows a second server binds the same port silently and the old one keeps answering (reproduced: two processes LISTENING on one port, browser got the old page) | Launch via `serve.py`: per-game default port, exclusive bind (`SO_EXCLUSIVEADDRUSE`, no reuse), next free port, no-cache headers; game name in title and console; `localStorage` keys prefixed with `GAME_ID` |
| Audio silent in a numeric test | Test started before boot finished, so no sound writes happened | Re-run with a proper boot wait; check `soundRegs` are non-zero |

General rule: when something looks wrong, measure board state (PCs, latches, frame counter,
tilemap text, sprite codes) before changing renderer code.
