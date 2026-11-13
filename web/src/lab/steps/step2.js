// Model Lab, step 2. Ported from the approved design draft docs/design/AirLabStep2.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { css, el as svgEl, onTheme, svgPoint } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="sk" style="height:34px;width:60%;border-radius:999px;margin-bottom:14px"></div>
        <div class="split"><div class="sk" style="height:440px;border-radius:14px"></div><div class="sk" style="height:440px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 2 of 17</span>
      <h2 id="st">The question and its timing</h2>
      <p class="goal">Every afternoon the model answers one question: will tomorrow's average PM2.5 be above 35.4? It may only use what is known by noon today: this morning's air, and tomorrow's weather as forecast this morning. Drag through the two days to see what is known when.</p>
      <div class="seg cases" role="group" aria-label="Example"><button class="on" data-c="0" type="button">Wind cleans it up</button><button data-c="1" type="button">It builds up</button><button data-c="2" type="button">It stays dirty</button></div>
      <div class="split">
        <figure class="plot">
          <div class="phead"><b id="ptitle"></b></div>
          <svg id="tl" class="tl" viewBox="0 0 760 440" width="100%" role="img"></svg>
          <figcaption class="note" id="pnote"></figcaption>
        </figure>
        <div class="nota" aria-live="polite">
          <h3>Known at this moment</h3>
          <p class="now" id="now"></p>
          <ul class="know" id="know"></ul>
          <h3 style="margin-top:18px">This example's inputs</h3>
          <div class="xv" id="xv"></div>
        </div>
      </div>
      <div class="ctl" style="margin:16px 0 0">
        <label for="t">Move through the two days<input id="t" type="range" min="0" max="48" step="0.25" value="12"></label>
        <button id="noon" type="button">Go to noon today</button>
      </div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>Every input is known by noon on day D. Tomorrow's weather enters as a forecast made that morning, never as the weather that happened.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The answer comes from the day after: the average of its hours, against the line.</p></div>`;

export const skHtml = '';

// Times in hours from 00:00 on day D, Tehran time
const RUN_START = 3.5,
  RUN_READY = 3.5 + 6.4,
  CUTOFF = 12,
  FIRST_TRY = 14,
  JUDGED_END = 48,
  THRESHOLD = 35.4;
const fmtD = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const clock = (h) => {
  const d = h >= 24 ? 'tomorrow' : 'today',
    m = Math.round((h % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} ${h >= 48 ? '(end of tomorrow)' : d}`;
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function inputs(c) {
  const morning = c.pm.filter(([h]) => h < 12).map(([, v]) => v);
  const tw = c.wx.filter(([h]) => h >= 24 && h < 48);
  const doy = (Date.parse(c.target + 'T12:00:00Z') - Date.parse(c.target.slice(0, 4) + '-01-01T12:00:00Z')) / 864e5 + 1,
    ang = (2 * Math.PI * doy) / 365.25;
  return [
    ['PM2.5, average to noon', mean(morning), 'μg/m³', 0],
    ['PM2.5, highest hour', Math.max(...morning), 'μg/m³', 0],
    ['PM2.5, last hour (11:30)', morning[morning.length - 1], 'μg/m³', 0],
    ['season, sine', Math.sin(ang), '', 0],
    ['season, cosine', Math.cos(ang), '', 0],
    ["tomorrow's wind (forecast)", mean(tw.map((r) => r[1])), 'km/h', 1],
    ["tomorrow's air ceiling (forecast)", mean(tw.map((r) => r[2])), 'm', 1],
    ["tomorrow's rain (forecast)", tw.reduce((s, r) => s + r[3], 0), 'mm', 1],
  ];
}

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { win, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  const svg = $('tl');
  let C = null,
    ci = 0,
    now = 12,
    live = true;
  const off = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    off.push(() => target.removeEventListener(type, fn));
  };
  const el = (t, a, txt) => svgEl(svg, t, a, txt);
  const tex = (s, e) => katex.render(s, e, { throwOnError: false });
  const L = 60,
    R = 740,
    fx = (h) => L + (h / 48) * (R - L);

  function draw() {
    svg.innerHTML = '';
    if (!C) return;
    const c = C[ci],
      ink = css('--ink'),
      mut = css('--mut'),
      rule = css('--rule'),
      warn = css('--warn'),
      calm = css('--calm');
    // top panel: PM2.5 through both days
    const T1 = 24,
      B1 = 240,
      PM = Math.max(80, ...c.pm.map((r) => r[1])) * 1.05,
      fy = (v) => B1 - (v / PM) * (B1 - T1);
    el('rect', { x: fx(0), y: T1, width: fx(CUTOFF) - fx(0), height: B1 - T1, fill: calm, 'fill-opacity': 0.12 });
    el('text', { x: fx(0) + 6, y: T1 + 16, 'font-size': 14, 'font-weight': 600, fill: calm }, 'what the model reads');
    el('rect', { x: fx(24), y: T1, width: fx(48) - fx(24), height: B1 - T1, fill: warn, 'fill-opacity': 0.1 });
    el('text', { x: fx(24) + 6, y: T1 + 16, 'font-size': 14, 'font-weight': 600, fill: warn }, 'the day it judges');
    [0, 25, 50, 75, 100, 125]
      .filter((v) => v < PM)
      .forEach((v) => {
        el('line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: rule });
        el('text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 14, fill: mut }, v);
      });
    el('line', { x1: L, x2: R, y1: fy(THRESHOLD), y2: fy(THRESHOLD), stroke: warn, 'stroke-dasharray': '6 4' });
    el('text', { x: fx(13) + 4, y: fy(THRESHOLD) - 6, 'font-size': 13, fill: warn }, String(THRESHOLD));
    el('path', { d: 'M' + c.pm.map(([h, v]) => `${fx(h).toFixed(1)} ${fy(v).toFixed(1)}`).join('L'), fill: 'none', stroke: ink, 'stroke-width': 2 });
    const tm = c.tomorrow_mean;
    el('line', { x1: fx(24), x2: fx(48), y1: fy(tm), y2: fy(tm), stroke: warn, 'stroke-width': 3 });
    el('text', { x: fx(47.5), y: fy(tm) - 8, 'text-anchor': 'end', 'font-size': 14, 'font-weight': 700, fill: warn }, `tomorrow's average ${tm.toFixed(1)}: ${tm > THRESHOLD ? 'y = 1' : 'y = 0'}`);
    el('text', { x: 22, y: (T1 + B1) / 2, 'text-anchor': 'middle', 'font-size': 14, fill: mut, transform: `rotate(-90 22 ${(T1 + B1) / 2})` }, 'PM2.5 (μg/m³)');
    // bottom panel: tomorrow's weather, as forecast this morning
    const T2 = 290,
      B2 = 380,
      w = c.wx,
      WM = Math.max(20, ...w.map((r) => r[1])) * 1.1,
      HM = Math.max(1000, ...w.map((r) => r[2])) * 1.1;
    const fw = (v) => B2 - (v / WM) * (B2 - T2),
      fh = (v) => B2 - (v / HM) * (B2 - T2);
    el('text', { x: L, y: T2 - 12, 'font-size': 14, 'font-weight': 600, fill: ink }, "Tomorrow's weather, as forecast at 03:30 today (ready about 10:00)");
    el('path', { d: 'M' + w.map(([h, , b]) => `${fx(h).toFixed(1)} ${fh(b).toFixed(1)}`).join('L') + `L${fx(w[w.length - 1][0])} ${B2}L${fx(w[0][0])} ${B2}Z`, fill: calm, 'fill-opacity': 0.18 });
    el('path', { d: 'M' + w.map(([h, v]) => `${fx(h).toFixed(1)} ${fw(v).toFixed(1)}`).join('L'), fill: 'none', stroke: calm, 'stroke-width': 2 });
    w.forEach(([h, , , p]) => {
      if (p > 0) el('rect', { x: fx(h) - 2, y: B2 - Math.min(40, p * 20), width: 4, height: Math.min(40, p * 20), fill: ink, 'fill-opacity': 0.6 });
    });
    el('line', { x1: L, x2: R, y1: B2, y2: B2, stroke: rule });
    el('text', { x: R, y: T2 + 4, 'text-anchor': 'end', 'font-size': 13, fill: mut }, 'line: wind (km/h) · shaded: air ceiling · bars: rain');
    // time axis
    [[0, '00:00 today'], [12, 'noon'], [24, '00:00 tomorrow'], [36, 'noon'], [48, '24:00']].forEach(([h, t]) => {
      el('line', { x1: fx(h), x2: fx(h), y1: T1, y2: B2 + 6, stroke: rule });
      el('text', { x: fx(h), y: B2 + 24, 'text-anchor': h === 0 ? 'start' : h === 48 ? 'end' : 'middle', 'font-size': 14, fill: mut }, t);
    });
    el('text', { x: fx(6), y: B2 + 42, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 600, fill: ink }, fmtD(c.today));
    el('text', { x: fx(36), y: B2 + 42, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 600, fill: ink }, fmtD(c.target));
    el('line', { x1: fx(CUTOFF), x2: fx(CUTOFF), y1: T1 - 6, y2: B2, stroke: ink, 'stroke-width': 2, 'stroke-dasharray': '5 4' });
    el('text', { x: fx(CUTOFF), y: T1 - 10, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: ink }, 'cutoff 12:00');
    // the moving "now"
    el('line', { x1: fx(now), x2: fx(now), y1: T1, y2: B2 + 2, stroke: warn, 'stroke-width': 3 });
    el('circle', { cx: fx(now), cy: B2 + 2, r: 8, fill: warn, stroke: css('--sf'), 'stroke-width': 2 });
    const hit = el('rect', { x: L, y: T1, width: R - L, height: B2 - T1, fill: 'transparent' });
    const move = (e) => setNow(((svgPoint(svg, e).x - L) / (R - L)) * 48);
    hit.addEventListener('pointerdown', (e) => {
      move(e);
      const mv = (ev) => move(ev),
        up = () => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
        };
      win.addEventListener('pointermove', mv);
      win.addEventListener('pointerup', up);
    });
    svg.setAttribute('aria-label', `${c.title}: PM2.5 hour by hour on ${fmtD(c.today)} and ${fmtD(c.target)}, with tomorrow's weather forecast`);
    $('ptitle').textContent = `West Tehran, ${fmtD(c.today)} and ${fmtD(c.target)}`;
    const notes = [
      `This morning was dirty, but the forecast made today shows strong wind tomorrow, and tomorrow came out at ${tm.toFixed(1)}. Without the weather, the model would only see a dirty morning.`,
      `This morning was clean, but the forecast shows little wind and a low air ceiling tomorrow: dust stays close to the ground. Tomorrow came out at ${tm.toFixed(1)}.`,
      `Dirty this morning, and the forecast shows still air tomorrow, so the dust stays. Tomorrow came out at ${tm.toFixed(1)}.`,
    ];
    $('pnote').textContent = notes[ci];
    know();
    xvec();
  }
  function know() {
    const c = C[ci],
      h = now,
      read = c.pm.filter(([t]) => t < 12 && t <= h).length;
    const items = [
      [h >= 0.5, read >= 12 ? "This morning's air: all 12 hours the model reads (00:30 to 11:30)." : read > 0 ? `This morning's air: ${read} of the 12 hours so far.` : "This morning's air: not yet."],
      [h >= RUN_READY, h >= RUN_READY ? "Tomorrow's weather forecast: ready (made at 03:30, published about 10:00)." : h >= RUN_START ? "Tomorrow's weather forecast: being made, ready about 10:00." : "Tomorrow's weather forecast: not made yet (starts 03:30)."],
      [h >= CUTOFF, h >= CUTOFF ? 'The inputs are fixed: nothing after 12:00 is used.' : 'Inputs still filling up until 12:00.'],
      [h >= FIRST_TRY, h >= FIRST_TRY ? 'The forecast for tomorrow can be saved (first try 14:00).' : 'The forecast is not saved yet (first try 14:00).'],
      [h >= JUDGED_END, h >= JUDGED_END ? `Tomorrow's real air: known. Average ${c.tomorrow_mean.toFixed(1)}, so y = ${c.tomorrow_mean > THRESHOLD ? 1 : 0}.` : "Tomorrow's real air: not known until the end of tomorrow."],
    ];
    $('now').textContent = clock(h);
    $('know').innerHTML = items.map(([ok, t]) => `<li class="${ok ? 'yes' : 'no'}"><i>${ok ? '✓' : '·'}</i><span>${t}</span></li>`).join('');
  }
  function xvec() {
    $('xv').innerHTML =
      inputs(C[ci])
        .map(([n, v, u, isNew], j) => `<span class="k">x${j + 1}</span><span class="${isNew ? 'new' : ''}">${n}</span><span class="v">${Math.abs(v) < 10 && u === '' ? v.toFixed(2) : v.toFixed(u === 'mm' ? 1 : u === 'm' ? 0 : 1)} ${u}</span>`)
        .join('') + `<span class="k">y</span><span>tomorrow above ${THRESHOLD}?</span><span class="v">${C[ci].tomorrow_mean > THRESHOLD ? 1 : 0}</span>`;
  }
  function setNow(h) {
    now = Math.max(0, Math.min(48, Math.round(h * 4) / 4));
    $('t').value = String(now);
    draw();
  }

  on($('t'), 'input', (e) => setNow(+e.target.value));
  on($('noon'), 'click', () => setNow(12));
  const cases = document.querySelectorAll('#main .cases button');
  cases.forEach((b) =>
    on(b, 'click', () => {
      ci = +b.dataset.c;
      cases.forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }),
  );
  tex('x^{(i)}=\\big[\\,\\text{PM2.5 up to 12:00 on }D,\\ \\text{season},\\ \\text{weather forecast for }D{+}1\\,\\big]', $('m1'));
  tex('y^{(i)}=1\\ \\text{ if the average of day }D{+}1>35.4,\\ \\text{else }0', $('m2'));
  win.addEventListener('resize', draw);
  off.push(onTheme(draw));

  ctx.load('lab-timing').then((d) => {
    if (!live) return;
    C = d;
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
