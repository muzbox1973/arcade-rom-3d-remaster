/* High-quality renderer for the Namco WSG register stream.
   The ROM's sound program still decides every note, volume and waveform; this class
   only replaces how those register values become audio:
   - 'remaster': band-limited (alias-free) versions of the PROM waveforms, de-clicked
     volume changes, gentle ensemble doubling + stereo placement, layered 54XX explosions
   - 'original': the stepped 32-sample hardware waveform, mono, like the cabinet
   Classic script: defines global `WSGSynth`.
   WSG register layout and frequency scaling follow MAME's src/devices/sound/namco.cpp
   (BSD-3-Clause, Nicola Salmoria, Aaron Giles); the remaster synthesis is original.
   See THIRD_PARTY_NOTICES.md. */
(function (global) {
  'use strict';
  const TBL = 2048, WSG_HZ = 96000;

  class WSGSynth {
    constructor(waves, sampleRate) {
      this.sr = sampleRate; this.mode = 'remaster';
      this.waves = waves;                        // 8 x 32 signed samples (-8..7)
      // band-limited tables: [wave][maxHarmonic 1..16] -> Float32Array(TBL)
      this.bl = waves.map(w => {
        const N = 32, mean = w.reduce((a, b) => a + b, 0) / N, A = [], B = [];
        for (let k = 1; k <= 16; k++) {
          let a = 0, b = 0;
          for (let n = 0; n < N; n++) { const ph = 2 * Math.PI * k * n / N; a += (w[n] - mean) * Math.cos(ph); b += (w[n] - mean) * Math.sin(ph); }
          const s = k === 16 ? 1 / N : 2 / N; A.push(a * s); B.push(b * s);
        }
        const levels = [null];
        for (let L = 1; L <= 16; L++) {
          const t = new Float32Array(TBL + 1);
          for (let i = 0; i <= TBL; i++) {
            // sample at the centre of each hardware step to keep the waveform's phase
            const x = (i / TBL) * 32 - 0.5;
            let v = 0; for (let k = 1; k <= L; k++) { const ph = 2 * Math.PI * k * x / 32; v += A[k - 1] * Math.cos(ph) + B[k - 1] * Math.sin(ph); }
            t[i] = v;
          }
          levels.push(t);
        }
        return levels;
      });
      this.v = [0, 1, 2].map(i => ({ ph: 0, ph2: 0, vol: 0, pan: [0, -0.32, 0.32][i] }));
      this.volK = 1 - Math.exp(-1 / (0.0015 * sampleRate)); // ~1.5 ms de-click
      this.lp = [0, 0];
      // 54XX explosion layers
      this.ex = { body: 0, crack: 0, thump: 0, thPh: 0, thF: 0, bpLow: 0, bpBand: 0, crLP: 0, seed: 0x1234 };
      this.L = []; this.R = [];
    }
    noise() { let s = this.ex.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.ex.seed = s >>> 0; return (s >>> 0) / 2147483648 - 1; }
    trigger54(kind) {
      const e = this.ex;
      if (kind === 1) { e.body = 1; e.thump = 1; e.thF = 110; e.thPh = 0; }
      else e.crack = 1;
    }
    sample(table, ph) { const x = ph * TBL, i = x | 0, f = x - i; return table[i] + (table[i + 1] - table[i]) * f; }

    // voices: [{freq (20-bit reg), vol 0..15, wave 0..7, counter}] from the emulated board
    render(n, voices) {
      const sr = this.sr, L = this.L, R = this.R, remaster = this.mode === 'remaster', ex = this.ex;
      for (let s = 0; s < n; s++) {
        let l = 0, r = 0;
        for (let c = 0; c < 3; c++) {
          const hw = voices[c], st = this.v[c];
          const target = hw.freq ? hw.vol : 0;
          st.vol += (target - st.vol) * (remaster ? this.volK : 1);
          if (st.vol < 0.001 && !target) continue;
          const hz = hw.freq * WSG_HZ / 1048576;
          if (remaster) {
            const harm = Math.max(1, Math.min(16, Math.floor(sr * 0.45 / Math.max(hz, 1))));
            const tbl = this.bl[hw.wave][harm];
            st.ph += hz / sr; st.ph -= Math.floor(st.ph);
            st.ph2 += hz * 1.0026 / sr; st.ph2 -= Math.floor(st.ph2);     // +4.5 cent ensemble voice
            const a = this.sample(tbl, st.ph) * st.vol, b = this.sample(tbl, st.ph2) * st.vol * 0.32;
            const pl = 0.5 - st.pan * 0.5, pr = 0.5 + st.pan * 0.5;
            l += a * pl * 1.6 + b * pr; r += a * pr * 1.6 + b * pl;
          } else {
            st.ph += hz / sr; st.ph -= Math.floor(st.ph);
            const v = this.waves[hw.wave][(st.ph * 32) | 0] * st.vol;
            l += v; r += v;
          }
        }
        // 54XX explosion (approximation; its MCU ROM is not in the set)
        if (ex.body > 0.0005 || ex.crack > 0.0005 || ex.thump > 0.0005) {
          const w = this.noise();
          if (remaster) {
            // body: noise through a state-variable band-pass sweeping down with the decay
            const fc = 250 + 2600 * ex.body * ex.body, F = 2 * Math.sin(Math.PI * fc / sr);
            ex.bpLow += F * ex.bpBand; const hi = w - ex.bpLow - 0.9 * ex.bpBand; ex.bpBand += F * hi;
            const body = ex.bpBand * ex.body * 90;
            ex.crLP += 0.55 * (w - ex.crLP);
            const crack = ex.crLP * ex.crack * ex.crack * 70 * (Math.random() < 0.35 ? 1 : 0.25);
            ex.thF *= 0.99993; ex.thPh += ex.thF / sr;
            const thump = Math.sin(2 * Math.PI * ex.thPh) * ex.thump * 110;
            l += body * 1.05 + crack * 0.8 + thump; r += body * 0.95 + crack * 1.2 + thump;
          } else {
            ex.crLP += 0.25 * (w - ex.crLP);
            const v = ex.crLP * (ex.body + ex.crack) * 70; l += v; r += v;
          }
          ex.body *= 0.99993; ex.crack *= 0.99975; ex.thump *= 0.99982;
        }
        l /= 360; r /= 360;
        if (remaster) { l = Math.tanh(l * 1.15) * 0.92; r = Math.tanh(r * 1.15) * 0.92; } // gentle analog-style saturation
        L.push(l); R.push(r);
      }
    }
    take() { const out = [Float32Array.from(this.L), Float32Array.from(this.R)]; this.L.length = 0; this.R.length = 0; return out; }
    clear() { this.L.length = 0; this.R.length = 0; }
  }
  global.WSGSynth = WSGSynth;
})(typeof window !== 'undefined' ? window : globalThis);
