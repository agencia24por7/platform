(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.portfolios = function (route) { return route.id ? detail(route.id) : list(); };

  function list() {
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    const rows = R.portfolioRows(st.period, sc.clientIds);
    const total = rows.reduce(function (a, p) { return a + p.metrics.spend; }, 0);

    const table = UI.table([
      { key: 'pf', label: 'Carteira', width: '22%' }, { key: 'owner', label: 'Responsável' },
      { key: 'cl', label: 'Clientes', num: true }, { key: 'ac', label: 'Contas', num: true },
      { key: 'bud', label: 'Verba/mês', num: true }, { key: 'sp', label: 'Investido', num: true },
      { key: 'res', label: 'Resultado', num: true }, { key: 'tr', label: 'Tendência' }, { key: 'dl', label: 'Variação', num: true }
    ], rows.map(function (p) {
      const isE = p.model === 'ecommerce';
      return {
        __action: 'go:portfolios/' + p.id,
        pf: '<span class="row" style="gap:8px"><span class="legend__swatch" style="background:' + p.color + '"></span><span class="col" style="gap:0"><span class="strong">' + p.name + '</span><span class="xsmall subtle">' + p.goal + '</span></span></span>',
        owner: '<span class="small muted">' + (R.user(p.ownerId) || {}).name + '</span>',
        cl: '<span class="num">' + p.clients.length + '</span>', ac: '<span class="num">' + p.accounts + '</span>',
        bud: '<span class="num">' + F.money(p.budget) + '</span>', sp: '<span class="num">' + F.money(p.metrics.spend) + '</span>',
        res: '<span class="num">' + (isE ? F.money(p.metrics.revenueConfirmed) : p.model === 'leads' ? F.number(p.metrics.leads) + ' leads' : '—') + '</span>',
        tr: C.sparkline(R.series({ clientIds: p.clientIds, days: st.period }, 'spend').map(function (x) { return x.value; }), p.color),
        dl: UI.delta(p.deltaSpend)
      };
    }), { title: 'Portfólios', actions: UI.btn('Novo portfólio', { size: 'sm', variant: 'primary', icon: 'plus', action: 'toast:Portfólio criado (mock)' }) });

    const tree = UI.card({
      title: 'Hierarquia da operação', sub: 'Organização → Portfólio → Cliente → Plataforma → Conta',
      body: '<div class="col" style="gap:10px">' + rows.map(function (p) {
        return '<div class="col" style="gap:3px"><div class="row" style="gap:8px"><span class="legend__swatch" style="background:' + p.color + '"></span><span class="strong small">' + p.name + '</span><span class="xsmall subtle">' + p.clients.length + ' clientes · ' + p.accounts + ' contas</span></div>'
          + p.clients.map(function (c) {
            return '<div class="row small row--wrap" style="padding-left:18px;gap:6px"><span class="subtle">└</span><span>' + c.name + '</span>'
              + R.accountsOf(c.id).map(function (a) { return '<span class="pill pill--outline">' + (a.platform === 'meta' ? 'Meta' : 'Google') + ' · ' + a.group + '</span>'; }).join('') + '</div>';
          }).join('') + '</div>';
      }).join('<div class="divider"></div>') + '</div>'
    });

    const split = UI.card({
      title: 'Participação no investimento',
      body: '<div class="row" style="gap:var(--sp-5);align-items:center">'
        + C.donut(rows.map(function (p) { return { value: p.metrics.spend, color: p.color }; }), { centerLabel: F.moneyShort(total), centerSub: 'no período' })
        + '<div class="col" style="flex:1">' + rows.map(function (p) {
          const share = p.metrics.spend / (total || 1);
          return '<div class="col" style="gap:4px"><div class="row"><span class="small">' + p.name + '</span><span class="spacer"></span><span class="small num strong">' + F.pct(share, 0) + '</span></div>'
            + '<div class="progress"><div class="progress__bar" style="width:' + (share * 100) + '%;background:' + p.color + '"></div></div></div>';
        }).join('') + '</div></div>'
    });

    return {
      nav: 'portfolios', title: 'Portfólios', right: g.Shell.periodPicker(st.period),
      content: '<div class="page__head"><div><div class="page__title">Portfólios</div><div class="page__sub">Carteiras agrupam clientes por operação, equipe ou modelo. Acesso concedido numa carteira desce para os clientes e as contas dela.</div></div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Carteiras', value: String(rows.length) })
        + UI.stat({ label: 'Clientes', value: String(rows.reduce(function (a, p) { return a + p.clients.length; }, 0)) })
        + UI.stat({ label: 'Contas conectadas', value: String(rows.reduce(function (a, p) { return a + p.accounts; }, 0)) })
        + UI.stat({ label: 'Investido no período', value: F.money(total) })
        + '</div>' + table + '<div class="grid grid--2a">' + tree + split + '</div>'
    };
  }

  function detail(id) {
    const p = R.portfolio(id);
    if (!p) return { nav: 'portfolios', title: 'Portfólio', content: UI.empty('Portfólio não encontrado') };
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    const row = R.portfolioRows(st.period, sc.clientIds).find(function (x) { return x.id === id; });
    if (!row) return { nav: 'portfolios', title: p.name, content: UI.empty('Sem acesso a esta carteira', 'Seu escopo de membro não alcança os clientes dela.') };
    const rows = R.clientRows(st.period, row.clientIds);
    const isE = row.model === 'ecommerce';
    const t = row.metrics;
    const mcs = R.mcRows({ portfolio: id });
    const series = R.series({ clientIds: row.clientIds, days: st.period }, 'spend');

    return {
      nav: 'portfolios', title: p.name,
      crumbs: [{ label: 'Portfólios', route: 'portfolios' }, { label: p.name }],
      right: g.Shell.periodPicker(st.period),
      content: '<div class="page__head"><div><div class="page__title">' + p.name + '</div><div class="page__sub">' + p.goal + ' · responsável ' + (R.user(p.ownerId) || {}).name + '</div></div>'
        + '<div class="page__actions">' + UI.btn('Kanban da carteira', { size: 'sm', icon: 'board', action: 'filter-go:portfolio:' + id }) + UI.btn('Operação em massa', { size: 'sm', icon: 'bolt', action: 'go:accounts/bulk' }) + '</div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Investimento', value: F.money(t.spend), delta: R.delta(t.spend, row.prev.spend) })
        + UI.stat({ label: isE ? 'Receita confirmada' : 'Leads', value: isE ? F.money(t.revenueConfirmed) : F.number(t.leads), delta: R.delta(isE ? t.revenueConfirmed : t.leads, isE ? row.prev.revenueConfirmed : row.prev.leads) })
        + UI.stat({ label: isE ? 'ROAS confirmado' : 'CPL', value: isE ? F.ratio(t.roasConfirmed) : F.moneyCents(t.cpl), delta: R.delta(isE ? t.roasConfirmed : t.cpl, isE ? row.prev.roasConfirmed : row.prev.cpl), inverse: !isE })
        + UI.stat({ label: 'Fora da meta', value: String(rows.filter(function (c) { return !R.goalStatus(c, c.metrics).ok; }).length) + ' / ' + rows.length })
        + '</div>'
        + '<div class="grid grid--2a">'
        + UI.card({ title: 'Investimento da carteira', body: C.area(series, { height: 210, color: p.color, seed: 3 }) + C.axis(series) })
        + UI.card({
          title: 'Iniciativas no fluxo', sub: mcs.length + ' campanhas de marketing', tight: true,
          body: UI.table([{ key: 'n', label: 'Iniciativa' }, { key: 'c', label: 'Cliente' }, { key: 's', label: 'Etapa' }], mcs.map(function (m) {
            return { __action: 'go:marketing/' + m.id, n: '<span class="small strong">' + m.name + '</span>', c: '<span class="small muted">' + m.client.name + '</span>', s: '<span class="small">' + m.stage.name + '</span>' };
          }), { bare: true, empty: 'Nenhuma iniciativa' })
        })
        + '</div>'
        + UI.table([
          { key: 'c', label: 'Cliente', width: '22%' }, { key: 'sp', label: 'Investido', num: true },
          { key: 'res', label: isE ? 'Receita conf.' : 'Leads', num: true }, { key: 'eff', label: isE ? 'ROAS conf.' : 'CPL', num: true },
          { key: 'goal', label: 'Meta' }, { key: 'ctr', label: 'CTR', num: true }, { key: 'cpm', label: 'CPM', num: true }, { key: 'bar', label: 'Participação', width: '12%' }
        ], rows.map(function (c) {
          const gs = R.goalStatus(c, c.metrics);
          const isEc = c.model === 'ecommerce';
          return {
            __action: 'go:clients/' + c.id, c: UI.clientCell(c),
            sp: '<span class="num">' + F.money(c.metrics.spend) + '</span>',
            res: '<span class="num">' + (isEc ? F.money(c.metrics.revenueConfirmed) : F.number(c.metrics.leads)) + '</span>',
            eff: '<span class="num strong">' + (isEc ? F.ratio(c.metrics.roasConfirmed) : F.moneyCents(c.metrics.cpl)) + '</span>',
            goal: UI.pill(gs.label, gs.ok ? 'ok' : 'danger', true),
            ctr: '<span class="num">' + F.pct(c.metrics.ctr, 2) + '</span>',
            cpm: '<span class="num">' + F.moneyCents(c.metrics.cpm) + '</span>',
            bar: UI.bar(c.metrics.spend, Math.max.apply(null, rows.map(function (x) { return x.metrics.spend; })), p.color)
          };
        }), { title: 'Benchmark interno da carteira', sub: 'Mesma régua entre operações comparáveis' })
    };
  }
})(window);
