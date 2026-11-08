(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.clients = function (route) { return route.id ? detail(route.id, route.tab) : list(); };

  function list() {
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    let rows = R.clientRows(st.period, sc.clientIds);
    if (st.modelFilter !== 'all') rows = rows.filter(function (c) { return c.model === st.modelFilter; });
    rows.sort(function (a, b) {
      const ra = R.rootOf(a.id), rb = R.rootOf(b.id);
      if (ra !== rb) return ra < rb ? -1 : 1;
      if (a.id === ra) return -1;
      if (b.id === rb) return 1;
      return a.name < b.name ? -1 : 1;
    });
    const noun = R.clientLabel(sc.organizationId);

    return {
      nav: 'clients', title: noun + 's', right: g.Shell.periodPicker(st.period),
      content: '<div class="page__head"><div><div class="page__title">' + noun + 's</div><div class="page__sub">Cada ' + noun.toLowerCase() + ' tem ambiente isolado, N contas de anúncio e nível de autonomia do agente. Rede e filial formam hierarquia — o acesso concedido na rede desce para as unidades.</div></div>'
        + '<div class="page__actions">' + (R.can(g.Store.me().id, 'Cadastrar cliente') ? UI.btn('Cadastrar cliente', { variant: 'primary', icon: 'plus', action: 'go:onboarding' }) : '') + '</div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Clientes no escopo', value: String(rows.length), foot: rows.filter(function (c) { return c.status === 'onboarding'; }).length + ' em onboarding' })
        + UI.stat({ label: 'Verba contratada', value: F.money(rows.reduce(function (a, c) { return a + c.monthlyBudget; }, 0)), foot: 'soma mensal' })
        + UI.stat({ label: 'Contas conectadas', value: String(DB.integrations.adAccounts.filter(function (a) { return sc.clientIds.indexOf(a.clientId) >= 0; }).length) })
        + UI.stat({ label: 'Autonomia média', value: 'Nível ' + (rows.reduce(function (a, c) { return a + c.autonomyLevel; }, 0) / (rows.length || 1)).toFixed(1).replace('.', ','), foot: '1 consultivo · 3 autônomo' })
        + '</div>'
        + '<div class="row row--wrap">' + UI.chips([{ key: 'all', label: 'Todos' }, { key: 'leads', label: 'Leads' }, { key: 'ecommerce', label: 'E-commerce' }], st.modelFilter, 'model') + '</div>'
        + UI.table([
          { key: 'c', label: noun, width: '22%' }, { key: 'pf', label: 'Carteira' }, { key: 'model', label: 'Modelo' },
          { key: 'acc', label: 'Contas' }, { key: 'mc', label: 'Iniciativas', num: true },
          { key: 'bud', label: 'Verba/mês', num: true }, { key: 'sp', label: 'Investido', num: true },
          { key: 'pace', label: 'Ritmo', width: '10%' }, { key: 'goal', label: 'Meta' },
          { key: 'aut', label: 'Agente' }, { key: 'st', label: 'Status' }
        ], rows.map(function (c) {
          const accs = R.accountsOf(c.id);
          const inv = R.investmentsOf(c.id).slice(-1)[0];
          const pace = inv.spent / inv.planned;
          const gs = R.goalStatus(c, c.metrics);
          return {
            __action: 'go:clients/' + c.id,
            c: (c.parentClientId ? '<span style="display:inline-block;padding-left:22px;position:relative"><span class="subtle" style="position:absolute;left:6px;top:4px">└</span>' + UI.clientCell(c) + '</span>' : UI.clientCell(c) + (c.isNetwork ? ' ' + UI.pill('rede · ' + R.childrenOf(c.id).length + ' unidades', 'info') : '')),
            pf: '<span class="small muted">' + ((R.portfolio(c.portfolioId) || {}).name || '—') + '</span>',
            model: UI.modelPill(c.model),
            acc: '<span class="row" style="gap:4px">' + accs.map(function (a) {
              return UI.pill((a.platform === 'meta' ? 'M' : 'G') + '·' + a.group.slice(0, 4), a.status === 'connected' ? 'ok' : a.status === 'pending' ? 'warn' : 'danger', true);
            }).join('') + '</span>',
            mc: '<span class="num">' + R.mcRows({ client: c.id }).length + '</span>',
            bud: '<span class="num">' + F.money(c.monthlyBudget) + '</span>',
            sp: '<span class="num">' + F.money(c.metrics.spend) + '</span>',
            pace: UI.progress(pace * 100, pace > 1.05 ? 'danger' : pace < .7 ? 'warn' : null),
            goal: UI.pill(gs.label, gs.ok ? 'ok' : 'danger', true),
            aut: UI.autonomyPill(c.autonomyLevel),
            st: UI.statusPill(c.status)
          };
        }), { title: 'Carteira', sub: 'Últimos ' + st.period + ' dias' })
    };
  }

  function detail(id, tab) {
    const c = R.client(id);
    if (!c) return { nav: 'clients', title: 'Cliente', content: UI.empty('Cliente não encontrado') };
    const me = g.Store.me(), sc = R.scope(me.id);
    if (sc.clientIds.indexOf(id) < 0) return { nav: 'clients', title: c.name, content: UI.empty('Sem acesso a este cliente', 'Seu vínculo em members não alcança este recurso.') };
    const st = g.Store.get(), period = st.period;
    const t = R.totals({ clientId: c.id, days: period });
    const prev = R.totalsPrev({ clientId: c.id, days: period });
    const active = tab || 'visao';
    const role = R.roleOn(me.id, 'client', c.id);
    const kids = R.childrenOf(c.id);
    const parent = c.parentClientId ? R.client(c.parentClientId) : null;

    const header = UI.card({
      body: '<div class="row row--wrap" style="gap:var(--sp-4)">' + UI.avatar(c.name, { lg: true, square: true, alt: c.model === 'ecommerce' })
        + '<div class="col" style="gap:4px"><div class="row" style="gap:8px"><span class="page__title" style="font-size:var(--fs-lg)">' + c.name + '</span>'
        + UI.modelPill(c.model) + UI.statusPill(c.status) + '</div>'
        + '<span class="small muted">' + c.segment + ' · ' + c.site + ' · ' + c.regions.join(', ') + ' · desde ' + F.dateFull(c.since) + '</span>'
        + (parent ? '<span class="xsmall subtle">Unidade de <a class="strong" data-action="go:clients/' + parent.id + '" style="cursor:pointer">' + parent.name + '</a></span>' : '')
        + (kids.length ? '<span class="xsmall subtle">Rede com ' + kids.length + ' unidades</span>' : '') + '</div>'
        + '<span class="spacer"></span>'
        + '<div class="col" style="align-items:flex-end;gap:6px">' + UI.autonomyPill(c.autonomyLevel)
        + '<span class="xsmall subtle">Seu papel aqui: ' + R.roleLabel(role) + '</span></div>'
        + UI.btn('Agente', { icon: 'agent', action: 'go:agent/' + c.id })
        + UI.btn('Conexões', { icon: 'link', action: 'go:connections/' + c.id })
        + '</div>'
    });

    const kpis = '<div class="grid grid--4">' + R.kpiSet(c.model, t).slice(0, 4).map(function (k, i) {
      return UI.stat({
        label: k.label, value: k.value, delta: R.delta(t[k.key], prev[k.key]),
        inverse: k.key === 'cpl' || k.key === 'cpa' || k.key === 'cpql', foot: 'vs anterior',
        spark: C.sparkline(R.series({ clientId: c.id, days: period }, k.key).map(function (p) { return p.value; }), C.PALETTE[i % 4])
      });
    }).join('') + '</div>';

    const tabsEl = UI.tabs([
      { key: 'visao', label: 'Visão geral' },
      { key: 'iniciativas', label: 'Iniciativas', count: R.mcRows({ client: c.id }).length },
      { key: 'campanhas', label: 'Campanhas', count: R.campaignRows(period, { clientId: c.id }).length },
      { key: 'investimento', label: 'Investimento' },
      { key: 'contexto', label: 'Contexto' },
      { key: 'acessos', label: 'Acessos', count: R.membersOnScope('client', c.id).length }
    ], active, 'tab:clients/' + c.id);

    const body = { visao: tabVisao, iniciativas: tabMc, campanhas: tabCamp, investimento: tabInv, contexto: tabCtx, acessos: tabAcl }[active](c, period, t)
      + (kids.length && active === 'visao' ? networkTable(kids, period, c) : '');

    return {
      nav: 'clients', title: c.name,
      crumbs: [{ label: 'Clientes', route: 'clients' }, { label: c.name }],
      right: g.Shell.periodPicker(period),
      content: header + kpis + tabsEl + body
    };
  }

  function tabVisao(c, period, t) {
    const isE = c.model === 'ecommerce';
    const main = R.series({ clientId: c.id, days: period }, isE ? 'revenueConfirmed' : 'leads');
    const recon = R.reconOf(c.id);
    const recs = R.recsPending(c.id);
    return '<div class="grid grid--2">'
      + UI.card({ title: isE ? 'Receita confirmada por dia' : 'Leads por dia', body: C.area(main, { height: 210, seed: 1 }) + C.axis(main) })
      + UI.card({ title: isE ? 'ROAS confirmado' : 'CPL diário', body: C.area(R.series({ clientId: c.id, days: period }, isE ? 'roasConfirmed' : 'cpl'), { height: 210, color: 'var(--chart-3)', seed: 2 }) + C.axis(main) })
      + '</div>'
      + '<div class="grid grid--1a">'
      + UI.card({
        title: 'Indicadores', sub: 'Modelo ' + (isE ? 'E-commerce' : 'Leads'),
        body: UI.kv(R.kpiSet(c.model, t).map(function (k) { return [k.label, k.value]; }).concat([
          ['Impressões', F.number(t.impressions)], ['CTR', F.pct(t.ctr, 2)], ['CPM', F.moneyCents(t.cpm)],
          ['Divergência declarado × confirmado', F.pct(t.gap, 0) + (recon.status !== 'ok' ? ' · ' + recon.status : '')]
        ]))
      })
      + UI.card({
        title: 'Recomendações do agente', sub: recs.length ? recs.length + ' aguardando decisão' : 'Nenhuma pendência',
        actions: UI.btn('Ver todas', { size: 'sm', action: 'go:agent/' + c.id + '/otimizacoes' }), tight: true,
        body: recs.length ? recs.map(recRow).join('') : UI.empty('Sem recomendações abertas', 'A análise roda diariamente às 07h.')
      })
      + '</div>';
  }

  function networkTable(kids, period, parent) {
    const rows = R.clientRows(period, kids.map(function (k) { return k.id; }));
    const isE = parent.model === 'ecommerce';
    const max = Math.max.apply(null, rows.map(function (r) { return r.metrics.spend; }).concat([1]));
    return UI.table([
      { key: 'n', label: 'Unidade', width: '22%' }, { key: 'bud', label: 'Verba/mês', num: true },
      { key: 's', label: 'Investido', num: true }, { key: 'bar', label: '', width: '12%' },
      { key: 'r', label: isE ? 'Receita conf.' : 'Leads', num: true }, { key: 'e', label: isE ? 'ROAS conf.' : 'CPL', num: true },
      { key: 'g', label: 'Meta' }, { key: 'a', label: 'Contas', num: true }
    ], rows.map(function (b) {
      const gs = R.goalStatus(b, b.metrics);
      return {
        __action: 'go:clients/' + b.id,
        n: UI.clientCell(b), bud: '<span class="num">' + F.money(b.monthlyBudget) + '</span>',
        s: '<span class="num">' + F.money(b.metrics.spend) + '</span>',
        bar: UI.bar(b.metrics.spend, max),
        r: '<span class="num">' + (isE ? F.money(b.metrics.revenueConfirmed) : F.number(b.metrics.leads)) + '</span>',
        e: '<span class="num strong">' + (isE ? F.ratio(b.metrics.roasConfirmed) : F.moneyCents(b.metrics.cpl)) + '</span>',
        g: UI.pill(gs.label, gs.ok ? 'ok' : 'danger', true),
        a: '<span class="num">' + R.accountsOf(b.id).length + '</span>'
      };
    }), { title: 'Unidades da rede', sub: 'Hierarquia de cliente — a concessão feita na rede desce para todas as unidades' });
  }

  function recRow(r) {
    return '<div class="rec">' + UI.sev(r.severity) + '<div class="col" style="gap:4px">'
      + '<div class="row"><span class="rec__title">' + r.title + '</span><span class="spacer"></span>' + UI.sevPill(r.severity) + '</div>'
      + '<span class="small muted">' + r.what + '</span>'
      + '<div class="rec__grid"><div><b>Ação sugerida</b>' + r.action + '</div><div><b>Impacto esperado</b>' + r.impact + '</div></div>'
      + '<div class="row" style="margin-top:6px">' + (R.canApprove(g.Store.me().id, r.clientId) ? UI.btn('Aprovar', { variant: 'primary', size: 'sm', action: 'approve:' + r.id }) + UI.btn('Recusar', { size: 'sm', variant: 'danger', action: 'reject:' + r.id }) : '') + UI.btn('Detalhes', { size: 'sm', action: 'modal:rec:' + r.id }) + '</div>'
      + '</div></div>';
  }
  g.recRow = recRow;

  function tabMc(c) {
    const list = R.mcRows({ client: c.id });
    return UI.card({
      title: 'Campanhas de marketing', sub: 'Iniciativas desta conta e em que agente cada uma está',
      actions: UI.btn('Abrir no Kanban', { size: 'sm', icon: 'board', action: 'filter-go:client:' + c.id }), tight: true,
      body: list.length ? '<div class="swim__track" style="padding:var(--sp-3)">' + list.map(function (m) {
        return '<div style="display:flex;flex-direction:column;gap:4px;flex:0 0 250px"><span class="xsmall subtle">' + m.stage.name + '</span>' + g.MC_CARD(m) + '</div>';
      }).join('') + '</div>' : UI.empty('Nenhuma iniciativa', 'Crie uma campanha de marketing para este cliente.', UI.btn('Criar com o agente', { size: 'sm', variant: 'primary', icon: 'sparkles', action: 'modal:new-mc:agent' }))
    });
  }

  function tabCamp(c, period) {
    const rows = R.campaignRows(period, { clientId: c.id });
    const isE = c.model === 'ecommerce';
    const max = Math.max.apply(null, rows.map(function (r) { return r.metrics.spend; }).concat([1]));
    return UI.table([
      { key: 'n', label: 'Campanha', width: '22%' }, { key: 'acc', label: 'Conta' }, { key: 'p', label: 'Plataforma' },
      { key: 'mc', label: 'Iniciativa' }, { key: 'bud', label: 'Orç./dia', num: true }, { key: 'sp', label: 'Investido', num: true },
      { key: 'share', label: '', width: '8%' }, { key: 'res', label: isE ? 'Receita conf.' : 'Leads', num: true },
      { key: 'eff', label: isE ? 'ROAS conf.' : 'CPL', num: true }, { key: 'st', label: 'Status' }
    ], rows.map(function (r) {
      const a = R.account(r.adAccountId);
      const m = r.marketingCampaignId ? R.mc(r.marketingCampaignId) : null;
      return {
        __action: 'modal:campaign:' + r.id,
        n: '<span class="col" style="gap:0"><span class="strong">' + r.name + '</span><span class="xsmall subtle">desde ' + F.dateFull(r.startDate) + '</span></span>',
        acc: '<span class="small muted">' + a.group + '</span>', p: UI.platform(r.platform),
        mc: m ? '<span class="pill pill--outline">' + m.name + '</span>' : '<span class="xsmall subtle">avulsa</span>',
        bud: '<span class="num">' + F.money(r.budgetDaily) + '</span>', sp: '<span class="num">' + F.money(r.metrics.spend) + '</span>',
        share: UI.bar(r.metrics.spend, max, r.platform === 'meta' ? 'var(--chart-2)' : 'var(--chart-1)'),
        res: '<span class="num">' + (isE ? F.money(r.metrics.revenueConfirmed) : F.number(r.metrics.leads)) + '</span>',
        eff: '<span class="num strong">' + (isE ? F.ratio(r.metrics.roasConfirmed) : F.moneyCents(r.metrics.cpl)) + '</span>',
        st: UI.statusPill(r.status)
      };
    }), { title: 'Campanhas de plataforma', sub: 'Últimos ' + period + ' dias' });
  }

  function tabInv(c) {
    const inv = R.investmentsOf(c.id);
    const cur = inv[inv.length - 1];
    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Planejado x realizado', actions: C.legend([{ label: 'Planejado' }, { label: 'Realizado', color: 'var(--chart-2)' }]),
        body: C.grouped(inv.map(function (i) { return { label: F.monthLabel(i.month), values: [i.planned, i.spent] }; }), { height: 210 })
          + '<div class="row xsmall subtle" style="justify-content:space-between">' + inv.map(function (i) { return '<span>' + F.monthLabel(i.month) + '</span>'; }).join('') + '</div>'
      })
      + UI.card({
        title: 'Mês corrente',
        body: UI.kv([['Verba contratada', F.money(cur.planned)], ['Investido', F.money(cur.spent)], ['Saldo', F.money(cur.planned - cur.spent)], ['Fee da agência', F.money(cur.fee)], ['Status', UI.statusPill(cur.status)]])
          + UI.progress((cur.spent / cur.planned) * 100) + '<span class="xsmall subtle">' + F.pct(cur.spent / cur.planned, 0) + ' do orçamento consumido</span>'
      })
      + '</div>'
      + UI.table([{ key: 'm', label: 'Mês' }, { key: 'p', label: 'Planejado', num: true }, { key: 's', label: 'Realizado', num: true }, { key: 'd', label: 'Diferença', num: true }, { key: 'f', label: 'Fee', num: true }, { key: 'st', label: 'Status' }],
        inv.slice().reverse().map(function (i) {
          const diff = i.spent - i.planned;
          return { m: F.monthLabel(i.month), p: '<span class="num">' + F.money(i.planned) + '</span>', s: '<span class="num">' + F.money(i.spent) + '</span>', d: '<span class="num delta ' + (diff > 0 ? 'delta--down' : 'delta--up') + '">' + F.money(diff) + '</span>', f: '<span class="num">' + F.money(i.fee) + '</span>', st: UI.statusPill(i.status) };
        }), { title: 'Histórico de investimento' });
  }

  function tabCtx(c) {
    const ctx = DB.agent.context[c.id];
    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Ficha estratégica', sub: 'Alimenta o agente · versão ' + ctx.version + ' · atualizada ' + F.relative(ctx.updatedAt),
        actions: UI.btn('Editar', { size: 'sm', icon: 'settings', action: 'go:onboarding/' + c.id }),
        body: UI.kv([
          ['Modelo', UI.modelPill(c.model)], ['Ticket médio', F.money(ctx.ticket)], ['Margem', ctx.margem],
          ['Público-alvo', ctx.publico], ['Diferenciais', ctx.diferenciais], ['Jornada', ctx.jornada],
          ['Objetivos', ctx.objetivos], ['Restrições', ctx.restricoes], ['Sazonalidade', ctx.sazonalidade],
          ['Regiões', c.regions.join(', ')]
        ])
      })
      + UI.card({
        title: 'Completude', body: '<div class="row" style="gap:var(--sp-4);align-items:center">'
          + C.donut([{ value: ctx.completeness }, { value: 100 - ctx.completeness, color: 'var(--chart-grid)' }], { centerLabel: ctx.completeness + '%', centerSub: 'preenchido', size: 128 })
          + '<span class="small muted">Abaixo de 60% o agente sinaliza baixa confiança e bloqueia o avanço de iniciativas no Kanban.</span></div>'
          + UI.sectionTitle('Pesquisas', R.researchOf(c.id).length + ' registradas')
          + (R.researchOf(c.id).length ? UI.timeline(R.researchOf(c.id).map(function (r) {
            return { icon: '⌕', title: 'Pesquisa de ' + F.dateFull(r.date), text: r.summary.slice(0, 110) + '…', meta: 'confiança ' + r.confidence + ' · ' + r.sources.length + ' fontes' };
          })) : UI.empty('Nenhuma pesquisa'))
      })
      + '</div>';
  }

  function tabAcl(c) {
    const direct = R.membersOnScope('client', c.id);
    const viaAccount = DB.core.members.filter(function (m) { return m.scopeType === 'ad_account' && (R.account(m.scopeId) || {}).clientId === c.id; });
    const viaPf = DB.core.members.filter(function (m) { return m.scopeType === 'portfolio' && m.scopeId === c.portfolioId; });
    const viaOrg = DB.core.members.filter(function (m) { return m.scopeType === 'organization'; });
    function rowsOf(list, via) {
      return list.map(function (m) {
        const u = R.user(m.userId);
        return {
          u: '<span class="row" style="gap:8px">' + UI.avatar(u.name) + '<span class="col" style="gap:0"><span class="strong">' + u.name + '</span><span class="xsmall subtle">' + u.email + '</span></span></span>',
          role: UI.pill(R.roleLabel(m.role), m.role === 'client' ? 'info' : 'neutral'),
          via: '<span class="small muted">' + via + '</span>',
          scope: '<span class="mono">' + m.scopeType + (m.scopeId ? ':' + m.scopeId : '') + '</span>',
          exp: m.expiresAt ? '<span class="small ' + (new Date(m.expiresAt) < new Date(DB.meta.now) ? 'delta delta--down' : 'muted') + '">' + F.dateFull(m.expiresAt) + '</span>' : '<span class="xsmall subtle">sem prazo</span>',
          st: UI.statusPill(m.status)
        };
      });
    }
    const all = rowsOf(viaOrg, 'Organização').concat(rowsOf(viaPf, 'Portfólio')).concat(rowsOf(direct, 'Cliente')).concat(rowsOf(viaAccount, 'Conta de anúncio'));
    return UI.table([
      { key: 'u', label: 'Pessoa', width: '26%' }, { key: 'role', label: 'Papel aqui' }, { key: 'via', label: 'Acesso por' },
      { key: 'scope', label: 'Linha em members' }, { key: 'exp', label: 'Expira' }, { key: 'st', label: 'Status' }
    ], all, {
      title: 'Quem tem acesso a este cliente',
      sub: 'Resolvido pela tabela members — acesso concedido na organização ou na carteira desce até aqui',
      actions: UI.btn('Conceder acesso', { size: 'sm', variant: 'primary', icon: 'plus', action: 'go:settings/_/membros' })
    });
  }
})(window);
