// Model Lab, step 8. Ported from the approved design draft docs/design/AirLabStep8.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { cost, css, descent, drag, el, fmt, num, onTheme, rowCol, zapply, zfit } from '../kit.js';

const EPS = 1e-15;

export const html = `<div id="main">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 8 of 17</span>
      <h2 id="st">Logistic loss and cost</h2>
      <p class="goal">The loss is the penalty for one day: small when the model was confident and right, huge when it was confident and wrong. The cost is the average loss over all days. Drag the chance the model gave.</p>
      <div class="split"><figure class="plot"><div class="phead"><b>The penalty for one day</b><div class="seg" role="group" aria-label="What happened"><button class="on" data-y="1" type="button">Tomorrow was unhealthy (y = 1)</button><button data-y="0" type="button">Tomorrow was OK (y = 0)</button></div></div>
        <svg id="p" viewBox="0 0 760 340" width="100%" role="group" aria-label="Logistic loss against the model's chance"></svg>
        <figcaption class="note">Drag the point to change the chance the model gave. The loss shoots up as a confident answer turns out wrong.</figcaption></figure>
       <div class="nota"><h3>This day and all days</h3><div class="kv" id="kv"></div><p class="callout" id="co"></p></div></div>
    </section>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>Right and confident: almost no penalty. Wrong and confident: a very large one.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The cost is the average loss over all m training days. Training looks for the w and b that make it smallest.</p></div>`;

export const skHtml = '';

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { win, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let y = 1,
    f = 0.3,
    J = null,
    n = 0,
    live = true;
  const off = [];

  function redraw() {
    const svg = $('p');
    svg.innerHTML = '';
    const L = 60,
      R = 740,
      T = 20,
      B = 280,
      YM = 5,
      fx = (v) => L + v * (R - L),
      fy = (v) => B - (Math.min(v, YM) / YM) * (B - T);
    [0, 1, 2, 3, 4, 5].forEach((v) => {
      el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') });
      el(svg, 'text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 14, fill: css('--mut') }, v);
    });
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => el(svg, 'text', { x: fx(v), y: B + 22, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 44, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, 'f, the chance the model gave that tomorrow is unhealthy');
    const loss = (v) => (y ? -Math.log(Math.max(v, EPS)) : -Math.log(Math.max(1 - v, EPS)));
    let d = '';
    for (let v = 0.005; v <= 0.995; v += 0.005) d += (d ? 'L' : 'M') + fx(v).toFixed(1) + ' ' + fy(loss(v)).toFixed(1);
    el(svg, 'path', { d, fill: 'none', stroke: css(y ? '--warn' : '--calm'), 'stroke-width': 3 });
    el(svg, 'circle', { cx: fx(f), cy: fy(loss(f)), r: 9, fill: css('--ink'), stroke: css('--sf'), 'stroke-width': 2 });
    el(svg, 'text', { x: fx(f) + (f > 0.7 ? -14 : 14), y: fy(loss(f)) - 12, 'text-anchor': f > 0.7 ? 'end' : 'start', 'font-size': 15, 'font-weight': 700, fill: css('--ink') }, `loss ${fmt(loss(f), 3)}`);
    const hit = el(svg, 'rect', { x: L, y: T, width: R - L, height: B - T, fill: 'transparent', style: 'cursor:ew-resize' });
    drag(
      svg,
      hit,
      (q) => {
        f = Math.max(0.01, Math.min(0.99, (q.x - L) / (R - L)));
        redraw();
      },
      win,
    );
    $('kv').innerHTML =
      `<span>what happened</span><b>${y ? 'unhealthy, y = 1' : 'OK, y = 0'}</b><span>the model said</span><b>${fmt(f)}</b><span>this day's loss</span><b>${fmt(loss(f), 3)}</b>` +
      (J ? `<span>cost, all ${num(n)} days</span><b>${fmt(J, 4)}</b>` : '');
    $('co').innerHTML = y
      ? `Tomorrow was unhealthy. Saying 0.9 costs ${fmt(-Math.log(0.9), 2)}; saying 0.1 costs ${fmt(-Math.log(0.1), 2)}, about 22 times more. <b>The cost</b> is this penalty averaged over every training day, using the best model from step 5.`
      : `Tomorrow was OK. Saying 0.1 costs ${fmt(-Math.log(0.9), 2)}; saying 0.9 costs ${fmt(-Math.log(0.1), 2)}. <b>The cost</b> is this penalty averaged over every training day, using the best model from step 5.`;
  }

  document.querySelectorAll('#main .seg button').forEach((bt) => {
    const onClick = () => {
      y = +bt.dataset.y;
      document.querySelectorAll('#main .seg button').forEach((x) => x.classList.toggle('on', x === bt));
      redraw();
    };
    bt.addEventListener('click', onClick);
    off.push(() => bt.removeEventListener('click', onClick));
  });
  katex.render('L(f,y)=\\begin{cases}-\\ln f & y=1\\\\-\\ln(1-f) & y=0\\end{cases}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('J(\\mathbf w,b)=\\frac1m\\sum_{i=1}^{m}L\\big(f_{\\mathbf w,b}(\\mathbf x^{(i)}),\\,y^{(i)}\\big)', $('m2'), { throwOnError: false, displayMode: true });
  off.push(onTheme(redraw));
  redraw();

  ctx.load('lab-rows').then((R) => {
    if (!live) return;
    const x = rowCol(R.train, 'pm2_5_mean'),
      Y = rowCol(R.train, 'y');
    const A = x.map((v) => [v]),
      s = zfit(A),
      Z = zapply(A, s),
      r = descent(Z, Y, [0], 0, 0.5, 600);
    J = cost(Z, Y, r.w, r.b);
    n = Y.length;
    redraw();
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
