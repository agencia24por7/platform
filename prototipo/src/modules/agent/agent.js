(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.agent = function (route) { return route.id ? clientView(route) : globalView(); };

  function globalView() {
    const sc = R.scope(g.Store.me().id);
    const recs = R.recsPending(null, sc.clientIds);
    const pend = R.approvalsPending(sc.clientIds);
    const board = R.board({ accountIds: sc.accountIds });
    const q = DB.agent.quality;

    const roster = UI.table([
      { key: 'a', label: 'Agente', width: '22%' }, { key: 'r', label: 'Responsabilidade' },
      { key: 'k', label: 'Iniciativas na etapa', num: true }, { key: 'x', label: 'Execuções', num: true },
      { key: 'l', label: 'Última', num: true }, { key: 's', label: 'Status' }
    ], DB.agent.roster.map(function (a) {
      const col = board.find(function (c) { return c.stage.agentId === a.id; });
      return {
        __action: col ? 'filter-stage:' + col.stage.id : 'noop',
        a: '<span class="row" style="gap:8px">' + UI.avatar(a.name, { text: a.short, alt: true }) + '<span class="strong small">' + a.name + '</span></span>',
        r: '<span class="small muted">' + a.role + '</span>',
        k: '<span class="num strong">' + (col ? col.cards.length : '—') + '</span>',
        x: '<span class="num">' + a.runs + '</span>',
        l: '<span class="small muted">' + F.relative(a.lastRun) + '</span>',
        s: UI.pill(a.status === 'active' ? 'Ativo' : 'Limitado', a.status === 'active' ? 'ok' : 'warn', true)
      };
    }), { title: 'Agentes especializados', sub: 'Compartilham contexto e são coordenados pelo orquestrador. Clique para filtrar o Kanban pela etapa do agente.', actions: UI.btn('Abrir Kanban', { size: 'sm', icon: 'board', action: 'go:marketing' }) });

    const queue = UI.card({
      title: 'Recomendações abertas', sub: 'Ordenadas por severidade',
      actions: UI.btn('Fila de aprovações', { size: 'sm', action: 'go:approvals' }), tight: true,
      body: recs.sort(sevSort).map(function (r) {
        const c = R.client(r.clientId);
        return '<div class="rec">' + UI.sev(r.severity) + '<div class="col" style="gap:4px">'
          + '<div class="row"><span class="rec__title">' + r.title + '</span><span class="spacer"></span>' + UI.sevPill(r.severity) + UI.pill(c.name, 'neutral') + '</div>'
          + '<span class="small muted">' + r.what + '</span>'
          + '<div class="rec__grid"><div><b>Evidência</b>' + r.evidence + '</div><div><b>Ação sugerida</b>' + r.action + '</div></div>'
          + '<div class="row" style="margin-top:6px">' + UI.btn('Abrir cliente', { size: 'sm', action: 'go:agent/' + c.id + '/otimizacoes' })
          + (R.canApprove(g.Store.me().id, r.clientId) ? UI.btn('Aprovar', { size: 'sm', variant: 'primary', action: 'approve:' + r.id }) + UI.btn('Recusar', { size: 'sm', variant: 'danger', action: 'reject:' + r.id }) : UI.pill('somente leitura', 'neutral')) + '</div>'
          + '</div></div>';
      }).join('') || UI.empty('Nenhuma recomendação aberta')
    });

    const learnings = UI.card({
      title: 'Aprendizados acumulados', sub: 'Memória de otimização — inclui o que foi refutado', tight: true,
      body: DB.agent.learnings.map(function (l) {
        return '<div class="rec">' + UI.sev(l.result === 'positivo' ? 'opp' : 'high') + '<div class="col" style="gap:4px">'
          + '<div class="row"><span class="rec__title">' + l.title + '</span><span class="spacer"></span>'
          + UI.pill(l.result === 'positivo' ? 'Confirmado' : 'Refutado', l.result === 'positivo' ? 'ok' : 'danger') + UI.pill('Confiança ' + l.confidence, 'neutral') + '</div>'
          + '<span class="small muted">' + R.client(l.clientId).name + ' · reaproveitado em ' + l.appliedTo + ' contas · ' + F.relative(l.at) + '</span>'
          + '<div class="rec__grid"><div><b>Hipótese</b>' + l.hypothesis + '</div><div><b>Evidência</b>' + l.evidence + '</div></div></div></div>';
      }).join('')
    });

    return {
      nav: 'agent', title: 'Agente IA',
      content: '<div class="page__head"><div><div class="page__title">Agente IA — visão da agência</div>'
        + '<div class="page__sub">Não é um chatbot: são sete agentes especializados que pesquisam, planejam, diagnosticam e executam dentro da autonomia de cada cliente.</div></div>'
        + '<div class="page__actions">' + UI.btn('Rodar análise agora', { size: 'sm', icon: 'refresh', action: 'toast:Análise enfileirada no n8n (mock)' }) + '</div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Clientes analisados hoje', value: String(sc.clientIds.length) })
        + UI.stat({ label: 'Iniciativas no fluxo', value: String(board.reduce(function (a, c) { return a + c.cards.length; }, 0)), foot: 'ver Kanban' })
        + UI.stat({ label: 'Aguardando aprovação', value: String(pend.length), accent: true })
        + UI.stat({ label: 'Taxa de acerto', value: F.pct(q.successRate, 0), foot: q.samples + ' casos avaliados' })
        + '</div>'
        + roster + queue
        + '<div class="grid grid--2a">' + learnings + autonomyCard(sc) + '</div>'
    };
  }

  function autonomyCard(sc) {
    return UI.card({
      title: 'Autonomia por cliente',
      body: '<div class="col">' + DB.core.clients.filter(function (c) { return sc.clientIds.indexOf(c.id) >= 0; }).map(function (c) {
        return '<div class="row"><span class="small truncate" style="width:150px">' + c.name + '</span>' + UI.autonomyPill(c.autonomyLevel)
          + '<span class="spacer"></span><span class="xsmall subtle">' + R.rulesOf(c.id).filter(function (r) { return r.active; }).length + ' regras</span>'
          + UI.iconBtn('chevron', 'go:agent/' + c.id + '/configuracoes') + '</div>';
      }).join('') + '</div>'
    });
  }

  function sevSort(a, b) { return ({ high: 0, mid: 1, opp: 2, low: 3 })[a.severity] - ({ high: 0, mid: 1, opp: 2, low: 3 })[b.severity]; }

  function clientView(route) {
    const c = R.client(route.id);
    if (!c) return { nav: 'agent', title: 'Agente', content: UI.empty('Cliente não encontrado') };
    const tab = route.tab || 'conversar';
    const ctx = DB.agent.context[c.id];

    const header = UI.card({
      className: 'card--flat',
      body: '<div class="row row--wrap">' + UI.avatar(c.name, { square: true, alt: c.model === 'ecommerce' })
        + '<div class="col" style="gap:0"><span class="strong">' + c.name + '</span><span class="xsmall subtle">' + c.segment + ' · contexto ' + ctx.completeness + '% (v' + ctx.version + ')</span></div>'
        + '<span class="spacer"></span>' + UI.modelPill(c.model) + UI.autonomyPill(c.autonomyLevel)
        + UI.btn('Painel do cliente', { size: 'sm', action: 'go:clients/' + c.id }) + '</div>'
    });

    const tabsEl = UI.tabs([
      { key: 'conversar', label: 'Conversar' },
      { key: 'pesquisa', label: 'Pesquisa', count: R.researchOf(c.id).length },
      { key: 'estrategia', label: 'Estratégia', count: R.plansOf(c.id).length },
      { key: 'otimizacoes', label: 'Otimizações', count: R.recsPending(c.id).length },
      { key: 'execucoes', label: 'Execuções', count: R.actionsOf(c.id).length },
      { key: 'aprendizados', label: 'Aprendizados', count: R.learningsOf(c.id).length },
      { key: 'configuracoes', label: 'Configurações' }
    ], tab, 'tab:agent/' + c.id);

    const map = { conversar: tChat, pesquisa: tResearch, estrategia: tStrategy, otimizacoes: tOptim, execucoes: tExec, aprendizados: tLearn, configuracoes: tConfig };
    return {
      nav: 'agent', title: 'Agente · ' + c.name,
      crumbs: [{ label: 'Agente IA', route: 'agent' }, { label: c.name }],
      content: header + tabsEl + (map[tab] || tChat)(c)
    };
  }

  function tChat(c) {
    const msgs = DB.agent.conversations[c.id] || [];
    const sug = ['Como está a saúde das campanhas?', 'Pesquise meus principais concorrentes', 'Por que o CPL aumentou nesta semana?', 'Crie uma campanha de marketing para dezembro', 'Quais campanhas deveriam receber mais orçamento?'];
    const chat = '<div class="card" style="min-height:520px">'
      + '<div class="card__head"><span class="card__title">Conversa com o agente</span><span class="spacer"></span>' + UI.pill('Contexto v' + DB.agent.context[c.id].version + ' carregado', 'ok', true) + '</div>'
      + '<div class="chat">' + (msgs.length ? msgs.map(function (m) {
        return '<div class="msg ' + (m.role === 'user' ? 'msg--user' : '') + '">'
          + UI.avatar(m.role === 'user' ? g.Store.me().name : 'IA', { text: m.role === 'user' ? undefined : 'OR', alt: m.role !== 'user' })
          + '<div class="msg__bubble">' + m.text.split('|').map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div></div>';
      }).join('') : UI.empty('Comece uma conversa', 'O agente já carregou contexto, campanhas e histórico deste cliente.')) + '</div>'
      + '<div class="row row--wrap" style="padding:0 var(--sp-4) var(--sp-3)">' + sug.map(function (s) {
        return '<span class="chip" data-action="toast:Pergunta enviada ao agente (mock)">' + s + '</span>';
      }).join('') + '</div>'
      + '<div class="composer"><textarea class="textarea" style="min-height:44px" placeholder="Pergunte sobre o negócio, o mercado ou as campanhas..."></textarea>'
      + UI.btn('Enviar', { variant: 'primary', icon: 'send', action: 'toast:Mensagem enviada (mock)' }) + '</div></div>';

    const side = '<div class="col">'
      + UI.card({
        title: 'O que o agente sabe',
        body: UI.kv([
          ['Contexto', DB.agent.context[c.id].completeness + '% · versão ' + DB.agent.context[c.id].version],
          ['Iniciativas', String(R.mcRows({ client: c.id }).length)],
          ['Campanhas', String(R.campaignRows(30, { clientId: c.id }).length)],
          ['Contas', String(R.accountsOf(c.id).length)],
          ['Histórico', DB.meta.days + ' dias de métricas'],
          ['Aprendizados', String(R.learningsOf(c.id).length)],
          ['Autonomia', UI.autonomyPill(c.autonomyLevel)]
        ])
      })
      + UI.card({
        title: 'Como o agente responde',
        body: '<div class="col small muted">' + [
          'Separa fato confirmado, fonte pública, estimativa e hipótese.',
          'Compara com baseline sazonal, não com o período anterior cru.',
          'Usa conversão confirmada para decidir entre canais.',
          'Responde "não há dado suficiente" quando é o caso.',
          'Toda ação vira proposta estruturada com aprovação.'
        ].map(function (t) { return '<div class="row" style="gap:8px;align-items:flex-start">' + ICON('check', 14) + '<span>' + t + '</span></div>'; }).join('') + '</div>'
      })
      + '</div>';
    return '<div class="grid grid--2a">' + chat + side + '</div>';
  }

  function tResearch(c) {
    const list = R.researchOf(c.id);
    if (!list.length) return UI.card({ body: UI.empty('Nenhuma pesquisa', 'O Market Research Agent pesquisa concorrentes, público e tendências.', UI.btn('Pesquisar mercado', { size: 'sm', variant: 'primary', icon: 'search', action: 'toast:Pesquisa enfileirada (mock)' })) });
    return list.map(function (r) {
      const mcLink = r.marketingCampaignId ? R.mc(r.marketingCampaignId) : null;
      return UI.card({
        title: 'Pesquisa de mercado — ' + F.dateFull(r.date),
        sub: 'Market Research Agent · confiança ' + r.confidence + ' · ' + r.sources.length + ' fontes' + (mcLink ? ' · iniciativa ' + mcLink.name : ''),
        actions: UI.btn('Nova pesquisa', { size: 'sm', icon: 'refresh', action: 'toast:Pesquisa enfileirada (mock)' }),
        body: '<span class="small">' + r.summary + '</span>'
          + UI.sectionTitle('Concorrentes', 'Cada item classificado — hipótese nunca vira dado de mercado')
          + UI.table([{ key: 'n', label: 'Concorrente' }, { key: 'o', label: 'Observação' }, { key: 't', label: 'Classificação' }],
            r.competitors.map(function (x) {
              const tone = x.type === 'fato' ? 'ok' : x.type === 'estimativa' ? 'warn' : 'info';
              const label = x.type === 'fato' ? 'Fonte pública' : x.type === 'estimativa' ? 'Estimativa' : 'Hipótese';
              return { n: '<span class="strong">' + x.name + '</span>', o: '<span class="small muted">' + x.note + '</span>', t: UI.pill(label, tone) };
            }), { bare: true })
          + UI.sectionTitle('Oportunidades')
          + '<div class="row row--wrap">' + r.opportunities.map(function (o) { return '<span class="pill pill--outline">' + o + '</span>'; }).join('') + '</div>'
          + UI.sectionTitle('Fontes consultadas')
          + '<div class="col xsmall subtle">' + r.sources.map(function (s) { return '<span>' + ICON('external', 12) + ' ' + s + '</span>'; }).join('') + '</div>',
        foot: 'A pesquisa alimenta a base de conhecimento do cliente com fonte, data e classificação.'
      });
    }).join('');
  }

  function tStrategy(c) {
    const plans = R.plansOf(c.id);
    const cards = plans.map(function (p) {
      const max = Math.max.apply(null, p.items.map(function (i) { return i.budget; }));
      const mcLink = p.marketingCampaignId ? R.mc(p.marketingCampaignId) : null;
      return UI.card({
        title: 'Plano de mídia — ' + p.month,
        sub: 'Strategy Agent · ' + F.relative(p.createdAt) + (mcLink ? ' · ' + mcLink.name : ''),
        actions: UI.statusPill(p.status),
        body: UI.dlInline([['Investimento', F.money(p.budget)], ['Campanhas', String(p.items.length)], ['Métricas de sucesso', p.metrics]])
          + UI.table([{ key: 'n', label: 'Campanha' }, { key: 'b', label: 'Distribuição', width: '34%' }, { key: 'v', label: 'Orçamento', num: true }, { key: 's', label: '%', num: true }],
            p.items.map(function (i) {
              return {
                n: '<span class="small">' + i.name + '</span>',
                b: UI.bar(i.budget, max, i.name.indexOf('Meta') === 0 ? 'var(--chart-2)' : 'var(--chart-1)'),
                v: '<span class="num">' + F.money(i.budget) + '</span>', s: '<span class="num">' + F.pct(i.budget / p.budget, 0) + '</span>'
              };
            }), { bare: true })
          + UI.sectionTitle('Hipóteses de teste')
          + '<div class="col small muted">' + p.hypotheses.map(function (h) { return '<div class="row" style="gap:8px;align-items:flex-start">' + ICON('target', 14) + '<span>' + h + '</span></div>'; }).join('') + '</div>'
          + '<div class="row small" style="background:var(--c-warn-bg);color:var(--c-warn);padding:10px;border-radius:var(--radius-sm);align-items:flex-start;gap:8px">' + ICON('alert', 15) + '<span><b>Riscos:</b> ' + p.risks + '</span></div>',
        foot: p.status === 'pending'
          ? (R.canApprove(g.Store.me().id, p.clientId) ? UI.btn('Aprovar plano', { variant: 'primary', size: 'sm', action: 'approve-plan:' + p.id }) : UI.pill('Sem permissão para aprovar', 'neutral')) + UI.btn('Pedir ajuste', { size: 'sm', action: 'toast:Ajuste solicitado (mock)' }) + UI.btn('Recusar', { size: 'sm', variant: 'danger', action: 'noop' })
          : p.status === 'approved' ? 'Aprovado por ' + (R.user(p.approvedBy) || {}).name + ' em ' + F.dateTime(p.approvedAt)
            : UI.btn('Enviar para aprovação', { size: 'sm', variant: 'primary', action: 'toast:Plano enviado (mock)' })
      });
    }).join('');
    return '<div class="grid grid--2a">' + (cards || UI.card({ body: UI.empty('Nenhum plano de mídia') })) + '<div class="col">' + ficha(c) + '</div></div>';
  }

  function ficha(c) {
    const ctx = DB.agent.context[c.id];
    const t = R.totals({ clientId: c.id, days: 30 });
    const diag = c.model === 'ecommerce'
      ? 'Com ROAS confirmado de ' + F.ratio(t.roasConfirmed) + ' e ticket de ' + F.moneyCents(t.aov) + ', a conta sustenta aumento nas campanhas de maior retorno. Antes de escalar, confirmar margem, estoque e capacidade de atendimento.'
      : 'Com CPL de ' + F.moneyCents(t.cpl) + ' e custo por lead qualificado de ' + F.moneyCents(t.cpql) + ', o próximo ganho está na qualificação e na exclusão de termos sem intenção, não em aumentar verba.';
    return UI.card({
      title: 'Ficha estratégica', sub: 'Versão ' + ctx.version + ' · ' + F.relative(ctx.updatedAt),
      body: UI.kv([
        ['Modelo', UI.modelPill(c.model)], ['Ticket', F.money(ctx.ticket)], ['Objetivo', ctx.objetivos],
        ['Público', ctx.publico], ['Diferenciais', ctx.diferenciais], ['Restrições', ctx.restricoes], ['Sazonalidade', ctx.sazonalidade]
      ]) + '<div class="divider"></div><span class="xsmall subtle">Diagnóstico do agente</span><span class="small">' + diag + '</span>'
    });
  }

  function tOptim(c) {
    const recs = DB.agent.recommendations.filter(function (r) { return r.clientId === c.id; });
    const rules = R.rulesOf(c.id);
    const list = recs.length ? recs.map(function (r) {
      return UI.card({
        className: r.severity === 'high' ? 'card--danger' : '',
        title: r.title,
        sub: (R.campaign(r.campaignId) || {}).name + ' · ' + F.relative(r.createdAt) + (r.marketingCampaignId ? ' · ' + R.mc(r.marketingCampaignId).name : ''),
        actions: UI.sevPill(r.severity) + UI.statusPill(r.status),
        body: '<div class="rec__grid">'
          + '<div><b>O que aconteceu</b>' + r.what + '</div><div><b>Período analisado</b>' + r.period + '</div>'
          + '<div><b>Evidência</b>' + r.evidence + '</div><div><b>Causa provável</b>' + r.cause + '</div>'
          + '<div><b>Recomendação</b>' + r.action + '</div><div><b>Impacto esperado</b>' + r.impact + '</div>'
          + '<div><b>Risco</b>' + r.risk + '</div><div><b>Aprovação</b>' + (r.needsApproval ? 'Necessária' : 'Dispensada por regra ativa') + '</div>'
          + '</div>' + (r.decisionNote ? '<div class="small muted">Nota da decisão: ' + r.decisionNote + '</div>' : ''),
        foot: r.status === 'pending'
          ? (R.canApprove(g.Store.me().id, r.clientId)
            ? UI.btn('Aprovar e executar', { variant: 'primary', size: 'sm', icon: 'check', action: 'approve:' + r.id }) + UI.btn('Recusar', { size: 'sm', variant: 'danger', action: 'reject:' + r.id })
            : UI.pill('Decisão reservada a gestor, administrador ou proprietário', 'neutral')) + UI.btn('Pedir mais dados', { size: 'sm', action: 'toast:Solicitação enviada (mock)' })
          : UI.statusLabel(r.status) + ' por ' + ((R.user(r.decidedBy) || {}).name || '—') + ' · ' + (r.decidedAt ? F.dateTime(r.decidedAt) : '')
      });
    }).join('') : UI.card({ body: UI.empty('Nenhuma recomendação', 'A próxima análise roda amanhã às 07h.') });

    return '<div class="col">' + list + UI.table([
      { key: 'l', label: 'Regra' }, { key: 'c', label: 'Condição' }, { key: 'a', label: 'Ação' }, { key: 'li', label: 'Limite' }, { key: 'w', label: 'Janela' }, { key: 'o', label: 'Ativa' }
    ], rules.map(function (r) {
      return {
        l: '<span class="strong small">' + r.label + '</span>', c: '<span class="small muted">' + r.condition + '</span>',
        a: '<span class="small">' + r.action + '</span>', li: '<span class="small muted">' + r.limit + '</span>',
        w: '<span class="small muted">' + r.window + '</span>', o: UI.switchEl(r.active, 'noop')
      };
    }), { title: 'Regras de otimização', sub: 'Definem o que o agente executa sem aprovação', actions: UI.btn('Nova regra', { size: 'sm', icon: 'plus', action: 'noop' }), empty: 'Sem regras — toda ação exige aprovação' }) + '</div>';
  }

  function tExec(c) {
    const actions = R.actionsOf(c.id);
    const runs = DB.automation.runs.filter(function (r) { return r.clientId === c.id; });
    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Ações executadas', sub: 'Cada alteração guarda valor anterior, novo, chave de idempotência e verificação', tight: true,
        body: actions.length ? actions.map(function (a) {
          return '<div class="rec">' + UI.sev(a.verified === 'confirmada' ? 'opp' : a.verified === 'falhou' ? 'high' : 'mid') + '<div class="col" style="gap:6px">'
            + '<div class="row"><span class="rec__title">' + a.title + '</span><span class="spacer"></span>' + UI.statusPill(a.verified === 'pendente' ? 'pending' : a.verified) + '</div>'
            + '<span class="small muted">' + (R.campaign(a.campaignId) || {}).name + ' · ' + F.dateTime(a.at) + '</span>'
            + '<div class="rec__grid">'
            + '<div><b>Valor anterior</b>' + a.before + '</div><div><b>Valor novo</b>' + a.after + '</div>'
            + '<div><b>Motivo</b>' + a.reason + '</div>'
            + '<div><b>Executado por</b>' + (a.executedBy === 'agent' ? 'Agente' : (R.user(a.executedBy) || {}).name) + '</div>'
            + '<div><b>Chave de idempotência</b><span class="mono">' + a.idempotencyKey + '</span></div>'
            + '<div><b>Resposta da API</b><span class="mono">' + a.apiResult + '</span></div>'
            + '<div><b>Resultado medido</b>' + a.outcome + '</div>'
            + '<div><b>Reversível</b>' + (a.reversible ? 'Sim — snapshot anterior guardado' : 'Não') + '</div>'
            + '</div>'
            + (a.reversible ? '<div class="row">' + UI.btn('Reverter', { size: 'sm', variant: 'danger', action: 'toast:Reversão enfileirada (mock)' }) + '</div>' : '')
            + '</div></div>';
        }).join('') : UI.empty('Nenhuma ação executada')
      })
      + UI.card({
        title: 'Execuções do n8n', tight: true,
        body: runs.length ? UI.timeline(runs.map(function (r) {
          return { icon: r.status === 'success' ? '✓' : '!', title: r.workflow, text: r.note, meta: F.dateTime(r.startedAt) + (r.durationMs ? ' · ' + F.duration(r.durationMs) : ' · em execução') };
        })) : UI.empty('Sem execuções')
      })
      + '</div>';
  }

  function tLearn(c) {
    const mine = R.learningsOf(c.id), all = R.learningsOf();
    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Aprendizados deste cliente', sub: 'Resultado medido de cada alteração', tight: true,
        body: mine.length ? mine.map(function (l) {
          return '<div class="rec">' + UI.sev(l.result === 'positivo' ? 'opp' : 'high') + '<div class="col" style="gap:4px">'
            + '<div class="row"><span class="rec__title">' + l.title + '</span><span class="spacer"></span>' + UI.pill(l.result === 'positivo' ? 'Confirmado' : 'Refutado', l.result === 'positivo' ? 'ok' : 'danger') + '</div>'
            + '<div class="rec__grid"><div><b>Hipótese</b>' + l.hypothesis + '</div><div><b>Evidência</b>' + l.evidence + '</div>'
            + '<div><b>Confiança</b>' + l.confidence + '</div><div><b>Reaproveitado em</b>' + l.appliedTo + ' contas</div></div></div></div>';
        }).join('') : UI.empty('Sem aprendizados', 'Cada ação vira aprendizado depois da verificação.')
      })
      + UI.card({
        title: 'Benchmark interno', sub: 'Padrões agregados da carteira, sem expor dado de outro cliente',
        body: '<div class="col">' + all.map(function (l) {
          return '<div class="row small" style="gap:8px;align-items:flex-start">' + ICON(l.result === 'positivo' ? 'check' : 'alert', 14) + '<span>' + l.title + ' <span class="subtle">(' + l.appliedTo + ' contas)</span></span></div>';
        }).join('') + '</div>'
          + '<span class="xsmall subtle">Exibido só com mínimo de contas no recorte. Nenhum valor permite identificar a conta de origem.</span>'
      })
      + '</div>';
  }

  function tConfig(c) {
    const q = DB.agent.quality;
    return '<div class="col">'
      + UI.card({
        title: 'Nível de autonomia', sub: 'Define o que o agente executa sem aprovação neste cliente',
        body: '<div class="grid grid--3">' + DB.agent.autonomyLevels.map(function (l) {
          const active = l.level === c.autonomyLevel;
          return '<div class="card ' + (active ? 'card--accent' : '') + '" style="cursor:pointer"><div class="card__body">'
            + '<div class="row"><span class="strong">Nível ' + l.level + ' — ' + l.label + '</span><span class="spacer"></span>' + (active ? UI.pill('Ativo', 'ok', true) : UI.pill('Selecionar', 'neutral')) + '</div>'
            + '<span class="small muted">' + l.desc + '</span></div></div>';
        }).join('') + '</div>'
          + '<div class="row small" style="background:var(--accent-soft);padding:10px;border-radius:var(--radius-sm);gap:8px;align-items:flex-start">' + ICON('shield', 15)
          + '<span>A promoção de nível depende de histórico medido: aprovação ' + F.pct(q.approvalRate, 0) + ' (limiar ' + F.pct(q.threshold.approvalRate, 0) + ') e acerto ' + F.pct(q.successRate, 0) + ' (limiar ' + F.pct(q.threshold.successRate, 0) + ') em ' + q.samples + ' casos.</span></div>'
      })
      + '<div class="grid grid--2">'
      + UI.card({
        title: 'Limites de execução',
        body: UI.kv([
          ['Investimento diário máximo', F.money(Math.round(c.monthlyBudget / 30 * 1.2))],
          ['Aumento máximo por alteração', '10%'], ['Alterações por dia', '3'],
          ['Janela permitida', 'Seg a Sex, 06h às 20h'], ['Campanhas elegíveis', 'Todas exceto marca'],
          ['Ações proibidas', 'Excluir campanha, alterar conversões'],
          ['Parada automática', 'Inconsistência de dado, falha de sync ou desvio > 20%']
        ])
      })
      + UI.card({
        title: 'Proteções contra decisão precipitada',
        body: '<div class="col small muted">' + [
          'Volume mínimo de conversões antes de recomendar pausa.',
          'Respeita a janela de atribuição configurada.',
          'Aguarda a fase de aprendizado da campanha.',
          'Considera o ciclo de compra do negócio.',
          'Não otimiza com métrica inconsistente ou desvio alto.'
        ].map(function (t) { return '<div class="row" style="gap:8px;align-items:flex-start">' + ICON('shield', 14) + '<span>' + t + '</span></div>'; }).join('') + '</div>'
          + '<div class="divider"></div>'
          + '<div class="row"><span class="small strong">Kill switch deste cliente</span><span class="spacer"></span>' + UI.btn('Congelar execução', { size: 'sm', variant: 'danger', icon: 'alert', action: 'toast:Execução automática congelada (mock)' }) + '</div>'
      })
      + '</div>'
      + UI.table([{ key: 'a', label: 'Agente' }, { key: 'r', label: 'Responsabilidade' }, { key: 'o', label: '' }],
        DB.agent.roster.map(function (a) {
          const on = !(a.id === 'ag_campaign' && c.autonomyLevel === 1);
          return {
            a: '<span class="row" style="gap:8px">' + UI.avatar(a.name, { text: a.short, alt: true }) + '<span class="small strong">' + a.name + '</span></span>',
            r: '<span class="small muted">' + a.role + '</span>', o: UI.switchEl(on, 'noop')
          };
        }), { title: 'Agentes habilitados neste cliente' })
      + '</div>';
  }
})(window);
