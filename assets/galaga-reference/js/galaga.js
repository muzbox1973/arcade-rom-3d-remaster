/* Galaga (Namco 1981) board emulation: 3x Z80 sharing RAM, Namco 06XX/51XX/54XX
   custom I/O (high-level), Namco WSG 3-voice sound, video RAM decoding.
   The original program ROMs run unmodified. Classic script: defines global `Galaga`. */
(function (global) {
  'use strict';

  const CPU_HZ = 3072000;
  const LINES = 264, LINE_CYC = 192;            // 384 px/line @ 6.144 MHz pixel clock
  const FRAME_HZ = CPU_HZ / (LINES * LINE_CYC); // ~60.606 Hz
  const WSG_HZ = 96000;                         // 18.432 MHz / 6 / 32

  // 51XX joystick remap table
  const JOY_MAP = [0xf, 0xe, 0xd, 0x5, 0xc, 0x9, 0x7, 0x6, 0xb, 0x3, 0xa, 0x4, 0x1, 0x2, 0x0, 0x8];

  class Namco51 {
    constructor(readIn) { this.readIn = readIn; this.reset(); }
    reset() {
      this.mode = 0; this.inCount = 0; this.coincred = 0; this.credits = 0;
      this.coinsPerCred = [1, 1]; this.credsPerCoin = [1, 1]; this.coins = [0, 0];
      this.lastCoins = 0; this.lastButtons = 0; this.remap = 0;
    }
    write(data) {
      data &= 7;
      if (this.coincred) {
        switch (this.coincred--) {
          case 4: this.coinsPerCred[0] = data; break;
          case 3: this.credsPerCoin[0] = data; break;
          case 2: this.coinsPerCred[1] = data; break;
          case 1: this.credsPerCoin[1] = data; break;
        }
        return;
      }
      switch (data) {
        case 1: this.coincred = 4; this.credits = 0; break;
        case 2: this.mode = 1; this.inCount = 0; break;
        case 3: this.remap = 0; break;
        case 4: this.remap = 1; break;
        case 5: this.mode = 0; this.inCount = 0; break;
      }
    }
    read() {
      const in0 = this.readIn(0), in1 = this.readIn(1); // active-low bytes
      if (this.mode === 0) {
        switch ((this.inCount++) % 3) {
          case 0: return in0;
          case 1: return in1;
          default: return 0;
        }
      }
      switch ((this.inCount++) % 3) {
        case 0: {
          const inp = ~in0 & 0xff, toggle = inp ^ this.lastCoins; this.lastCoins = inp;
          if (this.coinsPerCred[0] > 0) {
            if (this.credits < 99) {
              if (toggle & inp & 0x10) {
                if (++this.coins[0] >= this.coinsPerCred[0]) { this.credits += this.credsPerCoin[0]; this.coins[0] -= this.coinsPerCred[0]; }
              }
              if (toggle & inp & 0x20) {
                if (++this.coins[1] >= this.coinsPerCred[1]) { this.credits += this.credsPerCoin[1]; this.coins[1] -= this.coinsPerCred[1]; }
              }
              if (toggle & inp & 0x40) this.credits++;
            }
          } else this.credits = 100;
          if (this.mode === 1) {
            if (toggle & inp & 0x04) { if (this.credits >= 1) { this.credits--; this.mode = 2; } }
            else if (toggle & inp & 0x08) { if (this.credits >= 2) { this.credits -= 2; this.mode = 2; } }
          }
          if (!(in0 & 0x80)) return 0xbb; // test switch
          return ((this.credits / 10) | 0) * 16 + this.credits % 10;
        }
        case 1: {
          let joy = in1 & 0x0f;
          const inp = ~in0 & 0xff, toggle = inp ^ this.lastButtons;
          this.lastButtons = (this.lastButtons & 2) | (inp & 1);
          if (this.remap) joy = JOY_MAP[joy];
          joy |= ((toggle & inp & 0x01) ^ 1) << 4;
          joy |= ((inp & 0x01) ^ 1) << 5;
          return joy;
        }
        default: {
          let joy = (in1 >> 4) & 0x0f;
          const inp = ~in0 & 0xff, toggle = inp ^ this.lastButtons;
          this.lastButtons = (this.lastButtons & 1) | (inp & 2);
          if (this.remap) joy = JOY_MAP[joy];
          joy |= ((toggle & inp & 0x02) ^ 2) << 3;
          joy |= ((inp & 0x02) ^ 2) << 4;
          return joy;
        }
      }
    }
  }

  class Galaga {
    constructor(files) {
      const need = ['gg1_1b.3p', 'gg1_2b.3m', 'gg1_3.2m', 'gg1_4b.2l', 'gg1_5b.3f', 'gg1_7b.2c', 'gg1_9.4l',
        'gg1_11.4d', 'gg1_10.4f', 'prom-5.5n', 'prom-4.2n', 'prom-3.1c', 'prom-1.1d'];
      const miss = need.filter(n => !files[n]);
      if (miss.length) throw new Error('ROM 파일 누락: ' + miss.join(', '));
      const main = new Uint8Array(0x4000);
      ['gg1_1b.3p', 'gg1_2b.3m', 'gg1_3.2m', 'gg1_4b.2l'].forEach((n, i) => main.set(files[n].subarray(0, 0x1000), i * 0x1000));
      const sub = new Uint8Array(0x4000).fill(0xff); sub.set(files['gg1_5b.3f'].subarray(0, 0x1000));
      const snd = new Uint8Array(0x4000).fill(0xff); snd.set(files['gg1_7b.2c'].subarray(0, 0x1000));
      this.roms = [main, sub, snd];
      this.ram = new Uint8Array(0x10000);
      this.chars = files['gg1_9.4l'];
      this.sprROM = new Uint8Array(0x2000); this.sprROM.set(files['gg1_11.4d'], 0); this.sprROM.set(files['gg1_10.4f'], 0x1000);
      this.palette = Array.from(files['prom-5.5n'].subarray(0, 32), b => {
        const r = 0x21 * (b & 1) + 0x47 * ((b >> 1) & 1) + 0x97 * ((b >> 2) & 1);
        const g = 0x21 * ((b >> 3) & 1) + 0x47 * ((b >> 4) & 1) + 0x97 * ((b >> 5) & 1);
        const bl = 0x47 * ((b >> 6) & 1) + 0x97 * ((b >> 7) & 1);
        return (r << 16) | (g << 8) | bl;
      });
      this.charLUT = files['prom-4.2n']; this.sprLUT = files['prom-3.1c'];
      this.waves = [];
      for (let w = 0; w < 8; w++) this.waves.push(Array.from(files['prom-1.1d'].subarray(w * 32, w * 32 + 32), v => (v & 15) - 8));

      // DIP switches (MAME defaults): DSWA = difficulty/demo sound/cabinet, DSWB = coinage/bonus/lives
      this.dswA = 0xf7; this.dswB = 0x97;
      // inputs (active low)
      this.in0 = 0xff; this.in1 = 0xff;

      this.n51 = new Namco51(i => (i === 0 ? this.in0 : this.in1));
      this.on54 = null;          // callback(cmd) for 54XX explosion commands
      this.on54log = [];

      const mk = idx => new Z80(a => this.read(idx, a), (a, v) => this.write(idx, a, v));
      this.cpu = [mk(0), mk(1), mk(2)];
      this.debt = [0, 0, 0];
      this.starLatch = new Uint8Array(8);
      this.soundRegs = new Uint8Array(32);
      this.voices = [0, 1, 2].map(() => ({ freq: 0, vol: 0, wave: 0, counter: 0 }));
      this.audioOut = null; this.sampleRate = 48000; this.sampleAcc = 0;
      this.frame = 0;
      this.n54 = { args: 0, ch: 0, params: [[], []] };
      this.noise = [{ env: 0, keep: 0, cut: 0.22, y: 0 }, { env: 0, keep: 0, cut: 0.45, y: 0 }];
      this.lfsr = 1;
      this.hardReset();
    }

    hardReset() {
      this.ram.fill(0);
      this.cpu.forEach(c => c.reset());
      this.latch = new Uint8Array(8); // LS259 cleared at power-on
      this.applyLatch();
      this.n51.reset();
      this.ctrl06 = 0; this.nmi06Period = 0; this.nmi06Count = 0;
      this.frame = 0;
    }

    applyLatch() {
      this.irq1en = this.latch[0]; this.irq2en = this.latch[1];
      this.sndNmiEn = !this.latch[2];
      const run = !!this.latch[3];
      if (!run && this.subRunning !== false) { this.cpu[1].reset(); this.cpu[2].reset(); }
      this.subRunning = run;
      if (!this.irq1en) this.cpu[0].irq = false;
      if (!this.irq2en) this.cpu[1].irq = false;
    }

    // ---------------- memory map (shared by all three CPUs)
    read(cpu, a) {
      if (a < 0x4000) return this.roms[cpu][a];
      if (a >= 0x8000) {
        if (a < 0x8800 || (a >= 0x8800 && a < 0x8c00) || (a >= 0x9000 && a < 0x9400) || (a >= 0x9800 && a < 0x9c00)) return this.ram[a];
        return 0;
      }
      if (a >= 0x6800 && a < 0x6808) {
        const o = a & 7;
        return ((this.dswB >> o) & 1) | (((this.dswA >> o) & 1) << 1);
      }
      if (a === 0x7100) return this.ctrl06;
      if (a >= 0x7000 && a < 0x7100) return this.read06();
      return 0;
    }
    write(cpu, a, v) {
      if (a >= 0x8000) {
        if (a < 0x8800 || (a >= 0x8800 && a < 0x8c00) || (a >= 0x9000 && a < 0x9400) || (a >= 0x9800 && a < 0x9c00)) this.ram[a] = v;
        else if (a >= 0xa000 && a < 0xa008) this.starLatch[a & 7] = v & 1;
        return;
      }
      if (a >= 0x6800 && a < 0x6820) { this.wsgWrite(a & 0x1f, v); return; }
      if (a >= 0x6820 && a < 0x6828) { this.latch[a & 7] = v & 1; this.applyLatch(); return; }
      if (a === 0x7100) { this.write06ctrl(v); return; }
      if (a >= 0x7000 && a < 0x7100) { this.write06(v); return; }
    }

    // ---------------- Namco 06XX bus controller
    write06ctrl(v) {
      this.ctrl06 = v;
      if ((v & 0x0f) === 0) { this.nmi06Period = 0; return; }
      const div = 1 << ((v >> 5) & 7);
      this.nmi06Period = 64 * div;           // cycles between NMIs (48 kHz / div)
      this.nmi06Count = this.nmi06Period;
    }
    read06() {
      if (!(this.ctrl06 & 0x10)) return 0;
      let r = 0xff;
      if (this.ctrl06 & 1) r &= this.n51.read();
      return r;
    }
    write06(v) {
      if (this.ctrl06 & 0x10) return;
      if (this.ctrl06 & 1) this.n51.write(v);
      if (this.ctrl06 & 8) { this.on54log.push(v); if (this.on54log.length > 64) this.on54log.shift(); this.write54(v); if (this.on54) this.on54(v); }
    }

    // ---------------- Namco 54XX (explosion noise). Its MCU ROM is not part of the set,
    // so the command protocol is followed and the noise itself is approximated.
    write54(v) {
      if (this.n54.args > 0) { this.n54.params[this.n54.ch].push(v); this.n54.args--; return; }
      const hi = v >> 4;
      if (hi === 1 || hi === 2) { const n = this.noise[hi - 1]; n.env = 1; if (this.synth) this.synth.trigger54(hi); }
      else if (hi === 3 || hi === 4) { this.n54.ch = hi - 3; this.n54.params[this.n54.ch] = []; this.n54.args = 4; }
    }

    // ---------------- Namco WSG
    wsgWrite(off, data) {
      data &= 0x0f;
      if (this.soundRegs[off] === data) return;
      this.soundRegs[off] = data;
      let ch;
      if (off < 0x10) ch = ((off - 5) / 5) | 0;
      else if (off === 0x10) ch = 0;
      else ch = ((off - 0x11) / 5) | 0;
      if (ch < 0 || ch > 2) return;
      const v = this.voices[ch], R = this.soundRegs;
      switch (off - ch * 5) {
        case 0x05: v.wave = data & 7; break;
        case 0x10: case 0x11: case 0x12: case 0x13: case 0x14:
          v.freq = (ch === 0 ? R[0x10] : 0) + (R[ch * 5 + 0x11] << 4) + (R[ch * 5 + 0x12] << 8) + (R[ch * 5 + 0x13] << 12) + (R[ch * 5 + 0x14] << 16);
          break;
        case 0x15: v.vol = data; break;
      }
    }
    renderAudio(n) {
      if (this.synth) { this.synth.render(n, this.voices); return; }
      if (!this.audioOut) return;
      const step = WSG_HZ / this.sampleRate;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < 3; c++) {
          const v = this.voices[c];
          if (v.vol && v.freq) {
            v.counter = (v.counter + v.freq * step) % 1048576;
            s += this.waves[v.wave][(v.counter >> 15) & 31] * v.vol;
          }
        }
        for (let k = 0; k < 2; k++) {
          const nz = this.noise[k];
          if (nz.env < 0.002) continue;
          this.lfsr = (this.lfsr >>> 1) ^ (-(this.lfsr & 1) & 0xb400);
          nz.y += nz.cut * (((this.lfsr & 1) ? 1 : -1) - nz.y);
          s += nz.y * nz.env * 70;
          nz.env *= k ? 0.99988 : 0.99993;
        }
        this.audioOut(s / 360);
      }
    }

    // ---------------- run one video frame
    runFrame() {
      const [m, s, t] = this.cpu;
      const spl = this.sampleRate / (FRAME_HZ * LINES);
      for (let line = 0; line < LINES; line++) {
        if (line === 224) { // VBLANK
          if (this.irq1en) m.irq = true;
          if (this.irq2en) s.irq = true;
        }
        if ((line === 64 || line === 192) && this.sndNmiEn && this.subRunning) t.nmi();
        // main CPU, with 06XX NMIs
        let budget = LINE_CYC - this.debt[0];
        while (budget > 0) {
          let chunk = budget;
          if (this.nmi06Period) chunk = Math.min(chunk, this.nmi06Count);
          let done = 0; while (done < chunk) done += m.step();
          budget -= done;
          if (this.nmi06Period) {
            this.nmi06Count -= done;
            if (this.nmi06Count <= 0) { this.nmi06Count += this.nmi06Period; m.nmi(); }
          }
        }
        this.debt[0] = -budget;
        if (this.subRunning) {
          this.debt[1] = s.run(LINE_CYC - this.debt[1]);
          this.debt[2] = t.run(LINE_CYC - this.debt[2]);
        }
        this.sampleAcc += spl;
        const n = this.sampleAcc | 0; this.sampleAcc -= n;
        if (n) this.renderAudio(n);
      }
      this.frame++;
    }

    // ---------------- video decoding helpers
    decodeChar(code) { // 8x8 indices (0-3)
      const out = new Uint8Array(64), base = code * 128;
      const XO = [64, 65, 66, 67, 0, 1, 2, 3];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const bit = base + y * 8 + XO[x];
        const g = o => (this.chars[o >> 3] >> (7 - (o & 7))) & 1;
        out[y * 8 + x] = (g(bit) << 1) | g(bit + 4);
      }
      return out;
    }
    decodeSprite(code) { // 16x16 indices (0-3), native orientation
      const out = new Uint8Array(256), base = code * 512;
      const XO = [0, 1, 2, 3, 64, 65, 66, 67, 128, 129, 130, 131, 192, 193, 194, 195];
      const YO = [0, 8, 16, 24, 32, 40, 48, 56, 256, 264, 272, 280, 288, 296, 304, 312];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const bit = base + YO[y] + XO[x];
        const g = o => (this.sprROM[o >> 3] >> (7 - (o & 7))) & 1;
        out[y * 16 + x] = (g(bit) << 1) | g(bit + 4);
      }
      return out;
    }
    sprColor(color, v) { const p = this.sprLUT[color * 4 + v] & 0x0f; return p === 0x0f ? -1 : this.palette[p]; }
    charColor(color, v) { const p = this.charLUT[color * 4 + v] & 0x0f; return p === 0x0f ? -1 : this.palette[p + 0x10]; }

    // tilemap: 36 cols x 28 rows in native orientation
    tileAt(col, row) {
      let r = row + 2, c = col - 2, offs;
      if (c & 0x20) offs = r + ((c & 0x1f) << 5); else offs = c + (r << 5);
      return { code: this.ram[0x8000 + offs] & 0x7f, color: this.ram[0x8400 + offs] & 0x3f };
    }
    // sprite list in native coordinates (288 x 224)
    sprites() {
      const list = [], R1 = 0x8b80, R2 = 0x9380, R3 = 0x9b80, ram = this.ram;
      for (let o = 0; o < 0x80; o += 2) {
        const code = ram[R1 + o] & 0x7f, color = ram[R1 + o + 1] & 0x3f;
        const sx = ram[R2 + o + 1] - 40 + 0x100 * (ram[R3 + o + 1] & 3);
        let sy = 256 - ram[R2 + o] + 1;
        const flipx = ram[R3 + o] & 1, flipy = (ram[R3 + o] >> 1) & 1;
        const sizex = (ram[R3 + o] >> 2) & 1, sizey = (ram[R3 + o] >> 3) & 1;
        sy -= 16 * sizey; sy = (sy & 0xff) - 32;
        list.push({ idx: o >> 1, code, color, sx, sy, flipx, flipy, sizex, sizey });
      }
      return list;
    }
  }

  Galaga.FRAME_HZ = FRAME_HZ;
  global.Galaga = Galaga;
})(typeof window !== 'undefined' ? window : globalThis);
