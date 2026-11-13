// Model Lab, step 12. Ported from the approved design draft docs/design/AirLabStep12.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { ICON_PAUSE, ICON_PLAY, ICON_RESET, ICON_STEP, css, el, fitExact, fmt, num, onTheme, rowCol, sigmoid, zapply, zfit } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="sk" style="height:384px;border-radius:14px"></div></section>
      <section class="card"><div class="split"><div class="sk" style="height:360px;border-radius:14px"></div><div class="sk" style="height:360px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 12 of 17</span>
      <h2 id="st">Feature scaling</h2>
      <p class="goal">The air ceiling runs into the thousands of metres while rain is a few millimetres, so no single learning rate suits them all as they are. Step 11 quietly raced on scaled inputs; here is why. Put every input on the same scale first, and training gets far faster.</p>
      <figure class="plot"><div class="phead"><b>Every input on one ruler</b><div class="seg" role="group" aria-label="Values shown" id="vseg"><button class="on" data-s="raw" type="button">Raw values</button><button data-s="z" type="button">Scaled</button></div></div>
   <div class="pbox"><svg id="strip" viewBox="0 0 1060 384" width="100%" role="img" aria-label="Values of five inputs on one shared axis"></svg></div>
   <figcaption class="note" id="snote"></figcaption></figure>
  <div class="two" style="margin-top:18px"><div class="box"><h3>One day, scaled</h3><table class="zt" id="zt"></table></div>
   <div class="box"><h3>How each input is scaled</h3><p class="zf">scaled = (value − mean) / spread</p>
    <p class="small" id="zexp"></p>
    <p class="small"><b>Keep them.</b> Tomorrow's forecast must be scaled with these same numbers, which is why the live model saves them next to its weights.</p></div></div>
    </section>
    <section class="card" aria-labelledby="st2"><h2 id="st2" style="margin-top:0">Train both and compare</h2>
  <p class="goal">Same days, same start, same gradient descent. Raw inputs use the largest α they survive (<span id="araw"></span>); scaled inputs can take a far bigger one.</p>
  <div class="player" role="group" aria-label="Training controls">
   <div class="prow"><button id="play" class="play" type="button" aria-label="Start training">${ICON_PLAY}</button>
    <button id="step" class="ibtn" type="button" aria-label="One step">${ICON_STEP}<span>Step</span></button>
    <button id="reset" class="ibtn" type="button" aria-label="Reset, back to the start">${ICON_RESET}<span>Reset</span></button>
    <div class="scrub"><input id="scrub" type="range" min="0" max="1000" value="0" aria-label="Step in the training"><div class="slab"><span>step <b id="sk">0</b> of <b id="sn">1,000</b></span></div></div>
    <div class="opt"><span>Steps</span><div class="seg" role="group" aria-label="Number of steps" id="iters"><button data-n="100" type="button">100</button><button class="on" data-n="1000" type="button">1,000</button><button data-n="5000" type="button">5,000</button></div></div></div>
   <div class="prow"><div class="opt"><span>α for scaled</span><div class="seg alph" role="group" aria-label="Learning rate for scaled inputs" id="aseg"><button data-a="0.1" type="button">0.1 <em>slow</em></button><button class="on" data-a="0.5" type="button">0.5 <em>good</em></button><button data-a="3" type="button">3 <em>fast</em></button><button data-a="20" type="button">20 <em>too big</em></button></div></div>
    <p class="anote" id="anote"></p><span class="sandbox">Sandbox: the live model is not changed.</span></div></div>
  <div class="two"><figure class="plot"><div class="phead"><b>Cost after each step</b></div>
    <div class="pbox"><svg id="cost" viewBox="0 0 520 360" width="100%" role="img" aria-label="Cost after each step, raw against scaled"></svg></div>
    <figcaption class="note">Both axes are on a log scale. The dashed line is the best possible cost, the same for both: scaling changes how fast you get there, not where.</figcaption></figure>
   <div class="race"><div class="rc" id="rcS"></div><div class="rc" id="rcR"></div><p class="small" id="verdict"></p></div></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>Subtract the training average, divide by the training spread.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>Measuring them on later days would leak the future into the model.</p></div>`;

export const skHtml = '';

const FEAT = [
  ['pm2_5_mean', 'PM2.5 today', 'μg/m³'],
  ['wx_blh', 'Air ceiling tomorrow', 'metres'],
  ['wx_wind', 'Wind tomorrow', 'km/h'],
  ['wx_temp', 'Temperature tomorrow', '°C'],
  ['wx_precip', 'Rain tomorrow', 'mm'],
];
const ANOTE = {
  0.1: 'Slow: safe, but it takes about 900 steps to get within 1% of the best.',
  0.5: "Good: the project's own step size, within 1% of the best in under 200 steps.",
  3: 'Fast: within 1% of the best in a few dozen steps.',
  20: 'Too big: past the limit for scaled inputs too, so the cost goes up on some steps. Scaling raises the limit; it does not remove it.',
};

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { setTimeout, requestAnimationFrame, cancelAnimationFrame, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  const ssv = $('strip'),
    csv = $('cost');
  const n = FEAT.length;
  const J0 = Math.log(2);
  let RAW = null,
    ZS = null,
    Yv = null,
    m = 0,
    mu = [],
    sd = [],
    mode = 'raw',
    anim = 1,
    from = 'raw',
    N = 1000,
    k = 0,
    playing = false,
    timer = 0,
    aS = 0.5,
    aR = 0,
    Jmin = 0,
    live = true,
    animId = 0,
    zday = 0;
  const Rr = {},
    Sr = {},
    sample = [];
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };
  const clamp = (v, a, c) => Math.max(a, Math.min(c, v)),
    fz = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  function Jf(X, w, b) {
    let s = 0;
    for (let i = 0; i < m; i++) {
      let z = b;
      const o = i * n;
      for (let j = 0; j < n; j++) z += X[o + j] * w[j];
      s += Yv[i] ? (z > 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z))) : z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
    }
    return s / m;
  }
  function descend(X, a, steps) {
    const w = new Float64Array(n);
    let b = 0;
    const J = [J0];
    let hit = 0,
      up = 0;
    for (let it = 0; it < steps; it++) {
      const g = new Float64Array(n);
      let gb = 0;
      for (let i = 0; i < m; i++) {
        let z = b;
        const o = i * n;
        for (let j = 0; j < n; j++) z += X[o + j] * w[j];
        const e = sigmoid(z) - Yv[i];
        for (let j = 0; j < n; j++) g[j] += e * X[o + j];
        gb += e;
      }
      for (let j = 0; j < n; j++) w[j] -= (a * g[j]) / m;
      b -= (a * gb) / m;
      const c = Jf(X, w, b);
      if (!up && c > J[J.length - 1] + 1e-12) up = it + 1;
      J.push(c);
      if (!hit && c < Jmin * 1.01) hit = it + 1;
    }
    return { J, hit, up };
  }
  function runAll() {
    Object.assign(Rr, descend(RAW, aR, N));
    Object.assign(Sr, descend(ZS, aS, N));
    $('scrub').max = N;
    $('sn').textContent = num(N);
  }
  const SL = 200,
    SR = 1030,
    ROW = 62,
    TOP = 26;
  const axis = (mo) => (mo === 'raw' ? { lo: 0, hi: 3000, ticks: [0, 500, 1000, 1500, 2000, 2500, 3000] } : { lo: -3, hi: 6, ticks: [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6] });
  const sx = (v, ax) => SL + ((clamp(v, ax.lo, ax.hi) - ax.lo) / (ax.hi - ax.lo)) * (SR - SL);
  function jit(i, j) {
    const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function drawStrip() {
    ssv.innerHTML = '';
    const a0 = axis(from),
      a1 = axis(mode),
      e = anim < 1 ? anim * anim * (3 - 2 * anim) : 1,
      ax = { lo: a0.lo + (a1.lo - a0.lo) * e, hi: a0.hi + (a1.hi - a0.hi) * e };
    axis(mode).ticks.forEach((t) => {
      const x = sx(t, ax);
      el(ssv, 'line', { x1: x, x2: x, y1: TOP - 8, y2: TOP + n * ROW - 6, stroke: t === 0 && mode === 'z' ? css('--mut') : css('--rule') });
      el(ssv, 'text', { x, y: TOP + n * ROW + 12, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut'), opacity: e }, num(t));
    });
    el(ssv, 'text', { x: (SL + SR) / 2, y: TOP + n * ROW + 32, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, mode === 'raw' ? 'Value in its own unit' : 'Scaled value: spreads from the mean');
    for (let j = 0; j < n; j++) {
      const yc = TOP + j * ROW + ROW / 2 - 6;
      el(ssv, 'text', { x: 0, y: yc - 2, 'font-size': 14, 'font-weight': 600, fill: css('--ink') }, FEAT[j][1]);
      el(ssv, 'text', { x: 0, y: yc + 15, 'font-size': 12, fill: css('--mut') }, mode === 'raw' ? FEAT[j][2] : 'mean 0, spread 1');
      const g = el(ssv, 'g', { fill: css('--ac'), 'fill-opacity': 0.35 });
      sample.forEach((i) => {
        const v = RAW[i * n + j],
          z = ZS[i * n + j],
          p0 = from === 'raw' ? v : z,
          p1 = mode === 'raw' ? v : z;
        el(g, 'circle', { cx: sx(p0 + (p1 - p0) * e, ax).toFixed(1), cy: (yc + (jit(i, j) - 0.5) * 34).toFixed(1), r: 2.4 });
      });
      const m0 = from === 'raw' ? mu[j] : 0,
        m1 = mode === 'raw' ? mu[j] : 0,
        mx = sx(m0 + (m1 - m0) * e, ax);
      el(ssv, 'line', { x1: mx, x2: mx, y1: yc - 21, y2: yc + 21, stroke: css('--ink'), 'stroke-width': 2.5 });
    }
    $('snote').textContent =
      mode === 'raw'
        ? `Each dot is a training day (every 20th of the ${num(m)}); the dark tick is the mean. On one ruler the air ceiling spreads over thousands of metres while PM2.5, wind, temperature and rain are squeezed near zero. A step that suits the air ceiling is far too big for the others, and one that suits them barely moves it.`
        : 'The same days after scaling. Every input is centered at 0 with a spread of 1, so one step size suits all five. Very rainy and very dusty days sit at the right edge.';
  }
  function animate() {
    from = mode === 'raw' ? 'z' : 'raw';
    anim = 0;
    const t0 = performance.now(),
      f = (t) => {
        anim = Math.min(1, (t - t0) / 650);
        drawStrip();
        if (anim < 1) animId = requestAnimationFrame(f);
      };
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(f);
  }
  function drawZ(i) {
    $('zt').innerHTML =
      '<tr><th>Input</th><th>That day</th><th>(value − mean) / spread</th><th style="text-align:right">Scaled</th></tr>' +
      FEAT.map((f, j) => {
        const v = RAW[i * n + j];
        return `<tr><td>${f[1]}</td><td>${fmt(v, 1)}</td><td>(${fmt(v, 1)} − ${fmt(mu[j], 1)}) / ${fmt(sd[j], 1)}</td><td class="z">${fz((v - mu[j]) / sd[j])}</td></tr>`;
      }).join('');
  }
  const L = 56,
    RR = 500,
    T = 16,
    B = 304;
  function drawCost() {
    csv.innerHTML = '';
    const top = J0 * 1.15,
      bot = Jmin * 0.96,
      X = (i) => L + (Math.log10(i + 1) / Math.log10(N + 1)) * (RR - L),
      Y = (v) => B - (Math.log(clamp(v, bot, top) / bot) / Math.log(top / bot)) * (B - T);
    [0.2, 0.3, 0.4, 0.5, 0.7].forEach((v) => {
      el(csv, 'line', { x1: L, x2: RR, y1: Y(v), y2: Y(v), stroke: css('--rule') });
      el(csv, 'text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: css('--mut') }, v);
    });
    [0, 1, 10, 100, 1000, 10000]
      .filter((v) => v <= N)
      .forEach((v) => {
        el(csv, 'line', { x1: X(v), x2: X(v), y1: T, y2: B, stroke: css('--rule') });
        el(csv, 'text', { x: X(v), y: B + 18, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut') }, num(v));
      });
    el(csv, 'line', { x1: L, x2: RR, y1: Y(Jmin), y2: Y(Jmin), stroke: css('--ink'), 'stroke-dasharray': '4 4', opacity: 0.6 });
    el(csv, 'text', { x: L + 6, y: Y(Jmin) + 16, 'font-size': 11, fill: css('--mut') }, 'best possible ' + Jmin.toFixed(4));
    el(csv, 'text', { x: (L + RR) / 2, y: B + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'Step (log scale)');
    el(csv, 'text', { x: 14, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + B) / 2})` }, 'Cost J (log scale)');
    [
      [Rr, '--cr', 'raw'],
      [Sr, '--cs', 'scaled'],
    ].forEach(([run, c, name]) => {
      const end = Math.min(k, run.J.length - 1);
      let d = '';
      for (let i = 0; i <= end; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(run.J[i]).toFixed(1);
      el(csv, 'path', { d, fill: 'none', stroke: css(c), 'stroke-width': 2.6, 'stroke-linejoin': 'round' });
      const x = X(end),
        y = Y(run.J[end]);
      el(csv, 'circle', { cx: x, cy: y, r: 4.5, fill: css(c) });
      el(csv, 'text', { x: Math.min(x + 8, RR - 50), y: y - 10, 'font-size': 12, 'font-weight': 600, fill: css(c) }, name);
    });
  }
  function card(id, run, name, a, c) {
    const end = Math.min(k, run.J.length - 1),
      J = run.J[end],
      gap = (J / Jmin - 1) * 100,
      wentUp = run.up && k >= run.up;
    const s =
      k === 0
        ? 'Not started.'
        : wentUp
          ? 'Cost went up at step ' + run.up + '; now ' + gap.toFixed(gap < 10 ? 1 : 0) + '% above the best.'
          : run.hit && k >= run.hit
            ? 'Within 1% of the best since step ' + num(run.hit) + '.'
            : gap.toFixed(gap < 10 ? 1 : 0) + '% above the best.';
    const bw = clamp((Math.log(J / Jmin) / Math.log(J0 / Jmin)) * 100, 0, 100),
      box = $(id);
    box.style.setProperty('--c', css(c));
    box.innerHTML = `<div class="rt"><b>${name}</b><span>α = ${a}</span></div><div class="n">${J.toFixed(4)}</div><div class="s">${s}</div><div class="bar"><i style="width:${bw}%"></i></div>`;
  }
  function render() {
    drawCost();
    card('rcS', Sr, 'Scaled', aS, '--cs');
    card('rcR', Rr, 'Raw', aR, '--cr');
    $('scrub').value = k;
    $('sk').textContent = num(k);
    $('anote').textContent = ANOTE[aS];
    $('verdict').innerHTML = Sr.up
      ? 'Scaled inputs also have a limit: with this α the cost goes up on some steps. Pick a smaller α for them.'
      : Sr.hit
        ? `<b>Scaled</b> gets within 1% of the best cost in <b>${num(Sr.hit)}</b> steps. <b>Raw</b> ${Rr.hit ? 'needs <b>' + num(Rr.hit) + '</b>, about ' + Math.round(Rr.hit / Sr.hit) + ' times as many.' : 'is still not within 1% after <b>' + num(N) + '</b>.'}`
        : `Neither run is within 1% of the best after ${num(N)} steps. Try more steps or a larger α.`;
  }
  function setPlay(v) {
    playing = v;
    $('play').innerHTML = v ? ICON_PAUSE : ICON_PLAY;
  }
  function stop() {
    cancelAnimationFrame(timer);
    setPlay(false);
  }
  let lastT = 0;
  function tick(ts) {
    if (!playing) return;
    if (ts && ts - lastT < 33) {
      timer = requestAnimationFrame(tick);
      return;
    }
    lastT = ts || 0;
    k = Math.min(N, k + (k < 30 ? 1 : Math.max(1, Math.round(N / 120))));
    render();
    if (k >= N) {
      setPlay(false);
      return;
    }
    timer = requestAnimationFrame(tick);
  }
  on($('play'), 'click', () => {
    if (!RAW) return;
    if (playing) {
      stop();
      return;
    }
    if (k >= N) k = 0;
    setPlay(true);
    tick();
  });
  on($('step'), 'click', () => {
    if (!RAW) return;
    stop();
    k = Math.min(N, k + 1);
    render();
  });
  on($('reset'), 'click', () => {
    if (!RAW) return;
    stop();
    k = 0;
    render();
  });
  on($('scrub'), 'input', (e) => {
    if (!RAW) return;
    stop();
    k = +e.target.value;
    render();
  });
  const q = (sel) => document.querySelectorAll('#main ' + sel);
  q('#vseg button').forEach((b) =>
    on(b, 'click', () => {
      if (!RAW || b.dataset.s === mode) return;
      mode = b.dataset.s;
      q('#vseg button').forEach((x) => x.classList.toggle('on', x === b));
      animate();
    }),
  );
  q('#iters button').forEach((x) =>
    on(x, 'click', () => {
      if (!RAW) return;
      N = +x.dataset.n;
      q('#iters button').forEach((y) => y.classList.toggle('on', y === x));
      stop();
      runAll();
      k = Math.min(k, N);
      render();
    }),
  );
  q('#aseg button').forEach((x) =>
    on(x, 'click', () => {
      if (!RAW) return;
      aS = +x.dataset.a;
      q('#aseg button').forEach((y) => y.classList.toggle('on', y === x));
      stop();
      Object.assign(Sr, descend(ZS, aS, N));
      render();
    }),
  );
  off.push(
    onTheme(() => {
      if (RAW) {
        drawStrip();
        render();
      }
    }),
  );
  katex.render('z_j=\\frac{x_j-\\mu_j}{\\sigma_j}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('\\mu_j,\\ \\sigma_j\\ \\text{from training days only}', $('m2'), { throwOnError: false, displayMode: true });

  ctx.load('lab-rows').then((Rw) => {
    if (!live) return;
    // Two runs of up to 5,000 steps over every day: let the skeleton paint first, then compute.
    setTimeout(() => {
      const d = Rw.train,
        X = d.rows.map((r) => FEAT.map((f) => r[d.cols.indexOf(f[0])]));
      Yv = rowCol(d, 'y');
      m = X.length;
      const s = zfit(X);
      mu = s.mu;
      sd = s.sd;
      const rawA = new Float64Array(m * n),
        zs = new Float64Array(m * n);
      X.forEach((r, i) =>
        r.forEach((v, j) => {
          rawA[i * n + j] = v;
          zs[i * n + j] = (v - mu[j]) / sd[j];
        }),
      );
      for (let i = 0; i < m; i += 20) sample.push(i);
      const best = fitExact(zapply(X, s), Yv, 0);
      RAW = rawA;
      ZS = zs;
      Jmin = Jf(ZS, Float64Array.from(best.w), best.b);
      // the largest raw step size whose cost never goes up in 300 steps
      for (const a of [1e-3, 5e-4, 2e-4, 1e-4, 5e-5, 2e-5, 1e-5, 5e-6, 2e-6, 1e-6])
        if (!descend(RAW, a, 300).up) {
          aR = a;
          break;
        }
      $('araw').textContent = aR;
      $('zexp').textContent = `The mean and spread (standard deviation) come from the ${num(m)} training days. Subtracting the mean centers each input at 0; dividing by the spread makes a typical value lie between −1 and 1.`;
      const day = d.rows.findIndex((r) => r[d.cols.indexOf('wx_precip')] > 2 && r[d.cols.indexOf('pm2_5_mean')] > 30);
      zday = day >= 0 ? day : 7;
      drawZ(zday);
      runAll();
      const main = $('main');
      main.classList.remove('skel');
      main.setAttribute('aria-busy', 'false');
      drawStrip();
      render();
    }, 0);
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
