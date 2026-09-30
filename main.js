/* MoleculeSolver landing page — progressive enhancement only.
   Without this script every section is still readable; it adds the reveals,
   the eased "camera tours" over screenshots, the sticky how-it-works stage,
   the collaboration/learning mocks and the click-to-zoom lightbox. */
(() => {
  'use strict';

  // ── Contact: the single place to change where "Request access" goes ──
  const CONTACT_EMAIL = 'contact@moleculesolver.com'; // TODO: confirm the real inbox
  const MAIL_SUBJECT = 'MoleculeSolver: access request';
  const MAIL_BODY = [
    'Hi MoleculeSolver team,',
    '',
    "I'd like to request access.",
    '',
    'Name:',
    'Institution / company:',
    'Role (university group, CRO, student, other):',
    'What I would like to use MoleculeSolver for:',
    '',
  ].join('\n');

  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(MAIL_SUBJECT)}&body=${encodeURIComponent(MAIL_BODY)}`;
  document.querySelectorAll('[data-request-access]').forEach((a) => a.setAttribute('href', mailto));
  document.querySelectorAll('[data-contact-email]').forEach((a) => {
    a.textContent = CONTACT_EMAIL;
    a.setAttribute('href', `mailto:${CONTACT_EMAIL}`);
  });
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ── Nav: background after scroll, mobile menu ──
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('nav-toggle');
  const onScrollNav = () => nav.classList.toggle('is-scrolled', window.scrollY > 16);
  onScrollNav();
  window.addEventListener('scroll', onScrollNav, { passive: true });
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('#nav-links a').forEach((a) =>
    a.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }),
  );

  // ── Reveal on scroll ──
  const revealIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          revealIO.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  document.querySelectorAll('[data-reveal]').forEach((el) => revealIO.observe(el));

  // ── Camera tours ──
  // A .tour is a window onto one image or video; data-tour lists camera stops
  // {x, y, s}: the focal point (fraction of the media) and the zoom. We translate and
  // scale the media so the focal point sits mid-window, clamped so no edge shows, and
  // CSS glides between stops with a long ease-in-out.
  //  - Image tours cycle through their stops on a timer.
  //  - Video tours are scripted against the recording: each stop has a time `t` (s),
  //    and optionally a glide duration `d` (s), so the camera arrives on a control just
  //    as the recording moves it. At the end the clip dips out and restarts.
  const HOLD_MS = 1600;
  const TOUR_MS = 3400;
  const FADE_MS = 450;

  class Tour {
    constructor(el) {
      this.el = el;
      this.media = el.querySelector('video, img');
      this.video = this.media?.tagName === 'VIDEO' ? this.media : null;
      try {
        this.stops = JSON.parse(el.dataset.tour || '[]');
      } catch {
        this.stops = [];
      }
      this.i = 0;
      this.timer = 0;
      this.raf = 0;
      this.running = false;
      if (this.video) {
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.addEventListener('ended', () => this.restart());
      }
    }
    apply(stop, instant = false) {
      const m = this.media;
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      if (!w || !h || !stop) return;
      const rw = this.el.clientWidth / w; // visible window as a fraction of the media
      const rh = this.el.clientHeight / h;
      const s = Math.max(1, stop.s || 1);
      const tx = clamp(rw / 2 - stop.x * s, rw - s, 0);
      const ty = clamp(rh / 2 - stop.y * s, rh - s, 0);
      if (instant) m.style.transition = 'none';
      else m.style.transitionDuration = stop.d ? `${stop.d}s` : '';
      m.style.setProperty('--tx', `${(tx * 100).toFixed(3)}%`);
      m.style.setProperty('--ty', `${(ty * 100).toFixed(3)}%`);
      m.style.setProperty('--s', s.toFixed(3));
      if (instant) {
        void m.offsetWidth; // commit the jump before re-enabling the glide
        m.style.transition = '';
      }
    }
    // Index of the stop that owns the video's current time.
    stopAt(time) {
      let idx = 0;
      this.stops.forEach((s, i) => {
        if ((s.t ?? 0) <= time) idx = i;
      });
      return idx;
    }
    follow() {
      const idx = this.stopAt(this.video.currentTime);
      if (idx !== this.i) {
        this.i = idx;
        this.apply(this.stops[idx]);
      }
      this.raf = requestAnimationFrame(() => this.follow());
    }
    start() {
      if (this.running || reduceMotion) return;
      if (this.video) {
        this.running = true;
        this.video.play().catch(() => {});
        cancelAnimationFrame(this.raf);
        this.follow();
        return;
      }
      if (this.stops.length < 2) return;
      this.running = true;
      this.tick();
    }
    tick() {
      this.apply(this.stops[this.i]);
      this.i = (this.i + 1) % this.stops.length;
      this.timer = window.setTimeout(() => this.tick(), TOUR_MS + HOLD_MS);
    }
    stop() {
      this.running = false;
      window.clearTimeout(this.timer);
      cancelAnimationFrame(this.raf);
      this.video?.pause();
    }
    reset() {
      this.stop();
      this.i = 0;
      if (this.video) {
        this.el.classList.remove('is-dipped');
        try {
          this.video.currentTime = 0;
        } catch {
          /* not loaded yet */
        }
      }
      if (this.stops.length) this.apply(this.stops[0], true);
    }
    // Soft loop: dip to dark, rewind with the camera back on its first stop, fade up.
    restart() {
      if (!this.running) return;
      this.el.classList.add('is-dipped');
      window.setTimeout(() => {
        if (!this.running) return;
        this.video.currentTime = 0;
        this.i = 0;
        this.apply(this.stops[0], true);
        this.video.play().catch(() => {});
        this.el.classList.remove('is-dipped');
      }, FADE_MS);
    }
  }

  const tours = new Map();
  document.querySelectorAll('.tour').forEach((el) => {
    const t = new Tour(el);
    if (!t.media) return;
    tours.set(el, t);
    const place = () => t.stops.length && t.apply(t.stops[0], true);
    // Videos are laid out from their width/height attributes before any data loads
    // (preload="none" never fires loadedmetadata until played), so place them now.
    if (t.video || t.media.complete) place();
    else t.media.addEventListener('load', place, { once: true });
  });

  // Free-running tours play only while on screen; stage slides are driven by the stage.
  const tourIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const t = tours.get(e.target);
        if (!t) continue;
        if (e.isIntersecting) t.start();
        else t.stop();
      }
    },
    { threshold: 0.3 },
  );
  tours.forEach((t, el) => {
    if (!el.classList.contains('stage__slide')) tourIO.observe(el);
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() =>
      tours.forEach((t) => {
        if (!t.stops.length) return;
        const idx = t.video ? t.i : t.running ? (t.i - 1 + t.stops.length) % t.stops.length : 0;
        t.apply(t.stops[idx], true);
      }),
    );
  });

  // ── Hero: the screenshot tilts back and straightens as you scroll ──
  const heroShot = document.getElementById('hero-shot');
  if (heroShot && !reduceMotion) {
    let cur = 0;
    let target = 0;
    let raf = 0;
    const render = () => {
      cur += (target - cur) * 0.085; // critically-damped-ish follow: soft, no overshoot
      heroShot.style.setProperty('--tilt', `${(14 * (1 - cur)).toFixed(3)}deg`);
      heroShot.style.setProperty('--hs', (0.94 + 0.06 * cur).toFixed(4));
      raf = Math.abs(target - cur) > 0.0005 ? requestAnimationFrame(render) : 0;
    };
    const onScroll = () => {
      target = clamp(window.scrollY / (window.innerHeight * 0.55), 0, 1);
      if (!raf) raf = requestAnimationFrame(render);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── How it works: sticky stage follows the step in the middle of the viewport ──
  const steps = [...document.querySelectorAll('.step')];
  const slides = [...document.querySelectorAll('.stage__slide')];
  const bars = [...document.querySelectorAll('.stage__progress i')];
  const stageLabel = document.getElementById('stage-label');
  let activeStep = -1;
  const setStep = (idx) => {
    if (idx === activeStep) return;
    activeStep = idx;
    steps.forEach((s, i) => s.classList.toggle('is-active', i === idx));
    bars.forEach((b, i) => b.classList.toggle('is-done', i <= idx));
    slides.forEach((sl, i) => {
      const t = tours.get(sl);
      if (i === idx) {
        sl.classList.add('is-active');
        t?.reset();
        // On narrow screens the stage is hidden (steps carry inline copies): don't
        // play, or download, a clip nobody can see.
        const shown = () => sl.offsetParent !== null;
        window.setTimeout(() => sl.classList.contains('is-active') && shown() && t?.start(), 500);
      } else {
        sl.classList.remove('is-active');
        t?.stop();
      }
    });
    if (stageLabel && slides[idx]) {
      stageLabel.style.opacity = '0';
      window.setTimeout(() => {
        stageLabel.textContent = slides[idx].dataset.label || '';
        stageLabel.style.opacity = '1';
      }, 250);
    }
  };
  if (steps.length) {
    const stepIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number(e.target.dataset.step));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.forEach((s) => stepIO.observe(s));
    setStep(0);
  }

  // ── Visibility helper for the looping mocks ──
  const whileVisible = (el, onShow, onHide, threshold = 0.35) => {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? onShow : onHide)();
      },
      { threshold },
    ).observe(el);
  };

  // ── Collaboration: cursors drift between waypoints ──
  const collab = document.getElementById('collab');
  if (collab) {
    const cursors = [...collab.querySelectorAll('.cursor')].map((el, n) => {
      let path = [];
      try {
        path = JSON.parse(el.dataset.path || '[]');
      } catch {
        path = [];
      }
      const place = ([x, y]) => {
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
      };
      if (path[0]) place(path[0]);
      return { el, path, place, i: 0, offset: n * 900, timer: 0 };
    });
    if (!reduceMotion) {
      whileVisible(
        collab,
        () =>
          cursors.forEach((c) => {
            if (c.timer || c.path.length < 2) return;
            const move = () => {
              c.i = (c.i + 1) % c.path.length;
              c.place(c.path[c.i]);
            };
            c.timer = window.setTimeout(function loop() {
              move();
              c.timer = window.setTimeout(loop, 3000 + Math.random() * 900);
            }, c.offset);
          }),
        () =>
          cursors.forEach((c) => {
            window.clearTimeout(c.timer);
            c.timer = 0;
          }),
      );
    }
  }

  // ── Learning: an interactive ¹³C quiz ──
  // Real shifts of real compounds; every wrong answer explains what that peak is.
  // Peaks are clickable on the spectrum (mouse) and as buttons (keyboard / touch).
  // 2D structures (RDKit coordinates, Kekulé bonds): atoms [x, y, label], bonds [a, b, order].
  const MOLS = {"naproxen":{"atoms":[[-2.717,-0.429,""],[-2.14,-0.763,"O"],[-1.563,-0.43,""],[-1.562,0.237,""],[-0.984,0.569,""],[-0.407,0.236,""],[0.17,0.568,""],[0.747,0.235,""],[0.747,-0.432,""],[0.169,-0.765,""],[-0.408,-0.431,""],[-0.985,-0.764,""],[1.325,0.568,""],[1.325,1.234,""],[1.902,0.234,""],[1.901,-0.433,"O"],[2.48,0.567,"OH"]],"bonds":[[0,1,1],[1,2,1],[2,3,1],[3,4,2],[4,5,1],[5,6,2],[6,7,1],[7,8,2],[8,9,1],[9,10,2],[10,11,1],[7,12,1],[12,13,1],[12,14,1],[14,15,2],[14,16,1],[11,2,2],[10,5,1]]},"4-methylanisole":{"atoms":[[0.516,1.48,""],[-0.062,1.148,"O"],[-0.063,0.482,""],[-0.641,0.149,""],[-0.643,-0.517,""],[-0.066,-0.852,""],[-0.067,-1.518,""],[0.512,-0.52,""],[0.513,0.147,""]],"bonds":[[0,1,1],[1,2,1],[2,3,1],[3,4,2],[4,5,1],[5,6,1],[5,7,2],[7,8,1],[8,2,2]]},"5-oxohexanenitrile":{"atoms":[[1.588,0.33,""],[1.01,-0.002,""],[1.009,-0.669,"O"],[0.434,0.333,""],[-0.144,0.0,""],[-0.721,0.335,""],[-1.299,0.003,""],[-1.877,-0.33,"N"]],"bonds":[[0,1,1],[1,2,2],[1,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,3]]},"ethyl benzoate":{"atoms":[[-2.047,-0.038,""],[-1.468,-0.369,""],[-0.892,-0.034,"O"],[-0.314,-0.365,""],[-0.311,-1.031,"O"],[0.263,-0.029,""],[0.841,-0.361,""],[1.417,-0.025,""],[1.415,0.642,""],[0.836,0.973,""],[0.26,0.637,""]],"bonds":[[0,1,1],[1,2,1],[2,3,1],[3,4,2],[3,5,1],[5,6,2],[6,7,1],[7,8,2],[8,9,1],[9,10,2],[10,5,1]]}};

  const QUIZ = [
    {
      topic: 'Carbonyl carbons',
      q: 'Which peak belongs to the <b>C=O</b> carbon?',
      compound: 'naproxen',
      mol: MOLS['naproxen'],
      target: 14,
      answer: 178,
      right:
        'Carbonyl carbons are strongly deshielded: acids and esters sit around 165–185 ppm, ketones and aldehydes even further downfield, near 190–220 ppm.',
      peaks: [
        { ppm: 178, atoms: [14], h: 0.42, why: 'the carboxylic acid C=O' },
        { ppm: 134, atoms: [7], h: 0.8, why: 'an aromatic carbon (aromatic carbons appear at 110–160 ppm)' },
        { ppm: 121, atoms: [3], h: 0.95, why: 'an aromatic C–H carbon (110–160 ppm)' },
        { ppm: 55, atoms: [0], h: 0.7, why: 'the O–CH₃ carbon: sp³ carbons bonded to oxygen appear at 50–65 ppm' },
        { ppm: 18, atoms: [13], h: 0.6, why: 'an alkyl CH₃, in the most shielded region (10–30 ppm)' },
      ],
    },
    {
      topic: 'Carbons next to oxygen',
      q: 'Which peak is the <b>O–CH₃</b> (methoxy) carbon?',
      compound: '4-methylanisole',
      mol: MOLS['4-methylanisole'],
      target: 0,
      answer: 55,
      right: 'An sp³ carbon bonded directly to oxygen appears around 50–65 ppm; a methoxy group sits close to 55 ppm.',
      peaks: [
        { ppm: 158, atoms: [2], h: 0.4, why: 'the aromatic carbon carrying the OCH₃: pushed downfield by oxygen, but still aromatic' },
        { ppm: 130, atoms: [4, 7], h: 0.9, why: 'an aromatic C–H carbon' },
        { ppm: 114, atoms: [3, 8], h: 0.95, why: 'the aromatic C–H next to the OCH₃ group, shielded by the oxygen lone pairs' },
        { ppm: 55, atoms: [0], h: 0.75, why: 'the methoxy carbon' },
        { ppm: 20, atoms: [6], h: 0.7, why: 'the aryl CH₃, a plain alkyl carbon (10–30 ppm)' },
      ],
    },
    {
      topic: 'Triple bonds',
      q: 'Which peak is the nitrile <b>C≡N</b> carbon?',
      compound: '5-oxohexanenitrile',
      mol: MOLS['5-oxohexanenitrile'],
      target: 6,
      answer: 119,
      right:
        'Nitrile carbons appear at 115–125 ppm. That overlaps the aromatic region, so always check what else the spectrum contains.',
      peaks: [
        { ppm: 207, atoms: [1], h: 0.35, why: 'a ketone C=O: ketones and aldehydes appear at 190–220 ppm' },
        { ppm: 119, atoms: [6], h: 0.38, why: 'the nitrile carbon' },
        { ppm: 42, atoms: [3], h: 0.8, why: 'the CH₂ next to the ketone' },
        { ppm: 30, atoms: [0], h: 0.9, why: 'the CH₃ of the methyl ketone' },
        { ppm: 17, atoms: [5], h: 0.75, why: 'the CH₂ next to the nitrile, a shielded alkyl carbon' },
      ],
    },
    {
      topic: 'Alkyl carbons',
      q: 'Which peak is the <b>CH₃</b> of the ethyl group?',
      compound: 'ethyl benzoate',
      mol: MOLS['ethyl benzoate'],
      target: 0,
      answer: 14,
      right: 'Alkyl CH₃ carbons are the most shielded, typically 10–30 ppm. Here the ethyl CH₃ appears at 14 ppm.',
      peaks: [
        { ppm: 167, atoms: [3], h: 0.4, why: 'the ester C=O' },
        { ppm: 133, atoms: [8], h: 0.7, why: 'the aromatic C–H opposite the ester group' },
        { ppm: 128, atoms: [7, 9], h: 0.95, why: 'an aromatic C–H carbon' },
        { ppm: 61, atoms: [1], h: 0.75, why: 'the O–CH₂, pulled downfield by the neighbouring oxygen' },
        { ppm: 14, atoms: [0], h: 0.8, why: 'the ethyl CH₃' },
      ],
    },
  ];

  const lesson = document.getElementById('lesson');
  if (lesson) {
    const $ = (id) => document.getElementById(id);
    const topicEl = $('lesson-topic');
    const stepEl = $('lesson-step');
    const qEl = $('lesson-q');
    const compoundEl = $('lesson-compound');
    const spec = $('lesson-spec');
    const molSvg = $('lesson-mol');
    const optsEl = $('lesson-options');
    const feedback = $('lesson-feedback');
    const next = $('lesson-next');
    const scoreEl = $('lesson-score');
    const SVG = 'http://www.w3.org/2000/svg';
    // x axis runs 220 ppm (left) → 0 ppm (right), the NMR convention.
    const X0 = 22;
    const X1 = 378;
    const BASE = 120;
    const xOf = (ppm) => X0 + ((220 - ppm) / 220) * (X1 - X0);
    let qi = 0;
    let score = 0;
    let answered = false;

    const el = (name, attrs, parent) => {
      const n = document.createElementNS(SVG, name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      parent?.appendChild(n);
      return n;
    };

    // Skeletal structure: bonds, heteroatom labels, and a halo behind every atom that
    // the quiz lights up (the carbon in question, then right/wrong, then peak hovers).
    const drawMolecule = (q) => {
      const { atoms, bonds } = q.mol;
      molSvg.replaceChildren();
      const W = 400;
      const H = 130;
      const PAD = 20;
      // The panel is wide and short: lay a tall drawing on its side.
      const spanX = Math.max(...atoms.map((a) => a[0])) - Math.min(...atoms.map((a) => a[0]));
      const spanY = Math.max(...atoms.map((a) => a[1])) - Math.min(...atoms.map((a) => a[1]));
      const pos = spanY > spanX ? atoms.map(([x, y]) => [y, -x]) : atoms.map(([x, y]) => [x, y]);
      const xs = pos.map((a) => a[0]);
      const ys = pos.map((a) => a[1]);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      // px per coordinate unit; capped so a bond is never longer than ~30 px.
      const k = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 0.01), (H - 2 * PAD) / Math.max(maxY - minY, 0.01), 45);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const P = pos.map(([x, y]) => [W / 2 + (x - cx) * k, H / 2 + (y - cy) * k]);
      const nbrs = atoms.map(() => []);
      bonds.forEach(([a, b]) => {
        nbrs[a].push(b);
        nbrs[b].push(a);
      });

      // Halos are blurred discs: an SVG filter (CSS filters on SVG children don't render in Safari).
      const blur = el('filter', { id: 'lesson-glow', x: '-100%', y: '-100%', width: '300%', height: '300%' },
        el('defs', {}, molSvg));
      el('feGaussianBlur', { stdDeviation: 4 }, blur);
      const halos = el('g', { class: 'halos', filter: 'url(#lesson-glow)' }, molSvg);
      atoms.forEach((_, i) => el('circle', { cx: P[i][0], cy: P[i][1], r: 11, class: 'halo', 'data-a': i }, halos));

      const gB = el('g', { class: 'bonds' }, molSvg);
      const line = (x1, y1, x2, y2) => el('line', { x1, y1, x2, y2 }, gB);
      bonds.forEach(([a, b, order]) => {
        const [x1, y1] = P[a];
        const [x2, y2] = P[b];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const L = Math.hypot(dx, dy);
        const nx = -dy / L;
        const ny = dx / L;
        const off = (d, t = 0) =>
          line(x1 + dx * t + nx * d, y1 + dy * t + ny * d, x2 - dx * t + nx * d, y2 - dy * t + ny * d);
        if (order === 1) return line(x1, y1, x2, y2);
        if (order === 3) {
          line(x1, y1, x2, y2);
          off(3.4);
          off(-3.4);
          return;
        }
        // Double bond: if the neighbours lean to one side (a ring), draw the second line
        // inside, shortened; otherwise (C=O, open chain) draw a centred pair.
        let side = 0;
        for (const [p, other] of [[a, b], [b, a]])
          for (const n of nbrs[p]) if (n !== other) side += Math.sign((P[n][0] - x1) * nx + (P[n][1] - y1) * ny);
        if (side === 0) {
          off(2.3);
          off(-2.3);
        } else {
          line(x1, y1, x2, y2);
          off(Math.sign(side) * 4.6, 0.17);
        }
      });

      // A small crisp dot marks the exact vertex; the soft wash underneath only tints the area.
      const dots = el('g', { class: 'dots' }, molSvg);
      atoms.forEach(([, , label], i) => {
        if (!label) el('circle', { cx: P[i][0], cy: P[i][1], r: 2.6, class: 'halo', 'data-a': i }, dots);
      });

      const gL = el('g', { class: 'labels' }, molSvg);
      atoms.forEach(([, , label], i) => {
        if (!label) return;
        const w = 8 * label.length + 4;
        el('rect', { x: P[i][0] - w / 2, y: P[i][1] - 8, width: w, height: 16, rx: 5, class: 'label-bg' }, gL);
        el('text', { x: P[i][0], y: P[i][1] + 4, class: `label label--${label[0]}` }, gL).textContent = label;
      });
      markAtoms([q.target], 'is-target');
      molSvg.setAttribute('aria-label', `Structure of ${q.compound}, with the carbon in question highlighted`);
    };

    const markAtoms = (ids, cls) => {
      molSvg.querySelectorAll(`.halo.${cls}`).forEach((h) => h.classList.remove(cls));
      ids.forEach((i) => molSvg.querySelectorAll(`.halo[data-a="${i}"]`).forEach((h) => h.classList.add(cls)));
    };

    const drawSpectrum = (q) => {
      spec.replaceChildren();
      el('line', { x1: 14, y1: BASE, x2: 386, y2: BASE, class: 'axis' }, spec);
      for (const t of [200, 150, 100, 50, 0]) {
        el('line', { x1: xOf(t), y1: BASE, x2: xOf(t), y2: BASE + 4, class: 'axis' }, spec);
        el('text', { x: xOf(t), y: BASE + 18, class: 'tick' }, spec).textContent = String(t);
      }
      el('text', { x: 386, y: BASE + 30, class: 'tick tick--unit' }, spec).textContent = 'ppm';
      let prevX = -Infinity;
      let prevLabelY = Infinity;
      q.peaks.forEach((p, i) => {
        const g = el('g', { class: 'peak' }, spec);
        const x = xOf(p.ppm);
        const top = BASE - 8 - p.h * 88;
        // Neighbouring peaks closer than a label's width: lift this label above the last one.
        let labelY = top - 6;
        if (x - prevX < 18) labelY = Math.min(labelY, prevLabelY - 12);
        prevX = x;
        prevLabelY = labelY;
        el('rect', { x: x - 11, y: 4, width: 22, height: BASE - 2, class: 'hit' }, g);
        el('line', { x1: x, y1: BASE, x2: x, y2: top, class: 'stick' }, g);
        el('text', { x, y: labelY, class: 'val' }, g).textContent = String(p.ppm);
        g.addEventListener('click', () => choose(i));
        // After answering, pointing at any peak shows which atom(s) it comes from.
        g.addEventListener('mouseenter', () => answered && markAtoms(p.atoms, 'is-hover'));
        g.addEventListener('mouseleave', () => markAtoms([], 'is-hover'));
      });
      spec.setAttribute('aria-label', `¹³C spectrum with peaks at ${q.peaks.map((p) => p.ppm).join(', ')} ppm`);
    };

    const render = () => {
      const q = QUIZ[qi];
      answered = false;
      lesson.classList.remove('is-done', 'is-answered');
      topicEl.textContent = `Try it · ${q.topic}`;
      stepEl.textContent = `${qi + 1} / ${QUIZ.length}`;
      qEl.innerHTML = q.q;
      compoundEl.textContent = `Compound: ${q.compound}`;
      compoundEl.hidden = false;
      molSvg.toggleAttribute('hidden', false);
      drawMolecule(q);
      drawSpectrum(q);
      optsEl.replaceChildren(
        ...q.peaks.map((p, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'opt';
          b.textContent = `${p.ppm} ppm`;
          b.addEventListener('click', () => choose(i));
          return b;
        }),
      );
      optsEl.hidden = false;
      spec.toggleAttribute('hidden', false); // SVG has no .hidden property
      feedback.className = 'lesson__feedback';
      feedback.textContent = 'Pick a peak on the spectrum or a value below.';
      scoreEl.textContent = qi ? `Score: ${score} / ${qi}` : '';
      next.hidden = true;
    };

    const choose = (i) => {
      if (answered) return;
      answered = true;
      lesson.classList.add('is-answered');
      const q = QUIZ[qi];
      const picked = q.peaks[i];
      const correct = picked.ppm === q.answer;
      if (correct) score++;
      const buttons = [...optsEl.children];
      const peaks = [...spec.querySelectorAll('.peak')];
      q.peaks.forEach((p, k) => {
        const state = p.ppm === q.answer ? 'is-right' : k === i ? 'is-wrong' : 'is-dim';
        buttons[k].classList.add(state);
        buttons[k].disabled = true;
        peaks[k].classList.add(state);
      });
      markAtoms([], 'is-target');
      markAtoms(q.peaks.find((p) => p.ppm === q.answer).atoms, 'is-right');
      if (!correct) markAtoms(picked.atoms, 'is-wrong');
      feedback.className = `lesson__feedback ${correct ? 'is-good' : 'is-bad'}`;
      feedback.innerHTML = correct
        ? `<b>✓ Right.</b> ${q.right}`
        : `<b>✗ Not quite.</b> ${picked.ppm} ppm is ${picked.why} (red on the structure). The answer is ${q.answer} ppm. ${q.right}`;
      scoreEl.textContent = `Score: ${score} / ${qi + 1}`;
      next.textContent = qi + 1 < QUIZ.length ? 'Next question →' : 'See your score →';
      next.hidden = false;
      next.focus({ preventScroll: true });
    };

    const finish = () => {
      lesson.classList.add('is-done');
      topicEl.textContent = 'Try it · Your result';
      stepEl.textContent = '';
      qEl.innerHTML = `You scored <b>${score} / ${QUIZ.length}</b>`;
      compoundEl.hidden = true;
      molSvg.toggleAttribute('hidden', true);
      spec.toggleAttribute('hidden', true);
      optsEl.hidden = true;
      feedback.className = 'lesson__feedback is-good';
      feedback.textContent =
        score === QUIZ.length
          ? 'Every carbon in the right place. Learning mode takes it further: full spectra and whole structures, one reasoning step at a time.'
          : 'Chemical shifts take practice. Learning mode walks you through full spectra and whole structures, one reasoning step at a time.';
      scoreEl.textContent = '';
      next.textContent = 'Try again ↺';
      next.hidden = false;
    };

    next.addEventListener('click', () => {
      if (lesson.classList.contains('is-done')) {
        qi = 0;
        score = 0;
        render();
      } else if (qi + 1 < QUIZ.length) {
        qi++;
        render();
      } else finish();
    });

    render();
  }

  // ── Lightbox: FLIP zoom from the on-page frame to a fitted full view ──
  const lightbox = document.getElementById('lightbox');
  let lbImg = null;
  let fromRect = null;
  const fitRect = (nw, nh) => {
    const maxW = window.innerWidth * 0.94;
    const maxH = window.innerHeight * 0.9;
    const k = Math.min(maxW / nw, maxH / nh, 1.6);
    const w = nw * k;
    const h = nh * k;
    return { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, width: w, height: h };
  };
  const transformFor = (r, to) =>
    `translate(${r.left}px, ${r.top}px) scale(${r.width / to.width})`;

  const openLightbox = (img) => {
    if (lbImg) return;
    const box = img.closest('.tour, .collab__canvas, figure') || img;
    fromRect = box.getBoundingClientRect();
    const isVideo = img.tagName === 'VIDEO';
    const nw = (isVideo ? img.videoWidth : img.naturalWidth) || img.width;
    const nh = (isVideo ? img.videoHeight : img.naturalHeight) || img.height;
    const to = fitRect(nw, nh);
    if (isVideo) {
      // Continue the clip from where the page's copy is, full size and looping.
      lbImg = document.createElement('video');
      lbImg.muted = true;
      lbImg.playsInline = true;
      lbImg.loop = true;
      lbImg.src = img.currentSrc || img.src;
      lbImg.poster = img.poster;
      lbImg.currentTime = img.currentTime || 0;
      if (!reduceMotion) lbImg.play().catch(() => {});
    } else {
      lbImg = document.createElement('img');
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt;
    }
    lbImg.style.width = `${to.width}px`;
    lbImg.style.height = `${to.height}px`;
    lbImg.style.transition = 'none';
    lbImg.style.transform = transformFor(fromRect, to);
    lightbox.appendChild(lbImg);
    lightbox.setAttribute('aria-hidden', 'false');
    void lbImg.offsetWidth;
    lbImg.style.transition = reduceMotion ? 'none' : '';
    lightbox.classList.add('is-open');
    lbImg.style.transform = `translate(${to.left}px, ${to.top}px) scale(1)`;
    lbImg.dataset.w = String(to.width);
  };
  const closeLightbox = () => {
    if (!lbImg) return;
    const img = lbImg;
    lbImg = null;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    img.style.transform = transformFor(fromRect, { width: Number(img.dataset.w) });
    const done = () => img.remove();
    if (reduceMotion) done();
    else {
      img.addEventListener('transitionend', done, { once: true });
      window.setTimeout(done, 900);
    }
  };
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const img = target?.closest('[data-zoom]');
    if (img && !lbImg) {
      e.preventDefault();
      openLightbox(img);
    } else if (lbImg && lightbox.contains(target)) {
      closeLightbox();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
  window.addEventListener('scroll', () => lbImg && closeLightbox(), { passive: true });
})();
