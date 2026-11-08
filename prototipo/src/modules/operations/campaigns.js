(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.campaigns = function () {
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    const f = { accountIds: sc.accountIds };
    if (st.filters.client !== 'all') f.clientId = st.filters.client;
    if (st.filters.account !== 'all') f.accountId = st.filters.account;
    if (st.filters.platform !== 'all') f.platform = st.filters.platform;
    let rows = R.campaignRows(st.period, f).sort(function (a, b) { return b.metrics.spend - a.metrics.spend; });
    const max = Math.max.apply(null, rows.map(function (r) { return r.metrics.spend; }).concat([1]));
    const tot = rows.reduce(function (a, r) {
      a.spend += r.metrics.spend; a.conv += r.metrics.conversions; a.rev += r.metrics.revenueConfirmed; a.leads += r.metrics.leads; return a;
    }, { spend: 0, conv: 0, rev: 0, leads: 0 });

    return {
      nav: 'campaigns', title: 'Campanhas de plataforma', right: g.Shell.periodPicker(st.period),
      content: '<div class="page__head"><div><div class="page__title">Campanhas de plataforma</div>'
        + '<div class="page__sub">As campanhas que existem dentro do Meta e do Google. Cada uma pode pertencer a uma campanha de marketing (iniciativa) ou ser avulsa.</div></div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Campanhas', value: String(rows.length), foot: rows.filter(function (r) { return r.status === 'active'; }).length + ' ativas' })
        + UI.stat({ label: 'Investimento', value: F.money(tot.spend), foot: 'últimos ' + st.period + ' dias' })
        + UI.stat({ label: 'Conversões', value: F.number(tot.conv), foot: F.number(tot.leads) + ' leads' })
        + UI.stat({ label: 'Receita confirmada', value: F.money(tot.rev), foot: 'ROAS ' + F.ratio(tot.spend ? tot.rev / tot.spend : 0) })
        + '</div>'
        + '<div class="row row--wrap">'
        + UI.select('filter:client', [{ value: 'all', label: 'Todos os clientes' }].concat(DB.core.clients.filter(function (c) { return sc.clientIds.indexOf(c.id) >= 0; }).map(function (c) { return { value: c.id, label: c.name }; })), st.filters.client, '200px')
        + UI.select('filter:account', [{ value: 'all', label: 'Todas as contas' }].concat(DB.integrations.adAccounts.filter(function (a) { return sc.accountIds.indexOf(a.id) >= 0 && (st.filters.client === 'all' || a.clientId === st.filters.client); }).map(function (a) { return { value: a.id, label: a.name }; })), st.filters.account, '240px')
        + UI.select('filter:platform', [{ value: 'all', label: 'Meta e Google' }, { value: 'meta', label: 'Meta' }, { value: 'google', label: 'Google' }], st.filters.platform, '150px')
        + '<span class="spacer"></span>' + UI.btn('Exportar CSV', { size: 'sm', icon: 'download', action: 'toast:CSV gerado (mock)' })
        + '</div>'
        + UI.table([
          { key: 'n', label: 'Campanha', width: '22%' }, { key: 'c', label: 'Cliente' }, { key: 'a', label: 'Conta' },
          { key: 'mc', label: 'Iniciativa' }, { key: 'p', label: 'Plataforma' }, { key: 'sp', label: 'Investido', num: true },
          { key: 'sh', label: '', width: '8%' }, { key: 'cv', label: 'Conversões', num: true },
          { key: 'cpa', label: 'CPA', num: true }, { key: 'is', label: 'Perda orç.', num: true }, { key: 'st', label: 'Status' }
        ], rows.map(function (r) {
          const m = r.marketingCampaignId ? R.mc(r.marketingCampaignId) : null;
          return {
            __action: 'modal:campaign:' + r.id,
            n: '<span class="strong">' + r.name + '</span>',
            c: '<span class="small muted">' + R.client(r.clientId).name + '</span>',
            a: '<span class="small muted">' + R.account(r.adAccountId).group + '</span>',
            mc: m ? '<span class="pill pill--outline truncate" style="max-width:150px">' + m.name + '</span>' : '<span class="xsmall subtle">avulsa</span>',
            p: UI.platform(r.platform),
            sp: '<span class="num">' + F.money(r.metrics.spend) + '</span>',
            sh: UI.bar(r.metrics.spend, max, r.platform === 'meta' ? 'var(--chart-2)' : 'var(--chart-1)'),
            cv: '<span class="num">' + F.number(r.metrics.conversions) + '</span>',
            cpa: '<span class="num">' + (r.metrics.conversions ? F.moneyCents(r.metrics.cpa) : '—') + '</span>',
            is: '<span class="num ' + (r.budgetLimited ? 'delta delta--down' : '') + '">' + r.impressionShareLost + '%</span>',
            st: UI.statusPill(r.status)
          };
        }), { title: 'Todas as campanhas', sub: 'Ordenadas por investimento' })
    };
  };

  g.PAGES.investments = function () {
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    const clients = DB.core.clients.filter(function (c) { return sc.clientIds.indexOf(c.id) >= 0; });
    const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
    const byMonth = months.map(function (m) {
      const list = DB.metrics.investments.filter(function (i) { return i.month === m && sc.clientIds.indexOf(i.clientId) >= 0; });
      return { month: m, planned: sum(list, 'planned'), spent: sum(list, 'spent'), fee: sum(list, 'fee') };
    });
    const cur = byMonth[byMonth.length - 1];

    return {
      nav: 'investments', title: 'Investimentos',
      content: '<div class="page__head"><div><div class="page__title">Investimentos</div><div class="page__sub">Verba contratada, ritmo de consumo e fee por cliente.</div></div>'
        + '<div class="page__actions">' + UI.btn('Fechar mês', { size: 'sm', variant: 'primary', action: 'toast:Fechamento registrado (mock)' }) + '</div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Verba sob gestão (mês)', value: F.money(cur.planned), foot: 'novembro/2026' })
        + UI.stat({ label: 'Investido até agora', value: F.money(cur.spent), foot: F.pct(cur.spent / cur.planned, 0) + ' do planejado' })
        + UI.stat({ label: 'Fee previsto', value: F.money(cur.fee), foot: '15% sobre a verba' })
        + UI.stat({ label: 'Média dos 3 meses', value: F.money(byMonth.slice(-4, -1).reduce(function (a, m) { return a + m.spent; }, 0) / 3), foot: 'realizado' })
        + '</div>'
        + '<div class="grid grid--2a">'
        + UI.card({
          title: 'Planejado x realizado', actions: C.legend([{ label: 'Planejado' }, { label: 'Realizado', color: 'var(--chart-2)' }]),
          body: C.grouped(byMonth.map(function (m) { return { label: F.monthLabel(m.month), values: [m.planned, m.spent] }; }), { height: 220 })
            + '<div class="row xsmall subtle" style="justify-content:space-between">' + byMonth.map(function (m) { return '<span>' + F.monthLabel(m.month) + '</span>'; }).join('') + '</div>'
        })
        + UI.card({
          title: 'Distribuição por cliente',
          body: '<div class="col">' + clients.map(function (c) {
            const inv = R.investmentsOf(c.id).slice(-1)[0];
            return '<div class="col" style="gap:4px"><div class="row"><span class="small">' + c.name + '</span><span class="spacer"></span><span class="small num">' + F.money(inv.planned) + '</span></div>'
              + UI.progress((inv.planned / cur.planned) * 100, c.model === 'ecommerce' ? 'alt' : null) + '</div>';
          }).join('') + '</div>'
        })
        + '</div>'
        + UI.table([
          { key: 'c', label: 'Cliente', width: '20%' }, { key: 'm', label: 'Modelo' }, { key: 'p', label: 'Planejado', num: true },
          { key: 's', label: 'Realizado', num: true }, { key: 'pa', label: 'Ritmo', width: '12%' },
          { key: 'f', label: 'Fee', num: true }, { key: 'r', label: 'Retorno', num: true }, { key: 'st', label: 'Status' }
        ], clients.map(function (c) {
          const inv = R.investmentsOf(c.id).slice(-1)[0];
          const t = R.totals({ clientId: c.id, days: 30 });
          const pace = inv.spent / inv.planned;
          return {
            __action: 'go:clients/' + c.id + '/investimento',
            c: UI.clientCell(c), m: UI.modelPill(c.model),
            p: '<span class="num">' + F.money(inv.planned) + '</span>', s: '<span class="num">' + F.money(inv.spent) + '</span>',
            pa: UI.progress(pace * 100, pace > 1.05 ? 'danger' : pace < .7 ? 'warn' : null),
            f: '<span class="num">' + F.money(inv.fee) + '</span>',
            r: '<span class="num">' + (c.model === 'ecommerce' ? F.money(t.revenueConfirmed) : F.number(t.leads) + ' leads') + '</span>',
            st: UI.statusPill(inv.status)
          };
        }), { title: 'Investimento por cliente', sub: 'Mês corrente' })
    };
  };

  function sum(list, k) { return list.reduce(function (a, i) { return a + i[k]; }, 0); }
})(window);
