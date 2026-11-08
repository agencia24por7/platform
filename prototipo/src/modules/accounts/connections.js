(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.connections = function (route) {
    const sc = R.scope(g.Store.me().id);
    const clientId = route.id || sc.clientIds[0];
    const c = R.client(clientId);
    if (!c) return { nav: 'accounts', title: 'Conexões', content: UI.empty('Cliente não encontrado') };
    if (sc.clientIds.indexOf(c.id) < 0) {
      return { nav: 'accounts', title: c.name, content: UI.empty('Sem acesso a este cliente', 'Nenhuma linha de members alcança este recurso — nem por organização, carteira, cliente ou conta.') };
    }
    const accounts = R.accountsOf(c.id);
    const ok = accounts.filter(function (a) { return a.status === 'connected'; });
    const runs = DB.automation.runs.filter(function (r) { return !r.clientId || r.clientId === c.id; });
    const pendingAcc = accounts.find(function (a) { return a.status === 'pending'; });

    const grants = R.connectionsOf(sc.organizationId, c.id);
    const picker = UI.select('go-connections', DB.core.clients.filter(function (x) { return sc.clientIds.indexOf(x.id) >= 0; }).map(function (x) { return { value: x.id, label: x.name }; }), c.id, '200px');

    const cards = accounts.map(function (a) {
      const conn = DB.integrations.connections.find(function (x) { return x.id === a.connectionId; });
      const bad = a.status !== 'connected';
      return UI.card({
        className: bad ? 'card--danger' : '',
        title: UI.platform(a.platform) + ' <span class="small muted">· ' + a.group + '</span>',
        actions: UI.statusPill(a.status),
        body: UI.kv([
          ['ID externo', '<span class="mono">' + a.externalId + '</span>'],
          ['Origem', a.accessType === 'mcc' ? conn.name + ' <span class="pill pill--info">herdado</span>' : 'Acesso direto do cliente'],
          ['Escopos', a.scopes.map(function (s) { return '<span class="pill pill--outline">' + s + '</span>'; }).join(' ')],
          ['Moeda / fuso', a.currency + ' · ' + a.timezone],
          ['Última sincronização', a.status === 'connected' ? F.dateTime(a.lastSyncAt) + ' · ' + F.number(a.syncRows) + ' linhas · 0 erros' : '<span class="delta delta--down">' + F.relative(a.lastSyncAt) + '</span>'],
          ['Campanhas', String(DB.ads.campaigns.filter(function (cp) { return cp.adAccountId === a.id; }).length)]
        ])
          + (a.error ? '<div class="col small" style="color:var(--c-danger);background:var(--c-danger-bg);padding:10px;border-radius:var(--radius-sm);gap:4px">'
            + '<span class="row" style="gap:6px">' + ICON('alert', 15) + '<b>' + a.error + '</b></span>'
            + '<span>Impacto: campanhas desta conta ficam sem dado novo e o agente suspende recomendações até normalizar.</span></div>' : '')
          + (a.pendingSince ? '<div class="col small" style="background:var(--c-warn-bg);color:var(--c-warn);padding:10px;border-radius:var(--radius-sm);gap:4px">'
            + '<span class="row" style="gap:6px">' + ICON('clock', 15) + '<b>Aguardando autorização desde ' + F.dateFull(a.pendingSince) + '</b></span>'
            + '<span class="mono">' + a.inviteLink + '</span></div>' : ''),
        foot: bad
          ? UI.btn('Reautorizar agora', { variant: 'primary', size: 'sm', icon: 'refresh', action: 'toast:Fluxo OAuth iniciado (mock)' }) + UI.btn('Enviar link ao cliente', { size: 'sm', icon: 'send', action: 'toast:Link enviado ao cliente (mock)' }) + UI.btn('Desvincular', { size: 'sm', variant: 'danger', action: 'noop' })
          : UI.btn('Sincronizar agora', { size: 'sm', icon: 'refresh', action: 'toast:Sincronização enfileirada (mock)' }) + UI.btn('Abrir conta', { size: 'sm', action: 'go:accounts/' + a.id }) + UI.btn('Desvincular', { size: 'sm', variant: 'danger', action: 'noop' })
      });
    }).join('');

    const grantCards = UI.card({
      title: 'Autorizações (grants)', sub: 'Uma autorização descobre N contas — por isso conexão e conta são coisas diferentes',
      tight: true,
      body: UI.table([
        { key: 'n', label: 'Conexão', width: '24%' }, { key: 'p', label: 'Plataforma' }, { key: 'g', label: 'Caminho' },
        { key: 'o', label: 'Credencial de' }, { key: 'sc', label: 'Escopos' }, { key: 'd', label: 'Descobertas', num: true },
        { key: 'e', label: 'Expira em', num: true }, { key: 'st', label: 'Estado' }
      ], grants.map(function (cn) {
        const tone = { active: 'ok', expiring: 'warn', degraded: 'warn', revoked: 'danger', reauth_pending: 'warn' }[cn.status];
        const label = { active: 'Ativa', expiring: 'Expirando', degraded: 'Degradada', revoked: 'Revogada', reauth_pending: 'Reautorização enviada' }[cn.status];
        const grantLabel = { mcc: 'MCC da organização', bm_partner: 'Parceria entre BMs', system_user: 'Usuário do sistema', oauth_user: 'OAuth direto' }[cn.grantType];
        return {
          n: '<span class="col" style="gap:0"><span class="strong">' + cn.name + '</span><span class="xsmall subtle mono">' + cn.externalId + '</span></span>',
          p: UI.platform(cn.platform), g: UI.pill(grantLabel, 'neutral'),
          o: UI.pill(cn.owner === 'organization' ? 'Da organização' : 'Da plataforma', cn.owner === 'organization' ? 'ok' : 'warn'),
          sc: '<span class="row row--wrap" style="gap:3px">' + cn.scopes.map(function (x) { return '<span class="pill pill--outline">' + x + '</span>'; }).join('') + '</span>',
          d: '<span class="num">' + cn.linked + ' de ' + cn.discovered + '</span>',
          e: '<span class="num ' + (cn.expiresInDays === 0 ? 'delta delta--down' : cn.expiresInDays < 60 ? 'delta delta--down' : '') + '">' + (cn.expiresInDays ? cn.expiresInDays + ' dias' : '—') + '</span>',
          st: UI.pill(label, tone, true)
        };
      }), { bare: true, empty: 'Nenhuma autorização alcança este cliente' }),
      foot: 'Segredo guardado no Secret Manager. No banco fica só a referência, os escopos concedidos e o estado.'
    });

    const credentials = UI.card({
      title: 'Credenciais e acessos', sub: 'Três camadas independentes',
      body: '<span class="xsmall subtle">LOGIN DA PLATAFORMA</span>'
        + '<div class="col" style="gap:6px">' + R.membersOnScope('client', c.id).map(function (m) {
          const u = R.user(m.userId);
          return '<div class="row" style="gap:8px">' + UI.avatar(u.name) + '<span class="col" style="gap:0"><span class="small strong">' + u.name + '</span><span class="xsmall subtle">' + R.roleLabel(m.role) + ' · ' + (u.lastLoginAt ? 'último acesso ' + F.relative(u.lastLoginAt) : 'convite pendente') + '</span></span>'
            + '<span class="spacer"></span>' + UI.statusPill(m.status) + '</div>';
        }).join('') + '</div>'
        + '<div class="divider"></div>'
        + '<span class="xsmall subtle">ACESSO ÀS CONTAS DE ANÚNCIO</span>'
        + '<div class="col" style="gap:6px">' + grants.map(function (cn) {
          return '<div class="row small"><span>' + cn.name + '</span><span class="spacer"></span>' + UI.pill(cn.expiresInDays ? 'expira em ' + cn.expiresInDays + 'd' : 'vencido', cn.expiresInDays && cn.expiresInDays >= 60 ? 'ok' : 'warn', true) + '</div>';
        }).join('')
        + '</div>'
        + '<div class="divider"></div>'
        + '<span class="xsmall subtle">DEVELOPER TOKEN</span>'
        + '<div class="row small"><span>' + sc.organization.name + '</span><span class="spacer"></span>'
        + UI.pill(sc.organization.developerTokenOwner === 'organization' ? 'Da organização · ' + (sc.organization.developerTokenLevel === 'standard' ? 'Standard' : 'Basic') : 'Da plataforma', sc.organization.developerTokenOwner === 'organization' ? 'ok' : 'danger', true) + '</div>'
        + '<span class="xsmall subtle">São credenciais separadas: revogar o login não derruba as contas, e revogar uma conta não tira acesso de ninguém.</span>'
    });

    const history = UI.card({
      title: 'Histórico de sincronização', tight: true,
      body: UI.table([{ key: 'w', label: 'Quando' }, { key: 'f', label: 'Workflow' }, { key: 'r', label: 'Registros', num: true }, { key: 's', label: 'Status' }],
        runs.slice(0, 6).map(function (r) {
          return {
            w: '<span class="small muted nowrap">' + F.dateTime(r.startedAt) + '</span>',
            f: '<span class="mono">' + r.workflow + '</span>',
            r: '<span class="num">' + F.number(r.records) + '</span>',
            s: UI.statusPill(r.status === 'running' ? 'pending' : r.status)
          };
        }), { bare: true }),
      foot: UI.btn('Ver tudo em Automações', { size: 'sm', action: 'go:automations' })
    });

    const invite = UI.card({
      className: 'card--accent',
      title: 'Link de autorização para o cliente',
      sub: 'Quando a conta é do cliente, ele autoriza por link sem ver a operação da agência',
      body: '<div class="row"><input class="input" value="' + (pendingAcc ? pendingAcc.inviteLink : 'https://tria.app/connect/' + c.id + '-novo') + '" style="flex:1">'
        + UI.btn('Copiar', { size: 'sm', action: 'toast:Link copiado (mock)' }) + UI.btn('Enviar', { size: 'sm', variant: 'primary', icon: 'send', action: 'toast:Link enviado por e-mail (mock)' }) + '</div>'
        + '<span class="small muted">' + (pendingAcc ? 'Status: aguardando autorização desde ' + F.dateFull(pendingAcc.pendingSince) + ' · 1 lembrete enviado' : 'Nenhuma autorização pendente. O link expira em 7 dias após o envio.') + '</span>'
    });

    return {
      nav: 'accounts', title: 'Conexões · ' + c.name,
      crumbs: [{ label: 'Clientes', route: 'clients' }, { label: c.name, route: 'clients/' + c.id }, { label: 'Conexões' }],
      right: picker,
      content: '<div class="page__head"><div><div class="page__title">Conexões — ' + c.name + '</div>'
        + '<div class="page__sub">Estado das integrações deste cliente e das credenciais que as sustentam.</div></div>'
        + '<div class="page__actions">' + UI.btn('Conectar nova conta', { variant: 'primary', size: 'sm', icon: 'plug', action: 'toast:Fluxo OAuth iniciado (mock)' }) + '</div></div>'
        + '<div class="grid grid--4">'
        + UI.stat({ label: 'Contas ativas', value: ok.length + ' de ' + accounts.length })
        + UI.stat({ label: 'Última sincronização', value: F.relative(accounts[0].lastSyncAt), foot: 'rejanela de 28 dias' })
        + UI.stat({ label: 'Histórico importado', value: DB.meta.days + ' dias' })
        + UI.stat({ label: 'Token mais próximo de expirar', value: (grants.length ? Math.min.apply(null, grants.map(function (x) { return x.expiresInDays || 0; })) : 0) + ' dias', foot: grants.length + ' autorizações' })
        + '</div>'
        + grantCards
        + '<div class="grid grid--2">' + cards + '</div>'
        + '<div class="grid grid--2">' + history + credentials + '</div>'
        + invite
        + '<div class="grid grid--2">'
        + UI.card({
          title: 'Ciclo de vida da credencial', sub: 'A renovação roda como job, não como reação ao erro',
          tight: true,
          body: UI.table([{ key: 'e', label: 'Estado' }, { key: 'm', label: 'Significa' }, { key: 'a', label: 'O que a plataforma faz' }], [
            { e: UI.pill('Ativa', 'ok', true), m: '<span class="small muted">Token válido, sincronizando</span>', a: '<span class="small">Opera normalmente</span>' },
            { e: UI.pill('Expirando', 'warn', true), m: '<span class="small muted">Vence em menos de 30 dias</span>', a: '<span class="small">Avisa o responsável e tenta renovar sozinha</span>' },
            { e: UI.pill('Degradada', 'warn', true), m: '<span class="small muted">Perdeu permissão em parte dos ativos</span>', a: '<span class="small">Mantém o que funciona e abre pendência</span>' },
            { e: UI.pill('Revogada', 'danger', true), m: '<span class="small muted">Cliente revogou ou o token morreu</span>', a: '<span class="small">Suspende sync e congela as iniciativas no Kanban</span>' },
            { e: UI.pill('Reautorização', 'warn', true), m: '<span class="small muted">Link enviado ao cliente</span>', a: '<span class="small">Acompanha prazo e lembretes</span>' }
          ], { bare: true })
        })
        + UI.card({
          className: 'card--alt',
          title: 'GA4 e GTM não usam este consentimento',
          body: '<span class="small muted">Dependem de uma conta de serviço adicionada à propriedade pelo próprio cliente. É um passo explícito no onboarding — o e-mail abaixo precisa ser incluído como leitor na propriedade do GA4.</span>'
            + '<div class="row"><input class="input" value="tria-reader@' + sc.organizationId + '.iam.gserviceaccount.com" style="flex:1">'
            + UI.btn('Copiar', { size: 'sm', action: 'toast:E-mail copiado (mock)' }) + '</div>'
            + UI.kv([['Escopos', '<span class="pill pill--outline">analytics.readonly</span> <span class="pill pill--outline">tagmanager.readonly</span>'], ['Status', UI.pill('Aguardando o cliente', 'warn', true)]])
        })
        + '</div>'
    };
  };
})(window);
