(function (g) {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  g.createRng = function (seed) {
    const next = mulberry32(seed);
    return {
      next: next,
      float: function (a, b) { return a + next() * (b - a); },
      int: function (a, b) { return Math.floor(a + next() * (b - a + 1)); },
      pick: function (l) { return l[Math.floor(next() * l.length)]; },
      pickMany: function (l, n) { const p = l.slice(), o = []; while (o.length < n && p.length) o.push(p.splice(Math.floor(next() * p.length), 1)[0]); return o; },
      bool: function (p) { return next() < (p === undefined ? .5 : p); },
      wobble: function (b, p) { return b * (1 + (next() * 2 - 1) * p); }
    };
  };
})(window);
