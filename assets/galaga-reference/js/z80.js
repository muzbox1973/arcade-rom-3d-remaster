/* Z80 CPU core (documented + common undocumented behaviour).
   Classic script: defines global `Z80`. */
(function (global) {
  'use strict';
  const SZ = new Uint8Array(256), SZP = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let p = i; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1;
    SZ[i] = (i ? i & 0x80 : 0x40) | (i & 0x28);
    SZP[i] = SZ[i] | ((p & 1) ? 0 : 0x04);
  }
  const sx = v => (v & 0x80 ? v - 256 : v);

  class Z80 {
    constructor(read, write, inp, out) {
      this.rd = read; this.wr = write;
      this.inp = inp || (() => 0xff); this.out = out || (() => {});
      this.reset();
    }
    reset() {
      this.a = 0xff; this.f = 0xff; this.b = this.c = this.d = this.e = this.h = this.l = 0;
      this.a_ = this.f_ = this.b_ = this.c_ = this.d_ = this.e_ = this.h_ = this.l_ = 0;
      this.ix = this.iy = 0xffff; this.sp = 0xffff; this.pc = 0; this.i = 0; this.r = 0;
      this.iff1 = this.iff2 = 0; this.im = 0; this.halted = false; this.eiDelay = false;
      this.irq = false; this.nmiPending = false;
    }
    // ---- helpers
    fetch() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
    fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
    rd16(a) { return this.rd(a) | (this.rd((a + 1) & 0xffff) << 8); }
    wr16(a, v) { this.wr(a, v & 0xff); this.wr((a + 1) & 0xffff, v >> 8); }
    push(v) { this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v & 0xff); }
    pop() { const v = this.rd16(this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }
    incR() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); }
    get bc() { return (this.b << 8) | this.c; } set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
    get de() { return (this.d << 8) | this.e; } set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
    get hl() { return (this.h << 8) | this.l; } set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
    get af() { return (this.a << 8) | this.f; } set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xff; }
    getHL(px) { return px === 0 ? this.hl : px === 1 ? this.ix : this.iy; }
    setHL(px, v) { v &= 0xffff; if (px === 0) this.hl = v; else if (px === 1) this.ix = v; else this.iy = v; }
    getRP(p, px) { switch (p) { case 0: return this.bc; case 1: return this.de; case 2: return this.getHL(px); default: return this.sp; } }
    setRP(p, v, px) { v &= 0xffff; switch (p) { case 0: this.bc = v; break; case 1: this.de = v; break; case 2: this.setHL(px, v); break; default: this.sp = v; } }
    getRP2(p, px) { return p === 3 ? this.af : this.getRP(p, px); }
    setRP2(p, v, px) { if (p === 3) this.af = v & 0xffff; else this.setRP(p, v, px); }
    // 8-bit register by index; px selects IXH/IXL for 4/5, addr used for 6
    getR(i, px, addr) {
      switch (i) {
        case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
        case 4: return px === 0 ? this.h : px === 1 ? this.ix >> 8 : this.iy >> 8;
        case 5: return px === 0 ? this.l : px === 1 ? this.ix & 0xff : this.iy & 0xff;
        case 6: return this.rd(addr);
        default: return this.a;
      }
    }
    setR(i, v, px, addr) {
      v &= 0xff;
      switch (i) {
        case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
        case 4: if (px === 0) this.h = v; else if (px === 1) this.ix = (this.ix & 0xff) | (v << 8); else this.iy = (this.iy & 0xff) | (v << 8); break;
        case 5: if (px === 0) this.l = v; else if (px === 1) this.ix = (this.ix & 0xff00) | v; else this.iy = (this.iy & 0xff00) | v; break;
        case 6: this.wr(addr, v); break;
        default: this.a = v;
      }
    }
    ea(px) { return px === 0 ? this.hl : ((px === 1 ? this.ix : this.iy) + sx(this.fetch())) & 0xffff; }
    cond(y) {
      const f = this.f;
      switch (y) {
        case 0: return !(f & 0x40); case 1: return !!(f & 0x40);
        case 2: return !(f & 0x01); case 3: return !!(f & 0x01);
        case 4: return !(f & 0x04); case 5: return !!(f & 0x04);
        case 6: return !(f & 0x80); default: return !!(f & 0x80);
      }
    }
    // ---- ALU
    add8(v, cy) { const a = this.a, r = a + v + cy; this.f = SZ[r & 0xff] | ((r >> 8) & 1) | ((a ^ v ^ r) & 0x10) | (((a ^ ~v) & (a ^ r) & 0x80) >> 5); this.a = r & 0xff; }
    sub8(v, cy) { const a = this.a, r = a - v - cy; this.f = SZ[r & 0xff] | ((r >> 8) & 1) | 0x02 | ((a ^ v ^ r) & 0x10) | (((a ^ v) & (a ^ r) & 0x80) >> 5); this.a = r & 0xff; }
    cp8(v) { const a = this.a; this.sub8(v, 0); this.a = a; this.f = (this.f & ~0x28) | (v & 0x28); }
    alu(y, v) {
      switch (y) {
        case 0: this.add8(v, 0); break;
        case 1: this.add8(v, this.f & 1); break;
        case 2: this.sub8(v, 0); break;
        case 3: this.sub8(v, this.f & 1); break;
        case 4: this.a &= v; this.f = SZP[this.a] | 0x10; break;
        case 5: this.a ^= v; this.f = SZP[this.a]; break;
        case 6: this.a |= v; this.f = SZP[this.a]; break;
        default: this.cp8(v);
      }
    }
    inc8(v) { const r = (v + 1) & 0xff; this.f = (this.f & 1) | SZ[r] | (r === 0x80 ? 4 : 0) | ((r & 0x0f) === 0 ? 0x10 : 0); return r; }
    dec8(v) { const r = (v - 1) & 0xff; this.f = (this.f & 1) | SZ[r] | 0x02 | (r === 0x7f ? 4 : 0) | ((r & 0x0f) === 0x0f ? 0x10 : 0); return r; }
    add16(a, v) { const r = a + v; this.f = (this.f & 0xc4) | ((r >> 16) & 1) | (((a ^ v ^ r) >> 8) & 0x10) | ((r >> 8) & 0x28); return r & 0xffff; }
    adc16(v) {
      const a = this.hl, r = a + v + (this.f & 1);
      this.f = ((r >> 16) & 1) | (((a ^ v ^ r) >> 8) & 0x10) | ((~(a ^ v) & (a ^ r) & 0x8000) ? 4 : 0) | ((r >> 8) & 0xa8) | ((r & 0xffff) ? 0 : 0x40);
      this.hl = r & 0xffff;
    }
    sbc16(v) {
      const a = this.hl, r = a - v - (this.f & 1);
      this.f = 0x02 | ((r >> 16) & 1) | (((a ^ v ^ r) >> 8) & 0x10) | (((a ^ v) & (a ^ r) & 0x8000) ? 4 : 0) | ((r >> 8) & 0xa8) | ((r & 0xffff) ? 0 : 0x40);
      this.hl = r & 0xffff;
    }
    rot(y, v) {
      let r, c;
      switch (y) {
        case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;            // RLC
        case 1: c = v & 1; r = (v >> 1) | (c << 7); break;               // RRC
        case 2: c = v >> 7; r = ((v << 1) | (this.f & 1)) & 0xff; break; // RL
        case 3: c = v & 1; r = (v >> 1) | ((this.f & 1) << 7); break;    // RR
        case 4: c = v >> 7; r = (v << 1) & 0xff; break;                  // SLA
        case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;             // SRA
        case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;            // SLL
        default: c = v & 1; r = v >> 1;                                  // SRL
      }
      this.f = SZP[r] | c; return r;
    }
    daa() {
      const a = this.a, n = this.f & 2; let c = this.f & 1, diff = 0;
      if ((this.f & 0x10) || (a & 0x0f) > 9) diff = 6;
      if (c || a > 0x99) { diff |= 0x60; c = 1; }
      const h = n ? ((this.f & 0x10) && (a & 0x0f) < 6 ? 0x10 : 0) : ((a & 0x0f) > 9 ? 0x10 : 0);
      this.a = (n ? a - diff : a + diff) & 0xff;
      this.f = SZP[this.a] | c | n | h;
    }
    // ---- interrupts
    nmi() { this.nmiPending = true; }
    takeInterrupts() {
      if (this.nmiPending) {
        this.nmiPending = false; this.halted = false;
        this.iff1 = 0; this.incR(); this.push(this.pc); this.pc = 0x66; return 11;
      }
      if (this.irq && this.iff1 && !this.eiDelay) {
        this.halted = false; this.iff1 = this.iff2 = 0; this.incR();
        this.push(this.pc);
        if (this.im === 2) { this.pc = this.rd16((this.i << 8) | 0xff); return 19; }
        this.pc = 0x38; return 13;
      }
      return 0;
    }
    // ---- execution
    step() {
      const ic = this.takeInterrupts(); if (ic) return ic;
      this.eiDelay = false;
      if (this.halted) { this.incR(); return 4; }
      this.incR();
      return this.exec(this.fetch());
    }
    run(cycles) { let n = 0; while (n < cycles) n += this.step(); return n - cycles; }

    exec(op) {
      let px = 0, cyc = 0;
      while (op === 0xdd || op === 0xfd) { px = op === 0xdd ? 1 : 2; op = this.fetch(); this.incR(); cyc += 4; }
      if (op === 0xcb) return cyc + this.execCB(px);
      if (op === 0xed) { this.incR(); return cyc + this.execED(this.fetch()); }
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
      if (x === 1) {
        if (op === 0x76) { this.halted = true; return cyc + 4; }
        if (y === 6) { const a = this.ea(px); this.wr(a, this.getR(z, 0)); return cyc + (px ? 15 : 7); }
        if (z === 6) { const a = this.ea(px); this.setR(y, this.rd(a), 0); return cyc + (px ? 15 : 7); }
        this.setR(y, this.getR(z, px), px); return cyc + 4;
      }
      if (x === 2) {
        if (z === 6) { const a = this.ea(px); this.alu(y, this.rd(a)); return cyc + (px ? 15 : 7); }
        this.alu(y, this.getR(z, px)); return cyc + 4;
      }
      if (x === 0) {
        switch (z) {
          case 0:
            switch (y) {
              case 0: return cyc + 4;
              case 1: { let t = this.a; this.a = this.a_; this.a_ = t; t = this.f; this.f = this.f_; this.f_ = t; return cyc + 4; }
              case 2: { const d = sx(this.fetch()); this.b = (this.b - 1) & 0xff; if (this.b) { this.pc = (this.pc + d) & 0xffff; return cyc + 13; } return cyc + 8; }
              case 3: { const d = sx(this.fetch()); this.pc = (this.pc + d) & 0xffff; return cyc + 12; }
              default: { const d = sx(this.fetch()); if (this.cond(y - 4)) { this.pc = (this.pc + d) & 0xffff; return cyc + 12; } return cyc + 7; }
            }
          case 1:
            if (!q) { this.setRP(p, this.fetch16(), px); return cyc + 10; }
            this.setHL(px, this.add16(this.getHL(px), this.getRP(p, px))); return cyc + 11;
          case 2:
            switch (y) {
              case 0: this.wr(this.bc, this.a); return cyc + 7;
              case 1: this.a = this.rd(this.bc); return cyc + 7;
              case 2: this.wr(this.de, this.a); return cyc + 7;
              case 3: this.a = this.rd(this.de); return cyc + 7;
              case 4: this.wr16(this.fetch16(), this.getHL(px)); return cyc + 16;
              case 5: this.setHL(px, this.rd16(this.fetch16())); return cyc + 16;
              case 6: this.wr(this.fetch16(), this.a); return cyc + 13;
              default: this.a = this.rd(this.fetch16()); return cyc + 13;
            }
          case 3: this.setRP(p, this.getRP(p, px) + (q ? -1 : 1), px); return cyc + 6;
          case 4: {
            if (y === 6) { const a = this.ea(px); this.wr(a, this.inc8(this.rd(a))); return cyc + (px ? 19 : 11); }
            this.setR(y, this.inc8(this.getR(y, px)), px); return cyc + 4;
          }
          case 5: {
            if (y === 6) { const a = this.ea(px); this.wr(a, this.dec8(this.rd(a))); return cyc + (px ? 19 : 11); }
            this.setR(y, this.dec8(this.getR(y, px)), px); return cyc + 4;
          }
          case 6: {
            if (y === 6) { const a = this.ea(px); this.wr(a, this.fetch()); return cyc + (px ? 15 : 10); }
            this.setR(y, this.fetch(), px); return cyc + 7;
          }
          default: {
            const a = this.a, f = this.f;
            switch (y) {
              case 0: { const c = a >> 7; this.a = ((a << 1) | c) & 0xff; this.f = (f & 0xc4) | c | (this.a & 0x28); break; }
              case 1: { const c = a & 1; this.a = (a >> 1) | (c << 7); this.f = (f & 0xc4) | c | (this.a & 0x28); break; }
              case 2: { const c = a >> 7; this.a = ((a << 1) | (f & 1)) & 0xff; this.f = (f & 0xc4) | c | (this.a & 0x28); break; }
              case 3: { const c = a & 1; this.a = (a >> 1) | ((f & 1) << 7); this.f = (f & 0xc4) | c | (this.a & 0x28); break; }
              case 4: this.daa(); break;
              case 5: this.a = a ^ 0xff; this.f = (f & 0xc5) | 0x12 | (this.a & 0x28); break;
              case 6: this.f = (f & 0xc4) | 1 | (a & 0x28); break;
              default: this.f = ((f & 0xc5) | ((f & 1) << 4) | (a & 0x28)) ^ 1;
            }
            return cyc + 4;
          }
        }
      }
      // x === 3
      switch (z) {
        case 0: if (this.cond(y)) { this.pc = this.pop(); return cyc + 11; } return cyc + 5;
        case 1:
          if (!q) { this.setRP2(p, this.pop(), px); return cyc + 10; }
          switch (p) {
            case 0: this.pc = this.pop(); return cyc + 10;
            case 1: {
              let t;
              t = this.b; this.b = this.b_; this.b_ = t; t = this.c; this.c = this.c_; this.c_ = t;
              t = this.d; this.d = this.d_; this.d_ = t; t = this.e; this.e = this.e_; this.e_ = t;
              t = this.h; this.h = this.h_; this.h_ = t; t = this.l; this.l = this.l_; this.l_ = t;
              return cyc + 4;
            }
            case 2: this.pc = this.getHL(px); return cyc + 4;
            default: this.sp = this.getHL(px); return cyc + 6;
          }
        case 2: { const nn = this.fetch16(); if (this.cond(y)) this.pc = nn; return cyc + 10; }
        case 3:
          switch (y) {
            case 0: this.pc = this.fetch16(); return cyc + 10;
            case 2: this.out((this.a << 8) | this.fetch(), this.a); return cyc + 11;
            case 3: this.a = this.inp((this.a << 8) | this.fetch()) & 0xff; return cyc + 11;
            case 4: { const v = this.rd16(this.sp); this.wr16(this.sp, this.getHL(px)); this.setHL(px, v); return cyc + 19; }
            case 5: { const t = this.de; this.de = this.hl; this.hl = t; return cyc + 4; }
            case 6: this.iff1 = this.iff2 = 0; return cyc + 4;
            default: this.iff1 = this.iff2 = 1; this.eiDelay = true; return cyc + 4;
          }
        case 4: { const nn = this.fetch16(); if (this.cond(y)) { this.push(this.pc); this.pc = nn; return cyc + 17; } return cyc + 10; }
        case 5:
          if (!q) { this.push(this.getRP2(p, px)); return cyc + 11; }
          { const nn = this.fetch16(); this.push(this.pc); this.pc = nn; return cyc + 17; } // p === 0 (others are prefixes)
        case 6: this.alu(y, this.fetch()); return cyc + 7;
        default: this.push(this.pc); this.pc = y << 3; return cyc + 11;
      }
    }

    execCB(px) {
      let addr = 0, op;
      if (px) { addr = ((px === 1 ? this.ix : this.iy) + sx(this.fetch())) & 0xffff; op = this.fetch(); }
      else { op = this.fetch(); this.incR(); }
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
      if (!px) addr = this.hl;
      const mem = px || z === 6;
      const v = mem ? this.rd(addr) : this.getR(z, 0);
      if (x === 1) { // BIT
        const r = v & (1 << y);
        this.f = (this.f & 1) | 0x10 | (r ? r & 0x80 : 0x44) | (v & 0x28);
        return px ? 20 : (z === 6 ? 12 : 8);
      }
      let r;
      if (x === 0) r = this.rot(y, v);
      else if (x === 2) r = v & ~(1 << y);
      else r = v | (1 << y);
      if (mem) { this.wr(addr, r); if (px && z !== 6) this.setR(z, r, 0); }
      else this.setR(z, r, 0);
      return px ? 23 : (z === 6 ? 15 : 8);
    }

    execED(op) {
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
      if (x === 1) {
        switch (z) {
          case 0: { const v = this.inp(this.bc) & 0xff; if (y !== 6) this.setR(y, v, 0); this.f = (this.f & 1) | SZP[v]; return 12; }
          case 1: this.out(this.bc, y === 6 ? 0 : this.getR(y, 0)); return 12;
          case 2: if (!q) this.sbc16(this.getRP(p, 0)); else this.adc16(this.getRP(p, 0)); return 15;
          case 3: { const nn = this.fetch16(); if (!q) this.wr16(nn, this.getRP(p, 0)); else this.setRP(p, this.rd16(nn), 0); return 20; }
          case 4: { const v = this.a; this.a = 0; this.sub8(v, 0); return 8; }
          case 5: this.iff1 = this.iff2; this.pc = this.pop(); return 14;
          case 6: this.im = [0, 0, 1, 2, 0, 0, 1, 2][y]; return 8;
          default:
            switch (y) {
              case 0: this.i = this.a; return 9;
              case 1: this.r = this.a; return 9;
              case 2: this.a = this.i; this.f = (this.f & 1) | SZ[this.a] | (this.iff2 ? 4 : 0); return 9;
              case 3: this.a = this.r; this.f = (this.f & 1) | SZ[this.a] | (this.iff2 ? 4 : 0); return 9;
              case 4: { const m = this.rd(this.hl); this.wr(this.hl, ((this.a << 4) | (m >> 4)) & 0xff); this.a = (this.a & 0xf0) | (m & 0x0f); this.f = (this.f & 1) | SZP[this.a]; return 18; }
              case 5: { const m = this.rd(this.hl); this.wr(this.hl, ((m << 4) | (this.a & 0x0f)) & 0xff); this.a = (this.a & 0xf0) | (m >> 4); this.f = (this.f & 1) | SZP[this.a]; return 18; }
              default: return 8;
            }
        }
      }
      if (x === 2 && z <= 3 && y >= 4) {
        const dir = (y & 1) ? -1 : 1, rep = y >= 6;
        switch (z) {
          case 0: { // LDI/LDD/LDIR/LDDR
            const v = this.rd(this.hl); this.wr(this.de, v);
            this.hl = (this.hl + dir) & 0xffff; this.de = (this.de + dir) & 0xffff; this.bc = (this.bc - 1) & 0xffff;
            const n = (v + this.a) & 0xff;
            this.f = (this.f & 0xc1) | (this.bc ? 4 : 0) | (n & 0x08) | ((n << 4) & 0x20);
            if (rep && this.bc) { this.pc = (this.pc - 2) & 0xffff; return 21; }
            return 16;
          }
          case 1: { // CPI/CPD/CPIR/CPDR
            const v = this.rd(this.hl), r = (this.a - v) & 0xff, h = (this.a ^ v ^ r) & 0x10;
            this.hl = (this.hl + dir) & 0xffff; this.bc = (this.bc - 1) & 0xffff;
            const n = (r - (h ? 1 : 0)) & 0xff;
            this.f = (this.f & 1) | 0x02 | h | (SZ[r] & 0xc0) | (this.bc ? 4 : 0) | (n & 0x08) | ((n << 4) & 0x20);
            if (rep && this.bc && r) { this.pc = (this.pc - 2) & 0xffff; return 21; }
            return 16;
          }
          case 2: { // INI/IND/INIR/INDR
            const v = this.inp(this.bc) & 0xff; this.wr(this.hl, v);
            this.hl = (this.hl + dir) & 0xffff; this.b = (this.b - 1) & 0xff;
            this.f = SZ[this.b] | 0x02;
            if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
            return 16;
          }
          default: { // OUTI/OUTD/OTIR/OTDR
            const v = this.rd(this.hl); this.b = (this.b - 1) & 0xff; this.out(this.bc, v);
            this.hl = (this.hl + dir) & 0xffff;
            this.f = SZ[this.b] | 0x02;
            if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
            return 16;
          }
        }
      }
      return 8;
    }
  }
  global.Z80 = Z80;
})(typeof window !== 'undefined' ? window : globalThis);
