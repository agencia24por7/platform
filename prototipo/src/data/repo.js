(function (g) {
  const DB = g.DB, F = g.F;
  const now = new Date(DB.meta.now);

  function find(list, id) { return list.find(function (x) { return x.id === id; }); }
  const user = function (id) { return find(DB.core.users, id); };
  const client = function (id) { return find(DB.core.clients, id); };
  const account = function (id) { return find(DB.integrations.adAccounts, id); };
  const portfolio = function (id) { return find(DB.core.portfolios, id); };
  const campaign = function (id) { return find(DB.ads.campaigns, id); };
  const mc = function (id) { return find(DB.ads.marketingCampaigns, id); };
  const stage = function (id) { return find(DB.agent.pipelineStages, id); };
  const agentOf = function (id) { return find(DB.agent.roster, id); };
  const organization = function (id) { return find(DB.core.organizations, id); };
  const connection = function (id) { return find(DB.integrations.connections, id); };
  const roleLabel = function (r) { const x = find(DB.core.roles, r); return x ? x.label : r; };

  function childrenOf(clientId) {
    return DB.core.clients.filter(function (c) { return c.parentClientId === clientId; });
  }
  function descendantsOf(clientId) {
    return childrenOf(clientId).reduce(function (acc, c) { return acc.concat([c.id], descendantsOf(c.id)); }, []);
  }
  function treeOf(clientId) { return [clientId].concat(descendantsOf(clientId)); }
  function rootOf(clientId) {
    const c = client(clientId);
    return c && c.parentClientId ? rootOf(c.parentClientId) : clientId;
  }

  function organizationsOf(userId) {
    const ids = [];
    DB.core.members.forEach(function (m) {
      if (m.userId !== userId || m.status !== 'active') return;
      if (m.expiresAt && new Date(m.expiresAt) < now) return;
      if (ids.indexOf(m.organizationId) < 0) ids.push(m.organizationId);
    });
    return ids.map(organization);
  }

  function memberRows(userId, organizationId) {
    return DB.core.members.filter(function (m) {
      if (m.userId !== userId || m.status !== 'active') return false;
      if (m.expiresAt && new Date(m.expiresAt) < now) return false;
      if (organizationId && m.organizationId !== organizationId) return false;
      return true;
    });
  }

  function scope(userId, forcedOrgId) {
    const orgs = organizationsOf(userId);
    const picked = forcedOrgId || (g.Store && g.Store.get().organizationId) || null;
    const organizationId = (picked && orgs.some(function (o) { return o.id === picked; }) ? picked
      : (orgs[0] || { id: 'org_1' }).id);
    const rows = memberRows(userId, organizationId);
    const orgRow = rows.find(function (m) { return m.scopeType === 'organization'; });
    const org = !!orgRow;
    const pfIds = rows.filter(function (m) { return m.scopeType === 'portfolio'; }).map(function (m) { return m.scopeId; });
    const directClients = rows.filter(function (m) { return m.scopeType === 'client'; }).map(function (m) { return m.scopeId; });
    const directAccounts = rows.filter(function (m) { return m.scopeType === 'ad_account'; }).map(function (m) { return m.scopeId; });
    let clientIds;
    if (org) clientIds = DB.core.clients.filter(function (c) { return c.organizationId === organizationId; }).map(function (c) { return c.id; });
    else {
      const fromPf = DB.core.clients.filter(function (c) { return pfIds.indexOf(c.portfolioId) >= 0; }).map(function (c) { return c.id; });
      const fromAcc = directAccounts.map(function (id) { const a = account(id); return a ? a.clientId : null; }).filter(Boolean);
      const base = fromPf.concat(directClients).concat(fromAcc);
      const withTree = base.reduce(function (acc, id) { return acc.concat(treeOf(id)); }, []);
      clientIds = Array.from(new Set(withTree)).filter(function (id) {
        const c = client(id);
        return c && c.organizationId === organizationId;
      });
    }
    const accountIds = DB.integrations.adAccounts.filter(function (a) {
      if (a.organizationId !== organizationId) return false;
      if (org) return true;
      if (directAccounts.indexOf(a.id) >= 0) return true;
      if (clientIds.indexOf(a.clientId) >= 0) return true;
      const c = client(a.clientId);
      return c && pfIds.indexOf(c.portfolioId) >= 0;
    }).map(function (a) { return a.id; });
    const topRole = org ? rows.find(function (m) { return m.scopeType === 'organization'; }).role
      : (rows.map(function (m) { return m.role; }).sort(function (a, b) { return rank(b) - rank(a); })[0] || 'analyst');
    return {
      org: org, organizationId: organizationId, organization: organization(organizationId),
      rows: rows, portfolioIds: pfIds, clientIds: clientIds, accountIds: accountIds,
      organizations: orgs, multiOrg: orgs.length > 1,
      role: topRole, isClient: topRole === 'client'
    };
  }

  function rank(role) { return { owner: 5, admin: 4, manager: 3, partner: 2, analyst: 1, client: 0 }[role] || 0; }

  function roleOn(userId, scopeType, scopeId) {
    const rows = memberRows(userId);
    let best = null, bestSpec = -1;
    const spec = { organization: 0, portfolio: 1, client: 2, ad_account: 3 };
    rows.forEach(function (m) {
      let reaches = false;
      if (m.scopeType === 'organization') reaches = true;
      else if (m.scopeType === scopeType && m.scopeId === scopeId) reaches = true;
      else if (m.scopeType === 'portfolio') {
        if (scopeType === 'client') reaches = (client(scopeId) || {}).portfolioId === m.scopeId;
        if (scopeType === 'ad_account') { const a = account(scopeId); reaches = a && (client(a.clientId) || {}).portfolioId === m.scopeId; }
      } else if (m.scopeType === 'client') {
        if (scopeType === 'client') reaches = treeOf(m.scopeId).indexOf(scopeId) >= 0;
        if (scopeType === 'ad_account') { const a = account(scopeId); reaches = a && treeOf(m.scopeId).indexOf(a.clientId) >= 0; }
      }
      if (reaches && spec[m.scopeType] >= bestSpec) { bestSpec = spec[m.scopeType]; best = m.role; }
    });
    return best;
  }

  function can(userId, permission) {
    const r = scope(userId).role;
    const row = DB.core.permissionMatrix.find(function (p) { return p.action === permission; });
    if (!row) return rank(r) >= 3;
    return row[r] === 'sim' || row[r] === 'escopo';
  }

  function dateNDaysAgo(n) {
    const d = new Date(DB.meta.today + 'T12:00:00');
    d.setDate(d.getDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  }

  function empty() { return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsConfirmed: 0, leads: 0, leadsQualified: 0, purchases: 0, revenue: 0, revenueConfirmed: 0 }; }
  function acc(a, r) {
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks;
    a.conversions += r.conversions; a.conversionsConfirmed += r.conversionsConfirmed;
    a.leads += r.leads; a.leadsQualified += r.leadsQualified; a.purchases += r.purchases;
    a.revenue += r.revenue; a.revenueConfirmed += r.revenueConfirmed;
    return a;
  }
  function derive(t) {
    t.ctr = t.impressions ? t.clicks / t.impressions : 0;
    t.cpc = t.clicks ? t.spend / t.clicks : 0;
    t.cpm = t.impressions ? (t.spend / t.impressions) * 1000 : 0;
    t.cpa = t.conversions ? t.spend / t.conversions : 0;
    t.cpl = t.leads ? t.spend / t.leads : 0;
    t.cpql = t.leadsQualified ? t.spend / t.leadsQualified : 0;
    t.roas = t.spend ? t.revenue / t.spend : 0;
    t.roasConfirmed = t.spend ? t.revenueConfirmed / t.spend : 0;
    t.convRate = t.clicks ? t.conversions / t.clicks : 0;
    t.aov = t.purchases ? t.revenue / t.purchases : 0;
    t.gap = t.conversions ? (t.conversions - t.conversionsConfirmed) / t.conversions : 0;
    return t;
  }

  function rows(f) {
    f = f || {};
    const from = f.days ? dateNDaysAgo(f.days) : null;
    return DB.metrics.daily.filter(function (r) {
      if (f.clientId && r.clientId !== f.clientId) return false;
      if (f.clientIds && f.clientIds.indexOf(r.clientId) < 0) return false;
      if (f.campaignId && r.campaignId !== f.campaignId) return false;
      if (f.campaignIds && f.campaignIds.indexOf(r.campaignId) < 0) return false;
      if (f.accountId && r.adAccountId !== f.accountId) return false;
      if (f.accountIds && f.accountIds.indexOf(r.adAccountId) < 0) return false;
      if (f.platform && f.platform !== 'all' && r.platform !== f.platform) return false;
      if (from && r.date < from) return false;
      if (f.before && r.date >= f.before) return false;
      return true;
    });
  }

  function totals(f) { return derive(rows(f).reduce(acc, empty())); }

  function totalsPrev(f) {
    const days = f.days || 30;
    const start = dateNDaysAgo(days * 2), end = dateNDaysAgo(days);
    const list = rows(Object.assign({}, f, { days: null })).filter(function (r) { return r.date >= start && r.date < end; });
    return derive(list.reduce(acc, empty()));
  }

  function series(f, metric) {
    const map = new Map();
    rows(f).forEach(function (r) {
      if (!map.has(r.date)) map.set(r.date, empty());
      acc(map.get(r.date), r);
    });
    return Array.from(map.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).map(function (e) {
      const t = derive(e[1]);
      return { date: e[0], value: metric ? (t[metric] || 0) : t.spend, totals: t };
    });
  }

  function delta(a, b) { return b ? (a - b) / b : 0; }

  function clientRows(days, ids) {
    const list = ids ? DB.core.clients.filter(function (c) { return ids.indexOf(c.id) >= 0; }) : DB.core.clients;
    return list.map(function (c) {
      const t = totals({ clientId: c.id, days: days });
      const p = totalsPrev({ clientId: c.id, days: days });
      return Object.assign({}, c, { metrics: t, prev: p, deltaSpend: delta(t.spend, p.spend) });
    });
  }

  function accountRows(days, ids) {
    const list = ids ? DB.integrations.adAccounts.filter(function (a) { return ids.indexOf(a.id) >= 0; }) : DB.integrations.adAccounts;
    return list.map(function (a) {
      return Object.assign({}, a, {
        client: client(a.clientId),
        metrics: totals({ accountId: a.id, days: days }),
        campaignCount: DB.ads.campaigns.filter(function (c) { return c.adAccountId === a.id; }).length,
        audit: DB.ads.accountAudits.find(function (x) { return x.accountId === a.id; })
      });
    });
  }

  function campaignRows(days, f) {
    f = f || {};
    return DB.ads.campaigns.filter(function (c) {
      if (f.clientId && c.clientId !== f.clientId) return false;
      if (f.clientIds && f.clientIds.indexOf(c.clientId) < 0) return false;
      if (f.accountId && c.adAccountId !== f.accountId) return false;
      if (f.accountIds && f.accountIds.indexOf(c.adAccountId) < 0) return false;
      if (f.marketingCampaignId && c.marketingCampaignId !== f.marketingCampaignId) return false;
      if (f.platform && f.platform !== 'all' && c.platform !== f.platform) return false;
      return true;
    }).map(function (c) { return Object.assign({}, c, { metrics: totals({ campaignId: c.id, days: days }) }); });
  }

  function portfolioRows(days, scopeIds) {
    return DB.core.portfolios.map(function (p) {
      const cl = DB.core.clients.filter(function (c) { return c.portfolioId === p.id && (!scopeIds || scopeIds.indexOf(c.id) >= 0); });
      const ids = cl.map(function (c) { return c.id; });
      const t = totals({ clientIds: ids, days: days });
      const prev = totalsPrev({ clientIds: ids, days: days });
      const models = cl.map(function (c) { return c.model; });
      return Object.assign({}, p, {
        clients: cl, clientIds: ids, metrics: t, prev: prev,
        model: models.length && models.every(function (m) { return m === models[0]; }) ? models[0] : 'misto',
        accounts: DB.integrations.adAccounts.filter(function (a) { return ids.indexOf(a.clientId) >= 0; }).length,
        budget: cl.reduce(function (a, c) { return a + c.monthlyBudget; }, 0),
        deltaSpend: delta(t.spend, prev.spend)
      });
    }).filter(function (p) { return p.clients.length; });
  }

  function mcMetrics(item, days) {
    if (!item.childCampaignIds.length) return derive(empty());
    return totals({ campaignIds: item.childCampaignIds, days: days || 30 });
  }

  function mcRows(f) {
    f = f || {};
    return DB.ads.marketingCampaigns.filter(function (m) {
      if (f.accountIds && !m.adAccountIds.some(function (a) { return f.accountIds.indexOf(a) >= 0; })) return false;
      if (f.client && f.client !== 'all' && (m.reachClientIds || [m.clientId]).indexOf(f.client) < 0) return false;
      if (f.account && f.account !== 'all' && m.adAccountIds.indexOf(f.account) < 0) return false;
      if (f.portfolio && f.portfolio !== 'all' && m.portfolioId !== f.portfolio) return false;
      if (f.platform && f.platform !== 'all' && m.platforms.indexOf(f.platform) < 0) return false;
      if (f.owner && f.owner !== 'all' && m.ownerUserId !== f.owner) return false;
      if (f.origin && f.origin !== 'all' && m.origin !== f.origin) return false;
      if (f.scope && f.scope !== 'all' && (m.scopeType || 'client') !== f.scope) return false;
      if (f.status && f.status !== 'all' && m.status !== f.status) return false;
      return true;
    }).map(function (m) {
      const st = stage(m.stageId);
      const hours = F.hours(m.stageSince);
      return Object.assign({}, m, {
        client: client(m.clientId), stage: st, hoursInStage: hours,
        reachClients: (m.reachClientIds || [m.clientId]).map(client).filter(Boolean),
        late: st.slaHours ? hours > st.slaHours : false,
        owner: user(m.ownerUserId), metrics: mcMetrics(m, 30),
        events: DB.agent.pipelineEvents.filter(function (e) { return e.marketingCampaignId === m.id; })
      });
    });
  }

  function board(f) {
    const list = mcRows(f);
    return DB.agent.pipelineStages.map(function (s) {
      const cards = list.filter(function (m) { return m.stageId === s.id; });
      return {
        stage: s, cards: cards,
        budget: cards.reduce(function (a, c) { return a + c.budgetTotal; }, 0),
        late: cards.filter(function (c) { return c.late; }).length
      };
    });
  }

  function approvalsPending(scopeIds) {
    return DB.agent.approvals.filter(function (a) { return a.status === 'pending' && (!scopeIds || scopeIds.indexOf(a.clientId) >= 0); });
  }
  function recsPending(clientId, scopeIds) {
    return DB.agent.recommendations.filter(function (r) {
      if (r.status !== 'pending') return false;
      if (clientId && r.clientId !== clientId) return false;
      if (scopeIds && scopeIds.indexOf(r.clientId) < 0) return false;
      return true;
    });
  }

  function wasteCampaigns(days) {
    return campaignRows(days || 7).filter(function (c) { return c.metrics.spend > 100 && c.metrics.conversions === 0; });
  }
  function budgetOpportunities(days) {
    return campaignRows(days || 14).filter(function (r) {
      if (r.status !== 'active' || !r.budgetLimited) return false;
      const c = client(r.clientId);
      return c.model === 'ecommerce' ? r.metrics.roasConfirmed >= (c.goalRoas || 4) * 0.9 : r.metrics.cpl > 0 && r.metrics.cpl <= (c.goalCpl || 0);
    }).sort(function (a, b) { return b.metrics.spend - a.metrics.spend; });
  }

  function goalStatus(c, t) {
    if (c.model === 'ecommerce') {
      const ok = t.roasConfirmed >= (c.goalRoas || 0);
      return { ok: ok, label: F.ratio(t.roasConfirmed) + ' / ' + F.ratio(c.goalRoas || 0) };
    }
    const ok = t.cpl > 0 && t.cpl <= (c.goalCpl || Infinity);
    return { ok: ok, label: F.moneyCents(t.cpl) + ' / ' + F.moneyCents(c.goalCpl || 0) };
  }

  function kpiSet(model, t) {
    if (model === 'ecommerce') return [
      { key: 'spend', label: 'Investimento', value: F.money(t.spend) },
      { key: 'revenueConfirmed', label: 'Receita confirmada', value: F.money(t.revenueConfirmed) },
      { key: 'roasConfirmed', label: 'ROAS confirmado', value: F.ratio(t.roasConfirmed) },
      { key: 'purchases', label: 'Compras', value: F.number(t.purchases) },
      { key: 'cpa', label: 'CPA', value: F.moneyCents(t.cpa) },
      { key: 'aov', label: 'Ticket médio', value: F.moneyCents(t.aov) }
    ];
    return [
      { key: 'spend', label: 'Investimento', value: F.money(t.spend) },
      { key: 'leads', label: 'Leads', value: F.number(t.leads) },
      { key: 'cpl', label: 'CPL', value: F.moneyCents(t.cpl) },
      { key: 'leadsQualified', label: 'Leads qualificados', value: F.number(t.leadsQualified) },
      { key: 'cpql', label: 'Custo por lead qualificado', value: F.moneyCents(t.cpql) },
      { key: 'convRate', label: 'Taxa de conversão', value: F.pct(t.convRate) }
    ];
  }

  function platformSplit(f) {
    return ['meta', 'google'].map(function (p) { return { platform: p, totals: totals(Object.assign({}, f, { platform: p })) }; });
  }

  g.Repo = {
    DB: DB, user: user, client: client, account: account, portfolio: portfolio, campaign: campaign,
    organization: organization, connection: connection, organizationsOf: organizationsOf,
    canApprove: function (userId, clientId) {
      if (!can(userId, 'Aprovar plano e ações do agente')) return false;
      if (!clientId) return true;
      return scope(userId).clientIds.indexOf(clientId) >= 0;
    },
    canOperate: function (userId, clientId) {
      if (rank(scope(userId).role) < 3) return false;
      return !clientId || scope(userId).clientIds.indexOf(clientId) >= 0;
    },
    childrenOf: childrenOf, descendantsOf: descendantsOf, treeOf: treeOf, rootOf: rootOf,
    clientLabel: function (orgId) { return (organization(orgId) || {}).type === 'advertiser' ? 'Negócio' : 'Cliente'; },
    connectionsOf: function (organizationId, clientId) {
      return DB.integrations.connections.filter(function (cn) {
        if (cn.organizationId !== organizationId) return false;
        if (!clientId) return true;
        return DB.integrations.adAccounts.some(function (a) { return a.clientId === clientId && a.connectionId === cn.id; });
      });
    },
    approvalsFor: function (orgId) {
      return DB.core.platformApprovals.filter(function (a) { return a.scope === 'tria' || a.scope === orgId; });
    },
    mc: mc, stage: stage, agent: agentOf, roleLabel: roleLabel, memberRows: memberRows, scope: scope,
    roleOn: roleOn, can: can, rank: rank,
    dateNDaysAgo: dateNDaysAgo, rows: rows, totals: totals, totalsPrev: totalsPrev, series: series, delta: delta,
    clientRows: clientRows, accountRows: accountRows, campaignRows: campaignRows, portfolioRows: portfolioRows,
    mcRows: mcRows, mcMetrics: mcMetrics, board: board,
    approvalsPending: approvalsPending, recsPending: recsPending,
    wasteCampaigns: wasteCampaigns, budgetOpportunities: budgetOpportunities,
    goalStatus: goalStatus, kpiSet: kpiSet, platformSplit: platformSplit,
    accountsOf: function (clientId) { return DB.integrations.adAccounts.filter(function (a) { return a.clientId === clientId; }); },
    researchOf: function (clientId) { return DB.agent.research.filter(function (r) { return r.clientId === clientId; }); },
    plansOf: function (clientId) { return DB.agent.mediaPlans.filter(function (p) { return p.clientId === clientId; }); },
    actionsOf: function (clientId) { return DB.agent.actions.filter(function (a) { return !clientId || a.clientId === clientId; }); },
    rulesOf: function (clientId) { return DB.agent.rules.filter(function (r) { return r.clientId === clientId; }); },
    learningsOf: function (clientId) { return DB.agent.learnings.filter(function (l) { return !clientId || l.clientId === clientId; }); },
    investmentsOf: function (clientId) { return DB.metrics.investments.filter(function (i) { return i.clientId === clientId; }); },
    auditOf: function (accountId) { return DB.ads.accountAudits.find(function (a) { return a.accountId === accountId; }); },
    reconOf: function (clientId) { return DB.metrics.reconciliation.find(function (r) { return r.clientId === clientId; }); },
    alertsOf: function (clientId) { return DB.automation.alerts.filter(function (a) { return !clientId || a.clientId === clientId; }); },
    membersOf: function (userId) { return DB.core.members.filter(function (m) { return m.userId === userId; }); },
    membersOnScope: function (type, id) { return DB.core.members.filter(function (m) { return m.scopeType === type && m.scopeId === id; }); }
  };
})(window);
