// Model Lab, step 4. Ported from the approved design draft docs/design/AirLabStep4.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
import katex from 'katex';
import { css, drag, el, fmt, onTheme, sigmoid } from '../kit.js';

export const html = `<div id="main">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 4 of 17</span>
      <h2 id="st">Sigmoid</h2>
      <p class="goal">The sigmoid squeezes any number, however big or small, into a chance between 0 and 1. Drag the point along the curve.</p>
      <div class="split"><figure class="plot"><div class="phead"><b>g(z) = 1 / (1 + e<sup>−z</sup>)</b></div>
        <svg id="p" viewBox="0 0 760 360" width="100%" role="group" aria-label="The sigmoid curve with a draggable point"></svg>
        <figcaption class="note">Drag anywhere on the chart, or use the slider. Far left the curve flattens at 0, far right at 1, and z = 0 gives exactly one half.</figcaption></figure>
       <div class="nota"><h3>Step by step</h3><div class="kv" id="kv"></div><p class="callout">Whatever the weighted sum of the inputs comes to, the sigmoid turns it into a chance. A big positive sum means "very likely unhealthy", a big negative one "very unlikely".</p></div></div>
      <div class="ctl" style="margin-top:16px"><label for="z">z<input id="z" type="range" min="-10" max="10" step="0.05" value="1.5"></label><b id="zv"></b></div>
    </section>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>Any z goes in; a number strictly between 0 and 1 comes out.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The middle is one half, and the two ends never quite reach 0 or 1.</p></div>`;

export const skHtml = '';

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { win, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let z = 1.5;
  const off = [];

  function redraw() {
    const svg = $('p');
    svg.innerHTML = '';
    const L = 60,
      R = 740,
      T = 20,
      B = 300,
      fx = (v) => L + ((v + 10) / 20) * (R - L),
      fy = (v) => B - v * (B - T);
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
      el(svg, 'line', { x1: L, x2: R, y1: fy(v), y2: fy(v), stroke: css('--rule'), 'stroke-dasharray': v === 0.5 ? '4 4' : '' });
      el(svg, 'text', { x: L - 8, y: fy(v) + 5, 'text-anchor': 'end', 'font-size': 14, fill: css('--mut') }, v);
    });
    [-10, -5, 0, 5, 10].forEach((v) => el(svg, 'text', { x: fx(v), y: B + 22, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, v));
    el(svg, 'text', { x: (L + R) / 2, y: B + 44, 'text-anchor': 'middle', 'font-size': 14, fill: css('--mut') }, 'z');
    let d = '';
    for (let v = -10; v <= 10.001; v += 0.1) d += (d ? 'L' : 'M') + fx(v).toFixed(1) + ' ' + fy(sigmoid(v)).toFixed(1);
    el(svg, 'path', { d, fill: 'none', stroke: css('--calm'), 'stroke-width': 3 });
    const g = sigmoid(z);
    el(svg, 'line', { x1: fx(z), x2: fx(z), y1: B, y2: fy(g), stroke: css('--warn'), 'stroke-dasharray': '4 3' });
    el(svg, 'line', { x1: L, x2: fx(z), y1: fy(g), y2: fy(g), stroke: css('--warn'), 'stroke-dasharray': '4 3' });
    el(svg, 'circle', { cx: fx(z), cy: fy(g), r: 9, fill: css('--warn'), stroke: css('--sf'), 'stroke-width': 2 });
    el(svg, 'text', { x: fx(z) + (z > 6 ? -14 : 14), y: fy(g) + (g > 0.85 ? 24 : -12), 'text-anchor': z > 6 ? 'end' : 'start', 'font-size': 15, 'font-weight': 700, fill: css('--warn') }, `g(${fmt(z)}) = ${fmt(g, 3)}`);
    const hit = el(svg, 'rect', { x: L, y: T, width: R - L, height: B - T, fill: 'transparent', style: 'cursor:ew-resize' });
    drag(
      svg,
      hit,
      (q) => {
        z = Math.max(-10, Math.min(10, Math.round(((((q.x - L) / (R - L)) * 20 - 10)) * 20) / 20));
        $('z').value = String(z);
        redraw();
      },
      win,
    );
    $('zv').textContent = fmt(z);
    const big = (v) => (v < 1000 ? fmt(v, 3) : v.toExponential(2));
    $('kv').innerHTML = `<span>z</span><b>${fmt(z)}</b><span>e<sup>−z</sup></span><b>${big(Math.exp(-z))}</b><span>1 + e<sup>−z</sup></span><b>${big(1 + Math.exp(-z))}</b><span>g(z), the chance</span><b>${fmt(g, 3)}</b><span>about</span><b>${Math.round(g * 10) === 0 ? 'under 1' : Math.round(g * 10)} in 10</b>`;
  }

  const zi = $('z');
  const onZ = (e) => {
    z = +e.target.value;
    redraw();
  };
  zi.addEventListener('input', onZ);
  off.push(() => zi.removeEventListener('input', onZ));
  katex.render('g(z)=\\frac{1}{1+e^{-z}}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('g(0)=\\tfrac12,\\qquad g(z)\\to 1 \\text{ as } z\\to\\infty,\\qquad g(z)\\to 0 \\text{ as } z\\to-\\infty', $('m2'), { throwOnError: false, displayMode: true });
  off.push(onTheme(redraw));
  redraw();
  return () => {
    off.forEach((f) => f());
    dispose();
  };
}
