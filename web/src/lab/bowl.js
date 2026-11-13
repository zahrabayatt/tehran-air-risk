// The 3D cost bowl shared by Lab steps 4 to 6. Ported from docs/design/lab-bowl.js.
// Shared 3D cost bowl for the Lab drafts (steps 4 to 6): w, b and cost as a shaded surface.
// LabBowl.draw(canvas, svgEl, o) paints the surface and overlays, and returns { proj, dot }.
// o: { J, WR, BR, Jmin, wBest, bBest, yaw, pitch, w, b, path, arrow, H }
export const LabBowl = (function () {
  function fit(canvas, svgEl, H) {
    const r = svgEl.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1,
      s = r.width / 520;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    c.clearRect(0, 0, 520, H);
    return c;
  }
  function draw(canvas, svgEl, o) {
    const H = o.H || 380,
      c = fit(canvas, svgEl, H),
      dark = document.documentElement.dataset.theme === 'dark';
    const { J, WR, BR, Jmin } = o,
      N = 34,
      top = Math.sqrt(J(WR[1], BR[1])),
      hz = (v) => Math.sqrt(v) / top;
    const cyw = Math.cos(o.yaw),
      syw = Math.sin(o.yaw),
      cp = Math.cos(o.pitch),
      sp = Math.sin(o.pitch),
      sc = H / 380;
    const proj = (wv, bv, jv) => {
      const X = (wv - WR[0]) / (WR[1] - WR[0]) - 0.5,
        Y = (bv - BR[0]) / (BR[1] - BR[0]) - 0.5,
        Z = Math.min(hz(jv), 1.15) * 0.62;
      const x1 = X * cyw - Y * syw,
        y1 = X * syw + Y * cyw;
      return [260 + x1 * 360 * sc, H * 0.69 - (Z * cp + y1 * sp) * 300 * sc, y1 * cp - Z * sp];
    };
    const lo = Math.log(Jmin),
      hi = Math.log(J(WR[1], BR[1])),
      quads = [];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const w0 = WR[0] + (i / N) * (WR[1] - WR[0]),
          w1 = WR[0] + ((i + 1) / N) * (WR[1] - WR[0]),
          b0 = BR[0] + (j / N) * (BR[1] - BR[0]),
          b1 = BR[0] + ((j + 1) / N) * (BR[1] - BR[0]);
        const pts = [
          [w0, b0],
          [w1, b0],
          [w1, b1],
          [w0, b1],
        ].map(([a, bb]) => proj(a, bb, J(a, bb)));
        const jm = J((w0 + w1) / 2, (b0 + b1) / 2);
        quads.push({
          pts,
          d: pts.reduce((s, q) => s + q[2], 0) / 4,
          h: Math.min(1, Math.max(0, (Math.log(jm) - lo) / (hi - lo))),
        });
      }
    quads.sort((a, b) => b.d - a.d);
    for (const q of quads) {
      const g = Math.pow(1 - q.h, 1.4);
      c.beginPath();
      q.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = dark
        ? `rgba(${Math.round(30 + 65 * g)},${Math.round(60 + 156 * g)},${Math.round(55 + 116 * g)},0.96)`
        : `rgba(${Math.round(200 - 180 * g)},${Math.round(230 - 108 * g)},${Math.round(215 - 130 * g)},0.96)`;
      c.fill();
      c.strokeStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';
      c.lineWidth = 0.6;
      c.stroke();
    }
    const ink = dark ? '#ffffff' : '#101512',
      mut = dark ? '#B6BDBA' : '#56605A',
      cs = getComputedStyle(document.documentElement);
    const ac = cs.getPropertyValue('--ac').trim(),
      warn = cs.getPropertyValue('--warn').trim();
    c.font = '12px Geist Variable, sans-serif';
    const ax = (a, bb, lab) => {
      const p0 = proj(a[0], a[1], 0),
        p1 = proj(bb[0], bb[1], 0);
      c.strokeStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(p0[0], p0[1]);
      c.lineTo(p1[0], p1[1]);
      c.stroke();
      c.fillStyle = mut;
      c.fillText(lab, p1[0] + 6, p1[1] + 4);
    };
    ax([WR[0], BR[0]], [WR[1], BR[0]], 'w');
    ax([WR[0], BR[0]], [WR[0], BR[1]], 'b');
    const z0 = proj(WR[0], BR[0], 0),
      zt = proj(WR[0], BR[0], J(WR[1], BR[1]));
    c.beginPath();
    c.moveTo(z0[0], z0[1]);
    c.lineTo(zt[0], zt[1]);
    c.stroke();
    c.fillText('cost J', zt[0] + 6, zt[1]);
    const best = proj(o.wBest, o.bBest, Jmin);
    c.fillStyle = ink;
    c.beginPath();
    c.arc(best[0], best[1], 4, 0, 6.283);
    c.fill();
    c.fillText('lowest point', best[0] + 8, best[1] + 14);
    if (o.path && o.path.length > 1) {
      c.strokeStyle = warn;
      c.lineWidth = 2;
      c.beginPath();
      o.path.forEach((s, i) => {
        const p = proj(s.w, s.b, s.J !== undefined ? s.J : J(s.w, s.b));
        i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]);
      });
      c.stroke();
      const every = Math.max(1, Math.ceil(o.path.length / 50));
      c.fillStyle = warn;
      for (let i = 0; i < o.path.length; i += every) {
        const s = o.path[i],
          p = proj(s.w, s.b, J(s.w, s.b));
        c.beginPath();
        c.arc(p[0], p[1], 2.4, 0, 6.283);
        c.fill();
      }
    }
    let startDot = null;
    if (o.start) {
      const p = proj(o.start.w, o.start.b, J(o.start.w, o.start.b));
      startDot = p;
      c.lineWidth = 3;
      c.strokeStyle = ac;
      c.fillStyle = dark ? '#2A2E32' : '#fff';
      c.beginPath();
      c.arc(p[0], p[1], 9, 0, 6.283);
      c.fill();
      c.stroke();
      c.fillStyle = ac;
      c.font = '600 12px Geist Variable, sans-serif';
      c.fillText('start', p[0] + 13, p[1] - 9);
      c.font = '12px Geist Variable, sans-serif';
    }
    const cur = proj(o.w, o.b, J(o.w, o.b));
    if (o.arrow) {
      const e = 1.2,
        len = Math.hypot(o.arrow.dw, o.arrow.db) || 1,
        k = 6 / len;
      const tw = o.w - o.arrow.dw * k,
        tb = o.b - o.arrow.db * k,
        tip = proj(tw, tb, J(tw, tb));
      const dx = tip[0] - cur[0],
        dy = tip[1] - cur[1],
        dl = Math.hypot(dx, dy) || 1,
        L = Math.min(70, Math.max(52, dl)),
        ex = cur[0] + (dx / dl) * L,
        ey = cur[1] + (dy / dl) * L;
      c.strokeStyle = ac;
      c.lineWidth = 3.5;
      c.beginPath();
      c.moveTo(cur[0], cur[1]);
      c.lineTo(ex, ey);
      c.stroke();
      const a = Math.atan2(ey - cur[1], ex - cur[0]);
      c.fillStyle = ac;
      c.beginPath();
      c.moveTo(ex, ey);
      c.lineTo(ex - 11 * Math.cos(a - 0.45), ey - 11 * Math.sin(a - 0.45));
      c.lineTo(ex - 11 * Math.cos(a + 0.45), ey - 11 * Math.sin(a + 0.45));
      c.closePath();
      c.fill();
      void e;
    }
    if (!o.hideDot) {
      c.fillStyle = ac;
      c.beginPath();
      c.arc(cur[0], cur[1], o.big ? 12 : 10, 0, 6.283);
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = dark ? '#2A2E32' : '#fff';
      c.stroke();
    }
    return { proj, dot: cur, start: startDot };
  }
  // nearest (w, b) on the surface to a screen point
  function pick(proj, J, WR, BR, x, y) {
    let bw = 0,
      bb = 0,
      bd = 1e18;
    for (let w = WR[0]; w <= WR[1]; w += 0.5)
      for (let b = BR[0]; b <= BR[1]; b += 0.5) {
        const s = proj(w, b, J(w, b)),
          d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
        if (d < bd) {
          bd = d;
          bw = w;
          bb = b;
        }
      }
    return [bw, bb];
  }
  return { draw, pick };
})();
