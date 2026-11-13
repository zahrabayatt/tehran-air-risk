// Model Lab, step 9. Ported from the approved design draft docs/design/AirLabStep9.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { ICON_PAUSE, ICON_PLAY, ICON_RESET, ICON_STEP, css, el, fitExact, num, onTheme, rng, rowCol, sigmoid, svgPoint } from '../kit.js';
import { LabBowl } from '../bowl.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 9 of 17</span>
      <h2 id="st">Gradient descent</h2>
      <p class="goal">Take a small step downhill, recompute the slope, repeat. Drag the start on the bowl, choose a step size, and press play: the curve, the path and the cost all move together.</p>
      <div class="player" role="group" aria-label="Training controls">
   <div class="prow"><button id="play" class="play" type="button" aria-label="Start training">${ICON_PLAY}</button>
    <button id="step" class="ibtn" type="button" aria-label="One step">${ICON_STEP}<span>Step</span></button>
    <button id="reset" class="ibtn" type="button" aria-label="Reset, back to the start">${ICON_RESET}<span>Reset</span></button>
    <div class="scrub"><input id="scrub" type="range" min="0" max="300" value="0" aria-label="Step in the training"><div class="slab"><span>step <b id="sk">0</b> of <b id="sn">300</b></span><span id="conv"></span></div></div></div>
   <div class="prow"><div class="opt"><span>Learning rate α</span><div class="seg" role="group" aria-label="Learning rate" id="aseg"><button data-a="0.1" type="button">0.1</button><button data-a="1" type="button">1</button><button class="on" data-a="3" type="button">3</button><button data-a="20" type="button">20</button><button data-a="custom" type="button">Custom</button></div>
     <span class="custom hidden2"><input id="a" type="range" min="0" max="1" step="0.001" aria-label="Custom learning rate"><b id="av"></b></span></div>
    <div class="opt"><span>Steps</span><div class="seg" role="group" aria-label="Number of steps" id="iters"><button data-n="100" type="button">100</button><button class="on" data-n="300" type="button">300</button><button data-n="1000" type="button">1,000</button></div></div>
    <span class="sandbox">Sandbox: the live model is not changed</span></div></div>
  <div class="two"><figure class="plot"><div class="phead"><b>The curve, as it learns</b></div>
    <div class="pbox"><canvas id="dots" aria-hidden="true"></canvas><svg id="plot" viewBox="0 0 520 380" width="100%" role="img" aria-label="Training days and the current curve"></svg><div class="hud" id="hudbox"><span>step</span><b id="hS"></b><span>w</span><b id="hW"></b><span>b</span><b id="hB"></b><span>cost</span><b class="jv" id="hJ"></b></div></div>
    <figcaption class="note">Each dot is a training day, at 1 if tomorrow was unhealthy and 0 if not. Faint curves are where the curve was a few steps ago.</figcaption></figure>
   <figure class="plot"><div class="phead"><b>Down the bowl</b><div class="seg" role="group" aria-label="Bowl view" id="bview"><button class="on" data-v="bowl" type="button">3D bowl</button><button data-v="map" type="button">Top view</button><button data-v="curve" type="button">Cost by w</button></div></div>
    <div class="pbox"><canvas id="heat" aria-hidden="true"></canvas><svg id="cost" viewBox="0 0 520 380" width="100%" role="img" aria-label="The cost bowl with the path of gradient descent"></svg></div>
    <figcaption class="note" id="pnote2"></figcaption></figure></div>
  <figure class="plot" style="margin-top:18px"><div class="phead"><b>Cost after each step</b></div>
   <div class="pbox"><svg id="hist" viewBox="0 0 1060 190" width="100%" role="img" aria-label="Cost after each step"></svg></div>
   <figcaption class="note">Cost is on a log scale above the best possible cost, so small changes near the bottom stay visible. The number at the tip is the current cost, and in brackets its change from the step before.</figcaption></figure>
  <div class="meter" aria-live="polite"><div class="box"><h3>Where it stands</h3><p id="status" style="margin:0;font-size:15px;line-height:1.55"></p></div>
   <div class="box"><h3>The last update</h3><div class="formula" id="f"></div></div></div>
  <div class="chips" role="group" aria-label="Presets"><span class="try">Try:</span><button class="chip" data-p="good" type="button">A good step size</button><button class="chip" data-p="small" type="button">Too small</button><button class="chip" data-p="big" type="button">Too large</button></div>
  <p class="pnote" id="pnote"></p>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>Subtract the slope, because the slope points uphill. α sets how big each step is.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>Both slopes are computed from the old w and b before either changes. Near the bottom the slopes shrink, so the steps shrink too, even with the same α.</p></div>`;

export const skHtml = '';

const WR = [-3, 6],
  BR = [-8, 3];
const PRE = {
  good: [3, 'A good step size: big enough to get there in a few hundred steps, small enough to stay steady. The path drops into the valley, then slides along it to the bottom.'],
  small: [0.1, 'Too small: every step is tiny, so after hundreds of steps the curve has barely moved and the cost is still high.'],
  big: [20, 'Too large: each step overshoots the bottom and lands on the far side of the valley. The path zigzags, and after 300 steps the cost is still well above the best possible.'],
};
const PNOTES = {
  bowl: 'The path in 3D, running down the surface of the bowl. Drag the hollow start dot to choose where to begin; drag anywhere else to turn the bowl. Each small dot is one step.',
  map: 'The same path seen from above: each small dot is one step, the cross is the bottom. Drag the hollow dot to choose where to start.',
  curve: 'A slice through the bowl at the current b, with the current w on it. As b changes during training, the slice changes with it.',
};

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { requestAnimationFrame, cancelAnimationFrame, win, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  const svg = $('plot'),
    csv = $('cost'),
    hsv = $('hist'),
    cv = $('dots'),
    hv = $('heat');
  const L = 52,
    R = 505,
    T = 14,
    B = 330,
    XM = 150,
    CB = 330;
  const fx = (x) => L + (Math.min(x, XM) / XM) * (R - L),
    fy = (p) => B - p * (B - T) * 0.92 - 12;
  const gw = (v) => L + ((v - WR[0]) / (WR[1] - WR[0])) * (R - L),
    gb = (v) => CB - ((v - BR[0]) / (BR[1] - BR[0])) * (CB - T),
    igw = (X) => WR[0] + ((X - L) / (R - L)) * (WR[1] - WR[0]),
    igb = (Y) => BR[0] + ((CB - Y) / (CB - T)) * (BR[1] - BR[0]);
  let G = [],
    m = 0,
    MU = 0,
    SD = 1,
    PM = [],
    Y = [],
    conv = -1,
    Jmin = 0,
    wBest = 0,
    bBest = 0,
    w0 = 0,
    b0 = 0,
    alpha = 3,
    N = 300,
    hist = [],
    k = 0,
    playing = false,
    timer = 0,
    dragging = false,
    stopped = '',
    live = true;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };
  const all = (sel) => Array.from(document.querySelectorAll('#main ' + sel));
  const clamp = (v, a, c) => Math.max(a, Math.min(c, v));
  const sp = (z) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));
  // The days grouped by PM2.5 value: z, number unhealthy, number OK. The cost is exact, just faster.
  function J(w, b) {
    let s = 0;
    for (const [z, n1, n0] of G) {
      const t = w * z + b;
      s += n1 * sp(-t) + n0 * sp(t);
    }
    return s / m;
  }
  function grad(w, b) {
    let gw_ = 0,
      gb_ = 0;
    for (const [z, n1, n0] of G) {
      const p = sigmoid(w * z + b),
        e = (n1 + n0) * p - n1;
      gw_ += e * z;
      gb_ += e;
    }
    return [gw_ / m, gb_ / m];
  }
  const a2s = (a) => Math.log10(a / 0.01) / Math.log10(3000),
    s2a = (s) => +(0.01 * Math.pow(3000, s)).toPrecision(2);
  function run() {
    hist = [{ w: w0, b: b0, J: J(w0, b0) }];
    stopped = '';
    conv = -1;
    let w = w0,
      b = b0;
    for (let i = 0; i < N; i++) {
      const [gw_, gb_] = grad(w, b),
        nw = w - alpha * gw_,
        nb = b - alpha * gb_,
        j = J(nw, nb);
      if (!isFinite(j) || j > 50) {
        stopped = 'Stopped after ' + (i + 1) + ' steps: the cost was growing without limit.';
        break;
      }
      hist.push({ w: nw, b: nb, J: j, gw: gw_, gb: gb_, pw: w, pb: b });
      if (conv < 0 && i > 2 && Math.abs(hist[i].J - j) / j < 0.0001) conv = i + 1;
      w = nw;
      b = nb;
    }
    $('scrub').max = hist.length - 1;
    $('sn').textContent = num(hist.length - 1);
  }
  function fitc(canvas, svgEl, H) {
    const r = svgEl.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1,
      s = r.width / 520;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    c.clearRect(0, 0, 520, H);
    return c;
  }
  function paintDots() {
    const c = fitc(cv, svg, 380),
      rr = rng(3);
    for (let i = 0; i < PM.length; i++) {
      c.fillStyle = css(Y[i] ? '--warn' : '--ac');
      c.globalAlpha = Y[i] ? 0.5 : 0.08;
      c.beginPath();
      c.arc(fx(PM[i]), fy(Y[i]) + (Y[i] ? 1 : -1) * (rr() * 14), 1.9, 0, 6.283);
      c.fill();
    }
  }
  function paintHeat() {
    const c = fitc(hv, csv, 380),
      dark = document.documentElement.dataset.theme === 'dark',
      NX = 120,
      NY = 70,
      lo = Math.log(Jmin),
      hi = Math.log(Math.max(J(WR[0], BR[1]), J(WR[1], BR[1])));
    const offc = document.createElement('canvas');
    offc.width = NX;
    offc.height = NY;
    const o = offc.getContext('2d'),
      img = o.createImageData(NX, NY),
      col = dark ? [103, 208, 220] : [11, 110, 127];
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const wv = WR[0] + ((i + 0.5) / NX) * (WR[1] - WR[0]),
          bv = BR[1] - ((j + 0.5) / NY) * (BR[1] - BR[0]),
          tt = clamp((Math.log(J(wv, bv)) - lo) / (hi - lo), 0, 1),
          g = Math.pow(1 - tt, 1.6),
          q = (j * NX + i) * 4;
        img.data[q] = col[0];
        img.data[q + 1] = col[1];
        img.data[q + 2] = col[2];
        img.data[q + 3] = Math.round(30 + 200 * g);
      }
    o.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(offc, L, T, R - L, CB - T);
  }
  function curve(w, b) {
    const pts = [];
    for (let x = 0; x <= XM; x += 1.5) pts.push(fx(x).toFixed(1) + ' ' + fy(sigmoid((w * (x - MU)) / SD + b)).toFixed(1));
    return 'M' + pts.join('L');
  }
  function drawLine() {
    svg.innerHTML = '';
    [0, 0.5, 1].forEach((v) => {
      el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') });
      el(svg, 'text', { x: L - 8, y: fy(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: css('--mut') }, v);
    });
    [0, 50, 100, 150].forEach((v) => el(svg, 'text', { x: fx(v), y: B + 18, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'PM2.5 today (μg/m³)');
    el(svg, 'text', { x: 14, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + B) / 2})` }, 'chance tomorrow is unhealthy');
    for (let g = 1; g <= 4; g++) {
      const s = hist[Math.max(0, k - g * Math.max(1, Math.round(k / 12)))];
      if (!s || k === 0) break;
      el(svg, 'path', { d: curve(s.w, s.b), fill: 'none', stroke: css('--line'), 'stroke-width': 1.5, opacity: 0.12 + 0.04 * (4 - g) });
    }
    const s = hist[k];
    el(svg, 'path', { d: curve(s.w, s.b), fill: 'none', stroke: css('--line'), 'stroke-width': 3, 'stroke-linecap': 'round' });
  }
  let pview = 'bowl',
    yaw = -0.75,
    pitch = 0.62,
    B3 = null,
    d3 = null;
  function drawPath() {
    $('pnote2').textContent = PNOTES[pview];
    if (pview === 'bowl') {
      csv.innerHTML = '';
      const r = el(csv, 'rect', { x: 0, y: 0, width: 520, height: 380, fill: 'transparent', style: 'cursor:move' }),
        s = hist[k];
      B3 = LabBowl.draw(hv, csv, { J, WR, BR, Jmin, wBest, bBest, yaw, pitch, w: s.w, b: s.b, path: hist.slice(0, k + 1), start: { w: w0, b: b0 }, hideDot: k === 0 });
      const near = (e) => {
        const q = svgPoint(csv, e);
        return B3.start && Math.hypot(q.x - B3.start[0], q.y - B3.start[1]) < 20;
      };
      r.addEventListener('pointermove', (e) => {
        if (!d3) r.style.cursor = near(e) ? 'grab' : 'move';
      });
      r.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        d3 = near(e) ? { k: 'start' } : { k: 'rot', x: e.clientX, y: e.clientY, yaw, pitch };
      });
      return;
    }
    if (pview === 'curve') {
      const c = hv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, hv.width, hv.height);
      csv.innerHTML = '';
      const s = hist[k];
      const f = (v) => J(v, s.b),
        vals = Array.from({ length: 121 }, (_, i) => WR[0] + (i / 120) * (WR[1] - WR[0])),
        lo = Math.min(...vals.map(f)),
        hi = Math.max(f(WR[0]), f(WR[1])),
        Yc = (v) => CB - ((v - lo) / (hi - lo)) * (CB - T);
      [-3, 0, 3, 6].forEach((v) => el(csv, 'text', { x: gw(v), y: CB + 18, 'text-anchor': 'middle', 'font-size': 11, fill: css('--mut') }, v));
      el(csv, 'text', { x: (L + R) / 2, y: CB + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'Weight w (b at ' + s.b.toFixed(2) + ')');
      el(csv, 'text', { x: 14, y: (T + CB) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + CB) / 2})` }, 'Cost J');
      el(csv, 'path', { d: vals.map((v, i) => (i ? 'L' : 'M') + gw(v).toFixed(1) + ' ' + Yc(f(v)).toFixed(1)).join(''), fill: 'none', stroke: css('--mut'), 'stroke-width': 2.5 });
      el(csv, 'circle', { cx: gw(s.w), cy: Yc(f(s.w)), r: 9, fill: css('--ac'), stroke: css('--sf'), 'stroke-width': 3 });
      el(csv, 'text', { x: gw(s.w) + 12, y: Yc(f(s.w)) - 10, 'font-size': 12, 'font-family': 'Geist Mono Variable, monospace', fill: css('--ink') }, 'w = ' + s.w.toFixed(2));
      return;
    }
    paintHeat();
    csv.innerHTML = '';
    [-3, 0, 3, 6].forEach((v) => el(csv, 'text', { x: gw(v), y: CB + 18, 'text-anchor': 'middle', 'font-size': 11, fill: css('--mut') }, v));
    [-8, -5, -2, 1].forEach((v) => el(csv, 'text', { x: L - 8, y: gb(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: css('--mut') }, v));
    el(csv, 'text', { x: (L + R) / 2, y: CB + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'Weight w');
    el(csv, 'text', { x: 14, y: (T + CB) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + CB) / 2})` }, 'Bias b');
    el(csv, 'path', { d: `M${gw(wBest) - 6} ${gb(bBest)} h12 M${gw(wBest)} ${gb(bBest) - 6} v12`, stroke: css('--ink'), 'stroke-width': 2 });
    let d = '';
    for (let i = 0; i <= k; i++) {
      const s = hist[i];
      d += (i ? 'L' : 'M') + clamp(gw(s.w), L, R).toFixed(1) + ' ' + clamp(gb(s.b), T, CB).toFixed(1);
    }
    el(csv, 'path', { d, fill: 'none', stroke: css('--warn'), 'stroke-width': 1.8 });
    const every = Math.max(1, Math.ceil(k / 60));
    for (let i = 1; i <= k; i += every) {
      const s = hist[i];
      el(csv, 'circle', { cx: clamp(gw(s.w), L, R), cy: clamp(gb(s.b), T, CB), r: 2.6, fill: css('--warn') });
    }
    const s = hist[k];
    if (k > 0) {
      const px = clamp(gw(s.w), L, R),
        py = clamp(gb(s.b), T, CB);
      el(csv, 'circle', { cx: px, cy: py, r: 7, fill: css('--ac'), stroke: css('--sf'), 'stroke-width': 2.5 });
    }
    const hit = el(csv, 'rect', { x: L, y: T, width: R - L, height: CB - T, fill: 'transparent', style: 'cursor:crosshair' });
    hit.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      moveStart(e);
    });
    el(csv, 'circle', { cx: gw(w0), cy: gb(b0), r: 9, fill: css('--sf'), stroke: css('--ac'), 'stroke-width': 3.5 });
    el(csv, 'text', { x: gw(w0) + 13, y: gb(b0) - 10, 'font-size': 12, 'font-weight': 600, fill: css('--ac') }, 'start');
  }
  function drawHist() {
    hsv.innerHTML = '';
    const l = 56,
      r = 1040,
      t = 12,
      bt = 140,
      top = Math.max(...hist.map((h) => h.J));
    const X = (i) => l + (i / N) * (r - l),
      Yh = (v) => bt - (Math.log(((v - Jmin) / (top - Jmin)) * 1e4 + 1) / Math.log(1e4 + 1)) * (bt - t);
    el(hsv, 'line', { x1: l, x2: r, y1: bt, y2: bt, stroke: css('--ac'), 'stroke-dasharray': '4 3', opacity: 0.7 });
    el(hsv, 'text', { x: l + 8, y: bt - 6, 'text-anchor': 'start', 'font-size': 12, fill: css('--ac') }, 'best possible cost: ' + Jmin.toFixed(4));
    [0, N / 2, N].forEach((v) => el(hsv, 'text', { x: X(v), y: bt + 16, 'text-anchor': 'middle', 'font-size': 11, fill: css('--mut') }, num(Math.round(v))));
    el(hsv, 'text', { x: l - 8, y: t + 8, 'text-anchor': 'end', 'font-size': 11, fill: css('--mut') }, 'cost');
    let d = '';
    for (let i = 0; i <= k; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + clamp(Yh(hist[i].J), t, bt).toFixed(1);
    el(hsv, 'path', { d, fill: 'none', stroke: css('--warn'), 'stroke-width': 2.2 });
    if (conv > 0 && k >= conv) {
      el(hsv, 'line', { x1: X(conv), x2: X(conv), y1: t, y2: bt, stroke: css('--ac'), 'stroke-width': 1.5, 'stroke-dasharray': '3 3' });
      el(hsv, 'text', { x: X(conv) + 5, y: t + 24, 'font-size': 11, 'font-weight': 600, fill: css('--ac') }, 'converged at step ' + conv);
    }
    const hx = X(k),
      hy = clamp(Yh(hist[k].J), t, bt);
    el(hsv, 'circle', { cx: hx, cy: hy, r: 5, fill: css('--warn') });
    const ch = k > 0 ? hist[k].J - hist[k - 1].J : 0,
      lab = hist[k].J.toFixed(4) + (k > 0 ? '  (' + (ch <= 0 ? '−' : '+') + Math.abs(ch).toFixed(Math.abs(ch) < 0.0001 ? 6 : 4) + ')' : ''),
      right = hx > r - 190;
    el(hsv, 'text', { x: right ? hx - 10 : hx + 10, y: Math.max(t + 34, hy - 12), 'text-anchor': right ? 'end' : 'start', 'font-size': 12, 'font-weight': 600, fill: css('--warn'), 'font-family': 'Geist Mono Variable, monospace' }, lab);
    el(hsv, 'text', { x: (l + r) / 2, y: bt + 30, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut') }, 'Step');
  }
  function moveStart(e) {
    const q = svgPoint(csv, e);
    w0 = clamp(Math.round(igw(q.x) * 4) / 4, ...WR);
    b0 = clamp(Math.round(igb(q.y) * 4) / 4, ...BR);
    stop();
    run();
    k = 0;
    render();
  }
  win.addEventListener('pointermove', (e) => {
    if (!G.length) return;
    if (dragging) {
      moveStart(e);
      return;
    }
    if (!d3) return;
    if (d3.k === 'rot') {
      yaw = d3.yaw + (e.clientX - d3.x) * 0.01;
      pitch = clamp(d3.pitch + (e.clientY - d3.y) * 0.006, 0.15, 1.35);
      drawPath();
      return;
    }
    const q = svgPoint(csv, e);
    [w0, b0] = LabBowl.pick(B3.proj, J, WR, BR, q.x, q.y);
    stop();
    run();
    k = 0;
    render();
  });
  win.addEventListener('pointerup', () => {
    dragging = false;
    d3 = null;
  });
  const f2 = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
  function render() {
    drawLine();
    drawPath();
    drawHist();
    const s = hist[k];
    $('hS').textContent = k;
    $('hW').textContent = s.w.toFixed(3);
    $('hB').textContent = s.b.toFixed(3);
    $('hJ').textContent = s.J.toFixed(4);
    $('scrub').value = k;
    $('sk').textContent = num(k);
    $('conv').textContent = stopped && k === hist.length - 1 ? 'diverged' : conv > 0 && k >= conv ? 'converged at step ' + conv : '';
    const done = k === hist.length - 1,
      gap = ((s.J - Jmin) / Jmin) * 100;
    $('status').textContent =
      stopped && done
        ? stopped
        : k === 0
          ? 'Press play, take one step at a time, or drag the timeline.'
          : conv > 0 && k >= conv
            ? `Converged at step ${conv}: each further step changes the cost by less than 0.01%. Cost ${s.J.toFixed(4)}${gap < 0.5 ? ', the best possible.' : ', ' + gap.toFixed(1) + '% above the best possible.'}`
            : `Step ${num(k)}: cost ${s.J.toFixed(4)}, ${gap.toFixed(1)}% above the best possible (${Jmin.toFixed(4)}).`;
    $('f').innerHTML =
      k === 0
        ? 'No step yet.'
        : 'w = ' + f2(s.pw) + ' − ' + alpha + ' × (' + f2(s.gw) + ')<br>&nbsp;&nbsp;= <span class="hl">' + f2(s.w) + '</span><br>b = ' + f2(s.pb) + ' − ' + alpha + ' × (' + f2(s.gb) + ')<br>&nbsp;&nbsp;= <span class="hl">' + f2(s.b) + '</span>';
  }
  function setPlay(v) {
    playing = v;
    const p = $('play');
    p.innerHTML = v ? ICON_PAUSE : ICON_PLAY;
    p.setAttribute('aria-label', v ? 'Pause' : 'Start training');
  }
  function stop() {
    cancelAnimationFrame(timer);
    setPlay(false);
  }
  let lastT = 0;
  function tick(ts) {
    if (!playing) return;
    if (ts && ts - lastT < 16) {
      timer = requestAnimationFrame(tick);
      return;
    }
    lastT = ts || 0;
    k = Math.min(hist.length - 1, k + Math.max(1, Math.round(N / 240)));
    render();
    if (k >= hist.length - 1) {
      setPlay(false);
      return;
    }
    timer = requestAnimationFrame(tick);
  }
  const custom = () => document.querySelector('#main .custom');
  const aIn = $('a');
  function setAlpha(a) {
    alpha = a;
    aIn.value = a2s(a);
    $('av').textContent = a;
    let hit = false;
    all('#aseg button').forEach((x) => {
      const o = x.dataset.a !== 'custom' && +x.dataset.a === a;
      x.classList.toggle('on', o);
      hit = hit || o;
    });
    if (!hit) document.querySelector('#main [data-a="custom"]').classList.add('on');
    custom().classList.toggle('hidden2', hit);
  }
  const restart = () => {
    stop();
    run();
    k = 0;
    render();
  };
  function chip(kk) {
    all('.chip').forEach((c) => c.classList.toggle('on', c.dataset.p === kk));
    $('pnote').textContent = kk ? PRE[kk][1] : '';
  }
  on($('play'), 'click', () => {
    if (!G.length) return;
    if (playing) {
      stop();
      return;
    }
    if (k >= hist.length - 1) k = 0;
    setPlay(true);
    tick();
  });
  on($('step'), 'click', () => {
    if (!G.length) return;
    stop();
    k = Math.min(hist.length - 1, k + 1);
    render();
  });
  on($('reset'), 'click', () => {
    if (!G.length) return;
    stop();
    k = 0;
    render();
  });
  on(aIn, 'input', () => {
    if (!G.length) return;
    setAlpha(s2a(+aIn.value));
    custom().classList.remove('hidden2');
    chip(null);
    restart();
  });
  all('#aseg button').forEach((x) =>
    on(x, 'click', () => {
      if (!G.length) return;
      if (x.dataset.a === 'custom') {
        all('#aseg button').forEach((y) => y.classList.toggle('on', y === x));
        custom().classList.remove('hidden2');
        return;
      }
      setAlpha(+x.dataset.a);
      chip(null);
      restart();
    }),
  );
  on($('scrub'), 'input', (e) => {
    if (!G.length) return;
    stop();
    k = +e.target.value;
    render();
  });
  all('#iters button').forEach((x) =>
    on(x, 'click', () => {
      if (!G.length) return;
      N = +x.dataset.n;
      all('#iters button').forEach((y) => y.classList.toggle('on', y === x));
      restart();
    }),
  );
  all('.chip').forEach((c) =>
    on(c, 'click', () => {
      if (!G.length) return;
      setAlpha(PRE[c.dataset.p][0]);
      chip(c.dataset.p);
      restart();
      setPlay(true);
      tick();
    }),
  );
  all('#bview button').forEach((x) =>
    on(x, 'click', () => {
      if (!G.length) return;
      pview = x.dataset.v;
      all('#bview button').forEach((y) => y.classList.toggle('on', y === x));
      drawPath();
    }),
  );
  const redraw = () => {
    if (G.length) {
      paintDots();
      render();
    }
  };
  win.addEventListener('resize', redraw);
  off.push(onTheme(redraw));
  katex.render('w:=w-\\alpha\\,\\frac{\\partial J}{\\partial w}\\qquad b:=b-\\alpha\\,\\frac{\\partial J}{\\partial b}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('\\frac{\\partial J}{\\partial w}=\\frac1m\\sum_i\\big(f^{(i)}-y^{(i)}\\big)x^{(i)},\\qquad \\frac{\\partial J}{\\partial b}=\\frac1m\\sum_i\\big(f^{(i)}-y^{(i)}\\big)', $('m2'), { throwOnError: false, displayMode: true });

  ctx.load('lab-rows').then((Rw) => {
    if (!live) return;
    PM = rowCol(Rw.train, 'pm2_5_mean');
    Y = rowCol(Rw.train, 'y');
    m = PM.length;
    MU = PM.reduce((a, b) => a + b, 0) / m;
    SD = Math.sqrt(PM.reduce((a, v) => a + (v - MU) ** 2, 0) / m);
    const g = {};
    PM.forEach((v, i) => {
      const kk = v.toFixed(3);
      (g[kk] = g[kk] || [(v - MU) / SD, 0, 0])[Y[i] ? 1 : 2]++;
    });
    G = Object.values(g);
    const best = fitExact(PM.map((v) => [(v - MU) / SD]), Y, 0);
    wBest = best.w[0];
    bBest = best.b;
    Jmin = J(wBest, bBest);
    const main = $('main');
    main.classList.remove('skel');
    main.setAttribute('aria-busy', 'false');
    setAlpha(3);
    run();
    paintDots();
    render();
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
