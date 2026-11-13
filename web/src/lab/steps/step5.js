// Model Lab, step 5. Ported from the approved design draft docs/design/AirLabStep5.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { cost, css, descent, el, fmt, onTheme, rowCol, sigmoid, svgPoint, zapply, zfit } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 5 of 17</span>
      <h2 id="st">Logistic model</h2>
      <p class="goal">Put the two together: a weighted sum of the input, z = w·x + b, then the sigmoid. With one input, today's PM2.5, the result is an S-shaped curve of chances. Move w and b, or let the computer find the best ones.</p>
      <div class="split"><figure class="plot"><div class="phead"><b>Chance that tomorrow is unhealthy, from today's PM2.5</b></div>
        <svg id="p" viewBox="0 0 760 360" width="100%" role="img" aria-label="Logistic curve over the training days"></svg>
        <figcaption class="note">Dots: every training day, at 1 if tomorrow was unhealthy and 0 if not. The curve is the model's chance. Click a dot to see its numbers.</figcaption></figure>
       <div class="nota"><h3>One day through the model</h3><div class="kv" id="kv"></div><p class="callout" id="co"></p></div></div>
      <div class="ctl" style="margin-top:16px"><label for="w">w<input id="w" type="range" min="0" max="0.3" step="0.001" value="0.05"><b id="wv"></b></label><label for="b">b<input id="b" type="range" min="-12" max="2" step="0.05" value="-3"><b id="bv"></b></label></div>
      <div class="chips" role="group" aria-label="Try these curves"><span class="try">Try:</span><button class="chip" data-p="flat" type="button">Flat curve</button><button class="chip" data-p="steep" type="button">Too steep</button><button class="chip" data-p="right" type="button">Shifted right</button><button class="chip" data-p="best" type="button">The best</button></div>
      <p class="pnote" id="pnote" style="color:var(--mut);font-size:14px;margin:10px 0 0;min-height:1.5em"></p>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The weighted sum, exactly as in linear regression.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>Then the sigmoid, so the answer is a chance between 0 and 1: the model's chance that y = 1.</p></div>`;

export const skHtml = '';

// Presets: [w, b, note]. The note is finished with the live cost. The flat preset's b and the figures in
// the notes come from the training days (filled in by setPresets once they are loaded).
const PRE = {
  flat: [0, 0, ''],
  steep: [0.3, -12, 'Too steep: the chance jumps from almost 0 to almost 1 around 40 μg/m³. Every unhealthy day below that, and every OK day above it, now costs a lot.'],
  right: [0.134, -10, ''],
  best: [null, null, 'The best: the w and b with the lowest cost, found by gradient descent (step 9).'],
};

function setPresets(X, Y) {
  const share = Y.reduce((s, v) => s + v, 0) / Y.length;
  const hidden = X.filter((v, i) => Y[i] === 1 && v >= 40 && v <= 75).length;
  PRE.flat[1] = Math.log(share / (1 - share));
  PRE.flat[2] = `Flat curve: w = 0, so every day gets the same chance, ${Math.round(share * 100)}%, whatever the morning air. That is the share of unhealthy days in training.`;
  PRE.right[2] = `Shifted right: the best steepness, but b moves the switch to about 75 μg/m³, so the ${hidden} unhealthy days that followed mornings between 40 and 75 μg/m³ get a low chance.`;
}

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let X = [],
    Y = [],
    w = 0.05,
    b = -3,
    sel = 0,
    chip = null,
    BEST = null,
    live = true;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };

  function redraw() {
    if (!X.length) return;
    const svg = $('p');
    svg.innerHTML = '';
    const L = 60,
      R = 740,
      T = 20,
      B = 300,
      XM = 160,
      fx = (v) => L + (Math.min(v, XM) / XM) * (R - L),
      fy = (v) => B - v * (B - T);
    [0, 0.5, 1].forEach((v) => {
      el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule'), 'stroke-dasharray': v === 0.5 ? '4 4' : '' });
      el(svg, 'text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 14, fill: css('--mut') }, v);
    });
    [0, 40, 80, 120, 160].forEach((v) => el(svg, 'text', { x: fx(v), y: B + 22, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 44, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, "Today's PM2.5 up to noon (μg/m³)");
    for (let i = 0; i < X.length; i++) {
      const j = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.08;
      el(svg, 'circle', { cx: fx(X[i]), cy: fy(Y[i] ? 1 - Math.abs(j) : Math.abs(j)), r: 2.2, fill: css(Y[i] ? '--warn' : '--calm'), 'fill-opacity': 0.3 });
    }
    let d = '';
    for (let v = 0; v <= XM; v += 1) d += (d ? 'L' : 'M') + fx(v).toFixed(1) + ' ' + fy(sigmoid(w * v + b)).toFixed(1);
    el(svg, 'path', { d, fill: 'none', stroke: css('--ink'), 'stroke-width': 3 });
    const x = X[sel],
      p = sigmoid(w * x + b);
    el(svg, 'circle', { cx: fx(x), cy: fy(p), r: 8, fill: css('--warn'), stroke: css('--sf'), 'stroke-width': 2 });
    const hit = el(svg, 'rect', { x: L, y: T, width: R - L, height: B - T, fill: 'transparent' });
    hit.addEventListener('click', (e) => {
      const q = svgPoint(svg, e),
        v = ((q.x - L) / (R - L)) * XM;
      let bd = 1e9;
      X.forEach((xx, i) => {
        const dd = Math.abs(xx - v);
        if (dd < bd) {
          bd = dd;
          sel = i;
        }
      });
      redraw();
    });
    const c = cost(X.map((v) => [v]), Y, [w], b);
    $('kv').innerHTML = `<span>x, today's PM2.5</span><b>${fmt(x, 1)}</b><span>z = w·x + b</span><b>${fmt(w, 3)} × ${fmt(x, 1)} ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b))} = ${fmt(w * x + b)}</b><span>g(z), the chance</span><b>${fmt(p, 3)}</b><span>tomorrow really was</span><b>${Y[sel] ? 'unhealthy (1)' : 'OK (0)'}</b><span>cost over all days</span><b>${fmt(c, 4)}</b>`;
    $('co').innerHTML = 'The curve rises where dirty mornings turn into unhealthy days. <b>w</b> sets how steep it is, <b>b</b> moves it left and right. The cost (step 8) is lower when the curve fits the dots better.';
    $('wv').textContent = fmt(w, 3);
    $('bv').textContent = fmt(b);
    document.querySelectorAll('#main .chip').forEach((q) => q.classList.toggle('on', q.dataset.p === chip));
    $('pnote').innerHTML = chip ? PRE[chip][2] + ` Cost <b style="color:var(--ink)">${fmt(c, 4)}</b>${chip === 'best' ? '.' : `, against ${fmt(BEST.c, 4)} for the best.`}` : '';
  }

  function findBest() {
    const A = X.map((v) => [v]),
      s = zfit(A),
      Z = zapply(A, s),
      r = descent(Z, Y, [0], 0, 0.5, 600),
      bw = r.w[0] / s.sd[0],
      bb = r.b - (r.w[0] * s.mu[0]) / s.sd[0];
    return { w: bw, b: bb, c: cost(A, Y, [bw], bb) };
  }

  ['w', 'b'].forEach((id) =>
    on($(id), 'input', (e) => {
      if (id === 'w') w = +e.target.value;
      else b = +e.target.value;
      chip = null;
      redraw();
    }),
  );
  document.querySelectorAll('#main .chip').forEach((c) =>
    on(c, 'click', () => {
      if (!X.length) return;
      if (!BEST) BEST = findBest();
      chip = c.dataset.p;
      [w, b] = chip === 'best' ? [BEST.w, BEST.b] : PRE[chip];
      $('w').value = w;
      $('b').value = b;
      redraw();
    }),
  );
  katex.render('z=\\mathbf w\\cdot\\mathbf x+b', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('f_{\\mathbf w,b}(\\mathbf x)=g(z)=\\frac{1}{1+e^{-(\\mathbf w\\cdot\\mathbf x+b)}}', $('m2'), { throwOnError: false, displayMode: true });
  off.push(onTheme(redraw));

  ctx.load('lab-rows').then((R) => {
    if (!live) return;
    X = rowCol(R.train, 'pm2_5_mean');
    Y = rowCol(R.train, 'y');
    setPresets(X, Y);
    sel = X.findIndex((v, i) => v > 45 && Y[i] === 1);
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
