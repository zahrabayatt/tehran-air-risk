// Model Lab, step 15. Ported from the approved design draft docs/design/AirLabStep15.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
// The fits are done in the page from lab-rows.json; the "In the live model" box reads the all_wx
// candidates of model.json (lambda and choosing cost; chosen = the model's lambda).
import katex from 'katex';
import { ICON_AGAIN, costClip, drawCostBy, drawFit, fitExact, fmt, num, onTheme, powers, rowCol, sampleDays, tickSlider } from '../kit.js';

const LAMS = [0, 0.0001, 0.001, 0.01, 0.1, 1, 10],
  DEG = 9,
  showL = (v) => (v === 0 ? 'none' : String(v));

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:350px;border-radius:14px"></div><div class="sk" style="height:350px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 15 of 17</span>
      <h2 id="st">Regularization</h2>
      <p class="goal">Keep the wiggly degree 9 curve from step 14, but charge it for large weights. One number, λ, sets the price: raise it and the curve calms down.</p>
      <div class="player" role="group" aria-label="Penalty settings">
   <div class="prow">${tickSlider('lam', 'Penalty λ', LAMS, 0, showL)}<button id="again" class="ibtn" type="button">${ICON_AGAIN}<span>Pick 60 other days</span></button></div>
   <p class="anote" id="anote"></p>
   <span class="sandbox">Sandbox: the live model is not changed. The same 60 training days and degree 9 curve as step 14.</span></div>
  <div class="two"><figure class="plot"><div class="phead"><b>The fit</b><span class="verdict" id="verdict"></span></div>
    <div class="pbox"><svg id="fit" viewBox="0 0 520 350" width="100%" role="img" aria-label="The degree 9 curve over the training days, with the share of unhealthy new days behind"></svg></div>
    <figcaption class="note"><span class="key"><i style="background:var(--warn)"></i>training day, unhealthy</span><span class="key"><i style="background:var(--ac)"></i>training day, OK</span><span class="key"><i style="border:1.5px solid var(--cn);border-radius:2px"></i>share unhealthy among new days</span></figcaption></figure>
   <figure class="plot"><div class="phead"><b>Cost by λ</b></div>
    <div class="pbox"><svg id="cbl" viewBox="0 0 520 350" width="100%" role="img" aria-label="Cost on training days and on new days, for each λ"></svg></div>
    <figcaption class="note" id="cnote"></figcaption></figure></div>
  <div class="two" style="margin-top:18px"><div class="box"><h3>The nine weights</h3><div class="wbars" id="wbars"></div>
    <div class="wr w9"><span></span><span class="wsc"><i style="left:0%">0.001</i><i style="left:16.67%">0.01</i><i style="left:33.33%">0.1</i><i style="left:50%">1</i><i style="left:66.67%">10</i><i style="left:83.33%">100</i><i style="left:100%">1,000</i></span><b></b></div>
    <p class="small">Bar length is on a log scale: each grid step is 10 times bigger. Without a penalty the weights run into the hundreds, pulling the curve up and down between the days.</p></div>
   <div class="box"><h3>The cost now has two parts</h3><div class="stack" id="stack"></div>
    <div class="legend2"><span><i style="background:var(--warn)"></i>fit: how far from the training days</span><span><i style="background:var(--cp)"></i>penalty: λ / 2m × the sum of the squared weights</span></div>
    <p class="small" id="snote"></p></div></div>
  <div class="box" style="margin-top:18px"><h3>In the live model</h3><p class="small" style="margin-top:0" id="liveHead"></p>
   <div class="wbars" id="live" style="margin-top:12px"></div>
   <p class="small" id="liveNote"></p></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The first part fits the data, the second keeps the weights small. λ sets the balance; b is not penalized.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The update, rearranged: each step first shrinks every weight a little, then moves downhill as before.</p></div>`;

export const skHtml = `<pre>from sklearn.linear_model import LogisticRegression</pre><p>Logistic regression with this same penalty.</p><pre>model = LogisticRegression(C=1 / lambda_).fit(X_train, y_train)</pre><p>Careful: scikit-learn sets the penalty with C, which is 1 over λ (up to how it scales the sum), so a bigger C means a smaller penalty.</p>`;

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { setTimeout, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let PM = null,
    Y = null,
    seed = 8,
    li = 0,
    S = null,
    fits = null,
    live = true;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };

  function build() {
    S = sampleDays(PM, Y, 60, seed);
    const X = powers(S.train.t, DEG),
      Xn = powers(S.fresh.t, DEG);
    fits = LAMS.map((l) => {
      const f = fitExact(X, S.train.y, l);
      return { ...f, tr: costClip(X, S.train.y, f.w, f.b), nw: costClip(Xn, S.fresh.y, f.w, f.b) };
    });
  }
  function redraw() {
    if (!fits) return;
    const ft = fits[li],
      nw = fits.map((f) => f.nw),
      best = nw.indexOf(Math.min(...nw));
    drawFit($('fit'), S, ft);
    drawCostBy($('cbl'), LAMS.map(showL), fits.map((f) => f.tr), nw, li, 'penalty λ');
    const [vc, vt] = li === best || ft.nw <= nw[best] * 1.05 ? ['right', 'Just right'] : li < best ? ['over', 'Overfit'] : ['under', 'Underfit'];
    const v = $('verdict');
    v.className = 'verdict ' + vc;
    v.textContent = vt;
    $('lamv').textContent = showL(LAMS[li]);
    $('anote').innerHTML =
      li === 0
        ? '<b>No penalty:</b> the step 14 overfit. The curve jumps to pass near each unhealthy training day.'
        : vc === 'right'
          ? `<b>λ = ${LAMS[li]}:</b> large weights now cost enough that the curve follows the air, not single days.`
          : vc === 'over'
            ? `<b>λ = ${LAMS[li]}:</b> a small penalty. The weights shrink, but the curve still bends for single days.`
            : `<b>λ = ${LAMS[li]}:</b> too much. The weights are pushed so close to 0 that the curve goes nearly flat and stops learning from PM2.5.`;
    $('cnote').textContent = `Dashed: cost on the 60 training days, which rises as λ grows. Solid: cost on the other ${num(S.fresh.y.length)} training days. Too little λ overfits, too much underfits; the shaded column is the lowest, λ = ${LAMS[best]} for these days.`;
    const lg = (a) => Math.max(0, Math.min(100, ((Math.log10(Math.max(a, 1e-3)) + 3) / 6) * 100));
    $('wbars').innerHTML = ft.w
      .map(
        (w, j) =>
          `<div class="wr w9"><span class="mono">w${'₁₂₃₄₅₆₇₈₉'[j]}</span><div class="tr"><i style="width:${lg(Math.abs(w)).toFixed(1)}%;background:${w < 0 ? 'var(--cn)' : 'var(--ac)'}"></i></div><b>${Math.abs(w) >= 100 ? num(Math.round(w)) : fmt(w, 2)}</b></div>`,
      )
      .join('');
    const m = S.train.y.length,
      pen = (LAMS[li] / (2 * m)) * ft.w.reduce((s, w) => s + w * w, 0),
      tot = ft.tr + pen,
      fp = (ft.tr / tot) * 100;
    $('stack').innerHTML = `<div style="width:${fp}%;background:var(--warn)">${fp > 18 ? fmt(ft.tr, 3) : ''}</div><div style="width:${100 - fp}%;background:var(--cp)">${100 - fp > 18 ? fmt(pen, 3) : ''}</div>`;
    $('snote').innerHTML =
      li === 0
        ? 'With λ = 0 there is no penalty: the cost is only the fit, so the weights are free to grow until the curve passes near every training day.'
        : `Fit <b>${fmt(ft.tr, 3)}</b> + penalty <b>${fmt(pen, 3)}</b> = <b>${fmt(tot, 3)}</b>. Descent lowers the total, so it gives up a little fit to keep the weights small.`;
  }
  // The real training run: every lambda tried on the 19 inputs of the weather model (model.json).
  function liveBox(M, rows) {
    const cs = M.candidates.filter((c) => c.feature_set === M.feature_set),
      lam = M.hyperparameters.lambda,
      mx = Math.max(...cs.map((c) => c.selection_cost)),
      chosen = cs.find((c) => c.lambda === lam) || cs[0],
      none = cs.find((c) => c.lambda === 0);
    $('liveHead').innerHTML = `The real training run tried λ = ${cs.map((c) => num(c.lambda)).join(', ').replace(/, (?=[^,]*$)/, ' and ')} on all ${M.features.length} inputs of the weather model and kept the one with the lowest cost on the choosing months (May to November 2025): <b>λ = ${num(lam)}</b>.`;
    $('live').innerHTML = cs
      .map((c) => {
        const ch = c.lambda === lam;
        return `<div class="wr" style="grid-template-columns:110px 1fr 150px"><span class="mono">λ = ${num(c.lambda)}</span><div class="tr" style="background:var(--bg)"><i style="width:${((c.selection_cost / mx) * 100).toFixed(1)}%;background:${ch ? 'var(--ac)' : 'var(--mut)'};opacity:${ch ? 1 : 0.45}"></i></div><b>${c.selection_cost.toFixed(4)}${ch ? ' chosen' : ''}</b></div>`;
      })
      .join('');
    $('liveNote').innerHTML = `With ${num(rows)} training days the model barely overfits, so the gain is small: choosing cost <b>${none.selection_cost.toFixed(4)}</b> without a penalty, <b>${chosen.selection_cost.toFixed(4)}</b> with it. Penalties matter most when data is scarce, as with the 60 days above, and the best λ depends on how many days and inputs there are.`;
  }
  const refit = () => {
    build();
    redraw();
  };
  on($('lam'), 'input', (e) => {
    li = +e.target.value;
    redraw();
  });
  on($('again'), 'click', () => {
    if (!fits) return;
    seed++;
    refit();
  });
  off.push(onTheme(() => fits && redraw()));
  katex.render('J(\\mathbf w,b)=\\underbrace{\\frac1m\\sum_i L\\big(f^{(i)},y^{(i)}\\big)}_{\\text{fit}}+\\underbrace{\\frac{\\lambda}{2m}\\sum_j w_j^2}_{\\text{penalty}}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('w_j:=w_j\\Big(1-\\alpha\\frac{\\lambda}{m}\\Big)-\\alpha\\frac1m\\sum_i\\big(f^{(i)}-y^{(i)}\\big)x_j^{(i)}', $('m2'), { throwOnError: false, displayMode: true });

  Promise.all([ctx.load('lab-rows'), ctx.load('model')]).then(([R, M]) => {
    if (!live) return;
    // Seven fits per pick: let the skeleton paint first.
    setTimeout(() => {
      PM = rowCol(R.train, 'pm2_5_mean');
      Y = rowCol(R.train, 'y');
      liveBox(M, R.train.rows.length);
      refit();
      const main = $('main');
      main.classList.remove('skel');
      main.setAttribute('aria-busy', 'false');
    }, 0);
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
