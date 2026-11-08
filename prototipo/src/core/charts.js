(function (g) {
  const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

  function svg(w, h, inner) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" style="display:block">' + inner + '</svg>';
  }
  function scale(values, h, pad) {
    const max = Math.max.apply(null, values.concat([0]));
    const min = Math.min.apply(null, values.concat([0]));
    const span = max - min || 1;
    return function (v) { return h - pad - ((v - min) / span) * (h - pad * 2); };
  }
  function path(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '); }
  function grid(w, h, pad, steps) {
    let o = '';
    for (let i = 0; i <= steps; i++) {
      const y = pad + ((h - pad * 2) / steps) * i;
      o += '<line x1="0" x2="' + w + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"/>';
    }
    return o;
  }

  g.CHART = {
    PALETTE: PALETTE,
    sparkline: function (values, color, h) {
      const W = 120, H = h || 28;
      if (!values.length) return '';
      const y = scale(values, H, 3), step = W / Math.max(1, values.length - 1);
      const pts = values.map(function (v, i) { return [i * step, y(v)]; });
      const c = color || PALETTE[0];
      return svg(W, H, '<path d="' + path(pts) + ' L ' + W + ' ' + H + ' L 0 ' + H + ' Z" fill="' + c + '" opacity=".10"/><path d="' + path(pts) + '" fill="none" stroke="' + c + '" stroke-width="1.6"/>');
    },
    area: function (points, o) {
      o = o || {};
      const W = 720, H = o.height || 200, PAD = 14;
      if (!points.length) return '';
      const y = scale(points.map(function (p) { return p.value; }), H, PAD);
      const step = W / Math.max(1, points.length - 1);
      const pts = points.map(function (p, i) { return [i * step, y(p.value)]; });
      const c = o.color || PALETTE[0];
      const id = 'ga' + (o.seed || points.length);
      return svg(W, H, '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + c + '" stop-opacity=".22"/><stop offset="100%" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>'
        + grid(W, H, PAD, 4)
        + '<path d="' + path(pts) + ' L ' + W + ' ' + H + ' L 0 ' + H + ' Z" fill="url(#' + id + ')"/>'
        + '<path d="' + path(pts) + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/>');
    },
    lines: function (seriesList, o) {
      o = o || {};
      const W = 720, H = o.height || 200, PAD = 14;
      const all = seriesList.reduce(function (a, s) { return a.concat(s.points.map(function (p) { return p.value; })); }, []);
      if (!all.length) return '';
      const y = scale(all, H, PAD);
      let body = grid(W, H, PAD, 4);
      seriesList.forEach(function (s, i) {
        const step = W / Math.max(1, s.points.length - 1);
        const pts = s.points.map(function (p, k) { return [k * step, y(p.value)]; });
        body += '<path d="' + path(pts) + '" fill="none" stroke="' + (s.color || PALETTE[i % 6]) + '" stroke-width="2" stroke-linejoin="round"' + (s.dashed ? ' stroke-dasharray="4 4"' : '') + '/>';
      });
      return svg(W, H, body);
    },
    bars: function (items, o) {
      o = o || {};
      const W = 720, H = o.height || 180, PAD = 14;
      if (!items.length) return '';
      const max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
      const slot = W / items.length, bw = Math.min(o.barWidth || 34, slot * .62);
      let body = grid(W, H, PAD, 4);
      items.forEach(function (it, i) {
        const hh = (it.value / max) * (H - PAD * 2);
        body += '<rect x="' + (i * slot + (slot - bw) / 2).toFixed(1) + '" y="' + (H - PAD - hh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, hh).toFixed(1) + '" rx="3" fill="' + (it.color || o.color || PALETTE[0]) + '"/>';
      });
      return svg(W, H, body);
    },
    grouped: function (groups, o) {
      o = o || {};
      const W = 720, H = o.height || 200, PAD = 14;
      const max = Math.max.apply(null, groups.reduce(function (a, gr) { return a.concat(gr.values); }, [1]));
      const slot = W / groups.length, n = groups[0].values.length, bw = Math.min(16, (slot * .7) / n);
      let body = grid(W, H, PAD, 4);
      groups.forEach(function (gr, i) {
        gr.values.forEach(function (v, k) {
          const hh = (v / max) * (H - PAD * 2);
          const x = i * slot + (slot - bw * n - 4 * (n - 1)) / 2 + k * (bw + 4);
          body += '<rect x="' + x.toFixed(1) + '" y="' + (H - PAD - hh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, hh).toFixed(1) + '" rx="3" fill="' + PALETTE[k % 6] + '"/>';
        });
      });
      return svg(W, H, body);
    },
    donut: function (slices, o) {
      o = o || {};
      const size = o.size || 148, r = size / 2 - 10, cx = size / 2, cy = size / 2, sw = o.thickness || 18;
      const total = slices.reduce(function (a, s) { return a + s.value; }, 0) || 1;
      let acc = -Math.PI / 2;
      let body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--chart-grid)" stroke-width="' + sw + '"/>';
      slices.forEach(function (s, i) {
        const ang = (s.value / total) * Math.PI * 2;
        if (ang <= 0) { return; }
        const x1 = cx + r * Math.cos(acc), y1 = cy + r * Math.sin(acc);
        const x2 = cx + r * Math.cos(acc + ang), y2 = cy + r * Math.sin(acc + ang);
        body += '<path d="M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + (ang > Math.PI ? 1 : 0) + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + '" fill="none" stroke="' + (s.color || PALETTE[i % 6]) + '" stroke-width="' + sw + '"/>';
        acc += ang;
      });
      const center = o.centerLabel ? '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="16" font-weight="700" fill="var(--fg)">' + o.centerLabel + '</text><text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="10" fill="var(--fg-muted)">' + (o.centerSub || '') + '</text>' : '';
      return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' + body + center + '</svg>';
    },
    axis: function (points, every) {
      const n = every || Math.ceil(points.length / 7);
      return '<div class="row xsmall subtle" style="justify-content:space-between">' + points.filter(function (p, i) { return i % n === 0; }).map(function (p) { return '<span>' + g.F.date(p.date) + '</span>'; }).join('') + '</div>';
    },
    legend: function (items) {
      return '<div class="legend">' + items.map(function (it, i) {
        return '<span class="legend__item"><span class="legend__swatch" style="background:' + (it.color || PALETTE[i % 6]) + '"></span>' + it.label + '</span>';
      }).join('') + '</div>';
    }
  };
})(window);
