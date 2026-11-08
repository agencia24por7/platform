(function (g) {
  function parse() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { page: parts[0] || 'dashboard', id: parts[1] || null, tab: parts[2] || null, extra: parts[3] || null };
  }
  g.Router = {
    parse: parse,
    go: function (p) { location.hash = '#/' + String(p).replace(/^#?\/?/, ''); },
    start: function (fn) {
      g.addEventListener('hashchange', function () { fn(parse()); });
      if (!location.hash) location.hash = '#/login';
      fn(parse());
    }
  };
})(window);
