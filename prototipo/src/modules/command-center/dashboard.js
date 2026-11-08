(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.dashboard = function () {
    const st = g.Store.get(), me = g.Store.me(), sc = R.scope(me.id);
    const period = st.period;
    const ids = sc.clientIds;
    const t = R.totals({ clientIds: ids, days: period });
    const prev = R.totalsPrev({ clientIds: ids, days: period });
    const rows = R.clientRows(period, ids);
    const ecom = rows.filter(function (c) { return c.model === 'ecommerce'; });
    const leads = rows.filter(function (c) { return c.model === 'leads'; });
    const spendSeries = R.series({ clientIds: ids, days: period }, 'spend');
    const revSeries = R.series({ clientIds: ecom.map(idOf), days: period }, 'revenueConfirmed');
    const board = R.board({ accountIds: sc.accountIds });
    const cards = board.reduce(function (a, c) { return a.concat(c.cards); }, []);
    const accounts = DB.integrations.adAccounts.filter(function (a) { return sc.accountIds.indexOf(a.id) >= 0; });
    const broken = accounts.filter(function (a) { return a.status !== 'connected'; });

    const stats = '<div class="grid grid--4">'
      + UI.stat({ label: 'Investimento gerenciado', value: F.money(t.spend), delta: R.delta(t.spend, prev.spend), foot: 'vs período anterior', spark: C.sparkline(spendSeries.map(v), 'var(--chart-1)') })
      + UI.stat({ label: 'Receita confirmada', value: F.money(t.revenueConfirmed), delta: R.delta(t.revenueConfirmed, prev.revenueConfirmed), foot: 'declarada ' + F.money(t.revenue), spark: C.sparkline(revSeries.map(v), 'var(--chart-2)') })
      + UI.stat({ label: 'Leads qualificados', value: F.number(t.leadsQualified), delta: R.delta(t.leadsQualified, prev.leadsQualified), foot: F.number(t.leads) + ' leads brutos', spark: C.sparkline(R.series({ clientIds: leads.map(idOf), days: period }, 'leadsQualified').map(v), 'var(--chart-3)') })
      + UI.stat({ label: 'Contas saudáveis', value: (accounts.length - broken.length) + ' / ' + accounts.length, foot: broken.length ? broken.length + ' exigem atenção' : 'tudo sincronizado' })
      + '</div>';

    const chart = UI.card({
      title: 'Investimento e receita confirmada',
      sub: 'Série diária consolidada',
      actions: C.legend([{ label: 'Investimento' }, { label: 'Receita confirmada', color: 'var(--chart-2)' }]),
      body: C.lines([{ points: spendSeries, color: 'var(--chart-1)' }, { points: rescale(revSeries, spendSeries), color: 'var(--chart-2)', dashed: true }], { height: 220 }) + C.axis(spendSeries)
    });

    const flow = UI.card({
      title: 'Fluxo das campanhas de marketing',
      sub: cards.length + ' iniciativas no pipeline',
      actions: UI.btn('Abrir Kanban', { size: 'sm', icon: 'board', action: 'go:marketing' }),
      body: '<div class="col">' + board.map(function (col) {
        const share = cards.length ? col.cards.length / cards.length : 0;
        return '<div class="col" style="gap:3px"><div class="row"><span class="small">' + col.stage.name + (col.stage.kind === 'human' ? ' <span class="xsmall subtle">humano</span>' : '') + '</span>'
          + '<span class="spacer"></span><span class="small num strong">' + col.cards.length + '</span>'
          + (col.late ? '<span class="pill pill--danger">' + col.late + ' fora do SLA</span>' : '') + '</div>'
          + UI.progress(share * 100, col.stage.kind === 'human' ? 'warn' : null) + '</div>';
      }).join('') + '</div>'
    });

    const modelCards = '<div class="grid grid--2">'
      + UI.card({
        title: 'Clientes de Leads', sub: leads.length + ' operações', className: 'card--accent',
        body: UI.dlInline([['Investimento', F.money(sum(leads, 'spend'))], ['Leads', F.number(sum(leads, 'leads'))], ['Qualificados', F.number(sum(leads, 'leadsQualified'))], ['CPL', F.moneyCents(sum(leads, 'spend') / (sum(leads, 'leads') || 1))]])
          + C.bars(leads.map(function (c) { return { value: c.metrics.leads }; }), { height: 100, color: 'var(--chart-1)' })
          + labels(leads)
      })
      + UI.card({
        title: 'Clientes de E-commerce', sub: ecom.length + ' operações', className: 'card--alt',
        body: UI.dlInline([['Investimento', F.money(sum(ecom, 'spend'))], ['Receita conf.', F.money(sum(ecom, 'revenueConfirmed'))], ['ROAS conf.', F.ratio(sum(ecom, 'revenueConfirmed') / (sum(ecom, 'spend') || 1))], ['Compras', F.number(sum(ecom, 'purchases'))]])
          + C.bars(ecom.map(function (c) { return { value: c.metrics.revenueConfirmed }; }), { height: 100, color: 'var(--chart-2)' })
          + labels(ecom)
      })
      + '</div>';

    const pfRows = R.portfolioRows(period, ids);
    const pfCard = UI.card({
      title: 'Portfólios', actions: UI.btn('Ver todos', { size: 'sm', action: 'go:portfolios' }), tight: true,
      body: UI.table([
        { key: 'pf', label: 'Carteira' }, { key: 'cl', label: 'Clientes', num: true }, { key: 'ac', label: 'Contas', num: true },
        { key: 'sp', label: 'Investido', num: true }, { key: 'dl', label: 'Variação', num: true }
      ], pfRows.map(function (p) {
        return {
          __action: 'go:portfolios/' + p.id,
          pf: '<span class="row" style="gap:8px"><span class="legend__swatch" style="background:' + p.color + '"></span><span class="strong">' + p.name + '</span></span>',
          cl: '<span class="num">' + p.clients.length + '</span>', ac: '<span class="num">' + p.accounts + '</span>',
          sp: '<span class="num">' + F.money(p.metrics.spend) + '</span>', dl: UI.delta(p.deltaSpend)
        };
      }), { bare: true })
    });

    const health = UI.card({
      title: 'Saúde dos dados', sub: 'Integrações e reconciliação',
      body: '<div class="col">' + ['meta', 'google'].map(function (p) {
        const list = accounts.filter(function (a) { return a.platform === p; });
        const ok = list.filter(function (a) { return a.status === 'connected'; }).length;
        return '<div class="col" style="gap:4px"><div class="row"><span class="small">' + UI.platform(p) + '</span><span class="spacer"></span><span class="small num">' + ok + '/' + list.length + '</span></div>' + UI.progress((ok / (list.length || 1)) * 100, ok === list.length ? null : 'warn') + '</div>';
      }).join('') + '</div><div class="divider"></div>'
        + UI.kv([
          ['Divergência declarado × confirmado', F.pct(t.gap, 0)],
          ['Clientes com desvio > 20%', String(DB.metrics.reconciliation.filter(function (r) { return r.gap > .2 && ids.indexOf(r.clientId) >= 0; }).length)],
          ['Nota média de auditoria', String(Math.round(DB.ads.accountAudits.filter(function (a) { return sc.accountIds.indexOf(a.accountId) >= 0; }).reduce(function (a, x) { return a + x.score; }, 0) / (accounts.length || 1)))],
          ['Última sincronização', F.relative(DB.automation.runs[0].startedAt)]
        ]),
      foot: UI.btn('Abrir contas', { size: 'sm', action: 'go:accounts' })
    });

    const clientTable = UI.table([
      { key: 'client', label: 'Cliente', width: '22%' }, { key: 'pf', label: 'Portfólio' }, { key: 'model', label: 'Modelo' },
      { key: 'owner', label: 'Gestor' }, { key: 'spend', label: 'Investido', num: true },
      { key: 'result', label: 'Resultado', num: true }, { key: 'goal', label: 'Meta' }, { key: 'trend', label: 'Tendência' }
    ], rows.map(function (c) {
      const isE = c.model === 'ecommerce';
      const gs = R.goalStatus(c, c.metrics);
      return {
        __action: 'go:clients/' + c.id,
        client: UI.clientCell(c),
        pf: '<span class="small muted">' + ((R.portfolio(c.portfolioId) || {}).name || '—') + '</span>',
        model: UI.modelPill(c.model),
        owner: '<span class="small muted">' + (R.user(c.ownerUserId) || {}).name + '</span>',
        spend: '<span class="num">' + F.money(c.metrics.spend) + '</span>',
        result: '<span class="num">' + (isE ? F.money(c.metrics.revenueConfirmed) : F.number(c.metrics.leads) + ' leads') + '</span>',
        goal: UI.pill(gs.label, gs.ok ? 'ok' : 'danger', true),
        trend: C.sparkline(R.series({ clientId: c.id, days: period }, isE ? 'revenueConfirmed' : 'leads').map(v), isE ? 'var(--chart-2)' : 'var(--chart-1)')
      };
    }), { title: 'Clientes', sub: 'Últimos ' + period + ' dias', actions: R.can(me.id, 'Cadastrar cliente') ? UI.btn('Novo cliente', { size: 'sm', variant: 'primary', icon: 'plus', action: 'go:onboarding' }) : '' });

    const recs = R.recsPending(null, ids);
    const agentCard = UI.card({
      title: 'Agente IA', sub: recs.length + ' recomendações abertas · ' + R.approvalsPending(ids).length + ' aprovações pendentes',
      actions: UI.btn('Abrir agente', { size: 'sm', action: 'go:agent' }), tight: true,
      body: recs.slice(0, 3).map(function (r) {
        return '<div class="rec">' + UI.sev(r.severity) + '<div class="col" style="gap:4px">'
          + '<div class="row"><span class="rec__title">' + r.title + '</span><span class="spacer"></span>' + UI.sevPill(r.severity) + '</div>'
          + '<span class="small muted">' + R.client(r.clientId).name + ' · ' + F.relative(r.createdAt) + '</span>'
          + '<span class="small">' + r.action + '</span></div></div>';
      }).join('') || UI.empty('Nenhuma recomendação aberta')
    });

    const alertsCard = UI.card({
      title: 'Alertas operacionais',
      body: UI.timeline(R.alertsOf().filter(function (a) { return ids.indexOf(a.clientId) >= 0; }).map(function (a) {
        return { icon: '!', title: a.title, text: (R.client(a.clientId) || {}).name + ' — ' + a.detail, meta: F.relative(a.at) };
      }))
    });

    return {
      nav: 'dashboard', title: 'Dashboard Global',
      right: g.Shell.periodPicker(period),
      content: '<div class="page__head"><div><div class="page__title">Command Center</div>'
        + '<div class="page__sub">' + (sc.org ? 'Toda a agência' : 'Seu escopo: ' + ids.length + ' clientes e ' + sc.accountIds.length + ' contas') + ' · ' + F.dateFull(R.dateNDaysAgo(period)) + ' a ' + F.dateFull(DB.meta.today) + '</div></div>'
        + '<div class="page__actions">' + UI.btn('Exportar', { size: 'sm', icon: 'download', action: 'toast:Relatório exportado (mock)' }) + UI.btn('Nova iniciativa', { size: 'sm', variant: 'primary', icon: 'sparkles', action: 'modal:new-mc:agent' }) + '</div></div>'
        + stats
        + '<div class="grid grid--2a">' + chart + flow + '</div>'
        + modelCards
        + '<div class="grid grid--2a">' + pfCard + health + '</div>'
        + clientTable
        + '<div class="grid grid--2a">' + agentCard + alertsCard + '</div>'
    };
  };

  function v(p) { return p.value; }
  function idOf(c) { return c.id; }
  function sum(list, key) { return list.reduce(function (a, c) { return a + c.metrics[key]; }, 0); }
  function labels(list) { return '<div class="row xsmall subtle" style="justify-content:space-between">' + list.map(function (c) { return '<span>' + c.name.split(' ')[0] + '</span>'; }).join('') + '</div>'; }
  function rescale(s, ref) {
    const a = Math.max.apply(null, s.map(v).concat([1])), b = Math.max.apply(null, ref.map(v).concat([1]));
    return s.map(function (p) { return { date: p.date, value: p.value * (b / a) }; });
  }
})(window);
