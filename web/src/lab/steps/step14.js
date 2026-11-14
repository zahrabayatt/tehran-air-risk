// Model Lab, step 14. Ported from the approved design draft docs/design/AirLabStep14.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
// The fits are done in the page from lab-rows.json (today's PM2.5 and whether tomorrow was unhealthy).
import katex from 'katex';
import { ICON_AGAIN, costClip, drawCostBy, drawFit, fitExact, fmt, num, onTheme, powers, rowCol, sampleDays } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:350px;border-radius:14px"></div><div class="sk" style="height:350px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 14 of 17</span>
      <h2 id="st">Overfitting</h2>
      <p class="goal">A low training cost is not the goal. The goal is good chances for days the model has never seen. Fit a curve to a few days, then check it on all the other days.</p>
      <div class="player" role="group" aria-label="Fit settings">
   <div class="prow"><div class="sl" style="min-width:260px"><span>Curve degree</span><input id="deg" type="range" min="1" max="9" step="1" value="1" style="flex:1;accent-color:var(--ac)" aria-label="Curve degree"><b id="degv" style="min-width:16px">1</b></div>
    <div class="opt"><span>Training days</span><div class="seg" role="group" aria-label="Number of training days" id="ns"></div></div>
    <button id="again" class="ibtn" type="button">${ICON_AGAIN}<span>Pick 60 other days</span></button></div>
   <p class="anote" id="anote"></p>
   <span class="sandbox">Sandbox: the live model is not changed. Degree 1 is the model of steps 5 to 9; degree 3 adds PM2.5² and PM2.5³, and so on.</span></div>
  <div class="two"><figure class="plot"><div class="phead"><b>The fit</b><span class="verdict" id="verdict"></span></div>
    <div class="pbox"><svg id="fit" viewBox="0 0 520 350" width="100%" role="img" aria-label="The fitted curve over the training days, with the share of unhealthy new days behind"></svg></div>
    <figcaption class="note"><span class="key"><i style="background:var(--warn)"></i>training day, unhealthy</span><span class="key"><i style="background:var(--ac)"></i>training day, OK</span><span class="key"><i style="border:1.5px solid var(--cn);border-radius:2px"></i>share unhealthy among new days</span></figcaption></figure>
   <figure class="plot"><div class="phead"><b>Cost by degree</b></div>
    <div class="pbox"><svg id="cbd" viewBox="0 0 520 350" width="100%" role="img" aria-label="Cost on the training days and on new days, for each degree"></svg></div>
    <figcaption class="note" id="cnote"></figcaption></figure></div>
  <div class="meter"><div class="box"><h3>Where it stands</h3><div class="nums"><div><span>Cost on the training days</span><b id="ctr"></b></div><div><span>Cost on the new days</span><b id="cnw" style="color:var(--cn)"></b></div></div><p class="small" id="wnote"></p></div>
   <div class="box"><h3>How to fix overfitting</h3><ol class="fix"><li><b>More days.</b> Switch to 200 or 1,000 training days: the same degree 9 curve calms down.</li><li><b>Fewer inputs.</b> A lower degree has fewer weights to bend with; step 13 kept only the inputs that helped on new days.</li><li><b>Regularization.</b> Keep every input but keep the weights small. That is step 15.</li></ol></div></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The same cost as step 8, measured twice.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>Underfit (high bias): both costs are high. Overfit (high variance): the training cost is low but the new-days cost is high, and the curve changes a lot with other training days.</p></div>`;

export const skHtml = `<pre>from sklearn.preprocessing import PolynomialFeatures</pre><p>Builds x, x², ..., x⁹.</p><pre>from sklearn.linear_model import LogisticRegression</pre><p>The same logistic cost as this page.</p><pre>X9 = PolynomialFeatures(degree=9, include_bias=False).fit_transform(t)</pre><p>Nine inputs from one.</p><pre>LogisticRegression(penalty=None).fit(X9, y)</pre><p>It fits without any warning. Spotting overfitting is your job: score it on days it has not seen.</p>`;

const NS_ = [60, 200, 1000];

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { setTimeout, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let PM = null,
    Y = null,
    N = 60,
    seed = 8,
    deg = 1,
    S = null,
    fits = null,
    live = true;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };

  function build() {
    S = sampleDays(PM, Y, N, seed);
    fits = [];
    for (let d = 1; d <= 9; d++) {
      const X = powers(S.train.t, d),
        f = fitExact(X, S.train.y, 0);
      fits.push({ ...f, tr: costClip(X, S.train.y, f.w, f.b), nw: costClip(powers(S.fresh.t, d), S.fresh.y, f.w, f.b) });
    }
  }
  function verdict() {
    const nw = fits.map((f) => f.nw),
      best = nw.indexOf(Math.min(...nw)),
      ft = fits[deg - 1];
    if (deg - 1 === best || ft.nw <= nw[best] * 1.05) return ['right', 'Just right'];
    return deg - 1 > best ? ['over', 'Overfit'] : ['under', 'Underfit'];
  }
  function redraw() {
    if (!fits) return;
    const ft = fits[deg - 1],
      [vc, vt] = verdict(),
      pos = S.train.y.filter((v) => v).length;
    drawFit($('fit'), S, ft);
    drawCostBy($('cbd'), fits.map((_, i) => i + 1), fits.map((f) => f.tr), fits.map((f) => f.nw), deg - 1, 'curve degree');
    const v = $('verdict');
    v.className = 'verdict ' + vc;
    v.textContent = vt;
    $('degv').textContent = deg;
    $('anote').innerHTML = deg === 1 ? "<b>Degree 1:</b> one weight on today's PM2.5, the model of steps 5 to 9." : `<b>Degree ${deg}:</b> today's PM2.5 and its powers up to ${deg}, so ${deg} weights to bend the curve with.`;
    $('cnote').textContent = `Dashed: cost on the ${num(N)} training days, which only falls as the degree rises. Solid: cost on the other ${num(S.fresh.y.length)} training days, which this fit never saw. The shaded column is the degree with the lowest cost on new days.`;
    $('ctr').textContent = fmt(ft.tr, 3);
    $('cnw').textContent = fmt(ft.nw, 3);
    const d1 = fits[0];
    $('wnote').innerHTML =
      vc === 'over'
        ? `Training cost fell from ${fmt(d1.tr, 3)} (degree 1) to ${fmt(ft.tr, 3)}, but the new-days cost rose from ${fmt(d1.nw, 3)} to ${fmt(ft.nw, 3)}. With only ${pos} unhealthy days to learn from, the curve bends to pass near them instead of following the air.`
        : 'The lowest cost on days it has never seen. That is the degree to pick, even though higher degrees fit the training days better.';
    $('ns').innerHTML = NS_.map((n) => `<button type="button" data-n="${n}" class="${n === N ? 'on' : ''}">${num(n)}</button>`).join('');
    document.querySelector('#again span').textContent = `Pick ${num(N)} other days`;
  }
  const refit = () => {
    build();
    redraw();
  };
  on($('deg'), 'input', (e) => {
    deg = +e.target.value;
    redraw();
  });
  on($('ns'), 'click', (e) => {
    const b = e.target.closest('button');
    if (!b || !fits) return;
    N = +b.dataset.n;
    refit();
  });
  on($('again'), 'click', () => {
    if (!fits) return;
    seed++;
    refit();
  });
  off.push(onTheme(() => fits && redraw()));
  katex.render('J_{\\text{train}}=\\frac1{m_{\\text{train}}}\\sum_{i\\in\\text{train}}L\\big(f^{(i)},y^{(i)}\\big),\\qquad J_{\\text{new}}=\\frac1{m_{\\text{new}}}\\sum_{i\\in\\text{new}}L\\big(f^{(i)},y^{(i)}\\big)', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('f(x)=g\\big(w_1x+w_2x^2+\\dots+w_dx^d+b\\big)', $('m2'), { throwOnError: false, displayMode: true });

  ctx.load('lab-rows').then((R) => {
    if (!live) return;
    // Nine fits per pick: let the skeleton paint first.
    setTimeout(() => {
      PM = rowCol(R.train, 'pm2_5_mean');
      Y = rowCol(R.train, 'y');
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
