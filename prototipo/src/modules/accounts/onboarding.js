(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  const STEPS = ['Dados', 'Portfólio e modelo', 'Conexões', 'Contas', 'Contexto', 'Agente'];

  g.PAGES.onboarding = function (route) {
    const me = g.Store.me(), sc = R.scope(me.id);
    if (!R.can(me.id, 'Cadastrar cliente')) {
      return { nav: 'clients', title: 'Novo cliente', content: UI.empty('Sem permissão para cadastrar cliente', 'A matriz de permissões reserva esta ação a proprietário e administrador.') };
    }
    const c = route.id ? R.client(route.id) : null;
    if (route.id && (!c || sc.clientIds.indexOf(route.id) < 0)) {
      return { nav: 'clients', title: 'Onboarding', content: UI.empty('Sem acesso a este cliente', 'Nenhuma linha de members alcança este recurso.') };
    }
    const step = g.Store.get().onboardingStep;
    const body = [stDados, stModelo, stConexoes, stContas, stContexto, stAgente][step](c);
    return {
      nav: 'clients',
      title: c ? 'Onboarding · ' + c.name : 'Novo cliente',
      crumbs: [{ label: 'Clientes', route: 'clients' }, { label: c ? c.name : 'Cadastro' }],
      content: '<div class="page__head"><div><div class="page__title">' + (c ? 'Onboarding — ' + c.name : 'Cadastro de cliente') + '</div>'
        + '<div class="page__sub">Seis passos, salváveis e retomáveis. O cliente só sai de onboarding quando houver ao menos uma conta conectada e validada.</div></div></div>'
        + UI.steps(STEPS, step, 'step')
        + UI.card({ body: body })
        + '<div class="row">' + UI.btn('Voltar', { action: 'step:' + Math.max(0, step - 1), disabled: step === 0 })
        + '<span class="spacer"></span><span class="small subtle">Passo ' + (step + 1) + ' de ' + STEPS.length + '</span><span class="spacer"></span>'
        + (step === STEPS.length - 1 ? UI.btn('Concluir cadastro', { variant: 'primary', icon: 'check', action: 'finish-onboarding' }) : UI.btn('Salvar e continuar', { variant: 'primary', action: 'step:' + (step + 1) }))
        + '</div>'
    };
  };

  function field(label, value, hint, type) {
    return '<div class="field"><label class="field__label">' + label + '</label>'
      + (type === 'textarea' ? '<textarea class="textarea">' + (value || '') + '</textarea>' : '<input class="input" value="' + (value === undefined || value === null ? '' : value) + '">')
      + (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '</div>';
  }

  function stDados(c) {
    return '<div class="grid grid--3">'
      + field('Nome do cliente', c ? c.name : '', 'Usado no painel e nos relatórios')
      + field('Segmento', c ? c.segment : '', 'Ex.: clínica odontológica')
      + field('Site', c ? c.site : '')
      + field('Regiões atendidas', c ? c.regions.join(', ') : '', 'Separe por vírgula')
      + '<div class="field"><label class="field__label">Gestor responsável</label>'
      + UI.select('noop', DB.core.users.filter(function (u) { return R.rank(R.scope(u.id).role) >= 3; }).map(function (u) { return { value: u.id, label: u.name }; }), c ? c.ownerUserId : 'u_rafael') + '</div>'
      + field('Verba mensal (R$)', c ? c.monthlyBudget : '', 'Base para o planejamento do agente')
      + '</div>';
  }

  function stModelo(c) {
    const model = c ? c.model : 'leads';
    return '<div class="col">'
      + '<div class="field" style="max-width:420px"><label class="field__label">Portfólio</label>'
      + UI.select('noop', DB.core.portfolios.map(function (p) { return { value: p.id, label: p.name }; }).concat([{ value: 'new', label: '+ Criar novo portfólio' }]), c ? c.portfolioId : 'pf_1') + '</div>'
      + UI.sectionTitle('Modelo de negócio', 'Define os indicadores do painel e como o agente avalia o resultado')
      + '<div class="grid grid--2">'
      + modelCard('Geração de Leads', 'CPL, volume, taxa de conversão, qualidade do lead e custo por lead qualificado.', model === 'leads')
      + modelCard('E-commerce', 'ROAS confirmado, receita, CPA, ticket médio e compras.', model === 'ecommerce')
      + '</div>'
      + '<div class="grid grid--3">'
      + field('Ticket médio (R$)', c ? c.ticket : '')
      + field('Meta principal', c ? (model === 'leads' ? 'CPL ≤ R$ ' + c.goalCpl : 'ROAS ≥ ' + c.goalRoas) : '')
      + field('Margem (opcional)', c ? (c.model === 'ecommerce' ? '38%' : '') : '', 'Permite ao agente recomendar escala com segurança')
      + '</div></div>';
  }

  function modelCard(title, desc, active) {
    return '<div class="card ' + (active ? 'card--accent' : '') + '" style="cursor:pointer"><div class="card__body">'
      + '<div class="row"><span class="strong">' + title + '</span><span class="spacer"></span>' + (active ? UI.pill('Selecionado', 'ok', true) : UI.pill('Selecionar', 'neutral')) + '</div>'
      + '<span class="small muted">' + desc + '</span></div></div>';
  }

  function stConexoes(c) {
    const sc = R.scope(g.Store.me().id);
    const o = sc.organization;
    return '<div class="col">'
      + UI.card({
        className: 'card--accent',
        title: 'Credencial desta organização', sub: 'Toda chamada sai com o developer token da organização — nunca com um da tria',
        body: UI.kv([
          ['Conta administradora (MCC)', o.managerAccountId ? '<span class="mono">' + o.managerAccountId + '</span>' : UI.pill('Criar no cadastro', 'warn')],
          ['Developer token', UI.pill(o.developerTokenLevel === 'standard' ? 'Standard' : 'Basic', 'ok', true) + ' <span class="mono">' + o.developerTokenRef + '</span>'],
          ['Business Manager', o.businessManagerId ? '<span class="mono">' + o.businessManagerId + '</span>' : '—']
        ]) + (o.type === 'advertiser' ? '<span class="xsmall subtle">O MCC aqui não serve para gerenciar terceiros: é só onde o Google emite o token. Criar é gratuito e leva minutos, e o login continua sendo a conta Google normal.</span>' : '')
      })
      + UI.sectionTitle('Como as contas deste cliente chegam até a plataforma?')
      + '<div class="grid grid--3">'
      + '<div class="card card--accent" style="cursor:pointer"><div class="card__body"><div class="row"><span class="strong">MCC da organização</span><span class="spacer"></span>' + UI.pill('Selecionado', 'ok', true) + '</div>'
      + '<span class="small muted">A conta já está sob a administradora — a descoberta lista tudo, inclusive por acesso herdado.</span></div></div>'
      + '<div class="card" style="cursor:pointer"><div class="card__body"><div class="row"><span class="strong">Convite de acesso</span><span class="spacer"></span>' + UI.pill('Selecionar', 'neutral') + '</div>'
      + '<span class="small muted">A administradora convida a conta do cliente. Aceito o convite, ela aparece sem nova autorização.</span></div></div>'
      + '<div class="card" style="cursor:pointer"><div class="card__body"><div class="row"><span class="strong">OAuth direto</span><span class="spacer"></span>' + UI.pill('Selecionar', 'neutral') + '</div>'
      + '<span class="small muted">O cliente não quer mover a conta para o MCC. Ele autoriza por link; a chamada continua com o token da organização.</span></div></div>'
      + '</div>'
      + '<div class="col">' + R.connectionsOf(sc.organizationId).map(function (cn) {
        return '<div class="row card" style="padding:var(--sp-3);align-items:center;gap:var(--sp-3)">' + UI.platform(cn.platform)
          + '<span class="small">' + cn.name + ' <span class="mono">' + cn.externalId + '</span></span>'
          + '<span class="xsmall subtle">' + cn.discovered + ' contas descobertas · ' + cn.linked + ' ligadas</span>'
          + '<span class="spacer"></span>' + UI.statusPill(cn.status) + UI.btn('Trocar', { size: 'sm', action: 'noop' }) + '</div>';
      }).join('') + '</div>'
      + UI.card({
        className: 'card--flat',
        title: 'Escopos pedidos', sub: 'O mínimo necessário para operar de verdade — e nada além disso',
        tight: true,
        body: UI.table([{ key: 'p', label: 'Plataforma' }, { key: 's', label: 'Escopo' }, { key: 'w', label: 'Para quê' }], [
          { p: UI.platform('google'), s: '<span class="mono">adwords</span>', w: '<span class="small muted">Ler métricas e gerenciar campanhas, orçamentos, públicos e palavras-chave</span>' },
          { p: UI.platform('google'), s: '<span class="mono">datamanager</span>', w: '<span class="small muted">Público semelhante e conversão offline</span>' },
          { p: UI.platform('meta'), s: '<span class="mono">ads_read</span>', w: '<span class="small muted">Ler campanhas, conjuntos, anúncios e insights</span>' },
          { p: UI.platform('meta'), s: '<span class="mono">ads_management</span>', w: '<span class="small muted">Criar e alterar campanhas, orçamentos e criativos</span>' },
          { p: UI.platform('meta'), s: '<span class="mono">business_management</span>', w: '<span class="small muted">Enxergar os ativos do Business Manager</span>' },
          { p: UI.platform('meta'), s: '<span class="mono">leads_retrieval</span>', w: '<span class="small muted">Puxar os leads dos formulários — sem isso o closed-loop não fecha</span>' }
        ], { bare: true }),
        foot: 'Nunca são pedidos escopos de faturamento. O segredo vai para o Secret Manager; no banco fica só a referência e os metadados.'
      })
      + '</div>';
  }

  function stContas(c) {
    const accs = c ? R.accountsOf(c.id) : [];
    const extra = [{ name: 'Google — Flora Atacado (inativa)', id: '773-110-2288', off: true }];
    return '<div class="col">'
      + UI.sectionTitle('Seleção de contas', (accs.length || 3) + ' de ' + DB.integrations.connections.reduce(function (a, cn) { return a + cn.discovered; }, 0) + ' contas acessíveis selecionadas')
      + '<span class="search" style="max-width:360px">' + ICON('search', 15) + '<input class="input" placeholder="Filtrar contas"></span>'
      + '<div class="col">' + accs.map(function (a) {
        return '<div class="row card" style="padding:var(--sp-3);gap:var(--sp-3);align-items:center">' + UI.checkbox(true, 'noop')
          + '<div class="col" style="gap:0;flex:1"><span class="small strong">' + a.name + '</span>'
          + '<span class="xsmall subtle mono">' + a.externalId + ' · ' + a.currency + ' · ' + a.timezone + '</span></div>'
          + '<div class="field" style="width:150px"><span class="xsmall subtle">Grupo</span>' + UI.select('noop', ['Principal', 'Outlet', 'Marca', 'Shopping', 'Assinatura', 'Regional'].map(function (o) { return { value: o, label: o }; }), a.group) + '</div>'
          + UI.pill(a.status === 'connected' ? 'permissões ok' : 'verificar', a.status === 'connected' ? 'ok' : 'warn', true) + '</div>';
      }).join('')
      + extra.map(function (e) {
        return '<div class="row card" style="padding:var(--sp-3);gap:var(--sp-3);align-items:center;opacity:.7">' + UI.checkbox(false, 'noop')
          + '<div class="col" style="gap:0;flex:1"><span class="small strong">' + e.name + '</span><span class="xsmall subtle mono">' + e.id + '</span></div>'
          + UI.pill('sem gasto nos últimos 90 dias', 'neutral') + '</div>';
      }).join('') + '</div>'
      + UI.card({
        className: 'card--flat',
        body: '<span class="small strong">Validação automática</span>'
          + '<div class="row row--wrap small muted" style="gap:var(--sp-3)">' + ['existência da conta', 'moeda', 'fuso horário', 'leitura de insights', 'permissão de gestão', 'validade longa do token'].map(function (t) {
            return '<span class="row" style="gap:5px">' + ICON('check', 13) + t + '</span>';
          }).join('') + '</div>'
          + '<div class="col" style="gap:4px"><span class="small">Importando 90 dias de histórico</span>' + UI.progress(78) + '<span class="xsmall subtle">78% · a rejanela de 28 dias passa a rodar diariamente depois da carga inicial</span></div>'
      })
      + '</div>';
  }

  function stContexto(c) {
    const ctx = c ? DB.agent.context[c.id] : {};
    return '<div class="col">'
      + UI.sectionTitle('Contexto do negócio', 'Alimenta o agente. Campo vazio reduz a confiança das recomendações.')
      + '<div class="grid grid--2">'
      + field('Público-alvo', ctx.publico, null, 'textarea')
      + field('Diferenciais competitivos', ctx.diferenciais, null, 'textarea')
      + field('Jornada de compra', ctx.jornada, null, 'textarea')
      + field('Objetivos comerciais', ctx.objetivos, null, 'textarea')
      + field('Restrições de comunicação', ctx.restricoes, 'Promessas proibidas, limites legais, tom de voz', 'textarea')
      + field('Sazonalidade', ctx.sazonalidade, null, 'textarea')
      + '</div>'
      + (c ? '<div class="row small muted">' + ICON('alert', 15) + 'Contexto ' + ctx.completeness + '% completo. ' + (ctx.completeness < 60 ? 'Abaixo de 60% o agente opera com baixa confiança e o Kanban bloqueia o avanço das iniciativas.' : 'Nível suficiente para o agente planejar.') + '</div>' : '')
      + UI.btn('Pedir uma primeira pesquisa de mercado ao agente', { size: 'sm', icon: 'sparkles', action: 'toast:Pesquisa enfileirada (mock)' })
      + '</div>';
  }

  function stAgente(c) {
    const level = c ? c.autonomyLevel : 1;
    return '<div class="col">'
      + UI.sectionTitle('Agente e autonomia', 'Comece no consultivo. Os níveis seguintes abrem por histórico medido de acerto.')
      + '<div class="grid grid--3">' + DB.agent.autonomyLevels.map(function (l) {
        const active = l.level === level;
        return '<div class="card ' + (active ? 'card--accent' : '') + '" style="cursor:pointer"><div class="card__body">'
          + '<div class="row"><span class="strong">Nível ' + l.level + ' — ' + l.label + '</span><span class="spacer"></span>' + (active ? UI.pill('Ativo', 'ok', true) : '') + '</div>'
          + '<span class="small muted">' + l.desc + '</span></div></div>';
      }).join('') + '</div>'
      + UI.card({
        title: 'Limites operacionais', sub: 'Valem mesmo no nível autônomo',
        body: '<div class="grid grid--3">'
          + field('Investimento diário máximo (R$)', c ? Math.round(c.monthlyBudget / 30 * 1.2) : 1800)
          + field('Aumento máximo por alteração', '10%')
          + field('Alterações por dia', '3')
          + field('Janela permitida', 'Seg a Sex, 06h às 20h')
          + field('Campanhas elegíveis', 'Todas exceto marca')
          + field('Ações proibidas', 'Excluir campanha, alterar conversões')
          + '</div>'
      })
      + UI.card({
        title: 'Agentes habilitados neste cliente', tight: true,
        body: UI.table([{ key: 'a', label: 'Agente' }, { key: 'r', label: 'Responsabilidade' }, { key: 'on', label: '' }],
          DB.agent.roster.map(function (a) {
            const on = !(a.id === 'ag_campaign' && level === 1);
            return {
              a: '<span class="row" style="gap:8px">' + UI.avatar(a.name, { text: a.short, alt: true }) + '<span class="small strong">' + a.name + '</span></span>',
              r: '<span class="small muted">' + a.role + '</span>', on: UI.switchEl(on, 'noop')
            };
          }), { bare: true })
      })
      + '</div>';
  }
})(window);
