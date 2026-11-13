// Model Lab, step 1. Ported from the approved design draft docs/design/AirLabStep1.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { css, el as svgEl, num, onTheme, svgPoint } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:30%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="sk" style="height:56px;border-radius:14px;margin-bottom:16px"></div>
        <div class="split"><div class="sk" style="height:400px;border-radius:14px"></div><div class="sk" style="height:400px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 1 of 17</span>
      <h2 id="st">Data</h2>
      <p class="goal">Each day in each square is one training example: what we know today, and whether the next day turned out unhealthy. Move the line to see which days count as unhealthy, and pick any day to see how the model names it.</p>
      <div class="ctl">
        <label for="thr">Unhealthy above<input id="thr" type="range" min="15" max="80" step="0.1" value="35.4"><b id="thrv"></b></label>
        <button id="reset" type="button">Back to 35.4</button>
        <span class="count" id="count"></span>
      </div>
      <div class="split">
        <figure class="plot">
          <div class="phead"><b id="ptitle"></b><div class="seg" role="group" aria-label="View"><button class="on" data-v="cal" type="button">Every day</button><button data-v="tt" type="button">Today vs tomorrow</button></div></div>
          <svg id="plot" viewBox="0 0 760 330" width="100%" role="img"></svg>
          <figcaption class="note" id="pnote"></figcaption>
        </figure>
        <div class="nota" aria-live="polite">
          <h3>This day, in the model's notation</h3>
          <p class="where" id="where"></p>
          <div class="row"><span class="sym" data-k="i"></span><span class="v" id="vi"></span><span class="d">which example, counting from 0</span></div>
          <div class="row"><span class="sym" data-k="x"></span><span class="v" id="vx"></span><span class="d">PM2.5 today, average of the 12 hours up to noon (μg/m³)</span></div>
          <div class="row"><span class="sym" data-k="y"></span><span class="v" id="vy"></span><span class="d" id="dy"></span></div>
          <div class="row"><span class="sym" data-k="m"></span><span class="v" id="vm"></span><span class="d" id="dm"></span></div>
        </div>
      </div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>A day's PM2.5 is the average of the hours that exist, and it counts only when at least 20 of the 24 do.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The answer the model learns to predict: 1 when tomorrow's average is above the line, 0 when it is not.</p></div>`;

export const skHtml = '';

/** The unhealthy line, the same constant as THRESHOLD in training/labels.py. */
const THRESHOLD = 35.4;
const fmtD = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const prevDay = (s) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  const svg = $('plot');
  let D = null,
    thr = THRESHOLD,
    view = 'cal',
    selC = 5,
    selD = 0,
    live = true;
  const off = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    off.push(() => target.removeEventListener(type, fn));
  };
  const el = (t, a, txt) => svgEl(svg, t, a, txt);
  const tex = (s, e) => katex.render(s, e, { throwOnError: false });
  // example index i in the training table, which is sorted by square, then by day
  const indexOf = (c, d) => {
    let i = 0;
    for (let k = 0; k < c; k++) i += D.cells[k].tomorrow.filter((v) => v !== null).length;
    return i + D.cells[c].tomorrow.slice(0, d).filter((v) => v !== null).length;
  };

  const L = 150,
    R = 752,
    T = 10,
    RH = 24,
    B = T + 12 * RH;
  function calendar() {
    const n = D.days.length,
      w = (R - L) / n,
      warn = css('--warn'),
      calm = css('--calm');
    D.cells.forEach((c, ci) => {
      el('text', { x: L - 8, y: T + ci * RH + RH / 2 + 5, 'text-anchor': 'end', 'font-size': 15, fill: ci === selC ? css('--ink') : css('--mut'), 'font-weight': ci === selC ? 700 : 400 }, c.name);
      c.tomorrow.forEach((v, di) => {
        if (v === null) return;
        const up = v > thr;
        el('rect', { x: L + di * w, y: T + ci * RH + 1, width: w + 0.3, height: RH - 2, fill: up ? warn : calm, 'fill-opacity': up ? 1 : Math.min(0.75, 0.08 + (0.67 * v) / thr) });
      });
    });
    // month marks, and the year under the first month of each year
    D.days.forEach((d, di) => {
      if (d.slice(8) === '01' || di === 0) {
        const x = L + di * w;
        if (d.slice(8) === '01') {
          el('line', { x1: x, x2: x, y1: B, y2: B + 6, stroke: css('--mut') });
          if (x < R - 24) el('text', { x: x + 2, y: B + 20, 'font-size': 14, fill: css('--mut') }, new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3));
        }
        if (di === 0 || d.slice(5, 7) === '01') el('text', { x: x + 2, y: B + 36, 'font-size': 13, 'font-weight': 600, fill: css('--mut') }, d.slice(0, 4));
      }
    });
    el('rect', { x: L + selD * w - 1.5, y: T + selC * RH - 1, width: w + 3, height: RH + 2, fill: 'none', stroke: css('--ink'), 'stroke-width': 2 });
    const hit = el('rect', { x: L, y: T, width: R - L, height: B - T, fill: 'transparent' });
    hit.addEventListener('click', (e) => {
      const q = svgPoint(svg, e);
      const ci = Math.floor((q.y - T) / RH),
        di = Math.floor((q.x - L) / w);
      if (ci >= 0 && ci < 12 && di >= 0 && di < n && D.cells[ci].tomorrow[di] !== null) {
        selC = ci;
        selD = di;
        draw();
      }
    });
    el('text', { x: L, y: B + 56, 'font-size': 14, fill: css('--mut') }, 'Each thin column is one day. Darker teal: more fine dust. Orange: above your line.');
    $('ptitle').textContent = 'Every training day, in every square';
    $('pnote').textContent = 'A row is one forecast square; a column is the day being judged. Winter lights up, summer stays calm, and West Tehran is the dirtiest row by far. Click any day.';
  }
  function scatter() {
    const XM = 150,
      fx = (v) => L + (Math.min(v, XM) / XM) * (R - L),
      fy = (v) => B + 20 - (Math.min(v, XM) / XM) * (B + 20 - T);
    [0, 50, 100, 150].forEach((v) => {
      el('line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') });
      el('text', { x: L - 8, y: fy(v) + 4, 'text-anchor': 'end', 'font-size': 15, fill: css('--mut') }, v);
      el('text', { x: fx(v), y: B + 36, 'text-anchor': 'middle', 'font-size': 15, fill: css('--mut') }, v);
    });
    el('line', { x1: fx(0), y1: fy(0), x2: fx(XM), y2: fy(XM), stroke: css('--mut'), 'stroke-dasharray': '2 4' });
    const warn = css('--warn'),
      calm = css('--calm');
    D.cells.forEach((c) =>
      c.tomorrow.forEach((v, di) => {
        if (v === null) return;
        const t = c.today[di];
        el('circle', { cx: fx(t), cy: fy(v), r: 2.2, fill: v > thr ? warn : calm, 'fill-opacity': v > thr ? 0.75 : 0.35 });
      }),
    );
    el('line', { x1: L, x2: R, y1: fy(thr), y2: fy(thr), stroke: css('--warn'), 'stroke-width': 2, 'stroke-dasharray': '6 4' });
    el('text', { x: R - 4, y: fy(thr) - 6, 'text-anchor': 'end', 'font-size': 15, fill: css('--warn'), 'font-weight': 600 }, 'your line: ' + thr.toFixed(1));
    const s = D.cells[selC];
    el('circle', { cx: fx(s.today[selD]), cy: fy(s.tomorrow[selD]), r: 7, fill: 'none', stroke: css('--ink'), 'stroke-width': 2.5 });
    el('text', { x: (L + R) / 2, y: B + 52, 'text-anchor': 'middle', 'font-size': 15, fill: css('--mut') }, 'PM2.5 today, up to noon (μg/m³)');
    el('text', { x: 24, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 15, fill: css('--mut'), transform: `rotate(-90 24 ${(T + B) / 2})` }, "Tomorrow's average");
    const hit = el('rect', { x: L, y: T, width: R - L, height: B + 20 - T, fill: 'transparent' });
    hit.addEventListener('click', (e) => {
      const q = svgPoint(svg, e);
      let bd = 1e9;
      D.cells.forEach((c, ci) =>
        c.tomorrow.forEach((v, di) => {
          if (v === null) return;
          const dx = fx(c.today[di]) - q.x,
            dy = fy(v) - q.y,
            dd = dx * dx + dy * dy;
          if (dd < bd) {
            bd = dd;
            selC = ci;
            selD = di;
          }
        }),
      );
      draw();
    });
    $('ptitle').textContent = "Today's air against tomorrow's";
    $('pnote').textContent = "Each dot is one example. Most dots sit near the dotted diagonal: tomorrow tends to look like today. That is why today's PM2.5 is the first input. Dots far from it are days the air changed, often with the weather.";
  }
  function draw() {
    svg.innerHTML = '';
    if (!D) return;
    svg.setAttribute('viewBox', view === 'cal' ? '0 0 760 366' : '0 0 760 340');
    if (view === 'cal') calendar();
    else scatter();
    svg.setAttribute('aria-label', view === 'cal' ? 'Calendar of all training days by square, unhealthy days in orange' : "Today's PM2.5 against tomorrow's average for every training example");
    const c = D.cells[selC],
      v = c.tomorrow[selD],
      t = c.today[selD],
      d = D.days[selD];
    $('where').textContent = `${c.name}. Known on ${fmtD(prevDay(d))}; judged on ${fmtD(d)}.`;
    $('vi').textContent = num(indexOf(selC, selD));
    $('vx').textContent = t.toFixed(1);
    $('vy').textContent = v > thr ? '1' : '0';
    $('dy').textContent = `tomorrow averaged ${v.toFixed(1)} μg/m³: ${v > thr ? 'above' : 'not above'} the line, so ${v > thr ? 'unhealthy' : 'OK'}`;
    let all = 0,
      up = 0;
    D.cells.forEach((cc) =>
      cc.tomorrow.forEach((x) => {
        if (x !== null) {
          all++;
          if (x > thr) up++;
        }
      }),
    );
    $('count').innerHTML = `<b>${num(up)}</b> of ${num(all)} days above the line (${((up / all) * 100).toFixed(1)}%)`;
    $('thrv').textContent = thr.toFixed(1) + ' μg/m³';
  }

  const thrI = $('thr');
  on(thrI, 'input', () => {
    thr = +thrI.value;
    draw();
  });
  on($('reset'), 'click', () => {
    thr = THRESHOLD;
    thrI.value = String(THRESHOLD);
    draw();
  });
  document.querySelectorAll('[data-k]').forEach((e) => tex({ i: 'i', x: 'x^{(i)}', y: 'y^{(i)}', m: 'm' }[e.dataset.k], e));
  tex('\\text{daily PM2.5}=\\frac{1}{n_h}\\sum_{h}\\text{PM2.5}_h,\\qquad n_h\\ge 20', $('m1'));
  tex("y^{(i)}=\\begin{cases}1 & \\text{tomorrow's average} > 35.4\\\\0 & \\text{otherwise}\\end{cases}", $('m2'));
  const segs = document.querySelectorAll('#main .seg button');
  segs.forEach((b) =>
    on(b, 'click', () => {
      view = b.dataset.v;
      segs.forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }),
  );
  off.push(onTheme(draw));

  ctx.load('lab-days').then((d) => {
    if (!live) return;
    D = d;
    // start on a winter day in West Tehran that was unhealthy
    selD = D.days.findIndex((x, i) => x >= '2024-12-10' && D.cells[5].tomorrow[i] > THRESHOLD);
    if (selD < 0) selD = 0;
    $('vm').textContent = num(D.m);
    $('dm').textContent = `training examples: ${D.cells.length} squares × ${D.days.length} days`;
    const main = $('main');
    main.classList.remove('skel');
    main.setAttribute('aria-busy', 'false');
    draw();
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
