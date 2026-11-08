(function (g) {
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const brlC = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
  const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const dec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function parse(s) { return new Date(String(s).length === 10 ? s + 'T12:00:00' : s); }

  g.F = {
    money: function (v) { return brl.format(v || 0); },
    moneyCents: function (v) { return brlC.format(v || 0); },
    moneyShort: function (v) {
      const n = v || 0;
      if (Math.abs(n) >= 1e6) return 'R$ ' + dec.format(n / 1e6) + ' mi';
      if (Math.abs(n) >= 1000) return 'R$ ' + int.format(Math.round(n / 1000)) + 'k';
      return brl.format(n);
    },
    number: function (v) { return int.format(Math.round(v || 0)); },
    decimal: function (v) { return dec.format(v || 0); },
    pct: function (v, d) { return ((v || 0) * 100).toFixed(d === undefined ? 1 : d).replace('.', ',') + '%'; },
    ratio: function (v) { return dec.format(v || 0) + 'x'; },
    date: function (s) { return parse(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); },
    dateFull: function (s) { return parse(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); },
    dateTime: function (s) { const d = parse(s); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); },
    relative: function (s) {
      const mins = Math.round((new Date(g.DB.meta.now) - parse(s)) / 60000);
      if (mins < 1) return 'agora';
      if (mins < 60) return 'há ' + mins + ' min';
      if (mins < 1440) return 'há ' + Math.round(mins / 60) + 'h';
      const d = Math.round(mins / 1440);
      return d === 1 ? 'ontem' : 'há ' + d + ' dias';
    },
    elapsed: function (s) {
      const mins = Math.max(0, Math.round((new Date(g.DB.meta.now) - parse(s)) / 60000));
      if (mins < 60) return mins + 'min';
      const h = Math.floor(mins / 60);
      if (h < 24) return h + 'h';
      return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    },
    hours: function (s) { return Math.max(0, (new Date(g.DB.meta.now) - parse(s)) / 3600000); },
    duration: function (ms) { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; },
    monthLabel: function (m) {
      const n = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const p = m.split('-');
      return n[Number(p[1]) - 1] + '/' + p[0].slice(2);
    },
    initials: function (name) { return String(name).split(' ').slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase(); }
  };
})(window);
