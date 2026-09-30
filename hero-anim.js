/* MoleculeSolver hero — a code-driven motion piece.
   One pure function of time, render(t), draws the whole story on a canvas:
   raw ¹³C spectrum → baseline + peak picking → machine-learning groups assemble a candidate →
   the user moves a methyl (isocaffeine → caffeine) → 3D look → predicted ¹³C
   spectrum mirrored under the experimental one → match.
   Everything is vector-drawn per frame, so it stays crisp at any size / DPR.
   `?heroT=12.5` freezes a single frame (screenshots, video capture). */
(() => {
  'use strict';

  const canvas = document.getElementById('hero-anim');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');

  const LOOP = 20;
  const PI = Math.PI;

  // ── Easing & timing helpers ──
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const outCubic = (k) => 1 - (1 - k) ** 3;
  const inOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  const outBack = (k) => {
    const c1 = 1.5;
    return k <= 0 ? 0 : 1 + (c1 + 1) * (k - 1) ** 3 + c1 * (k - 1) ** 2;
  };
  // 0 → 1 → 0 window with soft edges of length f
  const win = (t, a, b, f = 0.25) => seg(t, a, a + f) * (1 - seg(t, b - f, b));

  // ── Palette (mirrors styles.css tokens) ──
  const COL = {
    text: '#f4f1fa',
    muted: '#a49db4',
    faint: '#6f6880',
    violet: '#8b5cf6',
    violetSoft: '#a78bfa',
    magenta: '#e879f9',
    pink: '#f472b6',
    line: '#ece6fa',
    bond: '#dcd5ec',
    N: '#9db8ff',
    O: '#ff8fb1',
  };
  const CHIP_DOT = { 'CH₃': COL.violetSoft, 'C=O': COL.pink, CH: COL.magenta, C: '#c4b5fd' };
  const font = (w, px, fam = 'Inter') => `${w} ${px}px ${fam}, system-ui, sans-serif`;

  // ── Caffeine ¹³C (CDCl₃): experimental shifts, predicted shifts, group, target atom ──
  const PPM_MAX = 170;
  const PPM_MIN = 10;
  const PEAKS = [
    { ppm: 155.4, h: 0.36, pred: 155.0, chip: 'C=O', atom: 'O6' },
    { ppm: 151.7, h: 0.42, pred: 151.9, chip: 'C=O', atom: 'O2' },
    { ppm: 148.7, h: 0.32, pred: 148.2, chip: 'C', atom: 'C4' },
    { ppm: 141.4, h: 0.62, pred: 141.9, chip: 'CH', atom: 'C8' },
    { ppm: 107.6, h: 0.3, pred: 107.1, chip: 'C', atom: 'C5' },
    { ppm: 33.6, h: 0.86, pred: 33.4, chip: 'CH₃', atom: 'MeX' },
    { ppm: 29.7, h: 0.8, pred: 29.9, chip: 'CH₃', atom: 'Me1' },
    { ppm: 27.9, h: 0.74, pred: 27.6, chip: 'CH₃', atom: 'Me3' },
  ];
  const SOLVENT = [77.48, 77.16, 76.84];
  const NOISE_AMP = 0.024;

  const lor = (x, x0, h, g) => h / (1 + ((x - x0) / g) ** 2);
  const signal = (x) =>
    PEAKS.reduce((s, p) => s + lor(x, p.ppm, p.h, 0.42), 0) +
    SOLVENT.reduce((s, x0) => s + lor(x, x0, 0.42, 0.3), 0);
  const predSignal = (x) => PEAKS.reduce((s, p) => s + lor(x, p.pred, p.h * 0.85 + 0.1, 0.55), 0);
  // Deterministic "noise": a sum of incommensurate sines, so every frame agrees.
  const noise = (x) =>
    (Math.sin(x * 7.3 + 0.9) * 0.5 +
      Math.sin(x * 13.1 + 2.1) * 0.35 +
      Math.sin(x * 23.7 + 4.4) * 0.3 +
      Math.sin(x * 41.9 + 1.3) * 0.22 +
      Math.sin(x * 3.1 + 5.2) * 0.25) /
    1.2;
  const drift = (x) => 0.08 * Math.sin(x / 26 + 0.8) + (0.07 * (x - PPM_MIN)) / (PPM_MAX - PPM_MIN) + 0.05;

  // Samples: a uniform grid plus dense points around every line so peak tops are exact.
  const XS = (() => {
    const a = [];
    const n = 1100;
    for (let i = 0; i <= n; i++) a.push(PPM_MAX - ((PPM_MAX - PPM_MIN) * i) / n);
    const centers = [...PEAKS.map((p) => p.ppm), ...PEAKS.map((p) => p.pred), ...SOLVENT];
    for (const c of centers) for (const o of [0, -0.12, 0.12, -0.25, 0.25, -0.45, 0.45, -0.8, 0.8]) a.push(c + o);
    return a.sort((p, q) => q - p);
  })();
  const SIG = XS.map(signal);
  const NOI = XS.map((x) => noise(x) * NOISE_AMP);
  const DRI = XS.map(drift);
  const PRED = XS.map(predSignal);

  // ── Caffeine skeleton, in bond-length units (y up). MeX is the methyl the user moves. ──
  const HEX_C = [0, 0];
  const PENT_C = [1.554, 0];
  const R_ME = 1.851;
  const ANG_N9 = -0.4 * PI;
  const ANG_N7 = 0.4 * PI;
  const ATOMS = {
    N1: [-0.866, 0.5, 'N'],
    C2: [-0.866, -0.5, 'C'],
    N3: [0, -1, 'N'],
    C4: [0.866, -0.5, 'C'],
    C5: [0.866, 0.5, 'C'],
    C6: [0, 1, 'C'],
    N7: [1.817, 0.809, 'N'],
    C8: [2.405, 0, 'C'],
    N9: [1.817, -0.809, 'N'],
    O2: [-1.732, -1, 'O'],
    O6: [0, 2, 'O'],
    Me1: [-1.732, 1, 'Me'],
    Me3: [0, -2, 'Me'],
    MeX: [0, 0, 'Me'], // position set per frame
  };
  const ME_TEXT = { Me1: ['H₃', 'C', ''], Me3: ['', 'C', 'H₃'], MeX: ['', 'C', 'H₃'] };
  // Draw order doubles as the build order.
  const BONDS = [
    ['C6', 'N1'],
    ['N1', 'C2'],
    ['C2', 'N3'],
    ['N3', 'C4'],
    ['C4', 'C5', { ring: HEX_C }],
    ['C5', 'C6'],
    ['C5', 'N7'],
    ['N7', 'C8', { ring: PENT_C, iso: true }],
    ['C8', 'N9', { ring: PENT_C, iso: false }],
    ['N9', 'C4'],
    ['C2', 'O2', { sym: true }],
    ['C6', 'O6', { sym: true }],
    ['N1', 'Me1'],
    ['N3', 'Me3'],
    ['N9', 'MeX', { methyl: true }],
  ];
  const MOL_PIVOT = [0.84, 0];

  // ── Layouts (logical units; the canvas is scaled to fit) ──
  const LAYOUTS = {
    wide: {
      W: 1200,
      H: 640,
      specFull: { x: 70, y: 74, w: 1060, h: 430 },
      specSide: { x: 24, y: 74, w: 610, h: 430 },
      mol: { cx: 935, cy: 272, U: 60 },
      bar: { y: 604, x0: 240, x1: 960 },
      fs: 1,
      narrow: false,
    },
    narrow: {
      W: 480,
      H: 800,
      specFull: { x: 14, y: 70, w: 452, h: 330 },
      specSide: { x: 14, y: 70, w: 452, h: 330 },
      mol: { cx: 240, cy: 572, U: 46 },
      bar: { y: 772, x0: 20, x1: 460 },
      fs: 1.12,
      narrow: true,
    },
  };
  let L = LAYOUTS.wide;
  let scale = 1;
  let dpr = 1;

  // ── Small drawing helpers ──
  const withAlpha = (a, fn) => {
    if (a <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= a;
    fn();
    ctx.restore();
  };
  const rrect = (x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };
  const glowDot = (x, y, r, color, a = 1) => {
    withAlpha(a, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, PI * 2);
      ctx.fill();
    });
  };
  const lerpRect = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });
  const quad = (p0, c, p1, k) => {
    const u = 1 - k;
    return [u * u * p0[0] + 2 * u * k * c[0] + k * k * p1[0], u * u * p0[1] + 2 * u * k * c[1] + k * k * p1[1]];
  };
  const spread = (xs, gap, lo, hi) => {
    const p = xs.slice();
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < p.length - 1; i++) {
        const d = p[i + 1] - p[i];
        if (d < gap) {
          p[i] -= (gap - d) / 2;
          p[i + 1] += (gap - d) / 2;
        }
      }
      for (let i = 0; i < p.length; i++) p[i] = Math.min(hi, Math.max(lo, p[i]));
    }
    return p;
  };

  // ── Timeline constants ──
  const SWEEP = [3.05, 3.7];
  const frac = (ppm) => (PPM_MAX - ppm) / (PPM_MAX - PPM_MIN);
  const peakPopAt = (ppm) => SWEEP[0] + (SWEEP[1] - SWEEP[0]) * frac(ppm);
  const chipLaunch = (i) => 4.95 + i * 0.09;
  const CHIP_DUR = 1.15;
  const bondStart = (i) => 6.3 + i * 0.06;
  const N_POP = { N1: 6.35, N3: 6.5, N9: 6.7, N7: 6.85 };
  const DRAG = [9.05, 10.25];
  const STEPS = [
    ['Spectrum', 0, 4.4],
    ['ML proposal', 4.4, 7.9],
    ['Refine', 7.9, 14.1],
    ['Predict & compare', 14.1, 19.3],
  ];

  // ── Spectrum geometry at time t ──
  function specGeom(t) {
    const k = inOutCubic(seg(t, 4.3, 5.35));
    const R = lerpRect(L.specFull, L.specSide, k);
    const bf = inOutCubic(seg(t, 14.2, 15.0));
    const c = inOutCubic(seg(t, 2.25, 3.0));
    const top = R.y + 66;
    const bottom = R.y + R.h - 26;
    const base = bottom - (bottom - top) * 0.46 * bf;
    const sy = (base - top) / 1.08;
    const pbase = base + 24;
    const pscale = Math.max(0, R.y + R.h - 6 - pbase);
    return {
      R,
      bf,
      top,
      base,
      sy,
      pbase,
      pscale,
      nAmt: lerp(1, 0.22, c),
      dAmt: 1 - c,
      X: (ppm) => R.x + frac(ppm) * R.w,
    };
  }
  const peakTopY = (G, ppm) => G.base - (signal(ppm) + G.nAmt * noise(ppm) * NOISE_AMP + G.dAmt * drift(ppm)) * G.sy;

  function drawSpectrum(t, G) {
    const { R, X, base, sy, top } = G;
    const fs = L.fs;

    // grid + axis
    const axisK = outCubic(seg(t, 0.1, 0.8));
    ctx.lineWidth = 1;
    for (let v = 160; v >= 20; v -= 20) {
      const x = X(v);
      if (x > R.x + R.w * axisK) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(x, top - 6);
      ctx.lineTo(x, base);
      ctx.stroke();
      ctx.fillStyle = COL.faint;
      ctx.font = font(500, 11 * fs);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), x, base + 13);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(R.x, base);
    ctx.lineTo(R.x + R.w * axisK, base);
    ctx.stroke();
    withAlpha(axisK, () => {
      ctx.fillStyle = COL.faint;
      ctx.font = font(500, 11 * fs);
      ctx.textAlign = 'right';
      ctx.fillText('ppm', R.x + R.w, base + 13);
    });

    // experimental trace (revealed left → right like a pen)
    const rv = inOutCubic(seg(t, 0.35, 2.2));
    const revealX = R.x + R.w * rv;
    const pts = [];
    for (let i = 0; i < XS.length; i++) {
      const x = X(XS[i]);
      if (x > revealX) break;
      pts.push([x, base - (SIG[i] + G.nAmt * NOI[i] + G.dAmt * DRI[i]) * sy]);
    }
    if (pts.length > 1) {
      // soft fill under the line
      const fill = ctx.createLinearGradient(0, top, 0, base);
      fill.addColorStop(0, 'rgba(139,92,246,0.16)');
      fill.addColorStop(1, 'rgba(139,92,246,0)');
      ctx.beginPath();
      ctx.moveTo(pts[0][0], base);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(pts[pts.length - 1][0], base);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      const stroke = (w, c) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) ctx.lineTo(p[0], p[1]);
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      stroke(5, 'rgba(167,139,250,0.16)');
      stroke(1.35, COL.line);

      const head = pts[pts.length - 1];
      const headA = win(t, 0.35, 2.35, 0.2);
      glowDot(head[0], head[1], 16, 'rgba(232,121,249,0.55)', headA);
      glowDot(head[0], head[1], 4, '#ffffff', headA);
    }

    // baseline model: a dashed curve riding the drift, flattening as it is subtracted
    const guideA = win(t, 1.9, 3.2, 0.3);
    withAlpha(guideA, () => {
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = COL.violetSoft;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const ppm = PPM_MAX - ((PPM_MAX - PPM_MIN) * i) / 80;
        const x = X(ppm);
        if (x > revealX) break;
        const y = base - G.dAmt * drift(ppm) * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // peak-picking sweep
    const sw = seg(t, SWEEP[0], SWEEP[1]);
    withAlpha(win(t, SWEEP[0] - 0.05, SWEEP[1] + 0.15, 0.15), () => {
      const sx = R.x + R.w * sw;
      const g = ctx.createLinearGradient(sx - 60, 0, sx, 0);
      g.addColorStop(0, 'rgba(232,121,249,0)');
      g.addColorStop(1, 'rgba(232,121,249,0.14)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 60, top - 10, 60, base - top + 10);
      ctx.fillStyle = 'rgba(240,171,252,0.8)';
      ctx.fillRect(sx - 0.75, top - 10, 1.5, base - top + 10);
    });

    // peak markers + fanned ppm labels (MestReNova-style leaders)
    const xs = PEAKS.map((p) => X(p.ppm));
    const lx = spread(xs, 15 * fs, R.x + 8, R.x + R.w - 8);
    PEAKS.forEach((p, i) => {
      const t0 = peakPopAt(p.ppm);
      const pop = outBack(seg(t, t0, t0 + 0.45));
      if (pop <= 0) return;
      const a = seg(t, t0, t0 + 0.25);
      const px = xs[i];
      const py = peakTopY(G, p.ppm);
      withAlpha(a, () => {
        // leader
        ctx.strokeStyle = 'rgba(196,181,253,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx[i], R.y + 50);
        ctx.lineTo(lx[i], R.y + 54);
        ctx.lineTo(px, R.y + 62);
        ctx.lineTo(px, Math.max(R.y + 62, lerp(R.y + 62, py - 9, outCubic(seg(t, t0, t0 + 0.4)))));
        ctx.stroke();
        // label
        ctx.save();
        ctx.translate(lx[i], R.y + 46);
        ctx.rotate(-PI / 2);
        ctx.fillStyle = COL.muted;
        ctx.font = font(500, 11 * fs);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.ppm.toFixed(1), 0, 0);
        ctx.restore();
        // marker
        ctx.save();
        ctx.translate(px, py - 5);
        ctx.scale(pop, pop);
        ctx.fillStyle = COL.magenta;
        ctx.beginPath();
        ctx.moveTo(-3.5, -5);
        ctx.lineTo(3.5, -5);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      glowDot(px, py, 14, 'rgba(232,121,249,0.6)', a * (1 - seg(t, t0 + 0.2, t0 + 0.9)));
    });
    // the solvent triplet is recognised and left out
    const s0 = peakPopAt(77.16);
    withAlpha(seg(t, s0, s0 + 0.3), () => {
      ctx.fillStyle = COL.faint;
      ctx.font = font(500, 10.5 * fs);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('CDCl₃', X(77.16), peakTopY(G, 77.16) - 6);
    });

    // predicted spectrum, mirrored underneath
    if (G.bf > 0.001) {
      withAlpha(G.bf, () => {
        ctx.strokeStyle = 'rgba(244,114,182,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(R.x, G.pbase);
        ctx.lineTo(R.x + R.w, G.pbase);
        ctx.stroke();
      });
      const pr = inOutCubic(seg(t, 14.9, 16.1));
      const pX = R.x + R.w * pr;
      const pp = [];
      for (let i = 0; i < XS.length; i++) {
        const x = X(XS[i]);
        if (x > pX) break;
        pp.push([x, G.pbase + PRED[i] * G.pscale]);
      }
      if (pp.length > 1) {
        const fill = ctx.createLinearGradient(0, G.pbase, 0, G.pbase + G.pscale);
        fill.addColorStop(0, 'rgba(244,114,182,0)');
        fill.addColorStop(1, 'rgba(244,114,182,0.16)');
        ctx.beginPath();
        ctx.moveTo(pp[0][0], G.pbase);
        for (const p of pp) ctx.lineTo(p[0], p[1]);
        ctx.lineTo(pp[pp.length - 1][0], G.pbase);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        for (const [w, c] of [
          [5, 'rgba(244,114,182,0.18)'],
          [1.35, COL.pink],
        ]) {
          ctx.beginPath();
          ctx.moveTo(pp[0][0], pp[0][1]);
          for (const p of pp) ctx.lineTo(p[0], p[1]);
          ctx.lineWidth = w;
          ctx.strokeStyle = c;
          ctx.stroke();
        }
        const head = pp[pp.length - 1];
        const headA = win(t, 14.9, 16.2, 0.2);
        glowDot(head[0], head[1], 16, 'rgba(244,114,182,0.6)', headA);
        glowDot(head[0], head[1], 4, '#ffffff', headA);
      }

      // matched pairs light up one by one
      PEAKS.forEach((p, i) => {
        const a0 = 16.05 + i * 0.11;
        const a = seg(t, a0, a0 + 0.3);
        if (a <= 0) return;
        const x = X(p.ppm);
        const y0 = peakTopY(G, p.ppm) - 4;
        const y1 = G.pbase + predSignal(p.pred) * G.pscale + 4;
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, 'rgba(167,139,250,0.28)');
        g.addColorStop(1, 'rgba(244,114,182,0.28)');
        withAlpha(a * (0.55 + 0.45 * (1 - seg(t, a0 + 0.3, a0 + 1))), () => {
          ctx.fillStyle = g;
          rrect(x - 5, y0, 10, y1 - y0, 5);
          ctx.fill();
        });
        glowDot(x, G.base + 12, 12, 'rgba(232,121,249,0.7)', a * (1 - seg(t, a0 + 0.3, a0 + 1.1)));
      });

      // match meter
      const matched = PEAKS.reduce((s, _, i) => s + seg(t, 16.05 + i * 0.11, 16.35 + i * 0.11), 0);
      withAlpha(seg(t, 15.7, 16.1), () => {
        const pct = Math.round((97 * matched) / PEAKS.length);
        // centred in the empty 40–100 ppm lane of the predicted trace
        const x = X(68);
        const y = G.pbase + G.pscale * 0.5;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = font(800, 34 * fs, 'Montserrat');
        const g2 = ctx.createLinearGradient(x - 45, 0, x + 45, 0);
        g2.addColorStop(0, '#a78bfa');
        g2.addColorStop(0.5, '#e879f9');
        g2.addColorStop(1, '#f472b6');
        ctx.fillStyle = g2;
        ctx.fillText(`${pct}%`, x, y);
        ctx.font = font(500, 11 * fs);
        ctx.fillStyle = COL.muted;
        ctx.fillText('spectral match', x, y + 18 * fs);
      });
    }

    drawSpecStatus(t, R);
  }

  function statusPill(x, y, text, dot, a, align = 'left') {
    withAlpha(a, () => {
      const fs = L.fs;
      ctx.font = font(500, 12 * fs);
      const tw = ctx.measureText(text).width;
      const h = 24 * fs;
      const w = tw + (dot ? 30 : 20) * fs;
      const x0 = align === 'center' ? x - w / 2 : x;
      rrect(x0, y - h / 2, w, h, h / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (dot) {
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(x0 + 12 * fs, y, 3 * fs, 0, PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = COL.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x0 + (dot ? 21 : 10) * fs, y + 0.5);
    });
  }

  function drawSpecStatus(t, R) {
    const y = R.y - 20;
    statusPill(R.x, y, 'sample_07.jdx  ·  ¹³C  ·  100 MHz  ·  CDCl₃', COL.violetSoft, win(t, 0.25, 2.25, 0.2));
    statusPill(R.x, y, 'Baseline correction', COL.violetSoft, win(t, 2.25, 3.05, 0.2));
    statusPill(R.x, y, 'Peak picking…', COL.magenta, win(t, 3.05, 4.35, 0.2));
    statusPill(R.x, y, '8 peaks  ·  solvent excluded', COL.magenta, win(t, 4.35, 14.25, 0.2));
    // legend during the comparison
    withAlpha(win(t, 14.25, 30, 0.3), () => {
      const fs = L.fs;
      ctx.font = font(500, 12 * fs);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let x = R.x;
      for (const [label, c] of [
        ['Experimental', COL.line],
        ['Predicted ¹³C', COL.pink],
      ]) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y - 1, 16 * fs, 2);
        ctx.fillStyle = COL.muted;
        ctx.fillText(label, x + 22 * fs, y + 0.5);
        x += ctx.measureText(label).width + 44 * fs;
      }
    });
  }

  // ── Molecule ──
  function molState(t) {
    const dragK = inOutCubic(seg(t, DRAG[0], DRAG[1]));
    const ang = lerp(ANG_N9, ANG_N7, dragK);
    const dropped = t >= DRAG[1];
    const m3 = inOutCubic(seg(t, 11.0, 11.55)) * (1 - inOutCubic(seg(t, 13.55, 14.1)));
    let yaw = 0;
    if (t >= 11.45 && t < 12.35) yaw = lerp(0, 0.85, inOutCubic(seg(t, 11.45, 12.35)));
    else if (t >= 12.35 && t < 13.25) yaw = lerp(0.85, -0.55, inOutCubic(seg(t, 12.35, 13.25)));
    else if (t >= 13.25) yaw = lerp(-0.55, 0, inOutCubic(seg(t, 13.25, 13.85)));
    const pitch = 0.32 * Math.sin(PI * seg(t, 11.45, 13.85));
    return {
      dragK,
      ang,
      dropped,
      kIso: 1 - seg(t, 10.3, 10.6),
      m3,
      yaw,
      pitch,
      U: L.mol.U * (1 + 0.06 * m3),
    };
  }

  function atomPos(name, st) {
    if (name === 'MeX') return [PENT_C[0] + R_ME * Math.cos(st.ang), R_ME * Math.sin(st.ang), 0];
    const a = ATOMS[name];
    return [a[0], a[1], 0];
  }

  function project(p, st) {
    const x = p[0] - MOL_PIVOT[0];
    const y = p[1] - MOL_PIVOT[1];
    const z = p[2] || 0;
    const cy = Math.cos(st.yaw);
    const sy = Math.sin(st.yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cp = Math.cos(st.pitch);
    const sp = Math.sin(st.pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const s = 9 / (9 - z2);
    return { X: L.mol.cx + x1 * s * st.U, Y: L.mol.cy - y2 * s * st.U, s, z: z2 };
  }

  const scr = (name, st) => project(atomPos(name, st), st);
  const kindOf = (name) => (name === 'MeX' ? 'Me' : ATOMS[name][2]);

  function bondTrim(name, st) {
    const k = kindOf(name);
    if (k === 'C') return 0;
    return st.U * (k === 'Me' ? 0.24 : 0.2);
  }

  function drawBondLine(pa, pb, ta, tb, prog, offset = 0, shrink = 0) {
    const dx = pb.X - pa.X;
    const dy = pb.Y - pa.Y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * offset;
    const ny = ux * offset;
    const s0 = ta + shrink * len;
    const s1 = len - tb - shrink * len;
    if (s1 <= s0) return;
    const e = lerp(s0, s1, prog);
    ctx.beginPath();
    ctx.moveTo(pa.X + ux * s0 + nx, pa.Y + uy * s0 + ny);
    ctx.lineTo(pa.X + ux * e + nx, pa.Y + uy * e + ny);
    ctx.stroke();
  }

  function atomLabel(name, st, a, lift = 1) {
    const p = scr(name, st);
    const k = kindOf(name);
    const fs = (st.U / 60) * 18;
    withAlpha(a, () => {
      ctx.save();
      ctx.translate(p.X, p.Y);
      ctx.scale(lift, lift);
      ctx.textBaseline = 'middle';
      ctx.font = font(600, fs);
      if (k === 'N' || k === 'O') {
        ctx.fillStyle = COL[k];
        ctx.textAlign = 'center';
        ctx.fillText(k, 0, 0.5);
      } else {
        const [pre, mid, post] = ME_TEXT[name];
        const wm = ctx.measureText(mid).width;
        ctx.fillStyle = COL.line;
        ctx.textAlign = 'center';
        ctx.fillText(mid, 0, 0.5);
        ctx.textAlign = 'right';
        if (pre) ctx.fillText(pre, -wm / 2, 0.5);
        ctx.textAlign = 'left';
        if (post) ctx.fillText(post, wm / 2, 0.5);
      }
      ctx.restore();
    });
  }

  function drawSkeletal(t, st, alpha) {
    withAlpha(alpha, () => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = COL.bond;
      ctx.lineWidth = Math.max(1.6, st.U * 0.036);
      BONDS.forEach(([a, b, o = {}], i) => {
        const prog = inOutCubic(seg(t, bondStart(i), bondStart(i) + 0.45));
        if (prog <= 0) return;
        if (o.methyl) return drawMethylBonds(t, st, prog);
        const pa = scr(a, st);
        const pb = scr(b, st);
        const ta = bondTrim(a, st);
        const tb = bondTrim(b, st);
        if (o.sym) {
          const off = st.U * 0.055;
          drawBondLine(pa, pb, ta, tb, prog, off);
          drawBondLine(pa, pb, ta, tb, prog, -off);
          return;
        }
        drawBondLine(pa, pb, ta, tb, prog);
        if (o.ring) {
          const innerA = o.iso === undefined ? 1 : o.iso ? st.kIso : 1 - st.kIso;
          if (innerA <= 0) return;
          // offset the second line toward the ring centre
          const rc = project([o.ring[0], o.ring[1], 0], st);
          const mx = (pa.X + pb.X) / 2;
          const my = (pa.Y + pb.Y) / 2;
          const dx = pb.X - pa.X;
          const dy = pb.Y - pa.Y;
          const sign = -dy * (rc.X - mx) + dx * (rc.Y - my) > 0 ? 1 : -1;
          withAlpha(innerA, () => drawBondLine(pa, pb, ta, tb, prog, sign * st.U * 0.13, 0.14));
        }
      });

      // atom labels: N pop in with the bonds, O / CH₃ are what the group chips turn into
      for (const [n, t0] of Object.entries(N_POP)) {
        const k = outBack(seg(t, t0, t0 + 0.4));
        atomLabel(n, st, seg(t, t0, t0 + 0.2), Math.max(0.01, k));
      }
      PEAKS.forEach((p, i) => {
        if (kindOf(p.atom) === 'C') return;
        const arr = chipLaunch(i) + CHIP_DUR;
        const a = seg(t, arr - 0.05, arr + 0.3);
        const lift = p.atom === 'MeX' ? 1 + 0.12 * win(t, 8.9, 10.4, 0.2) : 1;
        if (p.atom === 'MeX') drawGrabHalo(t, st);
        atomLabel(p.atom, st, a, lift);
      });
    });
  }

  function drawGrabHalo(t, st) {
    const a = win(t, 8.9, 10.45, 0.18);
    if (a <= 0) return;
    const p = scr('MeX', st);
    withAlpha(a, () => {
      const r = st.U * 0.4;
      rrect(p.X - r * 1.05, p.Y - r * 0.72, r * 2.3, r * 1.44, r * 0.72);
      ctx.fillStyle = 'rgba(139,92,246,0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(167,139,250,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function drawMethylBonds(t, st, prog) {
    const me = scr('MeX', st);
    const tm = bondTrim('MeX', st);
    const n9 = scr('N9', st);
    const n7 = scr('N7', st);
    const tn = bondTrim('N9', st);
    if (!st.dropped) {
      withAlpha(1 - 0.7 * seg(st.dragK, 0, 0.5), () => drawBondLine(n9, me, tn, tm, prog));
      withAlpha(0.85 * seg(st.dragK, 0.5, 1), () => {
        ctx.setLineDash([3, 4]);
        drawBondLine(n7, me, tn, tm, 1);
        ctx.setLineDash([]);
      });
    } else {
      const k = seg(t, DRAG[1], DRAG[1] + 0.2);
      withAlpha(0.85 * (1 - k), () => {
        ctx.setLineDash([3, 4]);
        drawBondLine(n7, me, tn, tm, 1);
        ctx.setLineDash([]);
      });
      withAlpha(k, () => drawBondLine(n7, me, tn, tm, 1));
    }
  }

  // ball-and-stick, matte: a broad diffuse falloff (lit → base → terminator), no specular hotspot
  const SPHERE = {
    C: { r: 0.25, lit: '#8a8299', base: '#655d75', shade: '#2c2637' },
    Me: { r: 0.25, lit: '#8a8299', base: '#655d75', shade: '#2c2637' },
    N: { r: 0.25, lit: '#7f98e6', base: '#5470c9', shade: '#233470' },
    O: { r: 0.25, lit: '#e0829f', base: '#c05577', shade: '#5e2037' },
    H: { r: 0.14, lit: '#d6d1de', base: '#b2acbd', shade: '#5d5869' },
  };

  function hydrogens(st) {
    const out = [];
    const methyl = (me, parent) => {
      const p = atomPos(me, st);
      const q = atomPos(parent, st);
      let dx = p[0] - q[0];
      let dy = p[1] - q[1];
      const l = Math.hypot(dx, dy);
      dx /= l;
      dy /= l;
      const ux = -dy;
      const uy = dx;
      for (const th of [PI / 2, PI / 2 + (2 * PI) / 3, PI / 2 + (4 * PI) / 3]) {
        const c = Math.cos(th) * 0.943;
        const s = Math.sin(th) * 0.943;
        out.push({ p: [p[0] + 0.62 * (dx * 0.33 + c * ux), p[1] + 0.62 * (dy * 0.33 + c * uy), 0.62 * s], parent: me });
      }
    };
    methyl('Me1', 'N1');
    methyl('Me3', 'N3');
    methyl('MeX', st.dropped ? 'N7' : 'N9');
    out.push({ p: [ATOMS.C8[0] + 0.62, 0, 0], parent: 'C8' });
    return out;
  }

  function draw3D(st, alpha) {
    withAlpha(alpha, () => {
      const items = [];
      const names = Object.keys(ATOMS);
      const P = {};
      for (const n of names) P[n] = project(atomPos(n, st), st);
      const hs = hydrogens(st).map((h) => ({ ...h, s: project(h.p, st) }));
      for (const [a0, b] of BONDS) {
        const aa = b === 'MeX' && st.dropped ? 'N7' : a0;
        items.push({ kind: 'bond', a: P[aa], b: P[b], z: (P[aa].z + P[b].z) / 2 - 0.01 });
      }
      for (const h of hs) items.push({ kind: 'bond', a: P[h.parent], b: h.s, z: (P[h.parent].z + h.s.z) / 2 - 0.01 });
      for (const n of names) items.push({ kind: 'atom', p: P[n], sp: SPHERE[kindOf(n)] });
      for (const h of hs) items.push({ kind: 'atom', p: h.s, sp: SPHERE.H });
      for (const it of items) if (it.kind === 'atom') it.z = it.p.z;
      items.sort((p, q) => p.z - q.z);

      const grow = 0.35 + 0.65 * alpha;
      for (const it of items) {
        if (it.kind === 'bond') {
          const w = st.U * 0.1 * ((it.a.s + it.b.s) / 2);
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#4d4660';
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(it.a.X, it.a.Y);
          ctx.lineTo(it.b.X, it.b.Y);
          ctx.stroke();
        } else {
          const r = it.sp.r * st.U * it.p.s * grow;
          const g = ctx.createRadialGradient(it.p.X - r * 0.3, it.p.Y - r * 0.35, 0, it.p.X - r * 0.1, it.p.Y - r * 0.12, r * 1.12);
          g.addColorStop(0, it.sp.lit);
          g.addColorStop(0.5, it.sp.base);
          g.addColorStop(1, it.sp.shade);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(it.p.X, it.p.Y, r, 0, PI * 2);
          ctx.fill();
        }
      }
    });
  }

  // ── Group chips flying from peaks into the structure ──
  function chipShape(x, y, text, color, s, a) {
    withAlpha(a, () => {
      const fs = L.fs;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.font = font(600, 13 * fs);
      const tw = ctx.measureText(text).width;
      const h = 26 * fs;
      const w = tw + 32 * fs;
      ctx.shadowColor = 'rgba(139,92,246,0.55)';
      ctx.shadowBlur = 16;
      rrect(-w / 2, -h / 2, w, h, h / 2);
      ctx.fillStyle = 'rgba(22,15,36,0.95)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color;
      ctx.globalAlpha *= 0.7;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha /= 0.7;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(-w / 2 + 12 * fs, 0, 3.2 * fs, 0, PI * 2);
      ctx.fill();
      ctx.fillStyle = COL.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, -w / 2 + 21 * fs, 0.5);
      ctx.restore();
    });
  }

  function drawChips(t, G, st) {
    // draw in reverse so the first-launched chip sits on top
    for (let i = PEAKS.length - 1; i >= 0; i--) {
      const p = PEAKS[i];
      const t0 = chipLaunch(i);
      const arr = t0 + CHIP_DUR;
      if (t < t0 || t > arr + 0.5) continue;
      const from = [G.X(p.ppm), peakTopY(G, p.ppm) - 18];
      const to0 = scr(p.atom, st);
      const to = [to0.X, to0.Y];
      const mx = (from[0] + to[0]) / 2;
      const my = (from[1] + to[1]) / 2;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const bend = L.narrow ? 0.28 : -0.35;
      const c = [mx - dy * bend, my + dx * bend];
      const k = inOutCubic(seg(t, t0, arr));
      const [x, y] = quad(from, c, to, k);
      const appear = outBack(seg(t, t0, t0 + 0.35));
      const morph = seg(t, arr - 0.05, arr + 0.3);
      const s = appear * lerp(1, 0.55, morph);
      chipShape(x, y, p.chip, CHIP_DOT[p.chip], s, 1 - morph);
      // arrival flash
      const f = seg(t, arr - 0.05, arr + 0.45);
      if (f > 0 && f < 1) {
        withAlpha(1 - f, () => {
          ctx.strokeStyle = COL.magenta;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(to[0], to[1], lerp(6, st.U * 0.4, outCubic(f)), 0, PI * 2);
          ctx.stroke();
        });
        if (kindOf(p.atom) === 'C') glowDot(to[0], to[1], st.U * 0.35, 'rgba(232,121,249,0.8)', 1 - f);
      }
    }
  }

  function drawCursor(t, st) {
    const a = win(t, 8.15, 11.0, 0.25);
    if (a <= 0) return;
    const U = st.U;
    const { cx, cy } = L.mol;
    const me = scr('MeX', st);
    const grab = [me.X + 4, me.Y + 4];
    let x;
    let y;
    if (t < 8.9) {
      const k = inOutCubic(seg(t, 8.15, 8.9));
      x = lerp(cx + 3.2 * U, grab[0], k);
      y = lerp(cy + 3.0 * U, grab[1], k);
    } else if (t < DRAG[1] + 0.15) {
      [x, y] = grab;
    } else {
      const k = inOutCubic(seg(t, DRAG[1] + 0.15, 11.0));
      x = lerp(grab[0], grab[0] + 1.4 * U, k);
      y = lerp(grab[1], grab[1] + 1.6 * U, k);
    }
    const press = win(t, 8.9, DRAG[1] + 0.1, 0.12);
    // press ripple
    const rp = seg(t, 8.9, 9.35);
    if (rp > 0 && rp < 1) {
      withAlpha((1 - rp) * a, () => {
        ctx.strokeStyle = COL.violetSoft;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, lerp(4, 22, outCubic(rp)), 0, PI * 2);
        ctx.stroke();
      });
    }
    withAlpha(a, () => {
      ctx.save();
      ctx.translate(x, y);
      const s = (L.narrow ? 1.05 : 1.15) * (1 - 0.1 * press);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 17);
      ctx.lineTo(4.2, 13.2);
      ctx.lineTo(7.2, 19.8);
      ctx.lineTo(9.8, 18.6);
      ctx.lineTo(6.9, 12.2);
      ctx.lineTo(12.2, 12.2);
      ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = '#1b1426';
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawMolTags(t, st) {
    const { cx, cy } = L.mol;
    const y = cy + st.U * 2.85;
    const x = cx + (L.narrow ? 0 : 0.2 * st.U);
    statusPill(x, y, 'ML proposal  ·  candidate 1 of 3', COL.violetSoft, win(t, 7.1, 10.45, 0.25), 'center');
    statusPill(x, y, 'Methyl moved  N9 → N7', COL.magenta, win(t, 10.45, 11.1, 0.2), 'center');
    statusPill(x, y, '3D model', COL.magenta, win(t, 11.05, 14.0, 0.25), 'center');
    statusPill(x, y, 'Predicting ¹³C…', COL.pink, win(t, 14.1, 16.9, 0.25), 'center');

    // final reveal
    const a = seg(t, 16.9, 17.4);
    withAlpha(a, () => {
      const fs = L.fs;
      ctx.textBaseline = 'middle';
      ctx.font = font(700, 20 * fs, 'Montserrat');
      const name = 'Caffeine';
      const nw = ctx.measureText(name).width;
      ctx.font = font(500, 13 * fs);
      const formula = 'C₈H₁₀N₄O₂';
      const fw = ctx.measureText(formula).width;
      const badge = 22 * fs;
      const total = badge + 10 * fs + nw + 12 * fs + fw;
      let x0 = x - total / 2;
      const pop = outBack(seg(t, 16.9, 17.35));
      ctx.save();
      ctx.translate(x0 + badge / 2, y);
      ctx.scale(pop, pop);
      const g = ctx.createLinearGradient(-badge / 2, 0, badge / 2, 0);
      g.addColorStop(0, '#7c3aed');
      g.addColorStop(1, '#db2777');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, badge / 2, 0, PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-4.5 * fs, 0.5);
      ctx.lineTo(-1.2 * fs, 3.8 * fs);
      ctx.lineTo(5 * fs, -3.6 * fs);
      ctx.stroke();
      ctx.restore();
      x0 += badge + 10 * fs;
      ctx.textAlign = 'left';
      ctx.font = font(700, 20 * fs, 'Montserrat');
      ctx.fillStyle = COL.text;
      ctx.fillText(name, x0, y + 1);
      ctx.font = font(500, 13 * fs);
      ctx.fillStyle = COL.muted;
      ctx.fillText(formula, x0 + nw + 12 * fs, y + 1);
    });
  }

  function drawBeam(t, G) {
    const t0 = 14.3;
    if (t < t0 || t > t0 + 1.2) return;
    const from = [L.mol.cx, L.mol.cy];
    const to = [G.R.x + G.R.w * 0.55, G.pbase + 6];
    const c = L.narrow ? [(from[0] + to[0]) / 2 + 120, (from[1] + to[1]) / 2] : [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 90];
    for (let j = 0; j < 9; j++) {
      const k = seg(t, t0 + j * 0.05, t0 + j * 0.05 + 0.6);
      if (k <= 0 || k >= 1) continue;
      const [x, y] = quad(from, c, to, inOutCubic(k));
      glowDot(x, y, 9, 'rgba(244,114,182,0.7)', Math.sin(PI * k));
      glowDot(x, y, 2.2, '#ffffff', Math.sin(PI * k));
    }
  }

  function drawBar(t) {
    const { y, x0, x1 } = L.bar;
    const fs = L.fs;
    const gap = 14;
    const w = (x1 - x0 - gap * (STEPS.length - 1)) / STEPS.length;
    const fadeOut = 1 - seg(t, 19.3, 19.95);
    STEPS.forEach(([label, a, b], i) => {
      const x = x0 + i * (w + gap);
      const k = seg(t, a, b);
      const active = t >= a && t < b;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      rrect(x, y, w, 2, 1);
      ctx.fill();
      if (k > 0) {
        withAlpha(fadeOut, () => {
          const g = ctx.createLinearGradient(x, 0, x + w, 0);
          g.addColorStop(0, '#7c3aed');
          g.addColorStop(1, '#db2777');
          ctx.fillStyle = g;
          rrect(x, y, w * k, 2, 1);
          ctx.fill();
        });
      }
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = font(600, 11 * fs);
      const num = `0${i + 1}`;
      ctx.fillStyle = active ? COL.violetSoft : COL.faint;
      ctx.fillText(num, x, y - 9);
      if (!L.narrow || active) {
        ctx.font = font(500, 12.5 * fs);
        ctx.fillStyle = active ? COL.text : k >= 1 && fadeOut > 0.5 ? COL.muted : COL.faint;
        if (L.narrow) {
          ctx.textAlign = 'center';
          ctx.fillText(label, (x0 + x1) / 2, y - 30);
        } else {
          ctx.fillText(label, x + 22 * fs, y - 9);
        }
      }
    });
  }

  // ── Frame ──
  function render(t) {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    const gA = seg(t, 0, 0.35) * (1 - seg(t, 19.3, 19.95));
    const G = specGeom(t);
    const st = molState(t);

    withAlpha(gA, () => {
      // soft light behind the molecule
      glowDot(L.mol.cx, L.mol.cy, st.U * 3.4, 'rgba(124,58,237,0.16)', seg(t, 5.2, 6.4));
      drawSpectrum(t, G);
      drawSkeletal(t, st, 1 - st.m3);
      if (st.m3 > 0.001) draw3D(st, st.m3);
      drawChips(t, G, st);
      drawBeam(t, G);
      drawMolTags(t, st);
      drawCursor(t, st);
    });
    drawBar(t);
  }

  // ── Sizing, playback ──
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frozen = new URLSearchParams(location.search).get('heroT');
  const STILL = frozen !== null ? Number(frozen) : reduceMotion ? 17.8 : null;
  let clock = 0;

  function resize() {
    const w = canvas.parentElement.clientWidth;
    if (!w) return;
    L = w < 640 ? LAYOUTS.narrow : LAYOUTS.wide;
    canvas.style.aspectRatio = `${L.W} / ${L.H}`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = w / L.W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(((w * L.H) / L.W) * dpr);
    render(STILL ?? clock % LOOP);
  }

  let visible = true;
  let raf = 0;
  let last = 0;
  const frame = (now) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    clock += dt;
    render(clock % LOOP);
    raf = visible ? requestAnimationFrame(frame) : 0;
  };
  const play = () => {
    if (STILL !== null || raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    if (STILL !== null) return;
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) play();
    }).observe(canvas);
    play();
  };

  // Wait for the webfonts so the first frames don't flash a fallback face.
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1200))]).then(start);

  // For offline video capture: window.__heroRender(t) draws one exact frame.
  if (frozen !== null) window.__heroRender = (t) => render(t);
})();
