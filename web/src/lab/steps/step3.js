// Model Lab, step 3. Ported from the approved design draft docs/design/AirLabStep3.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { css, el, fmt, num, onTheme, rowCol } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 3 of 17</span>
      <h2 id="st">Why not a straight line?</h2>
      <p class="goal">Linear regression drew a line through prices. Here the answer is only 0 or 1. Fit a straight line to it anyway and see what goes wrong.</p>
      <div class="split"><figure class="plot"><div class="phead"><b>Tomorrow unhealthy (1) or not (0), against today's PM2.5</b>
        <button class="btn" id="add" type="button">Add 60 very dirty days</button></div>
        <svg id="p" viewBox="0 0 760 380" width="100%" role="img" aria-label="Straight line fitted to 0 and 1 answers"></svg>
        <figcaption class="note" id="pn"></figcaption></figure>
       <div class="nota"><h3>What the line says</h3><div class="kv" id="kv"></div><p class="callout" id="co"></p></div></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>A straight line can give any number: below 0, above 1, never just a chance.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>Reading the line as a yes or no means cutting it at one half. Where that cut lands depends on every point, even far-away ones.</p></div>`;

export const skHtml = '';

const fit = (x, y) => {
  const mx = x.reduce((s, v) => s + v, 0) / x.length,
    my = y.reduce((s, v) => s + v, 0) / y.length;
  let a = 0,
    c = 0;
  x.forEach((v, i) => {
    a += (v - mx) * (y[i] - my);
    c += (v - mx) ** 2;
  });
  const w = a / c;
  return [w, my - w * mx];
};

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let X = [],
    Y = [],
    extra = false,
    live = true;
  const off = [];

  function redraw() {
    if (!X.length) return;
    const svg = $('p');
    svg.innerHTML = '';
    const xs = extra ? X.concat(Array.from({ length: 60 }, (_, i) => 200 + i * 1.7)) : X,
      ys = extra ? Y.concat(new Array(60).fill(1)) : Y;
    const [w, b] = fit(xs, ys),
      XM = extra ? 310 : 160,
      L = 60,
      R = 740,
      T = 20,
      B = 320,
      fx = (v) => L + (v / XM) * (R - L),
      fy = (v) => B - ((v + 0.4) / 1.8) * (B - T);
    [-0.4, 0, 0.5, 1, 1.4].forEach((v) => {
      el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css(v === 0 || v === 1 ? '--mut' : '--rule'), 'stroke-dasharray': v === 0.5 ? '4 4' : '' });
      el(svg, 'text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 14, fill: css('--mut') }, v);
    });
    el(svg, 'rect', { x: L, y: T, width: R - L, height: fy(1) - T, fill: css('--warn'), 'fill-opacity': 0.08 });
    el(svg, 'rect', { x: L, y: fy(0), width: R - L, height: B - fy(0), fill: css('--warn'), 'fill-opacity': 0.08 });
    el(svg, 'text', { x: R - 6, y: T + 16, 'text-anchor': 'end', 'font-size': 13, fill: css('--warn') }, 'above 1: not a chance');
    el(svg, 'text', { x: R - 6, y: B - 8, 'text-anchor': 'end', 'font-size': 13, fill: css('--warn') }, 'below 0: not a chance');
    for (let i = 0; i < xs.length; i++) {
      const j = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.12;
      el(svg, 'circle', { cx: fx(Math.min(xs[i], XM)), cy: fy(ys[i] + j - 0.06), r: 2.2, fill: css(ys[i] ? '--warn' : '--calm'), 'fill-opacity': i >= X.length ? 0.9 : 0.3 });
    }
    const xEnd = Math.min(XM, (1.4 - b) / w);
    el(svg, 'line', { x1: fx(0), y1: fy(b), x2: fx(xEnd), y2: fy(w * xEnd + b), stroke: css('--ink'), 'stroke-width': 2.5 });
    const cut = (0.5 - b) / w;
    el(svg, 'line', { x1: fx(cut), x2: fx(cut), y1: T, y2: B, stroke: css('--ink'), 'stroke-dasharray': '2 3' });
    el(svg, 'text', { x: fx(cut) + 6, y: T + 34, 'font-size': 14, 'font-weight': 600, fill: css('--ink') }, `switches to 1 at ${cut.toFixed(0)}`);
    [0, 50, 100, 150, 200, 250, 300].filter((v) => v <= XM).forEach((v) => el(svg, 'text', { x: fx(v), y: B + 20, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 42, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, "Today's PM2.5 up to noon (μg/m³)");
    const below = xs.filter((v) => w * v + b < 0).length,
      over = xs.filter((v) => w * v + b > 1).length,
      wrong = X.filter((v, i) => (w * v + b >= 0.5 ? 1 : 0) !== Y[i]).length;
    $('kv').innerHTML = `<span>at 5 μg/m³</span><b>${fmt(w * 5 + b)}</b><span>at 100 μg/m³</span><b>${fmt(w * 100 + b)}</b><span>days it gives below 0</span><b>${num(below)}</b><span>days it gives above 1</span><b>${num(over)}</b><span>switches to 1 at</span><b>${cut.toFixed(1)} μg/m³</b><span>real days called wrong</span><b>${num(wrong)} of ${num(X.length)}</b>`;
    $('co').innerHTML = extra
      ? '<b>The line tilted.</b> 60 very dirty days far to the right pulled it down, and the switch point moved. Days that did not change are now called differently.'
      : '<b>Two problems.</b> The line gives "chances" below 0 for clean days, and where it switches to 1 depends on every point, even far-away ones. Try adding very dirty days.';
    $('pn').textContent = 'Each dot is one training day, jittered up and down so they do not hide each other. Orange: tomorrow was unhealthy.';
  }

  const add = $('add');
  const onAdd = () => {
    extra = !extra;
    add.textContent = extra ? 'Remove them' : 'Add 60 very dirty days';
    redraw();
  };
  add.addEventListener('click', onAdd);
  off.push(() => add.removeEventListener('click', onAdd));
  katex.render('f_{w,b}(x)=wx+b', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('\\hat y=\\begin{cases}1 & f(x)\\ge 0.5\\\\0 & f(x)<0.5\\end{cases}', $('m2'), { throwOnError: false, displayMode: true });
  off.push(onTheme(redraw));

  ctx.load('lab-rows').then((R) => {
    if (!live) return;
    X = rowCol(R.train, 'pm2_5_mean');
    Y = rowCol(R.train, 'y');
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
