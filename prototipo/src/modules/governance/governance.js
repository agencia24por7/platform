(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.approvals = function () {
    const sc = R.scope(g.Store.me().id);
    const pend = R.approvalsPending(sc.clientIds);
    const done = DB.agent.approvals.filter(function (a) { return a.status !== 'pending' && sc.clientIds.indexOf(a.clientId) >= 0; });

    const queue = pend.map(function (a) {
      const c = R.client(a.clientId);
      const rec = a.recommendationId ? DB.agent.recommendations.find(function (r) { return r.id === a.recommendationId; }) : null;
      const plan = a.mediaPlanId ? DB.agent.mediaPlans.find(function (p) { return p.id === a.mediaPlanId; }) : null;
      const m = a.marketingCampaignId ? R.mc(a.marketingCampaignId) : null;
      return UI.card({
        title: a.title,
        sub: c.name + (m ? ' · iniciativa ' + m.name : '') + ' · solicitado ' + F.relative(a.requestedAt) + ' pelo ' + (R.agent(a.requestedBy) ? R.agent(a.requestedBy).name : 'gestor'),
        actions: UI.pill('Risco ' + a.risk, a.risk === 'Baixo' ? 'ok' : 'warn') + UI.autonomyPill(c.autonomyLevel),
        body: rec ? '<div class="rec__grid"><div><b>Diagnóstico</b>' + rec.what + '</div><div><b>Evidência</b>' + rec.evidence + '</div>'
          + '<div><b>Ação a executar</b>' + rec.action + '</div><div><b>Impacto esperado</b>' + rec.impact + '</div></div>'
          : plan ? '<div class="rec__grid"><div><b>Verba</b>' + F.money(plan.budget) + ' em ' + plan.items.length + ' campanhas</div>'
            + '<div><b>Métricas de sucesso</b>' + plan.metrics + '</div><div><b>Hipóteses</b>' + plan.hypotheses.join(' · ') + '</div>'
            + '<div><b>Riscos</b>' + plan.risks + '</div></div>'
            : '<span class="small muted">Proposta sem detalhe estruturado.</span>',
        foot: (a.value ? '<span class="mono">' + a.value + '</span>' : '') + '<span class="spacer"></span>'
          + UI.btn('Ver detalhes', { size: 'sm', action: plan ? 'go:agent/' + c.id + '/estrategia' : 'go:agent/' + c.id + '/otimizacoes' })
          + (R.canApprove(g.Store.me().id, a.clientId)
            ? UI.btn('Recusar', { size: 'sm', variant: 'danger', action: 'reject:' + (a.recommendationId || a.mediaPlanId || a.id) })
              + UI.btn('Aprovar e executar', { size: 'sm', variant: 'primary', icon: 'check', action: 'approve:' + (a.recommendationId || a.mediaPlanId || a.id) })
            : UI.pill('Somente leitura neste escopo', 'neutral'))
      });
    }).join('');

    return {
      nav: 'approvals', title: 'Aprovações',
      content: '<div class="page__head"><div><div class="page__title">Fila de aprovações</div>'
        + '<div class="page__sub">Nada é aplicado nas contas sem passar por aqui, exceto o que uma regra ativa autoriza explicitamente.</div></div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Na fila', value: String(pend.length), accent: true })
        + UI.stat({ label: 'Risco baixo', value: String(pend.filter(function (a) { return a.risk === 'Baixo'; }).length), foot: 'elegíveis a regra automática' })
        + UI.stat({ label: 'Decididas (30d)', value: String(done.length), foot: done.filter(function (a) { return a.status === 'approved'; }).length + ' aprovadas' })
        + UI.stat({ label: 'Tempo médio de decisão', value: '11 min' })
        + '</div>'
        + (pend.length ? queue : UI.card({ body: UI.empty('Fila vazia', 'Todas as propostas foram decididas.') }))
        + UI.table([{ key: 't', label: 'Solicitação' }, { key: 'c', label: 'Cliente' }, { key: 'v', label: 'Alteração' }, { key: 'b', label: 'Decidido por' }, { key: 'w', label: 'Quando' }, { key: 's', label: 'Status' }],
          done.map(function (a) {
            return {
              t: '<span class="small strong">' + a.title + '</span>', c: '<span class="small muted">' + R.client(a.clientId).name + '</span>',
              v: '<span class="mono">' + (a.value || '—') + '</span>', b: '<span class="small">' + ((R.user(a.decidedBy) || {}).name || '—') + '</span>',
              w: '<span class="small muted">' + (a.decidedAt ? F.dateTime(a.decidedAt) : '—') + '</span>', s: UI.statusPill(a.status)
            };
          }), { title: 'Histórico de decisões' })
    };
  };

  g.PAGES.automations = function () {
    const runs = DB.automation.runs;
    return {
      nav: 'automations', title: 'Automações',
      content: '<div class="page__head"><div><div class="page__title">Automações (n8n)</div>'
        + '<div class="page__sub">O n8n orquestra sincronização, análise e execução. A inteligência fica no Agent Service — o n8n não decide, apenas executa o que foi validado pelo policy engine.</div></div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Execuções hoje', value: String(runs.filter(function (r) { return r.startedAt.slice(0, 10) === DB.meta.today; }).length), foot: runs.filter(function (r) { return r.status === 'success'; }).length + ' com sucesso' })
        + UI.stat({ label: 'Falhas abertas', value: String(runs.filter(function (r) { return r.status === 'error'; }).length), foot: 'exigem ação manual' })
        + UI.stat({ label: 'Registros sincronizados', value: F.number(runs.reduce(function (a, r) { return a + r.records; }, 0)) })
        + UI.stat({ label: 'Workflows ativos', value: String(DB.automation.workflows.length), foot: 'n8n self-hosted' })
        + '</div>'
        + '<div class="grid grid--2a">'
        + UI.table([{ key: 'n', label: 'Workflow' }, { key: 'd', label: 'Função' }, { key: 's', label: 'Agenda' }, { key: 'l', label: 'Última execução' }],
          DB.automation.workflows.map(function (w) {
            const last = runs.find(function (r) { return r.workflow === w.name; });
            return {
              n: '<span class="mono strong">' + w.name + '</span>', d: '<span class="small muted">' + w.desc + '</span>',
              s: '<span class="small">' + w.schedule + '</span>', l: last ? '<span class="small muted">' + F.relative(last.startedAt) + '</span>' : '—'
            };
          }), { title: 'Workflows', actions: UI.btn('Abrir n8n', { size: 'sm', icon: 'external', action: 'noop' }) })
        + '<div class="col">'
        + UI.card({
          title: 'Acesso do n8n ao banco', sub: 'Usuário restrito, schema separado, views de leitura',
          body: UI.kv([
            ['Usuário', '<span class="mono">n8n_worker</span>'],
            ['Banco interno do n8n', '<span class="mono">n8n_internal</span> (separado)'],
            ['Leitura', '<span class="mono">automation.v_clients</span>, <span class="mono">v_campaigns</span>, <span class="mono">v_accounts</span>'],
            ['Escrita', '<span class="mono">automation.*</span> apenas'],
            ['Negado', '<span class="mono">core</span>, <span class="mono">integrations</span>, <span class="mono">ads</span>, <span class="mono">agent</span>'],
            ['Teste de permissão', UI.pill('Passou em ' + F.dateFull(DB.meta.today), 'ok', true)]
          ])
        })
        + UI.card({
          title: 'Quota e kill switch',
          body: UI.kv([
            ['Prioridade das filas', 'ação aprovada > sync incremental > backfill'],
            ['Falha por quota', 'reagendamento, não erro'],
            ['Rejanela de ingestão', '28 dias'],
            ['Execução automática', UI.pill('Ativa', 'ok', true)]
          ]),
          foot: UI.btn('Congelar toda execução automática', { size: 'sm', variant: 'danger', icon: 'alert', action: 'toast:Kill switch acionado — execução congelada (mock)' })
        })
        + '</div></div>'
        + UI.table([{ key: 'w', label: 'Workflow' }, { key: 'c', label: 'Cliente' }, { key: 's', label: 'Início' }, { key: 'd', label: 'Duração', num: true }, { key: 'r', label: 'Registros', num: true }, { key: 'n', label: 'Observação' }, { key: 'st', label: 'Status' }],
          runs.map(function (r) {
            return {
              w: '<span class="mono">' + r.workflow + '</span>', c: '<span class="small muted">' + (r.clientId ? R.client(r.clientId).name : 'Todos') + '</span>',
              s: '<span class="small muted">' + F.dateTime(r.startedAt) + '</span>',
              d: '<span class="num">' + (r.durationMs ? F.duration(r.durationMs) : '—') + '</span>',
              r: '<span class="num">' + F.number(r.records) + '</span>', n: '<span class="small">' + r.note + '</span>',
              st: UI.statusPill(r.status === 'running' ? 'pending' : r.status)
            };
          }), { title: 'Histórico de execuções' })
    };
  };

  g.PAGES.audit = function () {
    const log = DB.automation.auditLog;
    return {
      nav: 'audit', title: 'Auditoria',
      content: '<div class="page__head"><div><div class="page__title">Trilha de auditoria</div>'
        + '<div class="page__sub">Quem fez, o que mudou, quando e por quê. Ações do agente aparecem com a chave de idempotência e a aprovação relacionada.</div></div>'
        + '<div class="page__actions">' + UI.btn('Exportar', { size: 'sm', icon: 'download', action: 'toast:Log exportado (mock)' }) + '</div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Eventos (30 dias)', value: String(log.length + DB.agent.actions.length) })
        + UI.stat({ label: 'Ações do agente', value: String(DB.agent.actions.length), foot: 'todas com chave de idempotência' })
        + UI.stat({ label: 'Mudanças de acesso', value: String(log.filter(function (l) { return l.action.indexOf('member') === 0; }).length), foot: 'members' })
        + UI.stat({ label: 'Falhas de integração', value: String(log.filter(function (l) { return l.action.indexOf('fail') > 0; }).length) })
        + '</div>'
        + UI.table([{ key: 'w', label: 'Quando' }, { key: 'a', label: 'Autor' }, { key: 'ac', label: 'Evento' }, { key: 't', label: 'Alvo' }, { key: 'd', label: 'Detalhe' }, { key: 'ip', label: 'Origem' }],
          log.map(function (l) {
            const name = l.actorType === 'agent' ? (R.agent(l.actorId) || {}).name : l.actorType === 'system' ? 'Sistema' : (R.user(l.actorId) || {}).name;
            return {
              w: '<span class="small muted nowrap">' + F.dateTime(l.at) + '</span>',
              a: '<span class="row" style="gap:8px">' + UI.avatar(name || 'S', { alt: l.actorType === 'agent' }) + '<span class="small">' + name + '</span></span>',
              ac: '<span class="mono">' + l.action + '</span>', t: '<span class="small">' + l.target + '</span>',
              d: '<span class="small muted">' + l.detail + '</span>', ip: '<span class="xsmall subtle">' + l.ip + '</span>'
            };
          }), { title: 'Eventos registrados' })
    };
  };

  g.PAGES.reports = function () {
    const sc = R.scope(g.Store.me().id);
    const t = R.totals({ clientIds: sc.clientIds, days: g.Store.get().period });
    return {
      nav: 'reports', title: 'Relatórios',
      content: '<div class="page__head"><div><div class="page__title">Relatórios</div><div class="page__sub">Por cliente, por iniciativa, por portfólio ou da agência inteira.</div></div></div>'
        + UI.card({
          className: 'card--accent', title: 'Montar relatório', sub: 'O mesmo motor de dados alimenta painel, relatório e agente',
          body: '<div class="grid grid--4">'
            + '<div class="field"><label class="field__label">Escopo</label>' + UI.select('noop', [{ value: 'org', label: 'Agência' }].concat(DB.core.portfolios.map(function (p) { return { value: p.id, label: 'Portfólio ' + p.name }; })).concat(DB.core.clients.map(function (c) { return { value: c.id, label: 'Cliente ' + c.name }; })), 'org') + '</div>'
            + '<div class="field"><label class="field__label">Período</label>' + UI.select('noop', ['Últimos 30 dias', 'Mês fechado', 'Trimestre', 'Personalizado'].map(function (o) { return { value: o, label: o }; }), 'Últimos 30 dias') + '</div>'
            + '<div class="field"><label class="field__label">Modelo</label>' + UI.select('noop', ['Performance por campanha', 'Resultado por campanha de marketing', 'Comparativo cross-account', 'Auditoria de contas', 'Ações do agente e resultados'].map(function (o) { return { value: o, label: o }; }), 'Performance por campanha') + '</div>'
            + '<div class="field"><label class="field__label">Formato</label>' + UI.select('noop', ['PDF', 'Link compartilhável', 'Planilha'].map(function (o) { return { value: o, label: o }; }), 'PDF') + '</div>'
            + '</div>',
          foot: UI.btn('Gerar agora', { size: 'sm', variant: 'primary', icon: 'doc', action: 'toast:Relatório gerado (mock)' }) + UI.btn('Agendar envio', { size: 'sm', action: 'toast:Envio agendado (mock)' })
        })
        + '<div class="grid grid--2a">'
        + UI.table([{ key: 'n', label: 'Relatório', width: '26%' }, { key: 's', label: 'Escopo' }, { key: 'sc', label: 'Agenda' }, { key: 'f', label: 'Formato' }, { key: 'r', label: 'Destinatários' }, { key: 'l', label: 'Última' }, { key: 'a', label: '' }],
          DB.automation.reports.map(function (r) {
            return {
              n: '<span class="strong">' + r.name + '</span>', s: UI.pill(r.scope, 'neutral'), sc: '<span class="small">' + r.schedule + '</span>',
              f: '<span class="small muted">' + r.format + '</span>', r: '<span class="small muted">' + r.recipients + '</span>',
              l: '<span class="small muted">' + F.relative(r.lastRun) + '</span>',
              a: UI.btn('Baixar', { size: 'sm', icon: 'download', action: 'toast:PDF gerado (mock)' })
            };
          }), { title: 'Relatórios recorrentes', actions: UI.btn('Novo', { size: 'sm', variant: 'primary', icon: 'plus', action: 'noop' }) })
        + UI.card({
          title: 'Prévia — consolidado', sub: 'Últimos ' + g.Store.get().period + ' dias',
          body: UI.dlInline([['Investimento', F.money(t.spend)], ['Receita conf.', F.money(t.revenueConfirmed)], ['Leads', F.number(t.leads)], ['ROAS conf.', F.ratio(t.roasConfirmed)]])
            + '<div class="divider"></div>'
            + '<span class="small muted">O relatório do cliente mostra apenas o ambiente dele. Custo interno, fee e comparação com outros clientes nunca aparecem na versão enviada.</span>'
        })
        + '</div>'
    };
  };

  g.PAGES.settings = function (route) {
    const tab = route.tab || 'organizacao';
    const tabsEl = UI.tabs([
      { key: 'organizacao', label: 'Organização' },
      { key: 'membros', label: 'Membros e acessos', count: DB.core.members.length },
      { key: 'papeis', label: 'Papéis e permissões' },
      { key: 'agente', label: 'Agente e limites' },
      { key: 'integracoes', label: 'Integrações', count: DB.integrations.catalog.filter(function (i) { return i.status === 'active'; }).length },
      { key: 'infra', label: 'Infraestrutura' }
    ], tab, 'tab:settings/_');
    const body = { organizacao: tOrg, membros: tMembers, papeis: tRoles, agente: tAgent, integracoes: tInteg, infra: tInfra }[tab]();
    return {
      nav: 'settings', title: 'Configurações',
      content: '<div class="page__head"><div><div class="page__title">Configurações</div><div class="page__sub">Acesso, papéis, limites do agente, integrações e infraestrutura.</div></div></div>' + tabsEl + body
    };
  };

  function tOrg() {
    const sc = R.scope(g.Store.me().id);
    const o = sc.organization;
    const isAgency = o.type === 'agency';
    const grants = R.connectionsOf(o.id);
    const approvals = R.approvalsFor(o.id);
    return '<div class="col">'
      + UI.card({
        className: 'card--accent',
        title: o.name, sub: isAgency ? 'Agência — opera carteira de clientes' : 'Anunciante direto — opera a própria conta',
        actions: UI.pill(isAgency ? 'agency' : 'advertiser', 'info'),
        body: UI.kv([
          ['Conta administradora (MCC)', o.managerAccountId ? '<span class="mono">' + o.managerAccountId + '</span>' + (isAgency ? '' : ' <span class="xsmall subtle">criado no onboarding só para abrigar o token</span>') : '—'],
          ['Business Manager', o.businessManagerId ? '<span class="mono">' + o.businessManagerId + '</span>' : '—'],
          ['Developer token', '<span class="mono">' + o.developerTokenRef + '</span>'],
          ['Dono do token', UI.pill(o.developerTokenOwner === 'organization' ? 'Da organização' : 'Da plataforma', o.developerTokenOwner === 'organization' ? 'ok' : 'danger', true)],
          ['Nível do token', UI.pill(o.developerTokenLevel === 'standard' ? 'Standard' : 'Basic', o.developerTokenLevel === 'standard' ? 'ok' : 'info')],
          ['Assentos', String(o.seats)],
          ['Desde', F.dateFull(o.createdAt)]
        ])
          + '<div class="row small" style="background:var(--accent-soft);padding:10px;border-radius:var(--radius-sm);gap:8px;align-items:flex-start">' + ICON('shield', 15)
          + '<span><b>Toda chamada ao Google Ads sai com o developer token desta organização.</b> A tria nunca usa credencial própria para falar com a conta de um cliente — quota, responsabilidade perante o Google e risco de suspensão ficam onde nascem.</span></div>'
      })
      + '<div class="grid grid--2">'
      + UI.card({
        title: 'O que é de quem',
        tight: true,
        body: UI.table([{ key: 'a', label: 'A tria tem' }, { key: 'b', label: 'A organização tem' }], [
          { a: '<span class="small">App OAuth verificado (Google)</span>', b: '<span class="small strong">Developer token próprio</span>' },
          { a: '<span class="small">App com App Review e Business Verification (Meta)</span>', b: '<span class="small strong">MCC e Business Manager próprios</span>' },
          { a: '<span class="small">Secret Manager que guarda o segredo de cada organização</span>', b: '<span class="small strong">Os grants e as contas descobertas</span>' }
        ], { bare: true })
      })
      + UI.card({
        title: 'Pré-requisitos de acesso', sub: 'O que depende de aprovação externa',
        tight: true,
        body: UI.table([{ key: 'i', label: 'Item' }, { key: 'w', label: 'De quem' }, { key: 'n', label: 'Observação' }, { key: 's', label: 'Status' }],
          approvals.map(function (a) {
            const tone = a.status === 'approved' ? 'ok' : a.status === 'pending' ? 'warn' : 'neutral';
            const label = a.status === 'approved' ? 'Aprovado' : a.status === 'pending' ? 'Em análise' : 'Não se aplica';
            return {
              i: '<span class="small strong">' + a.item + '</span>',
              w: UI.pill(a.scope === 'tria' ? 'tria' : o.name, a.scope === 'tria' ? 'neutral' : 'info'),
              n: '<span class="small muted">' + a.note + '</span>', s: UI.pill(label, tone, true)
            };
          }), { bare: true })
      })
      + '</div>'
      + UI.table([
        { key: 'n', label: 'Conexão', width: '22%' }, { key: 'p', label: 'Plataforma' }, { key: 'g', label: 'Caminho' },
        { key: 'o', label: 'Credencial de' }, { key: 'd', label: 'Contas', num: true }, { key: 'e', label: 'Expira em', num: true },
        { key: 'r', label: 'Segredo' }, { key: 's', label: 'Estado' }
      ], grants.map(function (cn) {
        const tone = { active: 'ok', expiring: 'warn', degraded: 'warn', revoked: 'danger', reauth_pending: 'warn' }[cn.status];
        const label = { active: 'Ativa', expiring: 'Expirando', degraded: 'Degradada', revoked: 'Revogada', reauth_pending: 'Reautorização' }[cn.status];
        const grantLabel = { mcc: 'MCC da organização', bm_partner: 'Parceria entre BMs', system_user: 'Usuário do sistema', oauth_user: 'OAuth direto' }[cn.grantType];
        return {
          n: '<span class="col" style="gap:0"><span class="strong">' + cn.name + '</span><span class="xsmall subtle mono">' + cn.externalId + '</span></span>',
          p: UI.platform(cn.platform), g: UI.pill(grantLabel, 'neutral'),
          o: UI.pill(cn.owner === 'organization' ? 'Da organização' : 'Da plataforma', cn.owner === 'organization' ? 'ok' : 'danger'),
          d: '<span class="num">' + cn.linked + ' de ' + cn.discovered + '</span>',
          e: '<span class="num ' + (cn.expiresInDays < 60 ? 'delta delta--down' : '') + '">' + (cn.expiresInDays ? cn.expiresInDays + ' dias' : '—') + '</span>',
          r: '<span class="mono">' + cn.secretRef + '</span>',
          s: UI.pill(label, tone, true)
        };
      }), { title: 'Autorizações da organização', sub: 'Um grant rende N contas — a descoberta roda periodicamente e sugere o que apareceu no MCC' })
      + '</div>';
  }

  function tMembers() {
    const byUser = {};
    DB.core.members.forEach(function (m) { (byUser[m.userId] = byUser[m.userId] || []).push(m); });
    const cards = Object.keys(byUser).map(function (uid) {
      const u = R.user(uid), rows = byUser[uid], sc = R.scope(uid);
      return UI.card({
        title: '<span class="row" style="gap:10px">' + UI.avatar(u.name) + '<span class="col" style="gap:0"><span class="strong">' + u.name + '</span><span class="xsmall subtle">' + u.email + '</span></span></span>',
        actions: UI.pill(R.roleLabel(sc.role), 'neutral') + UI.pill(sc.org ? 'Toda a agência' : sc.clientIds.length + ' clientes · ' + sc.accountIds.length + ' contas', 'info'),
        tight: true,
        body: UI.table([{ key: 's', label: 'Escopo (linha em members)' }, { key: 'r', label: 'Papel' }, { key: 'rc', label: 'Alcança' }, { key: 'g', label: 'Concedido por' }, { key: 'e', label: 'Expira' }, { key: 'st', label: 'Status' }],
          rows.map(function (m) {
            const expired = m.expiresAt && new Date(m.expiresAt) < new Date(DB.meta.now);
            return {
              s: '<span class="mono">' + m.scopeType + (m.scopeId ? ':' + m.scopeId : '') + '</span>',
              r: UI.pill(R.roleLabel(m.role), m.role === 'partner' ? 'warn' : 'neutral'),
              rc: '<span class="small muted">' + reach(m) + '</span>',
              g: '<span class="small muted">' + ((R.user(m.grantedBy) || {}).name || '—') + '</span>',
              e: m.expiresAt ? '<span class="small ' + (expired ? 'delta delta--down' : 'muted') + '">' + F.dateFull(m.expiresAt) + '</span>' : '<span class="xsmall subtle">sem prazo</span>',
              st: UI.statusPill(m.status)
            };
          }), { bare: true }),
        foot: UI.btn('Conceder novo escopo', { size: 'sm', icon: 'plus', action: 'toast:Concessão criada (mock)' }) + UI.btn('Suspender membro', { size: 'sm', variant: 'danger', action: 'toast:Todas as linhas suspensas (mock)' })
      });
    }).join('');

    return '<div class="col">'
      + UI.card({
        className: 'card--accent',
        title: 'Como o acesso funciona', sub: 'users 1 ──< members >── N  ad_accounts / clients / portfolios / organization',
        body: '<span class="small muted">Um usuário gerencia N contas e uma conta é gerenciada por N usuários. Quem sustenta essa relação é a tabela <span class="mono">members</span> — cada linha é uma concessão <i>pessoa × recurso × papel</i>. O acesso desce na hierarquia: uma linha em <span class="mono">portfolio</span> alcança os clientes daquela carteira e as contas desses clientes. Havendo mais de um caminho, vence o escopo mais específico.</span>'
          + '<div class="row row--wrap">' + ['organization', 'portfolio', 'client', 'ad_account'].map(function (s) {
            return '<span class="pill pill--outline">' + s + ' · ' + DB.core.members.filter(function (m) { return m.scopeType === s; }).length + ' linhas</span>';
          }).join('') + '</div>'
      })
      + cards + '</div>';
  }

  function reach(m) {
    if (m.scopeType === 'organization') return 'Todos os clientes e contas';
    if (m.scopeType === 'portfolio') {
      const cl = DB.core.clients.filter(function (c) { return c.portfolioId === m.scopeId; });
      return (R.portfolio(m.scopeId) || {}).name + ' — ' + cl.length + ' clientes, ' + DB.integrations.adAccounts.filter(function (a) { return cl.some(function (c) { return c.id === a.clientId; }); }).length + ' contas';
    }
    if (m.scopeType === 'client') return (R.client(m.scopeId) || {}).name + ' — ' + R.accountsOf(m.scopeId).length + ' contas';
    return (R.account(m.scopeId) || {}).name || m.scopeId;
  }

  function tRoles() {
    const cols = [{ key: 'action', label: 'Ação', width: '26%' }].concat(DB.core.roles.map(function (r) { return { key: r.id, label: r.label }; }));
    const rows = DB.core.permissionMatrix.map(function (p) {
      const row = { action: '<span class="small strong">' + p.action + '</span>' };
      DB.core.roles.forEach(function (r) {
        const v = p[r.id];
        row[r.id] = v === 'sim' ? UI.pill('Sim', 'ok', true) : v === 'escopo' ? UI.pill('No escopo', 'info') : UI.pill('Não', 'neutral');
      });
      return row;
    });
    return '<div class="grid grid--3">' + DB.core.roles.map(function (r) {
      return UI.card({ title: r.label, sub: DB.core.members.filter(function (m) { return m.role === r.id; }).length + ' concessões', body: '<span class="small muted">' + r.desc + '</span>' });
    }).join('') + '</div>' + UI.table(cols, rows, { title: 'Matriz de permissões', sub: '“No escopo” = vale apenas nos recursos alcançados pelas linhas de members' });
  }

  function tAgent() {
    const q = DB.agent.quality;
    return '<div class="grid grid--2a">'
      + UI.table([{ key: 'c', label: 'Cliente' }, { key: 'l', label: 'Nível' }, { key: 'r', label: 'Regras ativas', num: true }, { key: 'li', label: 'Teto diário', num: true }, { key: 'a', label: '' }],
        DB.core.clients.map(function (c) {
          return {
            c: UI.clientCell(c), l: UI.autonomyPill(c.autonomyLevel),
            r: '<span class="num">' + R.rulesOf(c.id).filter(function (x) { return x.active; }).length + '</span>',
            li: '<span class="num">' + F.money(Math.round(c.monthlyBudget / 30 * 1.2)) + '</span>',
            a: UI.btn('Alterar', { size: 'sm', action: 'go:agent/' + c.id + '/configuracoes' })
          };
        }), { title: 'Autonomia por cliente' })
      + '<div class="col">'
      + UI.card({
        title: 'Modelo de IA',
        body: UI.kv([
          ['Provedor', UI.select('noop', [{ value: 'cfg', label: 'Configurável por ambiente' }, { value: 'c', label: 'Claude' }, { value: 'l', label: 'Modelo local' }], 'cfg')],
          ['Saída estruturada', UI.pill('Obrigatória (JSON)', 'ok', true)],
          ['SQL livre', UI.pill('Bloqueado', 'danger', true)],
          ['Chamada direta às APIs de anúncio', UI.pill('Bloqueada', 'danger', true)],
          ['Teto de consumo mensal', 'R$ 1.200 por organização'],
          ['Custo por recomendação aceita', F.moneyCents(q.costPerAccepted)]
        ])
      })
      + UI.card({
        title: 'Regras globais de segurança',
        body: '<div class="col small muted">' + [
          'Poucos dados: solicitar informação ou sinalizar baixa confiança.',
          'Métrica inconsistente ou desvio > 20%: não executar otimização.',
          'Campanha recém-criada: aguardar janela de aprendizado.',
          'Alteração de alto impacto: exigir aprovação sempre.',
          'Ação executada: verificar na plataforma antes de dar por concluída.',
          'Resultado negativo: registrar aprendizado e avaliar reversão.'
        ].map(function (t) { return '<div class="row" style="gap:8px;align-items:flex-start">' + ICON('shield', 14) + '<span>' + t + '</span></div>'; }).join('') + '</div>',
        foot: UI.btn('Kill switch global', { size: 'sm', variant: 'danger', icon: 'alert', action: 'toast:Execução automática congelada em toda a agência (mock)' })
      })
      + '</div></div>';
  }

  function tInteg() {
    return '<div class="col">'
      + UI.table([{ key: 'n', label: 'Integração', width: '20%' }, { key: 'k', label: 'Tipo' }, { key: 'a', label: 'Contas', num: true }, { key: 'o', label: 'Observação' }, { key: 's', label: 'Status' }, { key: 'ac', label: '' }],
        DB.integrations.catalog.map(function (i) {
          const tone = i.status === 'active' ? 'ok' : i.status === 'pending' ? 'warn' : 'neutral';
          const label = i.status === 'active' ? 'Ativa' : i.status === 'pending' ? 'Prevista' : 'Planejada';
          return {
            n: '<span class="strong">' + i.name + '</span>', k: UI.pill(i.kind, 'neutral'),
            a: '<span class="num">' + (i.accounts || '—') + '</span>', o: '<span class="small muted">' + i.note + '</span>',
            s: UI.pill(label, tone, true),
            ac: i.status === 'active' ? UI.btn('Gerenciar', { size: 'sm', action: 'go:accounts' }) : UI.btn('Conectar', { size: 'sm', variant: 'primary', action: 'toast:Fluxo OAuth iniciado (mock)' })
          };
        }), { title: 'Integrações', sub: 'Ordem do roadmap: Meta, Google Ads, GA4, CRM, GTM e Merchant Center' })
      + UI.card({
        className: 'card--accent', title: 'Credenciais separadas',
        body: '<span class="small muted">A autorização do usuário para entrar na plataforma e a autorização para acessar contas de publicidade são credenciais diferentes.</span>'
          + UI.kv([
            ['Login da plataforma', 'Google OAuth (Auth.js) — identidade do usuário'],
            ['Permissão humana', 'Tabela <span class="mono">members</span> — quem pode mexer no quê'],
            ['Acesso às contas', 'Tokens por conta ou por estrutura, no schema <span class="mono">integrations</span>'],
            ['Revogação', 'Independente em cada camada']
          ])
      })
      + '</div>';
  }

  function tInfra() {
    return UI.card({
      title: 'Arquitetura funcional', sub: 'Seis módulos, um só conjunto de dados, contas, permissões e execução',
      body: '<div class="grid grid--3">' + DB.automation.modules.map(function (m) {
        return '<div class="card card--flat" style="cursor:pointer" data-action="go:' + m.route + '"><div class="card__body">'
          + '<div class="row"><span class="mono subtle">' + m.n + '</span><span class="strong">' + m.name + '</span></div>'
          + '<span class="small muted">' + m.desc + '</span></div></div>';
      }).join('') + '</div>'
    })
      + '<div class="grid grid--2">'
      + UI.card({
        title: 'Camadas',
        body: UI.kv([
          ['Frontend', 'Next.js — painel, multi-conta, agente, relatórios e aprovações'],
          ['Backend / API', 'TypeScript — autenticação, members, regras e integrações'],
          ['Agent Service', 'Contexto, pesquisa, raciocínio, estratégia, análise e propostas'],
          ['Data &amp; Integration', 'Meta, Google, métricas, reconciliação e normalização'],
          ['Execução', 'n8n — filas, sincronizações e ações autorizadas'],
          ['Banco', 'PostgreSQL próprio com Row Level Security'],
          ['Hospedagem', 'Google Cloud VM · Docker Compose']
        ])
      })
      + UI.card({
        title: 'Backup e observabilidade',
        body: UI.kv([
          ['Último backup', F.dateTime(DB.automation.runs[9].startedAt) + ' · 612 MB'],
          ['Retenção', '30 dias no bucket'],
          ['Teste de restauração', UI.pill('Pendente', 'warn')],
          ['Isolamento', UI.pill('RLS por organization_id e client_id', 'ok', true)],
          ['Rejanela de métrica', '28 dias'],
          ['Custo do mês', 'R$ 148 (free tier + excedente)']
        ])
      })
      + '</div>'
      + UI.table([{ key: 's', label: 'Schema' }, { key: 't', label: 'Tabelas principais' }, { key: 'w', label: 'Quem acessa' }], [
        { s: '<span class="mono strong">core</span>', t: '<span class="small muted">organizations, users, <b>members</b>, roles, role_permissions, invitations, clients, portfolios, portfolio_clients, access_audit</span>', w: '<span class="small">Backend / API</span>' },
        { s: '<span class="mono strong">integrations</span>', t: '<span class="small muted">connections, ad_accounts, ad_account_access, account_groups, tokens, sync_logs</span>', w: '<span class="small">Data &amp; Integration</span>' },
        { s: '<span class="mono strong">ads</span>', t: '<span class="small muted"><b>marketing_campaigns</b>, campaigns, ad_sets, ads, budgets, account_snapshots, bulk_operations, account_audits</span>', w: '<span class="small">Backend / API</span>' },
        { s: '<span class="mono strong">metrics</span>', t: '<span class="small muted">metrics_daily, conversions, reconciliation, baselines, restatements, attribution_windows</span>', w: '<span class="small">Data &amp; Integration</span>' },
        { s: '<span class="mono strong">agent</span>', t: '<span class="small muted">client_context, market_research, strategies, media_plans, recommendations, action_proposals, approvals, agent_actions, optimization_rules, agent_conversations, agent_memory, agent_evaluations, <b>pipeline_stages</b>, <b>pipeline_events</b></span>', w: '<span class="small">Agent Service</span>' },
        { s: '<span class="mono strong">automation</span>', t: '<span class="small muted">v_clients, v_campaigns, v_accounts, sync_results, run_logs, queues, alerts</span>', w: '<span class="small">n8n_worker</span>' }
      ], { title: 'Schemas do banco' });
  }
})(window);
