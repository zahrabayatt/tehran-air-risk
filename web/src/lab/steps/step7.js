// Model Lab, step 7. Ported from the approved design draft docs/design/AirLabStep7.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { css, descent, drag, el, fmt, onTheme, rowCol, sigmoid, zfit } from '../kit.js';

const EPS = 1e-15;

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 7 of 17</span>
      <h2 id="st">Why not squared error?</h2>
      <p class="goal">Linear regression measured misses by squaring them. Do that to a chance from the sigmoid and the slope far from the best weight becomes small, so walking downhill creeps; on other data it can even go flat or have false bottoms. Compare the two costs as the weight w changes.</p>
      <div class="split"><figure class="plot"><div class="phead"><b>Cost as the weight w changes (b kept at its best)</b></div>
        <svg id="p" viewBox="0 0 760 360" width="100%" role="img" aria-label="Squared error cost and logistic cost against the weight"></svg>
        <figcaption class="note">Both costs measured over all training days, with today's PM2.5 (scaled) as the one input, each drawn to its own height so their shapes can be compared. Drag the point to move w.</figcaption></figure>
       <div class="nota"><h3>At this weight</h3><div class="kv" id="kv"></div><p class="callout" id="co"></p></div></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>With the sigmoid inside, this is not one smooth bowl: it has flat stretches where gradient descent stalls.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The logistic cost (next step) is one bowl, with a slope that always points to the bottom.</p></div>`;

export const skHtml = '';

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { win, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let Z = [],
    Y = [],
    bBest = 0,
    wBest = 0,
    w = -3,
    curves = null,
    live = true;
  const off = [];

  const sq = (wv) => {
    let s = 0;
    for (let i = 0; i < Y.length; i++) {
      const f = sigmoid(wv * Z[i] + bBest);
      s += (f - Y[i]) ** 2;
    }
    return s / Y.length / 2;
  };
  const lg = (wv) => {
    let s = 0;
    for (let i = 0; i < Y.length; i++) {
      const f = sigmoid(wv * Z[i] + bBest);
      s += -(Y[i] * Math.log(Math.max(f, EPS)) + (1 - Y[i]) * Math.log(Math.max(1 - f, EPS)));
    }
    return s / Y.length;
  };

  function redraw() {
    if (!curves) return;
    const svg = $('p');
    svg.innerHTML = '';
    const L = 60,
      R = 740,
      T = 20,
      B = 300,
      W0 = -6,
      W1 = 8,
      fx = (v) => L + ((v - W0) / (W1 - W0)) * (R - L);
    const maxL = Math.max(...curves.map((c) => c[2])),
      maxS = Math.max(...curves.map((c) => c[1]));
    const fyL = (v) => B - (v / maxL) * (B - T) * 0.95,
      fyS = (v) => B - (v / maxS) * (B - T) * 0.95;
    [W0, -3, 0, 3, 6].forEach((v) => el(svg, 'text', { x: fx(v), y: B + 22, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 44, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, "w, the weight on today's PM2.5 (scaled)");
    el(svg, 'line', { x1: L, x2: R, y1: B, y2: B, stroke: css('--rule') });
    el(svg, 'path', { d: 'M' + curves.map((c) => `${fx(c[0]).toFixed(1)} ${fyS(c[1]).toFixed(1)}`).join('L'), fill: 'none', stroke: css('--warn'), 'stroke-width': 3 });
    el(svg, 'path', { d: 'M' + curves.map((c) => `${fx(c[0]).toFixed(1)} ${fyL(c[2]).toFixed(1)}`).join('L'), fill: 'none', stroke: css('--calm'), 'stroke-width': 3 });
    el(svg, 'text', { x: fx(-5.8), y: fyS(sq(-5.8)) - 10, 'font-size': 14, 'font-weight': 600, fill: css('--warn') }, 'squared error');
    el(svg, 'text', { x: fx(-5.8), y: fyL(lg(-5.8)) + 22, 'font-size': 14, 'font-weight': 600, fill: css('--calm') }, 'logistic cost');
    el(svg, 'line', { x1: fx(wBest), x2: fx(wBest), y1: T, y2: B, stroke: css('--mut'), 'stroke-dasharray': '3 4' });
    el(svg, 'text', { x: fx(wBest) + 4, y: T + 14, 'font-size': 13, fill: css('--mut') }, 'best w');
    el(svg, 'line', { x1: fx(w), x2: fx(w), y1: T, y2: B, stroke: css('--ink'), 'stroke-width': 2 });
    el(svg, 'circle', { cx: fx(w), cy: B, r: 8, fill: css('--ink') });
    const hit = el(svg, 'rect', { x: L, y: T, width: R - L, height: B - T, fill: 'transparent', style: 'cursor:ew-resize' });
    drag(
      svg,
      hit,
      (q) => {
        w = Math.max(W0, Math.min(W1, W0 + ((q.x - L) / (R - L)) * (W1 - W0)));
        redraw();
      },
      win,
    );
    const d = 1e-3,
      gs = (sq(w + d) - sq(w - d)) / (2 * d),
      gl = (lg(w + d) - lg(w - d)) / (2 * d);
    const ratio = Math.abs(gl) / Math.max(Math.abs(gs), 1e-9);
    $('co').innerHTML =
      Math.abs(w - wBest) < 0.5
        ? 'Near the best weight both slopes are close to zero: this is the bottom.'
        : `Here the <b>logistic cost</b> slopes ${ratio.toFixed(0)} times more steeply than the <b>squared error</b>. Gradient descent steps in proportion to the slope, so on the squared error it would creep toward the bottom.`;
    $('kv').innerHTML = `<span>w</span><b>${fmt(w)}</b><span>squared error</span><b>${fmt(sq(w), 4)}</b><span>its slope</span><b>${fmt(gs, 4)}</b><span>logistic cost</span><b>${fmt(lg(w), 4)}</b><span>its slope</span><b>${fmt(gl, 4)}</b>`;
  }

  katex.render('J_{sq}(\\mathbf w,b)=\\frac{1}{2m}\\sum_{i}\\big(g(\\mathbf w\\cdot\\mathbf x^{(i)}+b)-y^{(i)}\\big)^2', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('J(\\mathbf w,b)=-\\frac1m\\sum_i\\Big[y^{(i)}\\ln f^{(i)}+(1-y^{(i)})\\ln(1-f^{(i)})\\Big]', $('m2'), { throwOnError: false, displayMode: true });
  off.push(onTheme(redraw));

  ctx.load('lab-rows').then((R) => {
    if (!live) return;
    const x = rowCol(R.train, 'pm2_5_mean');
    Y = rowCol(R.train, 'y');
    const s = zfit(x.map((v) => [v]));
    Z = x.map((v) => (v - s.mu[0]) / s.sd[0]);
    const r = descent(Z.map((v) => [v]), Y, [0], 0, 0.5, 600);
    wBest = r.w[0];
    bBest = r.b;
    curves = [];
    for (let v = -6; v <= 8.001; v += 0.1) curves.push([v, sq(v), lg(v)]);
    const main = $('main');
    main.classList.remove('skel');
    main.setAttribute('aria-busy', 'false');
    redraw();
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
