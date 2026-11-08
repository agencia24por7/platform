(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.portal = function (route) {
    const sc = R.scope(g.Store.me().id);
    const mine = sc.clientIds.map(R.client).filter(Boolean);
    const picked = g.Store.get().portalClient;
    const c = (picked && mine.some(function (x) { return x.id === picked; }) ? R.client(picked) : mine[0]) || DB.core.clients[0];
    const switcher = mine.length > 1 ? UI.select('switch-portal-client', mine.map(function (x) {
      return { value: x.id, label: x.name + (x.parentClientId ? '' : x.isNetwork ? ' · rede' : '') };
    }), c.id, '230px') : '';
    const sub = route.id || 'home';
    const period = g.Store.get().period;
    const t = R.totals({ clientId: c.id, days: period });
    const prev = R.totalsPrev({ clientId: c.id, days: period });
    const isE = c.model === 'ecommerce';

    const head = '<div class="page__head"><div><div class="page__title">' + c.name + '</div>'
      + '<div class="page__sub">' + (mine.length > 1 ? 'Você tem acesso a ' + mine.length + ' ' + (c.isNetwork ? 'operações' : 'negócios') + '. Só os dados do selecionado aparecem aqui.' : 'Seu ambiente. Só os dados desta conta aparecem aqui.') + '</div></div>'
      + '<div class="page__actions">' + switcher + g.Shell.periodPicker(period) + '</div></div>';

    if (sub === 'campaigns') {
      const rows = R.campaignRows(period, { clientId: c.id });
      return {
        nav: 'portal-campaigns', title: c.name,
        content: head + UI.table([
          { key: 'n', label: 'Campanha', width: '26%' }, { key: 'mc', label: 'Iniciativa' }, { key: 'p', label: 'Plataforma' },
          { key: 's', label: 'Investido', num: true }, { key: 'r', label: isE ? 'Receita' : 'Leads', num: true },
          { key: 'e', label: isE ? 'ROAS' : 'CPL', num: true }, { key: 'st', label: 'Status' }
        ], rows.map(function (r) {
          const m = r.marketingCampaignId ? R.mc(r.marketingCampaignId) : null;
          return {
            n: '<span class="strong">' + r.name + '</span>',
            mc: m ? '<span class="pill pill--outline">' + m.name + '</span>' : '',
            p: UI.platform(r.platform), s: '<span class="num">' + F.money(r.metrics.spend) + '</span>',
            r: '<span class="num">' + (isE ? F.money(r.metrics.revenueConfirmed) : F.number(r.metrics.leads)) + '</span>',
            e: '<span class="num strong">' + (isE ? F.ratio(r.metrics.roasConfirmed) : F.moneyCents(r.metrics.cpl)) + '</span>',
            st: UI.statusPill(r.status)
          };
        }), { title: 'Suas campanhas', sub: 'Últimos ' + period + ' dias' })
      };
    }

    if (sub === 'investments') {
      const inv = R.investmentsOf(c.id), cur = inv[inv.length - 1];
      return {
        nav: 'portal-investments', title: c.name,
        content: head + '<div class="grid grid--4">'
          + UI.stat({ label: 'Verba do mês', value: F.money(cur.planned) })
          + UI.stat({ label: 'Investido', value: F.money(cur.spent), foot: F.pct(cur.spent / cur.planned, 0) + ' do planejado' })
          + UI.stat({ label: 'Saldo', value: F.money(cur.planned - cur.spent) })
          + UI.stat({ label: 'Resultado no período', value: isE ? F.money(t.revenueConfirmed) : F.number(t.leads) + ' leads' })
          + '</div>'
          + UI.card({
            title: 'Planejado x realizado', actions: C.legend([{ label: 'Planejado' }, { label: 'Realizado', color: 'var(--chart-2)' }]),
            body: C.grouped(inv.map(function (i) { return { label: F.monthLabel(i.month), values: [i.planned, i.spent] }; }), { height: 210 })
              + '<div class="row xsmall subtle" style="justify-content:space-between">' + inv.map(function (i) { return '<span>' + F.monthLabel(i.month) + '</span>'; }).join('') + '</div>'
          })
      };
    }

    if (sub === 'performance') {
      const split = R.platformSplit({ clientId: c.id, days: period });
      const s = R.series({ clientId: c.id, days: period }, isE ? 'roasConfirmed' : 'cpl');
      return {
        nav: 'portal-performance', title: c.name,
        content: head + '<div class="grid grid--2a">'
          + UI.card({ title: isE ? 'ROAS por dia' : 'CPL por dia', body: C.area(s, { height: 220, color: 'var(--chart-3)', seed: 8 }) + C.axis(s) })
          + UI.card({
            title: 'Por plataforma',
            body: '<div class="col">' + split.map(function (p, i) {
              const share = t.spend ? p.totals.spend / t.spend : 0;
              return '<div class="col" style="gap:4px"><div class="row"><span class="small">' + UI.platform(p.platform) + '</span><span class="spacer"></span><span class="small num strong">' + F.pct(share, 0) + '</span></div>'
                + UI.progress(share * 100, i === 0 ? 'alt' : null) + '<span class="xsmall subtle">' + F.money(p.totals.spend) + ' · ' + F.number(p.totals.conversions) + ' conversões</span></div>';
            }).join('') + '</div>'
          })
          + '</div>'
          + UI.card({ title: 'Indicadores do período', body: UI.kv(R.kpiSet(c.model, t).map(function (k) { return [k.label, k.value]; }).concat([['Impressões', F.number(t.impressions)], ['CTR', F.pct(t.ctr, 2)], ['CPM', F.moneyCents(t.cpm)]])) })
      };
    }

    if (sub === 'reports') {
      return {
        nav: 'portal-reports', title: c.name,
        content: head + UI.table([{ key: 'n', label: 'Relatório' }, { key: 'p', label: 'Período' }, { key: 'w', label: 'Gerado em' }, { key: 'a', label: '' }],
          ['Outubro/2026', 'Setembro/2026', 'Agosto/2026'].map(function (m, i) {
            return {
              n: '<span class="strong">Relatório mensal de performance</span>', p: m,
              w: '<span class="small muted">' + F.dateFull(R.dateNDaysAgo(5 + i * 30)) + '</span>',
              a: UI.btn('Baixar PDF', { size: 'sm', icon: 'download', action: 'toast:PDF gerado (mock)' })
            };
          }), { title: 'Relatórios' })
      };
    }

    if (sub === 'agent') {
      const recs = R.recsPending(c.id);
      return {
        nav: 'portal-agent', title: c.name,
        content: head
          + UI.card({
            title: 'O que o agente observou', sub: 'Recomendações passam pela sua agência antes de qualquer alteração', tight: true,
            body: recs.length ? recs.map(function (r) {
              return '<div class="rec">' + UI.sev(r.severity) + '<div class="col" style="gap:4px">'
                + '<span class="rec__title">' + r.title + '</span><span class="small muted">' + r.what + '</span>'
                + '<div class="rec__grid"><div><b>Próximo passo</b>' + r.action + '</div><div><b>Impacto esperado</b>' + r.impact + '</div></div></div></div>';
            }).join('') : UI.empty('Nenhum ponto de atenção', 'A conta está dentro do esperado.')
          })
          + UI.card({
            title: 'Perguntar ao agente',
            body: '<div class="chat" style="min-height:200px">' + (DB.agent.conversations[c.id] || []).map(function (m) {
              return '<div class="msg ' + (m.role === 'user' ? 'msg--user' : '') + '">' + UI.avatar(m.role === 'user' ? 'Você' : 'IA', { text: m.role === 'user' ? 'VC' : 'OR', alt: m.role !== 'user' })
                + '<div class="msg__bubble">' + m.text.split('|').map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div></div>';
            }).join('') + '</div>',
            foot: '<input class="input" placeholder="Pergunte sobre suas campanhas..."><span style="width:8px"></span>' + UI.btn('Enviar', { size: 'sm', variant: 'primary', icon: 'send', action: 'toast:Mensagem enviada (mock)' })
          })
      };
    }

    const tree = R.treeOf(c.id);
    const branches = tree.length > 1 ? R.clientRows(period, tree.slice(1)) : [];
    const main = R.series(branches.length ? { clientIds: tree, days: period } : { clientId: c.id, days: period }, isE ? 'revenueConfirmed' : 'leads');
    return {
      nav: 'portal', title: c.name,
      content: head
        + '<div class="grid grid--4">' + R.kpiSet(c.model, t).slice(0, 4).map(function (k, i) {
          return UI.stat({ label: k.label, value: k.value, delta: R.delta(t[k.key], prev[k.key]), inverse: k.key === 'cpl' || k.key === 'cpa' || k.key === 'cpql', foot: 'vs período anterior', spark: C.sparkline(R.series({ clientId: c.id, days: period }, k.key).map(function (p) { return p.value; }), C.PALETTE[i % 4]) });
        }).join('') + '</div>'
        + '<div class="grid grid--2a">'
        + UI.card({ title: isE ? 'Receita por dia' : 'Leads por dia', body: C.area(main, { height: 220 }) + C.axis(main) })
        + UI.card({
          title: 'Resumo do período',
          body: UI.kv([
            ['Investimento', F.money(t.spend)],
            [isE ? 'Receita' : 'Leads', isE ? F.money(t.revenueConfirmed) : F.number(t.leads)],
            [isE ? 'ROAS' : 'CPL', isE ? F.ratio(t.roasConfirmed) : F.moneyCents(t.cpl)],
            ['Cliques', F.number(t.clicks)], ['CTR', F.pct(t.ctr, 2)],
            ['Gestor responsável', (R.user(c.ownerUserId) || {}).name]
          ])
        })
        + '</div>'
        + (branches.length ? UI.table([
          { key: 'n', label: 'Unidade' }, { key: 's', label: 'Investido', num: true },
          { key: 'r', label: 'Leads', num: true }, { key: 'e', label: 'CPL', num: true }, { key: 'q', label: 'Qualificados', num: true }
        ], branches.map(function (b) {
          return {
            n: '<span class="strong">' + b.name.replace('Sabor Carioca — ', '') + '</span>',
            s: '<span class="num">' + F.money(b.metrics.spend) + '</span>',
            r: '<span class="num">' + F.number(b.metrics.leads) + '</span>',
            e: '<span class="num strong">' + F.moneyCents(b.metrics.cpl) + '</span>',
            q: '<span class="num">' + F.number(b.metrics.leadsQualified) + '</span>'
          };
        }), { title: 'Unidades da rede', sub: branches.length + ' filiais consolidadas acima' }) : '')
        + UI.card({
          title: 'Acompanhamento da agência', tight: true,
          body: UI.timeline(R.actionsOf(c.id).map(function (a) {
            return { icon: '✓', title: a.title, text: a.reason, meta: F.dateTime(a.at) + ' · ' + a.outcome };
          }).concat([{ icon: '⌕', title: 'Análise diária do agente', text: 'Campanhas revisadas automaticamente', meta: 'hoje às 07h' }]))
        })
    };
  };
})(window);
