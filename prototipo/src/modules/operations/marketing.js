(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.marketing = function (route) {
    if (route.id && route.id !== '_') return detail(route.id, route.tab);
    return boardView(route.tab || 'kanban');
  };

  function filterBar(sc) {
    const st = g.Store.get(), f = st.filters;
    const clients = DB.core.clients.filter(function (c) { return sc.clientIds.indexOf(c.id) >= 0; });
    const accounts = DB.integrations.adAccounts.filter(function (a) {
      return sc.accountIds.indexOf(a.id) >= 0 && (f.client === 'all' || a.clientId === f.client);
    });
    const owners = Array.from(new Set(DB.ads.marketingCampaigns.map(function (m) { return m.ownerUserId; })));
    const active = Object.keys(f).filter(function (k) { return f[k] !== 'all'; }).length;

    return UI.card({
      className: 'card--flat',
      body: '<div class="row row--wrap">'
        + UI.select('filter:client', [{ value: 'all', label: 'Todos os clientes (' + clients.length + ')' }].concat(clients.map(function (c) { return { value: c.id, label: c.name }; })), f.client, '190px')
        + UI.select('filter:account', [{ value: 'all', label: 'Todas as contas (' + accounts.length + ')' }].concat(accounts.map(function (a) { return { value: a.id, label: a.name }; })), f.account, '230px')
        + UI.select('filter:portfolio', [{ value: 'all', label: 'Todos os portfólios' }].concat(DB.core.portfolios.map(function (p) { return { value: p.id, label: p.name }; })), f.portfolio, '170px')
        + UI.select('filter:platform', [{ value: 'all', label: 'Meta e Google' }, { value: 'meta', label: 'Só Meta' }, { value: 'google', label: 'Só Google' }], f.platform, '140px')
        + UI.select('filter:owner', [{ value: 'all', label: 'Todos os gestores' }].concat(owners.map(function (u) { return { value: u, label: R.user(u).name }; })), f.owner, '170px')
        + UI.select('filter:origin', [{ value: 'all', label: 'Qualquer origem' }, { value: 'agent', label: 'Criada pelo agente' }, { value: 'manual', label: 'Criada na mão' }], f.origin, '170px')
        + UI.select('filter:scope', [{ value: 'all', label: 'Qualquer alcance' }, { value: 'client', label: 'Operação única' }, { value: 'client_tree', label: 'Rede inteira' }], f.scope, '170px')
        + (active ? UI.btn('Limpar filtros (' + active + ')', { size: 'sm', icon: 'x', action: 'clear-filters' }) : '')
        + '<span class="spacer"></span>'
        + UI.chips([{ key: 'stage', label: 'Agrupar por agente' }, { key: 'client', label: 'Agrupar por cliente' }], g.Store.get().boardGroup, 'group')
        + '</div>'
    });
  }

  function boardView(tab) {
    const me = g.Store.me(), sc = R.scope(me.id);
    const st = g.Store.get();
    const f = Object.assign({ accountIds: sc.accountIds }, st.filters);
    const cols = R.board(f);
    const all = cols.reduce(function (a, c) { return a.concat(c.cards); }, []);
    const lateCount = all.filter(function (c) { return c.late; }).length;
    const blocked = all.filter(function (c) { return c.status === 'bloqueada'; }).length;
    const waiting = all.filter(function (c) { return c.status === 'aguardando_humano'; }).length;

    const stats = '<div class="grid grid--4">'
      + UI.stat({ label: 'Iniciativas no fluxo', value: String(all.length), foot: sc.org ? 'toda a agência' : sc.clientIds.length + ' clientes no seu escopo' })
      + UI.stat({ label: 'Aguardando pessoa', value: String(waiting), foot: 'briefing ou aprovação', accent: true })
      + UI.stat({ label: 'Bloqueadas', value: String(blocked), foot: blocked ? 'exigem ação para destravar' : 'nenhuma' })
      + UI.stat({ label: 'Fora do SLA', value: String(lateCount), foot: 'tempo na coluna acima do limite' })
      + '</div>';

    const tabsEl = UI.tabs([
      { key: 'kanban', label: 'Kanban', count: all.length },
      { key: 'lista', label: 'Lista' },
      { key: 'pipeline', label: 'Etapas do fluxo' }
    ], tab, 'tab:marketing/_');

    let body;
    if (tab === 'lista') body = listView(all);
    else if (tab === 'pipeline') body = stageDoc(cols);
    else body = st.boardGroup === 'client' ? swimlanes(all) : kanban(cols);

    return {
      nav: 'marketing', title: 'Campanhas de marketing', wide: true,
      content: '<div class="page__head"><div><div class="page__title">Campanhas de marketing</div>'
        + '<div class="page__sub">A iniciativa acima das campanhas de plataforma. Cada coluna é um agente do sistema — o card mostra em qual agente cada campanha de cada cliente está parada agora.</div></div>'
        + '<div class="page__actions">' + UI.btn('Criar com o agente', { variant: 'primary', icon: 'sparkles', action: 'modal:new-mc:agent' }) + UI.btn('Criar na mão', { icon: 'plus', action: 'modal:new-mc:manual' }) + '</div></div>'
        + stats + filterBar(sc) + tabsEl + body
    };
  }

  function kanban(cols) {
    return '<div class="board">' + cols.map(function (col) {
      const s = col.stage;
      const agent = s.agentId ? R.agent(s.agentId) : null;
      return '<div class="' + UI.cx('board__col', s.kind === 'human' && 'is-human') + '">'
        + '<div class="board__head">'
        + '<div class="board__title">' + (agent ? UI.avatar(agent.name, { text: agent.short, alt: true }) : '<span class="avatar">' + ICON('user', 13) + '</span>')
        + '<span>' + s.name + '</span><span class="count">' + col.cards.length + '</span></div>'
        + '<div class="board__meta"><span>' + (s.kind === 'human' ? 'Decisão humana' : 'Agente') + '</span>'
        + (s.slaHours ? '<span>· SLA ' + s.slaHours + 'h</span>' : '<span>· contínuo</span>')
        + (col.budget ? '<span class="spacer"></span><span class="strong">' + F.moneyShort(col.budget) + '</span>' : '') + '</div>'
        + (col.late ? '<div class="xsmall" style="color:var(--c-danger)">' + ICON('alert', 11) + ' ' + col.late + ' fora do SLA</div>' : '')
        + '</div>'
        + '<div class="board__list">' + (col.cards.length ? col.cards.map(card).join('') : '<div class="board__empty">Nenhuma iniciativa</div>') + '</div>'
        + '</div>';
    }).join('') + '</div>';
  }

  function card(m) {
    const kind = m.pendingAction.kind;
    const cls = m.status === 'bloqueada' ? 'mc--blocked' : m.status === 'no_ar' ? 'mc--live' : kind === 'manual' ? 'mc--human' : '';
    const who = kind === 'manual' ? (R.user(m.pendingAction.who) || {}).name : (R.agent(m.pendingAction.who) || {}).short;
    const kpi = m.targetKpis.roas ? 'ROAS ≥ ' + F.decimal(m.targetKpis.roas) : 'CPL ≤ ' + F.money(m.targetKpis.cpl) + (m.targetKpis.volume ? ' · ' + m.targetKpis.volume + ' leads' : '');
    const pace = m.budgetTotal ? Math.round((m.budgetAllocated / m.budgetTotal) * 100) : 0;
    return '<div class="' + UI.cx('mc', cls) + '" data-action="go:marketing/' + m.id + '">'
      + '<div class="mc__top"><span class="mc__name">' + m.name + '</span><span class="spacer"></span>'
      + (m.origin === 'agent' ? '<span title="Criada pelo agente">' + ICON('sparkles', 13) + '</span>' : '') + '</div>'
      + '<div class="mc__client">' + UI.avatar(m.client.name, { text: F.initials(m.client.name), alt: m.model === 'ecommerce' }) + ' ' + m.client.name
      + (m.scopeType === 'client_tree' ? ' <span class="pill pill--info">rede · ' + m.reachClients.length + '</span>' : '') + '</div>'
      + '<div class="mc__meta">' + UI.platformDots(m.platforms)
      + '<span>' + m.adAccountIds.length + ' contas</span>'
      + (m.childCampaignIds.length ? '<span>· ' + m.childCampaignIds.length + ' campanhas</span>' : '')
      + '<span class="spacer"></span><span class="mc__budget">' + F.moneyShort(m.budgetTotal) + '</span></div>'
      + '<div class="mc__meta"><span>' + kpi + '</span></div>'
      + (pace ? '<div class="mc__bar"><span style="width:' + pace + '%"></span></div>' : '')
      + '<div class="' + UI.cx('mc__action', 'mc__action--' + (kind === 'blocked' ? 'blocked' : kind)) + '">'
      + (kind === 'agent' ? '<span class="pulse"></span>' : kind === 'blocked' ? ICON('alert', 12) : ICON('user', 12))
      + '<span class="truncate">' + m.pendingAction.label + '</span>'
      + '<span class="' + UI.cx('mc__sla', m.late && 'mc__sla--late') + '">' + F.elapsed(m.stageSince) + '</span></div>'
      + (who && kind === 'manual' ? '<div class="xsmall subtle">Responsável: ' + who + '</div>' : '')
      + '</div>';
  }

  function swimlanes(all) {
    const byClient = {};
    all.forEach(function (m) { (byClient[m.clientId] = byClient[m.clientId] || []).push(m); });
    const ids = Object.keys(byClient).sort(function (a, b) { return byClient[b].length - byClient[a].length; });
    if (!ids.length) return UI.card({ body: UI.empty('Nenhuma iniciativa com os filtros atuais') });
    return '<div class="swim">' + ids.map(function (id) {
      const c = R.client(id), list = byClient[id].sort(function (a, b) { return a.stage.position - b.stage.position; });
      return '<div class="swim__row"><div class="swim__head">' + UI.avatar(c.name, { square: true, alt: c.model === 'ecommerce' })
        + '<span class="strong small">' + c.name + '</span>' + UI.modelPill(c.model)
        + '<span class="xsmall subtle">' + R.accountsOf(c.id).length + ' contas</span>'
        + '<span class="spacer"></span><span class="xsmall subtle">' + list.length + ' iniciativas · ' + F.moneyShort(list.reduce(function (a, m) { return a + m.budgetTotal; }, 0)) + '</span></div>'
        + '<div class="swim__track">' + list.map(function (m) {
          return '<div style="display:flex;flex-direction:column;gap:4px;flex:0 0 240px"><span class="xsmall subtle truncate">' + m.stage.name + '</span>' + card(m) + '</div>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  function listView(all) {
    return UI.table([
      { key: 'name', label: 'Iniciativa', width: '22%' }, { key: 'client', label: 'Cliente' },
      { key: 'stage', label: 'Etapa atual' }, { key: 'pending', label: 'Ação pendente' },
      { key: 'plat', label: 'Plataformas' }, { key: 'accounts', label: 'Contas', num: true },
      { key: 'budget', label: 'Verba', num: true }, { key: 'time', label: 'Na etapa', num: true },
      { key: 'origin', label: 'Origem' }, { key: 'status', label: 'Status' }
    ], all.sort(function (a, b) { return a.stage.position - b.stage.position; }).map(function (m) {
      return {
        __action: 'go:marketing/' + m.id,
        name: '<span class="col" style="gap:0"><span class="strong">' + m.name + '</span><span class="xsmall subtle">' + m.period + '</span></span>',
        client: '<span class="small muted">' + m.client.name + '</span>',
        scope: m.scopeType === 'client_tree' ? UI.pill('Rede · ' + m.reachClients.length, 'info') : UI.pill('Única', 'neutral'),
        stage: '<span class="row" style="gap:6px">' + (m.stage.agentId ? UI.avatar(m.stage.name, { text: R.agent(m.stage.agentId).short, alt: true }) : '') + '<span class="small">' + m.stage.name + '</span></span>',
        pending: '<span class="small ' + (m.pendingAction.kind === 'blocked' ? 'strong' : 'muted') + '">' + m.pendingAction.label + '</span>',
        plat: UI.platformDots(m.platforms),
        accounts: '<span class="num">' + m.adAccountIds.length + '</span>',
        budget: '<span class="num">' + F.money(m.budgetTotal) + '</span>',
        time: '<span class="num ' + (m.late ? 'delta delta--down' : '') + '">' + F.elapsed(m.stageSince) + '</span>',
        origin: UI.pill(m.origin === 'agent' ? 'Agente' : 'Manual', m.origin === 'agent' ? 'info' : 'neutral'),
        status: UI.statusPill(m.status)
      };
    }), { title: 'Todas as iniciativas', sub: 'Ordenadas pela posição no fluxo', empty: 'Nenhuma iniciativa com os filtros atuais' });
  }

  function stageDoc(cols) {
    return UI.table([
      { key: 'n', label: '#', width: '40px' }, { key: 'stage', label: 'Etapa' }, { key: 'kind', label: 'Tipo' },
      { key: 'desc', label: 'O que acontece' }, { key: 'sla', label: 'SLA', num: true },
      { key: 'cards', label: 'Iniciativas', num: true }, { key: 'budget', label: 'Verba parada', num: true }
    ], cols.map(function (col, i) {
      const s = col.stage, agent = s.agentId ? R.agent(s.agentId) : null;
      return {
        n: '<span class="mono">' + (i + 1) + '</span>',
        stage: '<span class="row" style="gap:8px">' + (agent ? UI.avatar(agent.name, { text: agent.short, alt: true }) : '<span class="avatar">' + ICON('user', 13) + '</span>') + '<span class="strong">' + s.name + '</span></span>',
        kind: UI.pill(s.kind === 'human' ? 'Humano' : 'Agente', s.kind === 'human' ? 'warn' : 'info'),
        desc: '<span class="small muted">' + s.desc + '</span>',
        sla: '<span class="num">' + (s.slaHours ? s.slaHours + 'h' : '—') + '</span>',
        cards: '<span class="num">' + col.cards.length + '</span>',
        budget: '<span class="num">' + (col.budget ? F.money(col.budget) : '—') + '</span>'
      };
    }), { title: 'Etapas do fluxo', sub: 'As colunas do Kanban são os próprios agentes, mais os portões humanos' });
  }

  function detail(id, tab) {
    const sc = R.scope(g.Store.me().id);
    const m = R.mcRows({}).find(function (x) { return x.id === id; });
    if (!m) return { nav: 'marketing', title: 'Iniciativa', content: UI.empty('Iniciativa não encontrada') };
    if (!(m.reachClientIds || [m.clientId]).some(function (cid) { return sc.clientIds.indexOf(cid) >= 0; })) {
      return { nav: 'marketing', title: m.name, content: UI.empty('Sem acesso a esta iniciativa', 'Nenhuma linha de members alcança o cliente dela.') };
    }
    const idx = DB.agent.pipelineStages.findIndex(function (s) { return s.id === m.stageId; });
    const active = tab || 'fluxo';

    const pipe = '<div class="pipe">' + DB.agent.pipelineStages.map(function (s, i) {
      const state = i < idx ? 'is-done' : i === idx ? 'is-current' : '';
      const agent = s.agentId ? R.agent(s.agentId) : null;
      return (i ? '<span class="' + UI.cx('pipe__link', i <= idx && 'is-done') + '"></span>' : '')
        + '<div class="' + UI.cx('pipe__node', state) + '"><span class="pipe__dot">' + (i < idx ? '✓' : agent ? agent.short : ICON('user', 12)) + '</span>'
        + '<span class="pipe__label">' + s.name + '</span></div>';
    }).join('') + '</div>';

    const header = UI.card({
      className: m.status === 'bloqueada' ? 'card--danger' : 'card--accent',
      body: '<div class="row row--wrap" style="gap:var(--sp-4)">'
        + UI.avatar(m.client.name, { lg: true, square: true, alt: m.model === 'ecommerce' })
        + '<div class="col" style="gap:4px"><div class="row" style="gap:8px"><span class="page__title" style="font-size:var(--fs-lg)">' + m.name + '</span>'
        + UI.statusPill(m.status) + UI.pill(m.origin === 'agent' ? 'Criada pelo agente' : 'Criada na mão', m.origin === 'agent' ? 'info' : 'neutral') + '</div>'
        + '<span class="small muted">' + m.client.name + ' · ' + m.period + ' · ' + F.money(m.budgetTotal) + ' · responsável ' + m.owner.name + '</span>'
        + (m.scopeType === 'client_tree' ? '<span class="xsmall subtle">Iniciativa de rede: alcança ' + m.reachClients.length + ' operações e ' + m.adAccountIds.length + ' contas</span>' : '') + '</div>'
        + '<span class="spacer"></span>'
        + (m.pendingAction.kind === 'manual'
          ? (R.canOperate(g.Store.me().id, m.clientId)
            ? UI.btn(m.pendingAction.label, { variant: 'primary', icon: 'check', action: 'advance:' + m.id })
            : UI.pill(m.pendingAction.label + ' · sem permissão', 'neutral'))
          : '')
        + (m.pendingAction.kind === 'blocked' ? UI.btn('Ver bloqueio', { variant: 'danger', icon: 'alert', action: 'toast:' + m.blockedReason }) : '')
        + (m.pendingAction.kind === 'agent' ? UI.pill(m.pendingAction.label, 'info', true) : '')
        + '</div>' + pipe
    });

    const tabsEl = UI.tabs([
      { key: 'fluxo', label: 'Fluxo e artefatos' },
      { key: 'campanhas', label: 'Campanhas de plataforma', count: m.childCampaignIds.length },
      { key: 'resultado', label: 'Resultado' },
      { key: 'briefing', label: 'Briefing' }
    ], active, 'tab:marketing/' + m.id);

    const body = { fluxo: tabFlow, campanhas: tabCampaigns, resultado: tabResult, briefing: tabBrief }[active](m, idx);

    return {
      nav: 'marketing', title: m.name,
      crumbs: [{ label: 'Campanhas de marketing', route: 'marketing' }, { label: m.client.name }],
      content: header + tabsEl + body
    };
  }

  function tabFlow(m, idx) {
    const stages = DB.agent.pipelineStages;
    const events = m.events.slice().reverse();
    const artifacts = [];
    R.researchOf(m.clientId).filter(function (r) { return r.marketingCampaignId === m.id; }).forEach(function (r) {
      artifacts.push({ icon: '⌕', title: 'Pesquisa de mercado', text: r.summary.slice(0, 120) + '…', meta: 'Market Research Agent · ' + F.dateFull(r.date) + ' · confiança ' + r.confidence, action: 'go:agent/' + m.clientId + '/pesquisa' });
    });
    R.plansOf(m.clientId).filter(function (p) { return p.marketingCampaignId === m.id; }).forEach(function (p) {
      artifacts.push({ icon: '◫', title: 'Plano de mídia — ' + F.money(p.budget), text: p.items.length + ' campanhas · ' + p.metrics, meta: 'Strategy Agent · ' + F.relative(p.createdAt) + ' · ' + UI.statusLabel(p.status), action: 'go:agent/' + m.clientId + '/estrategia' });
    });
    R.actionsOf(m.clientId).filter(function (a) { return a.marketingCampaignId === m.id; }).forEach(function (a) {
      artifacts.push({ icon: '⚙', title: a.title, text: a.before + ' → ' + a.after, meta: (a.executedBy === 'agent' ? 'Agente' : R.user(a.executedBy).name) + ' · ' + F.relative(a.at) + ' · ' + a.apiResult, action: 'go:agent/' + m.clientId + '/execucoes' });
    });

    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Histórico do fluxo', sub: 'Toda transição grava quem moveu, quando e o que produziu',
        tight: true,
        body: UI.timeline(events.map(function (e) {
          const s = R.stage(e.toStageId);
          const who = e.actorType === 'agent' ? (R.agent(e.actorId) || {}).name : (R.user(e.actorId) || {}).name;
          return { icon: e.actorType === 'agent' ? '◆' : '●', title: 'Entrou em ' + s.name, text: e.note, meta: who + ' · ' + F.dateTime(e.at) + (e.durationHours ? ' · ficou ' + e.durationHours + 'h' : ' · está aqui') };
        }))
      })
      + '<div class="col">'
      + UI.card({
        title: 'Etapa atual', sub: m.stage.name,
        body: UI.kv([
          ['Tipo', UI.pill(m.stage.kind === 'human' ? 'Decisão humana' : 'Agente', m.stage.kind === 'human' ? 'warn' : 'info')],
          ['Responsável', m.stage.kind === 'human' ? m.owner.name : R.agent(m.stage.agentId).name],
          ['Tempo na etapa', F.elapsed(m.stageSince) + (m.late ? ' · fora do SLA' : '')],
          ['SLA', m.stage.slaHours ? m.stage.slaHours + 'h' : 'contínuo'],
          ['Ação pendente', m.pendingAction.label]
        ]) + '<span class="small muted">' + m.stage.desc + '</span>'
          + (m.blockedReason ? '<div class="row small" style="color:var(--c-danger);background:var(--c-danger-bg);padding:10px;border-radius:var(--radius-sm)">' + ICON('alert', 15) + m.blockedReason + '</div>' : '')
      })
      + UI.card({
        title: 'Artefatos produzidos', tight: true,
        body: artifacts.length ? UI.timeline(artifacts) : UI.empty('Nenhum artefato ainda', 'Pesquisa, plano e execuções aparecem aqui.')
      })
      + '</div></div>';
  }

  function tabCampaigns(m) {
    if (!m.childCampaignIds.length) {
      return UI.card({ body: UI.empty('Nenhuma campanha de plataforma ainda', 'Elas são criadas pelo Campaign Agent depois da aprovação do plano — ou podem ser vinculadas manualmente se já existirem nas contas.', UI.btn('Vincular campanhas existentes', { size: 'sm', action: 'toast:Seleção de campanhas (mock)' })) });
    }
    const list = R.campaignRows(30, { marketingCampaignId: m.id });
    const isEcom = m.model === 'ecommerce';
    const max = Math.max.apply(null, list.map(function (c) { return c.metrics.spend; }).concat([1]));
    return UI.table([
      { key: 'name', label: 'Campanha', width: '24%' }, { key: 'account', label: 'Conta' }, { key: 'plat', label: 'Plataforma' },
      { key: 'spend', label: 'Investido', num: true }, { key: 'share', label: '', width: '10%' },
      { key: 'res', label: isEcom ? 'Receita conf.' : 'Leads', num: true },
      { key: 'eff', label: isEcom ? 'ROAS conf.' : 'CPL', num: true }, { key: 'status', label: 'Status' }
    ], list.map(function (c) {
      const a = R.account(c.adAccountId);
      return {
        __action: 'go:accounts/' + c.adAccountId + '/campanhas',
        name: '<span class="strong">' + c.name + '</span>',
        account: '<span class="small muted">' + a.group + '</span>',
        plat: UI.platform(c.platform),
        spend: '<span class="num">' + F.money(c.metrics.spend) + '</span>',
        share: UI.bar(c.metrics.spend, max, c.platform === 'meta' ? 'var(--chart-2)' : 'var(--chart-1)'),
        res: '<span class="num">' + (isEcom ? F.money(c.metrics.revenueConfirmed) : F.number(c.metrics.leads)) + '</span>',
        eff: '<span class="num strong">' + (isEcom ? F.ratio(c.metrics.roasConfirmed) : F.moneyCents(c.metrics.cpl)) + '</span>',
        status: UI.statusPill(c.status)
      };
    }), { title: 'Campanhas desta iniciativa', sub: 'Materializadas em ' + m.adAccountIds.length + ' contas' });
  }

  function tabResult(m) {
    const t = m.metrics;
    const isEcom = m.model === 'ecommerce';
    if (!m.childCampaignIds.length) return UI.card({ body: UI.empty('Sem resultado ainda', 'A iniciativa ainda não foi publicada.') });
    const target = isEcom ? m.targetKpis.roas : m.targetKpis.cpl;
    const actual = isEcom ? t.roasConfirmed : t.cpl;
    const pct = isEcom ? (target ? actual / target : 0) : (actual ? target / actual : 0);
    const s = R.series({ campaignIds: m.childCampaignIds, days: 30 }, isEcom ? 'revenueConfirmed' : 'leads');
    return '<div class="grid grid--4">'
      + UI.stat({ label: 'Investido', value: F.money(t.spend), foot: F.pct(t.spend / m.budgetTotal, 0) + ' da verba' })
      + UI.stat({ label: isEcom ? 'Receita confirmada' : 'Leads', value: isEcom ? F.money(t.revenueConfirmed) : F.number(t.leads), foot: isEcom ? 'declarada ' + F.money(t.revenue) : F.number(t.leadsQualified) + ' qualificados' })
      + UI.stat({ label: isEcom ? 'ROAS confirmado' : 'CPL', value: isEcom ? F.ratio(t.roasConfirmed) : F.moneyCents(t.cpl), foot: 'meta ' + (isEcom ? F.ratio(target) : F.money(target)) })
      + UI.stat({ label: 'Atingimento da meta', value: F.pct(pct, 0), foot: pct >= 1 ? 'meta atingida' : 'abaixo da meta' })
      + '</div>'
      + '<div class="grid grid--2a">'
      + UI.card({ title: isEcom ? 'Receita confirmada por dia' : 'Leads por dia', body: C.area(s, { height: 220, seed: 7 }) + C.axis(s) })
      + UI.card({
        title: 'Declarado × confirmado', sub: 'Fonte da verdade da conversão',
        body: UI.kv([
          ['Conversões declaradas', F.number(t.conversions)],
          ['Conversões confirmadas', F.number(t.conversionsConfirmed)],
          ['Divergência', F.pct(t.gap, 0) + (t.gap > .2 ? ' · acima do limite' : '')],
          ['Fonte confirmada', isEcom ? 'Plataforma de e-commerce' : 'CRM']
        ]) + '<span class="xsmall subtle">Realocação entre plataformas usa sempre o número confirmado.</span>'
      })
      + '</div>';
  }

  function tabBrief(m) {
    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Briefing', sub: m.origin === 'agent' ? 'Gerado pelo agente a partir do pedido do gestor' : 'Preenchido pelo gestor',
        body: '<span class="small">' + m.brief + '</span>'
          + UI.kv([
            ['Objetivo', m.objective],
            ['Verba total', F.money(m.budgetTotal)],
            ['Verba alocada', F.money(m.budgetAllocated)],
            ['Período', m.period],
            ['Plataformas', m.platforms.map(function (p) { return UI.platform(p); }).join(' ')],
            ['Alcance', m.scopeType === 'client_tree'
              ? UI.pill('Rede inteira', 'info') + ' <span class="small muted">' + m.reachClients.map(function (x) { return x.name; }).join(' · ') + '</span>'
              : UI.pill('Operação única', 'neutral') + ' ' + m.client.name],
            ['Contas', m.adAccountIds.map(function (id) { return '<span class="pill pill--outline">' + R.account(id).name.split('| ')[1] + '</span>'; }).join(' ')],
            ['Meta', m.targetKpis.roas ? 'ROAS ≥ ' + F.decimal(m.targetKpis.roas) : 'CPL ≤ ' + F.money(m.targetKpis.cpl) + ' · ' + m.targetKpis.volume + ' leads']
          ]),
        foot: UI.btn('Editar briefing', { size: 'sm', action: 'toast:Edição de briefing (mock)' })
      })
      + UI.card({
        title: 'Contexto do cliente usado', sub: 'Versão ' + DB.agent.context[m.clientId].version + ' · ' + DB.agent.context[m.clientId].completeness + '% completo',
        body: UI.kv([
          ['Público', DB.agent.context[m.clientId].publico],
          ['Diferenciais', DB.agent.context[m.clientId].diferenciais],
          ['Restrições', DB.agent.context[m.clientId].restricoes]
        ]) + '<span class="xsmall subtle">Toda decisão do fluxo guarda o snapshot do contexto e dos dados que a sustentaram.</span>'
      })
      + '</div>';
  }

  g.MC_CARD = card;
})(window);
