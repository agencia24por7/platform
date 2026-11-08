(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.accounts = function (route) {
    if (route.id === 'bulk') return bulk();
    if (route.id) return detail(route.id, route.tab);
    return list();
  };

  function list() {
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    let rows = R.accountRows(st.period, sc.accountIds);
    if (st.filters.client !== 'all') rows = rows.filter(function (a) { return a.clientId === st.filters.client; });
    if (st.filters.platform !== 'all') rows = rows.filter(function (a) { return a.platform === st.filters.platform; });
    const broken = rows.filter(function (a) { return a.status !== 'connected'; });
    const avg = Math.round(rows.reduce(function (a, r) { return a + r.audit.score; }, 0) / (rows.length || 1));

    return {
      nav: 'accounts', title: 'Contas de anúncios', right: g.Shell.periodPicker(st.period),
      content: '<div class="page__head"><div><div class="page__title">Contas de anúncios</div>'
        + '<div class="page__sub">Conta é entidade própria, independente do cliente: um cliente pode ter várias, e uma conta pode chegar por acesso direto ou herdado de uma estrutura administradora.</div></div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Contas no seu escopo', value: String(rows.length), foot: DB.integrations.connections.length + ' estruturas administradoras' })
        + UI.stat({ label: 'Com problema', value: String(broken.length), foot: broken.length ? 'exigem reautorização' : 'tudo sincronizado' })
        + UI.stat({ label: 'Nota média de auditoria', value: String(avg), foot: 'de 0 a 100' })
        + UI.stat({ label: 'Investido no período', value: F.money(rows.reduce(function (a, r) { return a + r.metrics.spend; }, 0)) })
        + '</div>'
        + '<div class="row row--wrap">'
        + UI.select('filter:client', [{ value: 'all', label: 'Todos os clientes' }].concat(DB.core.clients.filter(function (c) { return sc.clientIds.indexOf(c.id) >= 0; }).map(function (c) { return { value: c.id, label: c.name }; })), st.filters.client, '200px')
        + UI.select('filter:platform', [{ value: 'all', label: 'Meta e Google' }, { value: 'meta', label: 'Meta' }, { value: 'google', label: 'Google' }], st.filters.platform, '150px')
        + '<span class="spacer"></span>'
        + UI.btn('Operações em massa', { size: 'sm', icon: 'bolt', action: 'go:accounts/bulk' })
        + UI.btn('Conectar conta', { size: 'sm', variant: 'primary', icon: 'plug', action: 'toast:Fluxo OAuth iniciado (mock)' })
        + '</div>'
        + UI.table([
          { key: 'a', label: 'Conta', width: '22%' }, { key: 'c', label: 'Cliente' }, { key: 'p', label: 'Plataforma' },
          { key: 'ac', label: 'Acesso' }, { key: 'cm', label: 'Camp.', num: true }, { key: 'sp', label: 'Investido', num: true },
          { key: 'cpa', label: 'CPA', num: true }, { key: 'au', label: 'Auditoria', num: true }, { key: 'sy', label: 'Sync' }, { key: 'st', label: 'Status' }
        ], rows.map(function (a) {
          return {
            __action: 'go:accounts/' + a.id,
            a: '<span class="col" style="gap:0"><span class="strong">' + a.name + '</span><span class="xsmall subtle mono">' + a.externalId + '</span></span>',
            c: '<span class="small muted">' + a.client.name + '</span>', p: UI.platform(a.platform),
            ac: UI.pill(a.accessType === 'mcc' ? 'Herdado' : 'Direto', a.accessType === 'mcc' ? 'info' : 'neutral'),
            cm: '<span class="num">' + a.campaignCount + '</span>',
            sp: '<span class="num">' + F.money(a.metrics.spend) + '</span>',
            cpa: '<span class="num">' + (a.metrics.conversions ? F.moneyCents(a.metrics.cpa) : '—') + '</span>',
            au: UI.scorePill(a.audit.score),
            sy: '<span class="small muted">' + F.relative(a.lastSyncAt) + '</span>',
            st: UI.statusPill(a.status)
          };
        }), { title: 'Todas as contas' })
        + UI.table([{ key: 'n', label: 'Conexão' }, { key: 'p', label: 'Plataforma' }, { key: 'g', label: 'Caminho' }, { key: 'o', label: 'Credencial de' }, { key: 'e', label: 'ID externo' }, { key: 'ch', label: 'Contas', num: true }, { key: 'tk', label: 'Expira em', num: true }, { key: 's', label: 'Estado' }],
          R.connectionsOf(sc.organizationId).map(function (c) {
            const tone = { active: 'ok', expiring: 'warn', degraded: 'warn', revoked: 'danger', reauth_pending: 'warn' }[c.status];
            const label = { active: 'Ativa', expiring: 'Expirando', degraded: 'Degradada', revoked: 'Revogada', reauth_pending: 'Reautorização' }[c.status];
            const grantLabel = { mcc: 'MCC da organização', bm_partner: 'Parceria entre BMs', system_user: 'Usuário do sistema', oauth_user: 'OAuth direto' }[c.grantType];
            return {
              n: '<span class="strong">' + c.name + '</span>', p: UI.platform(c.platform),
              g: UI.pill(grantLabel, 'neutral'),
              o: UI.pill(c.owner === 'organization' ? 'Da organização' : 'Da plataforma', c.owner === 'organization' ? 'ok' : 'danger'),
              e: '<span class="mono">' + c.externalId + '</span>',
              ch: '<span class="num">' + c.linked + ' de ' + c.discovered + '</span>',
              tk: '<span class="num ' + (c.expiresInDays < 60 ? 'delta delta--down' : '') + '">' + (c.expiresInDays ? c.expiresInDays + ' dias' : 'vencido') + '</span>',
              s: UI.pill(label, tone, true)
            };
          }), { title: 'Autorizações da organização', sub: 'Um grant rende N contas. O developer token é sempre da organização — a tria nunca usa credencial própria.', actions: UI.btn('Redescobrir contas', { size: 'sm', icon: 'refresh', action: 'toast:14 contas encontradas, 3 novas sugeridas (mock)' }) })
    };
  }

  function detail(id, tab) {
    const a = R.account(id);
    if (!a) return { nav: 'accounts', title: 'Conta', content: UI.empty('Conta não encontrada') };
    const me = g.Store.me(), sc = R.scope(me.id);
    if (sc.accountIds.indexOf(id) < 0) return { nav: 'accounts', title: a.name, content: UI.empty('Sem acesso a esta conta', 'Nenhuma linha de members alcança este recurso.') };
    const st = g.Store.get(), period = st.period;
    const c = R.client(a.clientId);
    const audit = R.auditOf(a.id);
    const t = R.totals({ accountId: a.id, days: period });
    const active = tab || 'visao';
    const role = R.roleOn(me.id, 'ad_account', a.id);

    const header = UI.card({
      className: a.status === 'error' ? 'card--danger' : '',
      body: '<div class="row row--wrap" style="gap:var(--sp-4)">' + UI.avatar(a.name, { lg: true, square: true, alt: a.platform === 'meta' })
        + '<div class="col" style="gap:4px"><div class="row" style="gap:8px"><span class="page__title" style="font-size:var(--fs-lg)">' + a.name + '</span>' + UI.statusPill(a.status) + '</div>'
        + '<span class="small muted mono">' + a.externalId + '</span>'
        + '<span class="small muted">' + c.name + ' · grupo ' + a.group + ' · ' + (a.accessType === 'mcc' ? 'acesso herdado de ' + (DB.integrations.connections.find(function (x) { return x.id === a.connectionId; }) || {}).name : 'acesso direto') + ' · ' + a.timezone + '</span></div>'
        + '<span class="spacer"></span>'
        + '<div class="col" style="align-items:flex-end;gap:4px">' + UI.scorePill(audit.score) + '<span class="xsmall subtle">auditoria de ' + F.dateFull(audit.runAt.slice(0, 10)) + '</span>'
        + '<span class="xsmall subtle">seu papel: ' + R.roleLabel(role) + '</span></div>'
        + UI.btn('Sincronizar', { size: 'sm', icon: 'refresh', action: 'toast:Sincronização enfileirada (mock)' })
        + '</div>'
    });

    const tabsEl = UI.tabs([
      { key: 'visao', label: 'Visão geral' },
      { key: 'campanhas', label: 'Campanhas', count: R.campaignRows(period, { accountId: a.id }).length },
      { key: 'auditoria', label: 'Auditoria' },
      { key: 'conexao', label: 'Conexão' }
    ], active, 'tab:accounts/' + a.id);

    const body = { visao: tabVisao, campanhas: tabCamp, auditoria: tabAudit, conexao: tabConn }[active](a, c, period, t, audit);
    return {
      nav: 'accounts', title: a.name,
      crumbs: [{ label: 'Contas', route: 'accounts' }, { label: a.name }],
      right: g.Shell.periodPicker(period), content: header + tabsEl + body
    };
  }

  function tabVisao(a, c, period, t, audit) {
    const s = R.series({ accountId: a.id, days: period }, 'spend');
    const isE = c.model === 'ecommerce';
    return '<div class="grid grid--4">'
      + UI.stat({ label: 'Investimento', value: F.money(t.spend) })
      + UI.stat({ label: 'Conversões', value: F.number(t.conversions), foot: F.number(t.conversionsConfirmed) + ' confirmadas' })
      + UI.stat({ label: 'CPA', value: t.conversions ? F.moneyCents(t.cpa) : '—' })
      + UI.stat({ label: isE ? 'ROAS confirmado' : 'CPL', value: isE ? F.ratio(t.roasConfirmed) : F.moneyCents(t.cpl) })
      + '</div>'
      + '<div class="grid grid--2a">'
      + UI.card({ title: 'Investimento da conta', body: C.area(s, { height: 210, seed: 4 }) + C.axis(s) })
      + UI.card({
        title: 'Resumo da auditoria',
        body: '<div class="row" style="align-items:center;gap:var(--sp-4)">' + C.donut([{ value: audit.score }, { value: 100 - audit.score, color: 'var(--chart-grid)' }], { centerLabel: String(audit.score), centerSub: 'nota', size: 118 })
          + '<div class="col" style="flex:1;gap:5px">' + audit.findings.filter(function (f) { return f.status !== 'pass'; }).slice(0, 4).map(function (f) {
            return '<div class="row small" style="gap:8px">' + UI.pill(f.status === 'fail' ? 'Falha' : 'Atenção', f.status === 'fail' ? 'danger' : 'warn') + '<span class="truncate">' + f.label + '</span></div>';
          }).join('') + '</div></div>',
        foot: UI.btn('Auditoria completa', { size: 'sm', action: 'tab:accounts/' + a.id + ':auditoria' })
      })
      + '</div>';
  }

  function tabCamp(a, c, period) {
    const rows = R.campaignRows(period, { accountId: a.id });
    return UI.table([
      { key: 'n', label: 'Campanha', width: '26%' }, { key: 'mc', label: 'Iniciativa' }, { key: 'sp', label: 'Investido', num: true },
      { key: 'cv', label: 'Conversões', num: true }, { key: 'cpa', label: 'CPA', num: true },
      { key: 'is', label: 'Perda por orçamento', num: true }, { key: 'st', label: 'Status' }
    ], rows.map(function (r) {
      const m = r.marketingCampaignId ? R.mc(r.marketingCampaignId) : null;
      return {
        __action: 'modal:campaign:' + r.id,
        n: '<span class="strong">' + r.name + '</span>',
        mc: m ? '<span class="pill pill--outline">' + m.name + '</span>' : '<span class="xsmall subtle">avulsa</span>',
        sp: '<span class="num">' + F.money(r.metrics.spend) + '</span>',
        cv: '<span class="num">' + F.number(r.metrics.conversions) + '</span>',
        cpa: '<span class="num">' + (r.metrics.conversions ? F.moneyCents(r.metrics.cpa) : '—') + '</span>',
        is: '<span class="num ' + (r.budgetLimited ? 'delta delta--down' : '') + '">' + r.impressionShareLost + '%</span>',
        st: UI.statusPill(r.status)
      };
    }), { title: 'Campanhas da conta' });
  }

  function tabAudit(a, c, period, t, audit) {
    const groups = [['fail', 'Falhas', 'danger'], ['warn', 'Atenção', 'warn'], ['pass', 'Conforme', 'ok']];
    return '<div class="grid grid--1a">'
      + UI.card({
        title: 'Nota da conta',
        body: C.donut([{ value: audit.score }, { value: 100 - audit.score, color: 'var(--chart-grid)' }], { centerLabel: String(audit.score), centerSub: 'de 100', size: 148 })
          + '<span class="small muted">A nota desconta o peso de cada verificação reprovada. Roda mensalmente e sob demanda.</span>',
        foot: UI.btn('Rodar auditoria', { size: 'sm', icon: 'refresh', action: 'toast:Auditoria enfileirada (mock)' })
      })
      + UI.card({
        title: 'Verificações', tight: true,
        body: groups.map(function (gr) {
          const list = audit.findings.filter(function (f) { return f.status === gr[0]; });
          if (!list.length) return '';
          return '<div class="card__head" style="background:var(--bg-sunken)"><span class="card__title">' + gr[1] + '</span>' + UI.pill(String(list.length), gr[2]) + '</div>'
            + list.map(function (f) {
              return '<div class="rec">' + UI.sev(gr[0] === 'fail' ? 'high' : gr[0] === 'warn' ? 'mid' : 'opp')
                + '<div class="col" style="gap:2px"><span class="rec__title">' + f.label + '</span><span class="small muted">' + f.note + '</span><span class="xsmall subtle">peso ' + f.weight + '</span></div></div>';
            }).join('');
        }).join('')
      })
      + '</div>';
  }

  function tabConn(a, c) {
    const conn = DB.integrations.connections.find(function (x) { return x.id === a.connectionId; });
    const people = DB.core.members.filter(function (m) {
      return (m.scopeType === 'ad_account' && m.scopeId === a.id) || (m.scopeType === 'client' && m.scopeId === a.clientId);
    });
    return '<div class="grid grid--2">'
      + UI.card({
        title: 'Credencial técnica', sub: 'Autoriza a plataforma a falar com a conta — não tem relação com pessoas',
        body: UI.kv([
          ['Tipo de acesso', a.accessType === 'mcc' ? 'Herdado da estrutura administradora' : 'Direto'],
          ['Estrutura', conn ? conn.name + ' <span class="mono">' + conn.externalId + '</span>' : '—'],
          ['Escopos', a.scopes.map(function (s) { return '<span class="pill pill--outline">' + s + '</span>'; }).join(' ')],
          ['Moeda / fuso', a.currency + ' · ' + a.timezone],
          ['Última sincronização', F.dateTime(a.lastSyncAt) + ' · ' + F.number(a.syncRows) + ' linhas']
        ]) + (a.error ? '<div class="row small" style="color:var(--c-danger);background:var(--c-danger-bg);padding:10px;border-radius:var(--radius-sm)">' + ICON('alert', 15) + a.error + '</div>' : ''),
        foot: a.status === 'error'
          ? UI.btn('Reautorizar', { variant: 'primary', size: 'sm', icon: 'refresh', action: 'toast:Fluxo OAuth iniciado (mock)' }) + UI.btn('Enviar link ao cliente', { size: 'sm', icon: 'send', action: 'toast:Link enviado (mock)' })
          : UI.btn('Sincronizar', { size: 'sm', icon: 'refresh', action: 'toast:Sincronização enfileirada (mock)' }) + UI.btn('Revogar', { size: 'sm', variant: 'danger', action: 'noop' })
      })
      + UI.card({
        title: 'Pessoas com acesso', sub: 'Resolvido pela tabela members — camada separada da credencial', tight: true,
        body: UI.table([{ key: 'u', label: 'Pessoa' }, { key: 'r', label: 'Papel' }, { key: 'sc', label: 'Escopo' }, { key: 'e', label: 'Expira' }],
          people.map(function (m) {
            const u = R.user(m.userId);
            return {
              u: '<span class="row" style="gap:8px">' + UI.avatar(u.name) + '<span class="small">' + u.name + '</span></span>',
              r: UI.pill(R.roleLabel(m.role), 'neutral'),
              sc: '<span class="mono">' + m.scopeType + '</span>',
              e: m.expiresAt ? '<span class="small muted">' + F.dateFull(m.expiresAt) + '</span>' : '<span class="xsmall subtle">sem prazo</span>'
            };
          }), { bare: true, empty: 'Acesso só por organização ou portfólio' }),
        foot: 'Revogar o login de alguém não derruba esta conexão, e revogar a conta não tira o acesso de ninguém à plataforma.'
      })
      + '</div>';
  }

  function bulk() {
    const preview = R.wasteCampaigns(7);
    return {
      nav: 'accounts', title: 'Operações em massa',
      crumbs: [{ label: 'Contas', route: 'accounts' }, { label: 'Operações em massa' }],
      content: '<div class="page__head"><div><div class="page__title">Operações em massa</div><div class="page__sub">A mesma alteração em várias campanhas ou contas, com pré-visualização obrigatória e chave de idempotência por alvo.</div></div></div>'
        + '<div class="grid grid--1a">'
        + UI.card({
          title: 'Nova operação',
          body: '<div class="field"><label class="field__label">Ação</label>' + UI.select('noop', ['Pausar campanhas', 'Ajustar orçamento em %', 'Aplicar lista de negativas', 'Alterar estratégia de lance', 'Padronizar nomenclatura', 'Aplicar exclusão de público'].map(function (o) { return { value: o, label: o }; }), 'Pausar campanhas') + '</div>'
            + '<div class="field"><label class="field__label">Escopo</label>' + UI.select('noop', [{ value: 'all', label: 'Toda a agência' }].concat(DB.core.portfolios.map(function (p) { return { value: p.id, label: 'Portfólio ' + p.name }; })).concat(DB.core.clients.map(function (c) { return { value: c.id, label: 'Cliente ' + c.name }; })), 'all') + '</div>'
            + '<div class="field"><label class="field__label">Condição</label><input class="input" value="Sem conversão em 14 dias e gasto acima de R$ 200"></div>'
            + '<div class="row small muted">' + ICON('shield', 15) + 'Roda em modo de pré-visualização e só é aplicada após confirmação.</div>',
          foot: UI.btn('Pré-visualizar alvos', { variant: 'primary', size: 'sm', action: 'toast:' + preview.length + ' campanhas selecionadas (mock)' })
        })
        + UI.card({
          title: 'Pré-visualização', sub: preview.length + ' campanhas atendem à condição', tight: true,
          body: UI.table([{ key: 'n', label: 'Campanha' }, { key: 'c', label: 'Cliente' }, { key: 'a', label: 'Conta' }, { key: 's', label: 'Gasto 7d', num: true }, { key: 'cv', label: 'Conversões', num: true }],
            preview.map(function (r) {
              return {
                n: '<span class="small strong">' + r.name + '</span>', c: '<span class="small muted">' + R.client(r.clientId).name + '</span>',
                a: '<span class="small muted">' + R.account(r.adAccountId).group + '</span>',
                s: '<span class="num">' + F.money(r.metrics.spend) + '</span>', cv: '<span class="num">0</span>'
              };
            }), { bare: true }),
          foot: UI.btn('Aplicar em ' + preview.length + ' campanhas', { variant: 'primary', size: 'sm', icon: 'bolt', action: 'toast:Operação enviada para aprovação (mock)' })
        })
        + '</div>'
        + UI.table([{ key: 'l', label: 'Operação' }, { key: 's', label: 'Escopo' }, { key: 't', label: 'Alvos', num: true }, { key: 'b', label: 'Criada por' }, { key: 'w', label: 'Quando' }, { key: 'p', label: 'Resultado' }, { key: 'st', label: 'Status' }],
          DB.ads.bulkOperations.map(function (o) {
            return {
              l: '<span class="small strong">' + o.label + '</span>', s: '<span class="small muted">' + o.scope + '</span>',
              t: '<span class="num">' + o.targets + '</span>',
              b: '<span class="small">' + (o.createdBy === 'agent' ? 'Agente IA' : R.user(o.createdBy).name) + '</span>',
              w: '<span class="small muted">' + F.relative(o.createdAt) + '</span>',
              p: '<span class="small muted">' + o.preview + '</span>', st: UI.statusPill(o.status)
            };
          }), { title: 'Histórico de operações em massa' })
    };
  }
})(window);
