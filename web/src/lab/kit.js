// Shared helpers for the Model Lab steps, from the approved drafts (docs/design/air-lab.js): a small
// logistic regression with the same arithmetic as training/model.py, the overfitting helpers,
// the two charts steps 14 and 15 share, SVG helpers and the controls every step reuses.
// The page shell is LabPage.tsx and the data is ctx.load(name) (see lab/data.ts), so neither is here.
// Logistic regression, the same arithmetic as training/model.py
const sigmoid = z => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const EPS = 1e-15;
function predict(X, w, b) { return X.map(x => sigmoid(x.reduce((s, v, j) => s + v * w[j], b))); }
function cost(X, y, w, b, lam = 0) {
  const f = predict(X, w, b); let s = 0;
  for (let i = 0; i < y.length; i++) s += -(y[i] * Math.log(Math.max(f[i], EPS)) + (1 - y[i]) * Math.log(Math.max(1 - f[i], EPS)));
  return s / y.length + lam / (2 * y.length) * w.reduce((t, v) => t + v * v, 0);
}
function gradient(X, y, w, b, lam = 0) {
  const m = y.length, n = w.length, dw = new Array(n).fill(0); let db = 0;
  for (let i = 0; i < m; i++) { let z = b; for (let j = 0; j < n; j++) z += X[i][j] * w[j]; const e = sigmoid(z) - y[i]; for (let j = 0; j < n; j++) dw[j] += e * X[i][j]; db += e; }
  return [dw.map((v, j) => v / m + lam / m * w[j]), db / m];
}
function descent(X, y, w, b, alpha, iters, lam = 0) {
  const J = []; w = w.slice();
  for (let k = 0; k < iters; k++) {
    const [dw, db] = gradient(X, y, w, b, lam); const w2 = w.map((v, j) => v - alpha * dw[j]), b2 = b - alpha * db;
    if (!w2.every(Number.isFinite) || !Number.isFinite(b2)) break;
    const c = cost(X, y, w2, b2, lam); if (!Number.isFinite(c)) break; w = w2; b = b2; J.push(c);
  }
  return { w, b, J };
}
function zfit(X) { const n = X[0].length, m = X.length, mu = [], sd = [];
  for (let j = 0; j < n; j++) { const c = X.map(r => r[j]); const a = c.reduce((s, v) => s + v, 0) / m; mu.push(a); const v = Math.sqrt(c.reduce((s, x) => s + (x - a) ** 2, 0) / m); sd.push(v < 1e-12 ? 1 : v); }
  return { mu, sd }; }
const zapply = (X, s) => X.map(r => r.map((v, j) => (v - s.mu[j]) / s.sd[j]));

// Overfitting and regularization (steps 14 and 15): a few training days, today's PM2.5 raised to powers.
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// N training days at the real unhealthy share (7.1%), at least 2 unhealthy; the rest are the "new days".
function sampleDays(pm, y, N, seed) {
  const r = rng(seed), pos = [], neg = [];
  y.forEach((v, i) => (v ? pos : neg).push(i));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const k = Math.max(2, Math.round(N * pos.length / y.length)), pick = shuffle(pos).slice(0, k).concat(shuffle(neg).slice(0, N - k)), inS = new Set(pick);
  const t = v => Math.max(-1, Math.min(1, v / 75 - 1));
  const part = idx => ({ t: idx.map(i => t(pm[i])), pm: idx.map(i => pm[i]), y: idx.map(i => y[i]) });
  return { train: part(pick), fresh: part(y.map((_, i) => i).filter(i => !inS.has(i))) };
}
const powers = (t, d) => t.map(v => Array.from({ length: d }, (_, j) => v ** (j + 1)));
// Exact best weights for logistic cost + λ/(2m)·Σw² (Newton's method; same answer descent would reach after many steps).
function fitExact(X, y, lam) {
  const m = y.length, n = X[0].length + 1, A = X.map(r => [1].concat(r)); let w = new Array(n).fill(0);
  for (let it = 0; it < 60; it++) {
    const g = new Array(n).fill(0), H = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < m; i++) { const a = A[i]; let z = 0; for (let j = 0; j < n; j++) z += a[j] * w[j];
      const p = sigmoid(Math.max(-30, Math.min(30, z))), e = p - y[i], s = p * (1 - p);
      for (let j = 0; j < n; j++) { g[j] += e * a[j] / m; for (let k = 0; k < n; k++) H[j][k] += s * a[j] * a[k] / m; } }
    for (let j = 1; j < n; j++) { g[j] += lam / m * w[j]; H[j][j] += lam / m + 1e-6; } H[0][0] += 1e-9;
    const st = solve(H, g); w = w.map((v, j) => v - st[j]);
  }
  return { b: w[0], w: w.slice(1) };
}
function solve(M, v) { const n = v.length, a = M.map((r, i) => r.concat([v[i]]));
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r; [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; } }
  return a.map((r, i) => r[n] / r[i]); }
// The fit (steps 14, 15): training days as dots at 0 and 1, the share of unhealthy new days per 5 μg/m³ behind, the curve on top.
function drawFit(svg, S, ft) {
  svg.innerHTML = ''; const L = 56, R = 500, T = 16, B = 300, fx = v => L + Math.min(150, v) / 150 * (R - L), fy = v => B - v * (B - T);
  [0, 0.5, 1].forEach(v => { el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') }); el(svg, 'text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 13, fill: css('--mut') }, v); });
  [0, 50, 100, 150].forEach(v => el(svg, 'text', { x: fx(v), y: B + 20, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, v));
  el(svg, 'text', { x: (L + R) / 2, y: B + 42, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'PM2.5 today (μg/m³)');
  el(svg, 'text', { x: 16, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 16 ${(T + B) / 2})` }, 'chance tomorrow is unhealthy');
  const bins = {}; S.fresh.pm.forEach((v, i) => { const k = Math.min(29, Math.floor(v / 5)); (bins[k] = bins[k] || [0, 0])[0] += S.fresh.y[i]; bins[k][1]++; });
  Object.entries(bins).forEach(([k, [u, n]]) => { if (n >= 8) el(svg, 'rect', { x: fx(+k * 5) + 1, y: fy(u / n), width: (R - L) / 30 - 2, height: B - fy(u / n), fill: css('--cn'), 'fill-opacity': .14, stroke: css('--cn'), 'stroke-opacity': .5 }); });
  const r = rng(1); S.train.pm.forEach((v, i) => el(svg, 'circle', { cx: fx(v), cy: fy(S.train.y[i]) + (S.train.y[i] ? 1 : -1) * (4 + r() * 10), r: 4.5, fill: css(S.train.y[i] ? '--warn' : '--ac'), stroke: css('--sf'), 'stroke-width': 1 }));
  const pts = []; for (let v = 0; v <= 150; v += 1) { const t = Math.max(-1, Math.min(1, v / 75 - 1)); pts.push(`${fx(v).toFixed(1)} ${fy(sigmoid(ft.w.reduce((s, w, j) => s + w * t ** (j + 1), ft.b))).toFixed(1)}`); }
  el(svg, 'path', { d: 'M' + pts.join('L'), fill: 'none', stroke: css('--line'), 'stroke-width': 3 });
}
// Cost by a setting (steps 14, 15): dashed line for training days, solid for new days, the best setting shaded.
function drawCostBy(svg, labels, tr, nw, sel, xname) {
  svg.innerHTML = ''; const L = 52, R = 500, T = 16, B = 300, best = nw.indexOf(Math.min(...nw)), mx = Math.max(0.3, ...nw, ...tr) * 1.08;
  const fx = i => L + 14 + i / (labels.length - 1) * (R - L - 28), fy = v => B - v / mx * (B - T), cw = (R - L - 28) / (labels.length - 1);
  el(svg, 'rect', { x: fx(best) - cw / 2, y: T, width: cw, height: B - T, fill: css('--ac'), 'fill-opacity': .14 });
  el(svg, 'text', { x: fx(best), y: T + 14, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: css('--ac') }, 'best');
  for (let v = 0; v <= mx; v += 0.1) { el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule') }); el(svg, 'text', { x: L - 6, y: fy(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: css('--mut') }, fmt(v, 1)); }
  labels.forEach((t, i) => el(svg, 'text', { x: fx(i), y: B + 20, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'Geist Mono, monospace', fill: css(i === sel ? '--ink' : '--mut'), 'font-weight': i === sel ? 700 : 400 }, t));
  el(svg, 'text', { x: (L + R) / 2, y: B + 42, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, xname);
  el(svg, 'text', { x: 16, y: (T + B) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut'), transform: `rotate(-90 16 ${(T + B) / 2})` }, 'cost');
  el(svg, 'line', { x1: fx(sel), x2: fx(sel), y1: T, y2: B, stroke: css('--mut'), 'stroke-dasharray': '3 4' });
  [[tr, '--mut', '6 5', 'training days'], [nw, '--cn', '', 'new days']].forEach(([vs, col, dash, name]) => {
    el(svg, 'path', { d: 'M' + vs.map((v, i) => `${fx(i)} ${fy(v)}`).join('L'), fill: 'none', stroke: css(col), 'stroke-width': 2.5, 'stroke-dasharray': dash });
    vs.forEach((v, i) => el(svg, 'circle', { cx: fx(i), cy: fy(v), r: i === sel ? 6 : 3.5, fill: i === sel ? css(col) : css('--sf'), stroke: css(col), 'stroke-width': 2 }));
    const end = vs.length - 1, other = (vs === tr ? nw : tr)[end], up = vs[end] >= other;
    el(svg, 'text', { x: fx(end), y: fy(vs[end]) + (up ? -12 : 20), 'text-anchor': 'end', 'font-size': 12, fill: css(col) }, name);
  });
}
// Cost with each chance kept between 0.0001 and 0.9999, so one confident miss cannot make it infinite.
function costClip(X, y, w, b) { let s = 0; X.forEach((x, i) => { const p = Math.min(1 - 1e-4, Math.max(1e-4, sigmoid(x.reduce((t, v, j) => t + v * w[j], b)))); s += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p)); }); return s / y.length; }

// SVG helpers
const NS = 'http://www.w3.org/2000/svg';
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function el(par, t, a, txt) { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt !== undefined) e.textContent = txt; par.appendChild(e); return e; }
function svgPoint(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
// Drag on `target`: onMove gets the pointer in SVG coordinates. `win` is where the move and up listeners go
// (a step passes ctx.scope().win so leaving the step removes them); it is the window when omitted.
function drag(svg, target, onMove, win = window) {
  target.addEventListener('pointerdown', e => { e.preventDefault(); onMove(svgPoint(svg, e));
    const mv = ev => onMove(svgPoint(svg, ev)), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    win.addEventListener('pointermove', mv); win.addEventListener('pointerup', up); });
}
// A slider over a fixed list of values, with every value labelled under it (the house Lab's λ slider).
function tickSlider(id, label, values, start, show = v => v) {
  const ticks = values.map((v, i) => `<span style="left:${(i / (values.length - 1) * 100).toFixed(2)}%">${show(v)}</span>`).join('');
  return `<div class="sl"><span>${label}</span><div class="lw"><input id="${id}" type="range" min="0" max="${values.length - 1}" step="1" value="${start}" aria-label="${label}"><div class="ticks">${ticks}</div></div><b id="${id}v">${show(values[start])}</b></div>`;
}
const ICON_AGAIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>';
const ICON_PLAY = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_PAUSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const ICON_STEP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4.5v15l11-7.5zM17 4h3v16h-3z"/></svg>';
const ICON_RESET = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 3.5v5h5"/></svg>';
const fmt = (v, d = 2) => Number(v).toFixed(d);
const num = v => v.toLocaleString('en-US');

/** One column of a train or selection set from lab-rows.json, by column name. */
// Calls fn whenever the page switches between the dark and light theme (the page owns the button);
// returns the function that stops listening, for the step's dispose.
function onTheme(fn) {
  const obs = new MutationObserver(fn);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
const rowCol = (set, name) => set.rows.map((r) => r[set.cols.indexOf(name)]);

export {
  sigmoid, predict, cost, gradient, descent, zfit, zapply, el, svgPoint, drag, fmt, num, css, rng,
  sampleDays, powers, fitExact, solve, costClip, drawFit, drawCostBy, tickSlider, rowCol, onTheme,
  ICON_AGAIN, ICON_PLAY, ICON_PAUSE, ICON_STEP, ICON_RESET,
};
