// Model Lab, step 11. Ported from the approved design draft docs/design/AirLabStep11.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { ICON_PAUSE, ICON_PLAY, ICON_RESET, ICON_STEP, css, el, fitExact, fmt, num, onTheme, rowCol, sigmoid, zapply, zfit } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:420px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 11 of 17</span>
      <h2 id="st">Learning rate</h2>
      <p class="goal">α sets how big each step down the cost is. Race several values on the same <span id="ndays">…</span> days, from the same start, and see which one gets lowest fastest.</p>
      <div class="player" role="group" aria-label="Training controls">
   <div class="prow"><button id="play" class="play" type="button" aria-label="Start the race">${ICON_PLAY}</button>
    <button id="step" class="ibtn" type="button" aria-label="One step">${ICON_STEP}<span>Step</span></button>
    <button id="reset" class="ibtn" type="button" aria-label="Reset, back to the start">${ICON_RESET}<span>Reset</span></button>
    <div class="scrub"><input id="scrub" type="range" min="0" max="300" value="0" aria-label="Step in the race"><div class="slab"><span>step <b id="sk">0</b> of <b id="sn">300</b></span></div></div>
    <div class="opt"><span>Steps</span><div class="seg" role="group" aria-label="Number of steps" id="iters"><button data-n="100" type="button">100</button><button class="on" data-n="300" type="button">300</button><button data-n="1000" type="button">1,000</button></div></div></div>
   <div class="lanes" role="group" aria-label="Learning rates in the race"><span class="lh">In the race</span><div class="ls" id="lanes"></div>
    <label class="own"><span class="sw" style="background:var(--c4)"></span><span>Your own α</span><input id="own" type="range" min="-1" max="1.6" step="0.01" value="0.7" aria-label="Your own learning rate"><b id="ownv"></b></label></div>
   <span class="sandbox">Sandbox: the live model is not changed. The four fixed values are each about 3 times the one before.</span></div>
  <div class="two"><figure class="plot"><div class="phead"><b>Cost after each step</b></div>
    <div class="pbox"><svg id="cost" viewBox="0 0 520 380" width="100%" role="img" aria-label="Cost after each step, one line per learning rate"></svg></div>
    <figcaption class="note">One line per α, all from the same start (every weight 0). Both axes are on a log scale, so the first few steps, where the race is decided, get room.</figcaption></figure>
   <figure class="plot"><div class="phead"><b>The PM2.5 weight, first 30 steps</b></div>
    <div class="pbox"><svg id="wt" viewBox="0 0 520 380" width="100%" role="img" aria-label="The weight on today's PM2.5 over the first 30 steps, one line per learning rate"></svg></div>
    <figcaption class="note" id="wnote"></figcaption></figure></div>
  <figure class="plot" style="margin-top:18px"><div class="phead"><b>Standings at step <span id="stk">0</span></b></div><div id="board" class="board"></div>
   <figcaption class="note">Ranked by cost now: lower is better. The bar shows how far each run still is from the best possible cost, <span id="jmin"></span>.</figcaption></figure>
  <div class="box pick"><h3>How to pick α</h3><ol id="howto"></ol></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>α multiplies every step. Double α and every step is twice as long.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>Past a certain size, each step lands on the far side of the valley, higher than before.</p></div>`;

export const skHtml = '';

const FIXED = [0.3, 1, 3, 10];
const COLS = ['pm2_5_mean', 'pm2_5_max', 'pm2_5_last', 'season_sin', 'season_cos', 'wx_wind', 'wx_blh', 'wx_precip', 'wx_temp', 'wx_rh'];

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { setTimeout, requestAnimationFrame, cancelAnimationFrame, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  const csv = $('cost'),
    wsv = $('wt'),
    L = 56,
    R = 440,
    T = 16,
    B = 320,
    WSPAN = 30;
  const lanes = FIXED.map((a, i) => ({ a, c: '--c' + i, on: true })).concat([{ a: 5, c: '--c4', on: true, own: true }]);
  let Z = null,
    Yv = null,
    m = 0,
    n = 0,
    Jmin = 0,
    N = 300,
    k = 0,
    playing = false,
    timer = 0,
    live = true;
  const J0 = Math.log(2);
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };
  const clamp = (v, a, c) => Math.max(a, Math.min(c, v)),
    fa = (a) => String(+a.toPrecision(2));
  function Jw(w, b) {
    let s = 0;
    for (let i = 0; i < m; i++) {
      let z = b;
      const o = i * n;
      for (let j = 0; j < n; j++) z += Z[o + j] * w[j];
      s += Yv[i] ? (z > 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z))) : z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
    }
    return s / m;
  }
  function run(l) {
    let w = new Float64Array(n),
      b = 0;
    l.J = [J0];
    l.w0 = [0];
    l.up = 0;
    for (let it = 0; it < N; it++) {
      const g = new Float64Array(n);
      let gb = 0;
      for (let i = 0; i < m; i++) {
        let z = b;
        const o = i * n;
        for (let j = 0; j < n; j++) z += Z[o + j] * w[j];
        const e = sigmoid(z) - Yv[i];
        for (let j = 0; j < n; j++) g[j] += e * Z[o + j];
        gb += e;
      }
      for (let j = 0; j < n; j++) w[j] -= (l.a * g[j]) / m;
      b -= (l.a * gb) / m;
      const J = Jw(w, b);
      if (!l.up && J > l.J[l.J.length - 1] + 1e-12) l.up = it + 1;
      l.J.push(J);
      l.w0.push(w[0]);
    }
    let flips = 0;
    for (let i = 2; i < Math.min(16, l.w0.length); i++) {
      const d1 = l.w0[i] - l.w0[i - 1],
        d0 = l.w0[i - 1] - l.w0[i - 2];
      if (d1 * d0 < 0) flips++;
    }
    l.zig = flips >= 4;
  }
  function runAll() {
    lanes.forEach(run);
    const sc = $('scrub');
    sc.max = N;
    $('sn').textContent = num(N);
  }
  function spread(items, gap, lo, hi) {
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    const over = items.length ? items[items.length - 1].y - hi : 0;
    if (over > 0)
      for (let i = items.length - 1; i >= 0; i--) {
        items[i].y -= over;
        if (i && items[i].y - items[i - 1].y >= gap) break;
      }
    items.forEach((it) => (it.y = Math.max(lo, it.y)));
    return items;
  }
  function drawCost() {
    csv.innerHTML = '';
    const top = J0 * 1.15,
      bot = Jmin * 0.97,
      X = (i) => L + (Math.log10(i + 1) / Math.log10(N + 1)) * (R - L),
      Y = (v) => B - (Math.log(Math.min(v, top) / bot) / Math.log(top / bot)) * (B - T);
    [0.15, 0.2, 0.3, 0.4, 0.5, 0.7].forEach((v) => {
      el(csv, 'line', { x1: L, x2: R, y1: Y(v), y2: Y(v), stroke: css('--rule') });
      el(csv, 'text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: css('--mut') }, v);
    });
    [0, 1, 10, 100, 1000]
      .filter((v) => v <= N)
      .concat([N])
      .filter((v, i, a) => a.indexOf(v) === i)
      .forEach((v) => {
        el(csv, 'line', { x1: X(v), x2: X(v), y1: T, y2: B, stroke: css('--rule') });
        el(csv, 'text', { x: X(v), y: B + 18, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut') }, num(v));
      });
    el(csv, 'line', { x1: L, x2: R, y1: Y(Jmin), y2: Y(Jmin), stroke: css('--ink'), 'stroke-dasharray': '4 4', opacity: 0.6 });
    el(csv, 'text', { x: L + 6, y: Y(Jmin) + 16, 'font-size': 11, fill: css('--mut') }, 'best possible ' + Jmin.toFixed(4));
    el(csv, 'text', { x: (L + R) / 2, y: B + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'Step (log scale)');
    el(csv, 'text', { x: 14, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + B) / 2})` }, 'Cost J (log scale)');
    const labs = [];
    lanes
      .filter((l) => l.on)
      .forEach((l) => {
        const end = Math.min(k, l.J.length - 1);
        let d = '';
        for (let i = 0; i <= end; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(l.J[i]).toFixed(1);
        el(csv, 'path', { d, fill: 'none', stroke: css(l.c), 'stroke-width': l.own ? 2.6 : 2.2, 'stroke-linejoin': 'round' });
        const ty = Y(l.J[end]);
        el(csv, 'circle', { cx: X(end), cy: ty, r: 4, fill: css(l.c) });
        labs.push({ y: ty, t: fa(l.a), c: l.c });
      });
    spread(labs, 15, T + 4, B - 4).forEach((it) => el(csv, 'text', { x: R + 8, y: it.y + 4, 'font-size': 12, 'font-weight': 600, 'font-family': 'Geist Mono Variable, monospace', fill: css(it.c) }, it.t));
  }
  function drawW() {
    wsv.innerHTML = '';
    const on_ = lanes.filter((l) => l.on),
      all = on_.flatMap((l) => l.w0.slice(0, WSPAN + 1)),
      lo = Math.min(0, ...all) - 0.05,
      hi = Math.max(...all) + 0.05,
      X = (i) => L + (i / WSPAN) * (R - L),
      Y = (v) => B - ((v - lo) / (hi - lo)) * (B - T),
      kk = Math.min(k, WSPAN);
    const stepT = hi - lo > 2 ? 0.5 : 0.2;
    for (let v = Math.ceil(lo / stepT) * stepT; v <= hi; v += stepT) {
      el(wsv, 'line', { x1: L, x2: R, y1: Y(v), y2: Y(v), stroke: Math.abs(v) < 1e-9 ? css('--mut') : css('--rule') });
      el(wsv, 'text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: css('--mut') }, fmt(v, 1));
    }
    [0, 10, 20, 30].forEach((v) => el(wsv, 'text', { x: X(v), y: B + 18, 'text-anchor': 'middle', 'font-size': 12, fill: css('--mut') }, v));
    el(wsv, 'text', { x: (L + R) / 2, y: B + 40, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'Step');
    el(wsv, 'text', { x: 14, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 14 ${(T + B) / 2})` }, "Weight on today's PM2.5 (scaled)");
    const labs = [];
    on_.forEach((l) => {
      const end = Math.min(kk, l.w0.length - 1);
      let d = '';
      for (let i = 0; i <= end; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(l.w0[i]).toFixed(1);
      el(wsv, 'path', { d, fill: 'none', stroke: css(l.c), 'stroke-width': l.own ? 2.6 : 2.2, 'stroke-linejoin': 'round' });
      const y = Y(l.w0[end]);
      el(wsv, 'circle', { cx: X(end), cy: y, r: 4, fill: css(l.c) });
      labs.push({ y, t: fa(l.a), c: l.c });
    });
    spread(labs, 15, T + 4, B - 4).forEach((it) => el(wsv, 'text', { x: R + 8, y: it.y + 4, 'font-size': 12, 'font-weight': 600, 'font-family': 'Geist Mono Variable, monospace', fill: css(it.c) }, it.t));
  }
  function drawBoard() {
    $('stk').textContent = num(k);
    const rs = lanes
        .filter((l) => l.on)
        .map((l) => ({ l, J: l.J[Math.min(k, l.J.length - 1)] }))
        .sort((a, b) => a.J - b.J),
      span = Math.log(J0 / Jmin);
    $('board').innerHTML = rs
      .map((r, i) => {
        const l = r.l,
          wd = clamp((Math.log(r.J / Jmin) / span) * 100, 1, 100),
          wentUp = l.up && k >= l.up;
        const st = wentUp ? 'cost went up at step ' + l.up : i === 0 && k > 0 ? 'lowest now' : l.zig ? 'zig-zags' : i === rs.length - 1 && k > 0 ? 'smooth, slow' : 'smooth',
          cls = wentUp ? 'bad' : i === 0 && k > 0 ? 'lead' : '';
        return `<div class="brow"><span class="rk">${i + 1}</span><span class="al"><span class="sw" style="background:var(${l.c})"></span>${fa(l.a)}${l.own ? ' <small>yours</small>' : ''}</span><span class="tr"><i style="width:${wd}%;background:var(${l.c});opacity:.9"></i></span><span class="jv">${r.J.toFixed(4)}</span><span class="stt ${cls}">${st}</span></div>`;
      })
      .join('');
  }
  function render() {
    drawCost();
    drawW();
    drawBoard();
    $('scrub').value = k;
    $('sk').textContent = num(k);
  }
  function lanesUI() {
    $('lanes').innerHTML = lanes
      .filter((l) => !l.own)
      .map((l, i) => `<button class="lane" type="button" data-i="${i}" aria-pressed="${l.on}"><span class="sw" style="background:var(${l.c})"></span>${fa(l.a)}</button>`)
      .join('');
    document.querySelectorAll('#main .lane').forEach((b) =>
      on(b, 'click', () => {
        const l = lanes[+b.dataset.i];
        l.on = !l.on;
        b.setAttribute('aria-pressed', l.on);
        render();
      }),
    );
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
    const inc = k < 30 ? 1 : Math.max(1, Math.round(N / 120));
    k = Math.min(N, k + inc);
    render();
    if (k >= N) {
      setPlay(false);
      return;
    }
    timer = requestAnimationFrame(tick);
  }
  on($('play'), 'click', () => {
    if (!Z) return;
    if (playing) {
      stop();
      return;
    }
    if (k >= N) k = 0;
    setPlay(true);
    tick();
  });
  on($('step'), 'click', () => {
    if (!Z) return;
    stop();
    k = Math.min(N, k + 1);
    render();
  });
  on($('reset'), 'click', () => {
    if (!Z) return;
    stop();
    k = 0;
    render();
  });
  on($('scrub'), 'input', (e) => {
    if (!Z) return;
    stop();
    k = +e.target.value;
    render();
  });
  document.querySelectorAll('#main #iters button').forEach((x) =>
    on(x, 'click', () => {
      if (!Z) return;
      N = +x.dataset.n;
      document.querySelectorAll('#main #iters button').forEach((y) => y.classList.toggle('on', y === x));
      stop();
      runAll();
      k = Math.min(k, N);
      render();
    }),
  );
  const own = lanes[4],
    ownIn = $('own');
  function setOwn() {
    const raw = 10 ** +ownIn.value;
    own.a = +raw.toPrecision(2);
    $('ownv').textContent = fa(own.a);
  }
  on(ownIn, 'input', () => {
    setOwn();
    if (Z) {
      run(own);
      render();
    }
  });
  setOwn();
  off.push(onTheme(() => Z && render()));
  katex.render('w_j:=w_j-\\alpha\\,\\frac{\\partial J}{\\partial w_j},\\qquad b:=b-\\alpha\\,\\frac{\\partial J}{\\partial b}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('\\alpha\\ \\text{too large}\\Rightarrow J\\ \\text{goes up instead of down}', $('m2'), { throwOnError: false, displayMode: true });

  ctx.load('lab-rows').then((Rw) => {
    if (!live) return;
    const X = Rw.train.rows.map((r) => COLS.map((c) => r[Rw.train.cols.indexOf(c)])),
      Zs = zapply(X, zfit(X));
    Yv = rowCol(Rw.train, 'y');
    m = Zs.length;
    $('ndays').textContent = num(m);
    n = COLS.length;
    // The race is a few hundred million multiplications: let the skeleton paint first, then compute.
    setTimeout(() => {
      Z = new Float64Array(m * n);
      Zs.forEach((r, i) => r.forEach((v, j) => (Z[i * n + j] = v)));
      const best = fitExact(Zs, Yv, 0);
      Jmin = Jw(Float64Array.from(best.w), best.b);
      $('jmin').textContent = Jmin.toFixed(4);
      runAll();
      lanesUI();
      const main = $('main');
      main.classList.remove('skel');
      main.setAttribute('aria-busy', 'false');
      render();
      const up = lanes.filter((l) => !l.own && l.up).map((l) => l.a),
        zig = lanes.filter((l) => !l.own && l.zig && !l.up).map((l) => l.a),
        ok = lanes.filter((l) => !l.own && !l.up).map((l) => l.a),
        bestA = Math.max(...ok);
      $('wnote').textContent = `A small α walks up smoothly. ${zig.length ? 'Near the limit (' + zig.map(fa).join(', ') + ') it jumps past and back, a zig-zag that still settles. ' : ''}${up.length ? 'Past the limit (' + up.map(fa).join(', ') + ') the cost goes up on some steps.' : ''}`;
      $('howto').innerHTML = `<li>Try values about 3 times apart, like the four here: ${FIXED.map(fa).join(', ')}.</li><li>Throw out any whose cost goes up, even once.${up.length ? ' Here ' + up.map(fa).join(' and ') + ' does.' : ' Here none does in ' + num(N) + ' steps.'}</li><li>Keep the largest one left, here ${fa(bestA)}, or try a little above it with your own α. The project trains with α = 0.5: well under the limit, with enough steps to settle.</li>`;
    }, 0);
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
