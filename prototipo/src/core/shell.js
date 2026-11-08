(function (g) {
  const UI = g.UI, ICON = g.ICON, R = g.Repo;

  const NAV = [
    { group: 'Operação' },
    { key: 'dashboard', label: 'Dashboard Global', icon: 'dashboard', route: 'dashboard' },
    { key: 'portfolios', label: 'Portfólios', icon: 'target', route: 'portfolios' },
    { key: 'clients', label: 'Clientes', icon: 'clients', route: 'clients' },
    { key: 'accounts', label: 'Contas de anúncios', icon: 'plug', route: 'accounts' },
    { key: 'marketing', label: 'Campanhas de marketing', icon: 'board', route: 'marketing' },
    { key: 'campaigns', label: 'Campanhas de plataforma', icon: 'campaigns', route: 'campaigns' },
    { key: 'investments', label: 'Investimentos', icon: 'money', route: 'investments' },
    { group: 'Inteligência' },
    { key: 'performance', label: 'Performance', icon: 'history', route: 'performance' },
    { key: 'agent', label: 'Agente IA', icon: 'agent', route: 'agent' },
    { key: 'approvals', label: 'Aprovações', icon: 'check', route: 'approvals', badge: function (s) { return R.approvalsPending(s.clientIds).length; } },
    { group: 'Governança' },
    { key: 'automations', label: 'Automações', icon: 'flow', route: 'automations' },
    { key: 'reports', label: 'Relatórios', icon: 'doc', route: 'reports' },
    { key: 'audit', label: 'Auditoria', icon: 'shield', route: 'audit' },
    { key: 'settings', label: 'Configurações', icon: 'settings', route: 'settings' }
  ];

  const CLIENT_NAV = [
    { group: 'Meu ambiente' },
    { key: 'portal', label: 'Home', icon: 'dashboard', route: 'portal' },
    { key: 'portal-campaigns', label: 'Campanhas', icon: 'campaigns', route: 'portal/campaigns' },
    { key: 'portal-investments', label: 'Investimentos', icon: 'money', route: 'portal/investments' },
    { key: 'portal-performance', label: 'Performance', icon: 'history', route: 'portal/performance' },
    { key: 'portal-reports', label: 'Relatórios', icon: 'doc', route: 'portal/reports' },
    { key: 'portal-agent', label: 'Agente IA', icon: 'agent', route: 'portal/agent' }
  ];

  function sidebar(active) {
    const me = g.Store.me();
    const sc = R.scope(me.id);
    const items = sc.isClient ? CLIENT_NAV : NAV;
    const nav = items.map(function (it) {
      if (it.group) return '<div class="nav__group">' + it.group + '</div>';
      const badge = it.badge ? it.badge(sc) : 0;
      return '<div class="' + UI.cx('nav__item', it.key === active && 'is-active') + '" data-action="go:' + it.route + '">'
        + ICON(it.icon, 17) + '<span class="small">' + it.label + '</span>' + (badge ? '<span class="pill pill--warn">' + badge + '</span>' : '') + '</div>';
    }).join('');
    const noun = R.clientLabel(sc.organizationId).toLowerCase() + 's';
    const scopeLine = sc.org ? 'Toda a organização' : sc.clientIds.length + ' ' + noun + ' · ' + sc.accountIds.length + ' contas';
    return '<aside class="sidebar">'
      + '<div class="sidebar__brand"><span class="brand__mark">T</span><span class="brand__name">tria<small>AI-Native AdTech</small></span></div>'
      + '<nav class="sidebar__nav">' + nav + '</nav>'
      + '<div class="sidebar__foot"><div class="row" style="gap:10px">' + UI.avatar(me.name)
      + '<div class="col" style="gap:0;min-width:0"><span class="small strong truncate">' + me.name + '</span>'
      + '<span class="xsmall subtle truncate">' + R.roleLabel(sc.role) + ' · ' + scopeLine + '</span></div>'
      + UI.iconBtn('logout', 'go:login', 'Sair') + '</div></div></aside>';
  }

  function topbar(o) {
    const crumbs = (o.crumbs || []).map(function (c, i) {
      return (i ? ICON('chevron', 12) : '') + (c.route ? '<a data-action="go:' + c.route + '">' + c.label + '</a>' : '<span>' + c.label + '</span>');
    }).join('');
    return '<header class="topbar"><span class="topbar__title">' + o.title + '</span>'
      + (crumbs ? '<span class="topbar__crumbs">' + ICON('chevron', 12) + crumbs + '</span>' : '')
      + '<span class="spacer"></span>' + orgSwitcher() + (o.right || '')
      + '<span class="search" style="width:200px">' + ICON('search', 15) + '<input class="input" placeholder="Buscar..."></span>'
      + UI.iconBtn('bell', 'go:performance/_/anomalias', 'Alertas')
      + userSwitcher() + '</header>';
  }

  function orgSwitcher() {
    const sc = R.scope(g.Store.me().id);
    if (!sc.multiOrg) return '';
    return UI.select('switch-org', sc.organizations.map(function (o) {
      return { value: o.id, label: o.name + (o.type === 'agency' ? ' · agência' : ' · anunciante') };
    }), sc.organizationId, '210px');
  }

  function userSwitcher() {
    const me = g.Store.me();
    return UI.select('switch-user', g.DB.core.users.map(function (u) {
      return { value: u.id, label: u.name + ' · ' + R.roleLabel(R.scope(u.id).role) };
    }), me.id, '210px');
  }

  function periodPicker(p) {
    return UI.chips([{ key: '7', label: '7 dias' }, { key: '30', label: '30 dias' }, { key: '90', label: '90 dias' }], String(p), 'period');
  }

  g.Shell = {
    NAV: NAV,
    render: function (o) {
      return '<div class="app">' + sidebar(o.nav) + '<main class="main">' + topbar(o) + '<div class="' + UI.cx('page', o.wide && 'page--wide') + '">' + o.content + '</div></main></div>';
    },
    bare: function (content) { return '<div class="app is-bare">' + content + '</div>'; },
    periodPicker: periodPicker,
    toasts: function () {
      const list = g.Store.get().toasts;
      return list.length ? '<div class="toast-stack">' + list.map(function (t) { return '<div class="toast">' + t.message + '</div>'; }).join('') + '</div>' : '';
    }
  };
})(window);
