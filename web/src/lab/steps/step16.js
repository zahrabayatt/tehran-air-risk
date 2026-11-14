// Model Lab, step 16. Ported from the approved design draft docs/design/AirLabStep16.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
// Every number is version 2's, read from model.json: the three costs, the rows and date ranges of the
// three parts, the two baselines, the scikit-learn check and the reliability bins.
import katex from 'katex';
import { css, el, fmt, num, onTheme } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="sk" style="height:60px;border-radius:14px;margin-bottom:18px"></div><div class="sk" style="height:110px;border-radius:14px"></div></section>
      <section class="card"><div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 16 of 17</span>
      <h2 id="st">Held-out result</h2>
      <p class="goal">The final check. The live model, everything from steps 1 to 15, is scored once on a year of days it never saw and that played no part in any choice.</p>
      <div class="time" id="time" aria-label="How the days were used"></div>
  <div class="three"><div class="num" style="--c:var(--ac)"><span>Cost on the training days</span><b id="trainv"></b><small>what it learned from</small></div>
   <div class="num" style="--c:var(--cn)"><span>Cost on the choosing months</span><b id="selv"></b><small>used to pick λ</small></div>
   <div class="num" style="--c:var(--warn)"><span>Cost on the held-out year</span><b id="heldv"></b><small>never seen, never used to choose</small></div></div>
  <p class="small" id="whyNote"></p>
  <p class="small">This year was a second look: an earlier version was checked on it before. The numbers are honest about this model, but not a perfectly fresh test.</p>
    </section>
    <section class="card" aria-labelledby="st2"><h2 id="st2" style="margin-top:0">Every held-out day</h2>
  <div class="two"><figure class="plot"><div class="phead"><b>When it said this, how often it came</b></div>
    <div class="pbox"><svg id="r" viewBox="0 0 520 420" width="100%" role="img" aria-label="Reliability: the chance the model gave against how often the day was unhealthy"></svg></div>
    <figcaption class="note" id="relNote"></figcaption></figure>
   <div class="side"><div class="box" id="bincard"></div>
    <div class="box"><h3>How the chances spread</h3><div class="bars" id="hist"></div><p class="small" id="histNote"></p></div></div></div>
    </section>
    <section class="card" aria-labelledby="st3"><h2 id="st3" style="margin-top:0">Checked against scikit-learn</h2>
  <p class="goal">The same inputs and penalty, fitted by scikit-learn and scored on the same held-out year.</p>
  <div class="cmp"><div class="cm"><span>This project, from scratch</span><b id="myv"></b><small id="mysub"></small></div>
   <div class="cm"><span>scikit-learn LogisticRegression</span><b id="skv"></b><small id="sksub"></small></div>
   <div class="cm"><span>Largest weight difference</span><b id="dwv"></b><small id="dbsub"></small></div></div>
  <div class="two" style="margin-top:16px"><div class="box"><h3>Run it yourself</h3><pre class="cmd">python -m training.train</pre><p class="small">Builds the daily rows, trains, picks λ on the choosing months, then scores the held-out year once. Every number on this page comes from that run's saved model.</p></div>
   <div class="box"><h3>Too cautious in the middle</h3><p class="small" id="cautious"></p></div></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The cost, on days used for nothing else.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>For a trustworthy chance, came_k sits near the middle of band k.</p></div>`;

export const skHtml = '';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fd = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const exp = (v) => v.toExponential(1);

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let M = null,
    B = [],
    total = 0,
    sel = 3,
    live = true;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };

  function bands() {
    const h = M.held_out_probabilities;
    return h.counts_y1.map((u, k) => {
      const n = u + h.counts_y0[k],
        lo = h.bins[k],
        hi = h.bins[k + 1];
      return { k, u, n, lo, hi, mid: (lo + hi) / 2, s: n ? u / n : 0 };
    });
  }

  function fill() {
    const r = M.rows,
      dr = M.date_range,
      c = M.cost,
      bs = M.baselines,
      sk = M.sklearn_cost,
      hp = M.hyperparameters;
    const parts = [
      [dr.train, r.train, 'learn the weights', 'var(--acs)'],
      [dr.selection, r.selection, 'pick inputs and λ', 'rgba(143,188,255,.16)'],
      [dr.held_out, r.held_out, 'the final score', 'rgba(242,167,102,.18)'],
    ];
    const span = parts.map(([p]) => Math.max(days(p.start, p.end), 190));
    $('time').style.gridTemplateColumns = span.map((v) => v + 'fr').join(' ');
    $('time').innerHTML = parts.map(([p, n, what, bg]) => `<div style="background:${bg}"><b>${fd(p.start)} to ${fd(p.end)}</b><span>${num(n)} rows: ${what}</span></div>`).join('');
    $('trainv').textContent = fmt(c.train, 4);
    $('selv').textContent = fmt(c.selection, 4);
    $('heldv').textContent = fmt(c.held_out, 4);
    const bo = bs.overall.held_out_cost,
      bm = bs.monthly.held_out_cost,
      pc = [...new Set([c.held_out / bo, c.held_out / bm].map((v) => Math.round(v * 100)))];
    $('whyNote').innerHTML = `The held-out year costs more than the choosing months mostly because it holds a whole winter, when unhealthy days are common, while May to November is mostly clean air. Against simple guesses on the same year: giving every day the same chance (${fmt(bs.overall.rate * 100, 1)}%) costs <b>${fmt(bo, 4)}</b>, and each month's usual chance costs <b>${fmt(bm, 4)}</b>. The model's cost is about ${pc.join('% to ')}% of either.`;
    $('relNote').textContent = `All ${num(r.held_out)} held-out rows, grouped by the chance the model gave. Bigger dot, more days. On the dashed line, "3 in 10" would mean exactly 3 in 10 came. Click a dot or a bar to see that group.`;
    $('myv').textContent = fmt(c.held_out, 4);
    $('mysub').textContent = `gradient descent, α ${hp.alpha}, ${num(hp.iterations)} steps, λ ${hp.lambda}`;
    $('skv').textContent = fmt(sk.held_out, 4);
    $('sksub').textContent = `C = ${sk.C}, the same penalty as λ = ${hp.lambda}`;
    $('dwv').textContent = exp(sk.max_abs_weight_difference);
    $('dbsub').textContent = `b differs by ${exp(sk.bias_difference)}: the same model`;
    // "too cautious": the bands where more days turned unhealthy than the model said
    const over = B.filter((d) => d.n && d.s > d.hi);
    if (over.length) {
      const runs = [];
      over.forEach((d) => {
        const last = runs[runs.length - 1];
        if (last && last[last.length - 1].k === d.k - 1) last.push(d);
        else runs.push([d]);
      });
      const rng = runs.map((g) => `${Math.round(g[0].lo * 10)} to ${Math.round(g[g.length - 1].hi * 10)} in 10`).join(' and from ');
      const w = over.reduce((a, d) => (d.s - d.mid > a.s - a.mid ? d : a));
      $('cautious').textContent = `From ${rng} the dots sit above the line: when the model says ${Math.round(w.lo * 10)} to ${Math.round(w.hi * 10)} in 10, about ${Math.round(w.s * 10)} in 10 turn unhealthy. The forecast page says so beside its numbers.`;
    } else {
      $('cautious').textContent = 'No group sits above the line: in every group, no more days turned unhealthy than the model said.';
    }
  }

  function redraw() {
    if (!M) return;
    const b = B[sel],
      r = $('r');
    r.innerHTML = '';
    const L = 60,
      R = 500,
      T = 16,
      Bt = 360,
      fx = (v) => L + v * (R - L),
      fy = (v) => Bt - v * (Bt - T);
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((v) => {
      el(r, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') });
      el(r, 'text', { x: L - 8, y: fy(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: css('--mut') }, Math.round(v * 10) + ' in 10');
      el(r, 'text', { x: fx(v), y: Bt + 18, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut') }, Math.round(v * 10) + ' in 10');
    });
    el(r, 'line', { x1: fx(0), y1: fy(0), x2: fx(1), y2: fy(1), stroke: css('--mut'), 'stroke-dasharray': '6 6' });
    el(r, 'text', { x: (L + R) / 2, y: Bt + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'Chance the model gave');
    el(r, 'text', { x: 14, y: (T + Bt) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + Bt) / 2})` }, 'How often it was unhealthy');
    B.forEach((d) => {
      if (!d.n) return;
      const g = el(r, 'g', { style: 'cursor:pointer', 'data-k': d.k });
      el(g, 'circle', { cx: fx(d.mid), cy: fy(d.s), r: Math.max(6, Math.min(20, Math.sqrt(d.n) * 0.9)), fill: css(d.s > d.hi ? '--warn' : '--ac'), 'fill-opacity': d.k === sel ? 1 : 0.7, stroke: d.k === sel ? css('--ink') : 'none', 'stroke-width': 2.5 });
    });
    $('bincard').innerHTML = `<h3>Said ${Math.round(b.lo * 10)} to ${Math.round(b.hi * 10)} in 10</h3><div class="adrow"><span>Days in this group</span><b>${num(b.n)}</b><span>Turned unhealthy</span><b>${num(b.u)}</b><span>Share unhealthy</span><b class="${b.s > b.hi || b.s < b.lo ? 'off' : ''}">${Math.round(b.s * 100)}%</b><span>What the model said</span><b>${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)}%</b></div><p class="small">${b.s > b.hi ? 'More came than it said: too cautious here.' : b.s < b.lo ? 'Fewer came than it said.' : 'About what it said.'}</p>`;
    const mx = Math.max(...B.map((d) => d.n));
    $('hist').innerHTML = B.map((d) => `<div class="hb${d.k === sel ? ' on' : ''}" data-k="${d.k}"><span>${fmt(d.lo, 1)} to ${fmt(d.hi, 1)}</span><div class="tr"><i style="width:${((d.u / mx) * 100).toFixed(2)}%;background:var(--warn)"></i><i style="width:${(((d.n - d.u) / mx) * 100).toFixed(2)}%;background:var(--ac);opacity:.55"></i></div><b>${num(d.n)}</b></div>`).join('');
    const b0 = B[0];
    $('histNote').innerHTML = `Days per group: orange turned unhealthy, teal did not. <b>${Math.round((b0.n / total) * 100)}%</b> of the held-out rows got a chance under 1 in 10, and ${Math.round((1 - b0.u / b0.n) * 100)}% of those stayed OK.`;
  }

  on($('main'), 'click', (e) => {
    const g = e.target.closest('[data-k]');
    if (!g || !M) return;
    sel = +g.dataset.k;
    redraw();
  });
  off.push(onTheme(() => M && redraw()));
  katex.render('J_{\\text{test}}=\\frac1{m_{\\text{test}}}\\sum_i L\\big(f^{(i)},y^{(i)}\\big)', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('\\text{came}_k=\\frac{\\#\\{i: f^{(i)}\\in\\text{band }k,\\ y^{(i)}=1\\}}{\\#\\{i: f^{(i)}\\in\\text{band }k\\}}', $('m2'), { throwOnError: false, displayMode: true });

  ctx.load('model').then((m) => {
    if (!live) return;
    M = m;
    B = bands();
    total = B.reduce((s, d) => s + d.n, 0);
    fill();
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
