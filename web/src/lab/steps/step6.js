// Model Lab, step 6. Ported from the approved design draft docs/design/AirLabStep6.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { css, descent, el, fmt, num, onTheme, rowCol, sigmoid, zapply, zfit } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 6 of 17</span>
      <h2 id="st">Decision boundary</h2>
      <p class="goal">With two inputs, today's PM2.5 and tomorrow's forecast wind, the model draws a line across the chart. On one side it says "probably unhealthy", on the other "probably OK". Move the chance where it switches.</p>
      <div class="split"><figure class="plot"><div class="phead"><b>Today's PM2.5 against tomorrow's forecast wind</b></div>
        <svg id="p" viewBox="0 0 760 380" width="100%" role="img" aria-label="Training days by PM2.5 and wind with the decision boundary"></svg>
        <figcaption class="note">Each dot is a training day; orange if tomorrow was unhealthy. Right of the line, a dirtier morning with less wind, the model says "probably unhealthy". Strong wind tomorrow pushes the line right: it takes a dirtier morning to expect a bad day.</figcaption></figure>
       <div class="nota"><h3>The line</h3><div class="kv" id="kv"></div><p class="callout" id="co"></p></div></div>
      <div class="ctl" style="margin-top:16px"><label for="t">Switch to "unhealthy" at a chance of<input id="t" type="range" min="0.1" max="0.9" step="0.05" value="0.5"><b id="tv"></b></label></div>
      <div class="chips" role="group" aria-label="Try these switch points"><span class="try">Try:</span><button class="chip" data-p="0.5" type="button">Switch at 1 in 2</button><button class="chip" data-p="0.2" type="button">Catch more bad days</button><button class="chip" data-p="0.8" type="button">Fewer false alarms</button></div>
      <p class="pnote" id="pnote" style="color:var(--mut);font-size:14px;margin:10px 0 0;min-height:1.5em"></p>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The boundary is where the weighted sum is zero. It is a straight line because z is a weighted sum.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>To switch at another chance t, move the line to where z equals the log-odds of t.</p></div>`;

export const skHtml = '';

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let P = [],
    W = [],
    Y = [],
    fitR = null,
    S = null,
    t = 0.5,
    chip = null,
    live = true;
  const off = [];
  const on = (el_, ev, fn) => {
    el_.addEventListener(ev, fn);
    off.push(() => el_.removeEventListener(ev, fn));
  };

  function redraw() {
    if (!fitR) return;
    const svg = $('p');
    svg.innerHTML = '';
    const L = 60,
      R = 740,
      T = 20,
      B = 320,
      XM = 150,
      WM = 30,
      fx = (v) => L + (Math.min(v, XM) / XM) * (R - L),
      fy = (v) => B - (Math.min(v, WM) / WM) * (B - T);
    [0, 10, 20, 30].forEach((v) => {
      el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') });
      el(svg, 'text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 14, fill: css('--mut') }, v);
    });
    [0, 50, 100, 150].forEach((v) => el(svg, 'text', { x: fx(v), y: B + 22, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 44, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, "Today's PM2.5 up to noon (μg/m³)");
    el(svg, 'text', { x: 20, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut'), transform: `rotate(-90 20 ${(T + B) / 2})` }, "Tomorrow's wind, forecast (km/h)");
    for (let i = 0; i < P.length; i++) el(svg, 'circle', { cx: fx(P[i]), cy: fy(W[i]), r: 2.3, fill: css(Y[i] ? '--warn' : '--calm'), 'fill-opacity': Y[i] ? 0.7 : 0.25 });
    // boundary in raw units: w1*(x1-m1)/s1 + w2*(x2-m2)/s2 + b = logit(t)
    const k = Math.log(t / (1 - t)),
      [a, c] = fitR.w,
      bb = fitR.b,
      [m1, m2] = S.mu,
      [s1, s2] = S.sd;
    const x2 = (x1) => m2 + (s2 * (k - bb - (a * (x1 - m1)) / s1)) / c;
    const pts = [];
    for (let x1 = 0; x1 <= XM; x1 += 1) {
      const v = x2(x1);
      if (v >= 0 && v <= WM) pts.push([fx(x1), fy(v)]);
    }
    if (pts.length > 1) el(svg, 'path', { d: 'M' + pts.map((p) => p.join(' ')).join('L'), fill: 'none', stroke: css('--ink'), 'stroke-width': 3 });
    let tp = 0,
      fp = 0,
      fn = 0;
    for (let i = 0; i < P.length; i++) {
      const z = (a * (P[i] - m1)) / s1 + (c * (W[i] - m2)) / s2 + bb,
        say = sigmoid(z) >= t;
      if (say && Y[i]) tp++;
      else if (say) fp++;
      else if (Y[i]) fn++;
    }
    $('kv').innerHTML = `<span>weight on PM2.5 (scaled)</span><b>${fmt(a)}</b><span>weight on wind (scaled)</span><b>${fmt(c)}</b><span>bias b</span><b>${fmt(bb)}</b><span>days it calls unhealthy</span><b>${num(tp + fp)}</b><span>of those, really unhealthy</span><b>${num(tp)}</b><span>unhealthy days it misses</span><b>${num(fn)}</b>`;
    $('co').innerHTML = 'The weight on wind is <b>negative</b>: more wind tomorrow, lower chance. A lower switch chance calls more days unhealthy and misses fewer bad ones, at the price of more false alarms.';
    $('tv').textContent = fmt(t);
    document.querySelectorAll('#main .chip').forEach((q) => q.classList.toggle('on', q.dataset.p === chip));
    const NOTE = {
      '0.5': `Switch at 1 in 2: the line sits where z = 0. It calls ${num(tp + fp)} days unhealthy, ${num(tp)} of them rightly, and misses ${num(fn)}.`,
      '0.2': `Catch more bad days: switching at 2 in 10 moves the line up and left, so more days fall on the unhealthy side. It now misses only ${num(fn)} unhealthy days, but ${num(fp)} of the ${num(tp + fp)} it calls unhealthy turn out OK.`,
      '0.8': `Fewer false alarms: switching at 8 in 10 moves the line down and right, so fewer days fall on the unhealthy side. Only ${num(fp)} false alarms, but it misses ${num(fn)} unhealthy days.`,
    };
    $('pnote').innerHTML = chip && NOTE[chip] ? NOTE[chip] + ' The weights do not change; only where the line is drawn.' : '';
  }

  on($('t'), 'input', (e) => {
    t = +e.target.value;
    chip = null;
    redraw();
  });
  document.querySelectorAll('#main .chip').forEach((c) =>
    on(c, 'click', () => {
      chip = c.dataset.p;
      t = +chip;
      $('t').value = t;
      redraw();
    }),
  );
  katex.render('\\mathbf w\\cdot\\mathbf x+b=0\\;\\Longleftrightarrow\\;g(z)=\\tfrac12', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('w_1x_1+w_2x_2+b=\\ln\\frac{t}{1-t}', $('m2'), { throwOnError: false, displayMode: true });
  off.push(onTheme(redraw));

  ctx.load('lab-rows').then((R) => {
    if (!live) return;
    P = rowCol(R.train, 'pm2_5_mean');
    W = rowCol(R.train, 'wx_wind');
    Y = rowCol(R.train, 'y');
    const X = P.map((v, i) => [v, W[i]]);
    S = zfit(X);
    fitR = descent(zapply(X, S), Y, [0, 0], 0, 0.5, 800);
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
