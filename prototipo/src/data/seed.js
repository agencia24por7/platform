(function (g) {
  const rng = g.createRng(20261107);
  const TODAY = new Date(2026, 10, 7, 14, 0, 0);
  const iso = function (d) { return d.toISOString().slice(0, 10); };
  const addDays = function (d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const day = function (n) { return iso(addDays(TODAY, -n)); };
  const at = function (daysAgo, h, m) { const d = addDays(TODAY, -daysAgo); d.setHours(h || 9, m || 0, 0, 0); return d.toISOString(); };
  const hoursAgo = function (h) { return new Date(TODAY.getTime() - h * 3600000).toISOString(); };

  const organizations = [
    {
      id: 'org_1', name: 'Amigo Performance', slug: 'amigo', type: 'agency', status: 'active', createdAt: '2024-09-02',
      managerAccountId: '812-445-9031', businessManagerId: '1094887233',
      developerTokenRef: 'secret://org_1/google-ads-developer-token', developerTokenLevel: 'standard',
      developerTokenOwner: 'organization', seats: 6
    },
    {
      id: 'org_2', name: 'Pizzalize', slug: 'pizzalize', type: 'advertiser', status: 'active', createdAt: '2026-09-15',
      managerAccountId: '701-338-2240', businessManagerId: '9921004412',
      developerTokenRef: 'secret://org_2/google-ads-developer-token', developerTokenLevel: 'basic',
      developerTokenOwner: 'organization', seats: 1
    }
  ];

  const users = [
    { id: 'u_owner', name: 'Bruno Abreu', email: 'bruno@amigo.com.br', status: 'active', lastLoginAt: at(0, 8, 12) },
    { id: 'u_admin', name: 'Marina Costa', email: 'marina@amigo.com.br', status: 'active', lastLoginAt: at(0, 9, 40) },
    { id: 'u_rafael', name: 'Rafael Lima', email: 'rafael@amigo.com.br', status: 'active', lastLoginAt: at(0, 7, 5) },
    { id: 'u_juliana', name: 'Juliana Reis', email: 'juliana@amigo.com.br', status: 'active', lastLoginAt: at(0, 10, 2) },
    { id: 'u_diego', name: 'Diego Moraes', email: 'diego@amigo.com.br', status: 'active', lastLoginAt: at(1, 14, 20) },
    { id: 'u_leticia', name: 'Letícia Nunes', email: 'leticia@freelancer.com', status: 'active', lastLoginAt: at(2, 16, 40) },
    { id: 'u_ana', name: 'Ana Prado', email: 'ana@lojaflora.com.br', status: 'active', lastLoginAt: at(1, 11, 2) },
    { id: 'u_carlos', name: 'Carlos Teixeira', email: 'carlos@odontoprime.com.br', status: 'invited', lastLoginAt: null },
    { id: 'u_paulo', name: 'Paulo Serra', email: 'paulo@pizzalize.com.br', status: 'active', lastLoginAt: at(0, 12, 30) },
    { id: 'u_sandra', name: 'Sandra Bastos', email: 'sandra@sabordacarioca.com.br', status: 'active', lastLoginAt: at(0, 9, 15) },
    { id: 'u_helena', name: 'Helena Vasques', email: 'helena@sabordacarioca.com.br', status: 'active', lastLoginAt: at(1, 16, 40) },
    { id: 'u_vitor', name: 'Vitor Caldas', email: 'vitor@consultoria.com.br', status: 'active', lastLoginAt: at(0, 11, 5) }
  ];

  const roles = [
    { id: 'owner', label: 'Proprietário', desc: 'Tudo, inclusive faturamento, exclusão de dados e transferência da agência.' },
    { id: 'admin', label: 'Administrador', desc: 'Gerencia clientes, carteiras, conexões, membros e autonomia do agente.' },
    { id: 'manager', label: 'Gestor de tráfego', desc: 'Opera campanhas e aprova ações dentro do limite, nos escopos atribuídos.' },
    { id: 'analyst', label: 'Analista', desc: 'Lê dados e gera relatórios. Não aprova, não executa.' },
    { id: 'client', label: 'Cliente', desc: 'Vê só o próprio ambiente, sem custo interno, fee ou comparação.' },
    { id: 'partner', label: 'Parceiro', desc: 'Freelancer ou agência parceira, com acesso datado.' }
  ];

  const permissionMatrix = [
    { action: 'Ver dashboard global', owner: 'sim', admin: 'sim', manager: 'escopo', analyst: 'escopo', client: 'nao', partner: 'escopo' },
    { action: 'Cadastrar cliente', owner: 'sim', admin: 'sim', manager: 'nao', analyst: 'nao', client: 'nao', partner: 'nao' },
    { action: 'Conectar conta de anúncios', owner: 'sim', admin: 'sim', manager: 'escopo', analyst: 'nao', client: 'nao', partner: 'nao' },
    { action: 'Criar campanha de marketing', owner: 'sim', admin: 'sim', manager: 'escopo', analyst: 'nao', client: 'nao', partner: 'escopo' },
    { action: 'Aprovar plano e ações do agente', owner: 'sim', admin: 'sim', manager: 'escopo', analyst: 'nao', client: 'nao', partner: 'nao' },
    { action: 'Definir nível de autonomia', owner: 'sim', admin: 'sim', manager: 'nao', analyst: 'nao', client: 'nao', partner: 'nao' },
    { action: 'Gerenciar membros', owner: 'sim', admin: 'sim', manager: 'nao', analyst: 'nao', client: 'nao', partner: 'nao' },
    { action: 'Ver custo interno e fee', owner: 'sim', admin: 'sim', manager: 'escopo', analyst: 'nao', client: 'nao', partner: 'nao' },
    { action: 'Ver auditoria', owner: 'sim', admin: 'sim', manager: 'escopo', analyst: 'escopo', client: 'nao', partner: 'nao' }
  ];

  const portfolios = [
    { id: 'pf_1', name: 'E-commerce', goal: 'Escalar receita mantendo ROAS acima de 4', ownerId: 'u_rafael', color: 'var(--chart-2)' },
    { id: 'pf_2', name: 'Serviços locais', goal: 'Reduzir CPL e aumentar taxa de agendamento', ownerId: 'u_juliana', color: 'var(--chart-1)' },
    { id: 'pf_3', name: 'Alto valor / ciclo longo', goal: 'Qualificar lead para o time comercial', ownerId: 'u_diego', color: 'var(--chart-3)' }
  ];

  const clientsRaw = [
    { id: 'c_flora', name: 'Loja Flora', segment: 'Moda feminina', model: 'ecommerce', pf: 'pf_1', owner: 'u_rafael', budget: 42000, ticket: 220, autonomy: 2, site: 'lojaflora.com.br', regions: ['Brasil'], since: '2025-03-11', status: 'active' },
    { id: 'c_nutri', name: 'Nutri Vita', segment: 'Suplementos', model: 'ecommerce', pf: 'pf_1', owner: 'u_rafael', budget: 31000, ticket: 148, autonomy: 3, site: 'nutrivita.com.br', regions: ['Brasil'], since: '2025-01-08', status: 'active' },
    { id: 'c_pet', name: 'PetHaus', segment: 'Pet shop online', model: 'ecommerce', pf: 'pf_1', owner: 'u_rafael', budget: 22000, ticket: 96, autonomy: 2, site: 'pethaus.com.br', regions: ['Sudeste'], since: '2025-05-05', status: 'active' },
    { id: 'c_casa', name: 'Casa & Forma', segment: 'Decoração', model: 'ecommerce', pf: 'pf_1', owner: 'u_rafael', budget: 18500, ticket: 310, autonomy: 1, site: 'casaeforma.com.br', regions: ['Sul', 'Sudeste'], since: '2026-02-17', status: 'active' },
    { id: 'c_odonto', name: 'Odonto Prime', segment: 'Clínica odontológica', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 18000, ticket: 3400, autonomy: 2, site: 'odontoprime.com.br', regions: ['São Paulo', 'ABC'], since: '2025-06-02', status: 'active' },
    { id: 'c_bronze', name: 'Studio Bronze', segment: 'Estética avançada', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 7200, ticket: 1800, autonomy: 1, site: 'studiobronze.com.br', regions: ['Santa Catarina'], since: '2025-09-14', status: 'paused' },
    { id: 'c_vet', name: 'VetCare 24h', segment: 'Clínica veterinária', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 11400, ticket: 760, autonomy: 2, site: 'vetcare24h.com.br', regions: ['Curitiba'], since: '2025-11-30', status: 'active' },
    { id: 'c_verde', name: 'Casa Verde Móveis', segment: 'Móveis planejados', model: 'leads', pf: 'pf_3', owner: 'u_diego', budget: 26000, ticket: 12800, autonomy: 2, site: 'casaverdemoveis.com.br', regions: ['Sul'], since: '2024-11-20', status: 'active' },
    { id: 'c_alvorada', name: 'Instituto Alvorada', segment: 'Educação técnica', model: 'leads', pf: 'pf_3', owner: 'u_diego', budget: 14500, ticket: 2900, autonomy: 1, site: 'institutoalvorada.edu.br', regions: ['Minas Gerais'], since: '2025-08-19', status: 'active' },
    { id: 'c_ramos', name: 'Advocacia Ramos', segment: 'Direito previdenciário', model: 'leads', pf: 'pf_3', owner: 'u_diego', budget: 9800, ticket: 5200, autonomy: 1, site: 'advocaciaramos.com.br', regions: ['Paraná'], since: '2026-10-28', status: 'onboarding' },
    { id: 'c_pizza', name: 'Pizzalize', segment: 'Delivery de pizza', model: 'leads', pf: null, owner: 'u_paulo', budget: 6500, ticket: 89, autonomy: 1, site: 'pizzalize.com.br', regions: ['Recife'], since: '2026-09-15', status: 'active', org: 'org_2' },
    { id: 'c_burger', name: 'Pizzalize Burger', segment: 'Delivery de hambúrguer', model: 'leads', pf: null, owner: 'u_paulo', budget: 4200, ticket: 72, autonomy: 1, site: 'pizzalizeburger.com.br', regions: ['Recife'], since: '2026-10-20', status: 'active', org: 'org_2' },
    { id: 'c_rede', name: 'Rede Sabor Carioca', segment: 'Rede de restaurantes', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 48000, ticket: 140, autonomy: 2, site: 'sabordacarioca.com.br', regions: ['Rio de Janeiro'], since: '2025-04-10', status: 'active', isNetwork: true },
    { id: 'c_rede_tj', name: 'Sabor Carioca — Tijuca', segment: 'Filial', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 5200, ticket: 140, autonomy: 2, site: 'sabordacarioca.com.br/tijuca', regions: ['Tijuca'], since: '2025-04-10', status: 'active', parent: 'c_rede' },
    { id: 'c_rede_bz', name: 'Sabor Carioca — Barra', segment: 'Filial', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 6100, ticket: 140, autonomy: 2, site: 'sabordacarioca.com.br/barra', regions: ['Barra'], since: '2025-04-10', status: 'active', parent: 'c_rede' },
    { id: 'c_rede_ip', name: 'Sabor Carioca — Ipanema', segment: 'Filial', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 5800, ticket: 140, autonomy: 2, site: 'sabordacarioca.com.br/ipanema', regions: ['Ipanema'], since: '2025-06-02', status: 'active', parent: 'c_rede' },
    { id: 'c_rede_mr', name: 'Sabor Carioca — Méier', segment: 'Filial', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 4400, ticket: 140, autonomy: 1, site: 'sabordacarioca.com.br/meier', regions: ['Méier'], since: '2025-09-18', status: 'active', parent: 'c_rede' },
    { id: 'c_rede_nt', name: 'Sabor Carioca — Niterói', segment: 'Filial', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 4900, ticket: 140, autonomy: 1, site: 'sabordacarioca.com.br/niteroi', regions: ['Niterói'], since: '2026-01-23', status: 'active', parent: 'c_rede' },
    { id: 'c_rede_bg', name: 'Sabor Carioca — Botafogo', segment: 'Filial', model: 'leads', pf: 'pf_2', owner: 'u_juliana', budget: 5300, ticket: 140, autonomy: 2, site: 'sabordacarioca.com.br/botafogo', regions: ['Botafogo'], since: '2026-03-04', status: 'active', parent: 'c_rede' }
  ];

  const clients = clientsRaw.map(function (c) {
    return {
      id: c.id, organizationId: c.org || 'org_1', portfolioId: c.pf,
      parentClientId: c.parent || null, isNetwork: !!c.isNetwork,
      name: c.name, segment: c.segment,
      model: c.model, ownerUserId: c.owner, monthlyBudget: c.budget, ticket: c.ticket,
      autonomyLevel: c.autonomy, site: c.site, regions: c.regions, since: c.since, status: c.status,
      goalCpl: c.model === 'leads' ? Math.round(c.ticket * 0.03) : null,
      goalRoas: c.model === 'ecommerce' ? 4 : null,
      onboardingStep: c.status === 'onboarding' ? 3 : 6
    };
  });

  const members = [
    { id: 'm_1', organizationId: 'org_1', userId: 'u_owner', scopeType: 'organization', scopeId: null, role: 'owner', status: 'active', seatType: 'full', grantedBy: 'u_owner', grantedAt: at(430, 9, 0), expiresAt: null },
    { id: 'm_2', organizationId: 'org_1', userId: 'u_admin', scopeType: 'organization', scopeId: null, role: 'admin', status: 'active', seatType: 'full', grantedBy: 'u_owner', grantedAt: at(400, 9, 0), expiresAt: null },
    { id: 'm_3', organizationId: 'org_1', userId: 'u_rafael', scopeType: 'portfolio', scopeId: 'pf_1', role: 'manager', status: 'active', seatType: 'full', grantedBy: 'u_admin', grantedAt: at(300, 9, 0), expiresAt: null },
    { id: 'm_4', organizationId: 'org_1', userId: 'u_rafael', scopeType: 'client', scopeId: 'c_verde', role: 'manager', status: 'active', seatType: 'full', grantedBy: 'u_admin', grantedAt: at(120, 9, 0), expiresAt: null },
    { id: 'm_5', organizationId: 'org_1', userId: 'u_rafael', scopeType: 'ad_account', scopeId: 'acc_odonto_meta', role: 'analyst', status: 'active', seatType: 'full', grantedBy: 'u_juliana', grantedAt: at(40, 9, 0), expiresAt: null },
    { id: 'm_6', organizationId: 'org_1', userId: 'u_juliana', scopeType: 'portfolio', scopeId: 'pf_2', role: 'manager', status: 'active', seatType: 'full', grantedBy: 'u_admin', grantedAt: at(280, 9, 0), expiresAt: null },
    { id: 'm_7', organizationId: 'org_1', userId: 'u_juliana', scopeType: 'client', scopeId: 'c_alvorada', role: 'manager', status: 'active', seatType: 'full', grantedBy: 'u_admin', grantedAt: at(60, 9, 0), expiresAt: null },
    { id: 'm_8', organizationId: 'org_1', userId: 'u_diego', scopeType: 'portfolio', scopeId: 'pf_3', role: 'analyst', status: 'active', seatType: 'full', grantedBy: 'u_admin', grantedAt: at(200, 9, 0), expiresAt: null },
    { id: 'm_9', organizationId: 'org_1', userId: 'u_diego', scopeType: 'client', scopeId: 'c_flora', role: 'analyst', status: 'active', seatType: 'full', grantedBy: 'u_rafael', grantedAt: at(90, 9, 0), expiresAt: null },
    { id: 'm_10', organizationId: 'org_1', userId: 'u_leticia', scopeType: 'ad_account', scopeId: 'acc_nutri_meta', role: 'partner', status: 'active', seatType: 'light', grantedBy: 'u_rafael', grantedAt: at(20, 9, 0), expiresAt: at(-40, 9, 0) },
    { id: 'm_11', organizationId: 'org_1', userId: 'u_leticia', scopeType: 'ad_account', scopeId: 'acc_pet_meta', role: 'partner', status: 'active', seatType: 'light', grantedBy: 'u_rafael', grantedAt: at(20, 9, 0), expiresAt: at(-40, 9, 0) },
    { id: 'm_12', organizationId: 'org_1', userId: 'u_ana', scopeType: 'client', scopeId: 'c_flora', role: 'client', status: 'active', seatType: 'client_portal', grantedBy: 'u_rafael', grantedAt: at(150, 9, 0), expiresAt: null },
    { id: 'm_13', organizationId: 'org_1', userId: 'u_carlos', scopeType: 'client', scopeId: 'c_odonto', role: 'client', status: 'invited', seatType: 'client_portal', grantedBy: 'u_juliana', grantedAt: at(7, 10, 14), expiresAt: null },
    { id: 'm_14', organizationId: 'org_2', userId: 'u_paulo', scopeType: 'organization', scopeId: null, role: 'owner', status: 'active', seatType: 'full', grantedBy: 'u_paulo', grantedAt: at(53, 9, 0), expiresAt: null },
    { id: 'm_15', organizationId: 'org_1', userId: 'u_sandra', scopeType: 'client', scopeId: 'c_rede_tj', role: 'client', status: 'active', seatType: 'client_portal', grantedBy: 'u_juliana', grantedAt: at(90, 10, 0), expiresAt: null },
    { id: 'm_16', organizationId: 'org_1', userId: 'u_sandra', scopeType: 'client', scopeId: 'c_rede_bz', role: 'client', status: 'active', seatType: 'client_portal', grantedBy: 'u_juliana', grantedAt: at(90, 10, 2), expiresAt: null },
    { id: 'm_17', organizationId: 'org_1', userId: 'u_helena', scopeType: 'client', scopeId: 'c_rede', role: 'client', status: 'active', seatType: 'client_portal', grantedBy: 'u_juliana', grantedAt: at(120, 9, 0), expiresAt: null },
    { id: 'm_18', organizationId: 'org_1', userId: 'u_vitor', scopeType: 'portfolio', scopeId: 'pf_1', role: 'analyst', status: 'active', seatType: 'light', grantedBy: 'u_admin', grantedAt: at(15, 9, 0), expiresAt: at(-75, 9, 0) },
    { id: 'm_19', organizationId: 'org_2', userId: 'u_vitor', scopeType: 'organization', scopeId: null, role: 'analyst', status: 'active', seatType: 'light', grantedBy: 'u_paulo', grantedAt: at(12, 9, 0), expiresAt: at(-78, 9, 0) }
  ];

  const connections = [
    {
      id: 'conn_mcc', organizationId: 'org_1', platform: 'google', grantType: 'mcc', owner: 'organization',
      name: 'MCC da agência', externalId: '812-445-9031', status: 'active', discovered: 14, linked: 11,
      scopes: ['adwords', 'datamanager'], secretRef: 'secret://org_1/google-mcc-refresh',
      authorizedBy: 'u_admin', authorizedAt: at(300, 10, 0), lastRefreshedAt: at(0, 6, 0), expiresInDays: 132,
      note: 'Developer token da própria agência, nível Standard.'
    },
    {
      id: 'conn_bm', organizationId: 'org_1', platform: 'meta', grantType: 'bm_partner', owner: 'organization',
      name: 'Business Manager da agência', externalId: '1094887233', status: 'expiring', discovered: 16, linked: 13,
      scopes: ['ads_read', 'ads_management', 'business_management', 'leads_retrieval'], secretRef: 'secret://org_1/meta-system-user',
      authorizedBy: 'u_admin', authorizedAt: at(300, 10, 20), lastRefreshedAt: at(12, 4, 0), expiresInDays: 47,
      note: 'Token de usuário do sistema, não de pessoa. Clientes concedem acesso de parceiro ao BM da agência.'
    },
    {
      id: 'conn_flora_outlet', organizationId: 'org_1', platform: 'meta', grantType: 'system_user', owner: 'organization',
      name: 'Loja Flora — autorização direta (Outlet)', externalId: '7781093442', status: 'revoked', discovered: 1, linked: 1,
      scopes: ['ads_read', 'ads_management'], secretRef: 'secret://org_1/meta-flora-outlet',
      authorizedBy: 'u_rafael', authorizedAt: at(120, 15, 0), lastRefreshedAt: at(4, 6, 3), expiresInDays: 0,
      note: 'OAuthException 190 — o cliente revogou ou o token venceu. Reautorização pendente.'
    },
    {
      id: 'conn_alvorada', organizationId: 'org_1', platform: 'meta', grantType: 'system_user', owner: 'organization',
      name: 'Instituto Alvorada — autorização direta', externalId: '5520118830', status: 'reauth_pending', discovered: 1, linked: 1,
      scopes: ['ads_read', 'ads_management'], secretRef: 'secret://org_1/meta-alvorada',
      authorizedBy: 'u_diego', authorizedAt: at(80, 11, 0), lastRefreshedAt: at(4, 6, 3), expiresInDays: 0,
      note: 'Link de reautorização enviado ao cliente há 4 dias · 1 lembrete.'
    },
    {
      id: 'conn_pizza_g', organizationId: 'org_2', platform: 'google', grantType: 'mcc', owner: 'organization',
      name: 'MCC próprio (conta administradora do anunciante)', externalId: '701-338-2240', status: 'active', discovered: 1, linked: 1,
      scopes: ['adwords'], secretRef: 'secret://org_2/google-mcc-refresh',
      authorizedBy: 'u_paulo', authorizedAt: at(53, 9, 20), lastRefreshedAt: at(0, 6, 10), expiresInDays: 180,
      note: 'Developer token do próprio anunciante, nível Basic. O login segue sendo a conta normal dele.'
    },
    {
      id: 'conn_pizza_m', organizationId: 'org_2', platform: 'meta', grantType: 'system_user', owner: 'organization',
      name: 'Meta — conta própria', externalId: '9921004412', status: 'active', discovered: 2, linked: 1,
      scopes: ['ads_read', 'ads_management'], secretRef: 'secret://org_2/meta-oauth',
      authorizedBy: 'u_paulo', authorizedAt: at(53, 9, 32), lastRefreshedAt: at(0, 6, 12), expiresInDays: 58,
      note: 'Login for Business — token de usuário do sistema.'
    }
  ];

  const platformApprovals = [
    { id: 'pa_1', scope: 'tria', item: 'App OAuth do Google verificado', status: 'approved', note: 'Consentimento público liberado — refresh token de longa duração', since: at(210, 9, 0) },
    { id: 'pa_2', scope: 'tria', item: 'Developer token da tria', status: 'nao_aplicavel', note: 'A tria nunca usa token próprio para tráfego de cliente — o token é sempre da organização', since: at(190, 9, 0) },
    { id: 'pa_3', scope: 'tria', item: 'Meta — Business Verification', status: 'approved', note: 'Pré-requisito do App Review', since: at(180, 9, 0) },
    { id: 'pa_4', scope: 'tria', item: 'Meta — App Review dos escopos de anúncios', status: 'approved', note: 'ads_management, business_management, leads_retrieval', since: at(150, 9, 0) },
    { id: 'pa_5', scope: 'tria', item: 'Meta — Standard Access', status: 'pending', note: 'Em development access o backfill esbarra em limite de chamadas', since: at(30, 9, 0) },
    { id: 'pa_6', scope: 'org_1', item: 'MCC próprio da agência', status: 'approved', note: '812-445-9031 · 14 contas acessíveis', since: at(300, 9, 0) },
    { id: 'pa_7', scope: 'org_1', item: 'Developer token da agência', status: 'approved', note: 'Quota isolada da agência', since: at(295, 9, 0) },
    { id: 'pa_8', scope: 'org_1', item: 'Business Manager próprio', status: 'approved', note: 'Caminho de parceria com os clientes', since: at(300, 9, 0) },
    { id: 'pa_9', scope: 'org_2', item: 'MCC próprio (gratuito, só para abrigar o token)', status: 'approved', note: '701-338-2240 · criado no onboarding', since: at(53, 9, 0) },
    { id: 'pa_10', scope: 'org_2', item: 'Developer token do anunciante', status: 'approved', note: 'Nível Basic — suficiente para uma operação', since: at(52, 9, 0) },
    { id: 'pa_11', scope: 'org_2', item: 'Upgrade para Standard', status: 'pending', note: 'Só necessário se o volume de chamadas crescer', since: at(10, 9, 0) }
  ];

  const accountSpecs = [
    ['c_flora', 'meta', 'Principal', 'mcc', 'connected'], ['c_flora', 'meta', 'Outlet', 'direct', 'error'], ['c_flora', 'google', 'Principal', 'mcc', 'connected'],
    ['c_nutri', 'meta', 'Principal', 'mcc', 'connected'], ['c_nutri', 'meta', 'Marca', 'direct', 'connected'], ['c_nutri', 'google', 'Assinatura', 'mcc', 'connected'],
    ['c_pet', 'meta', 'Principal', 'mcc', 'connected'], ['c_pet', 'google', 'Shopping', 'mcc', 'connected'],
    ['c_casa', 'meta', 'Principal', 'direct', 'connected'], ['c_casa', 'google', 'Principal', 'mcc', 'connected'],
    ['c_odonto', 'meta', 'Principal', 'mcc', 'connected'], ['c_odonto', 'google', 'Principal', 'mcc', 'connected'],
    ['c_bronze', 'meta', 'Principal', 'direct', 'connected'],
    ['c_vet', 'meta', 'Principal', 'mcc', 'connected'], ['c_vet', 'google', 'Principal', 'mcc', 'connected'],
    ['c_verde', 'meta', 'Principal', 'mcc', 'connected'], ['c_verde', 'google', 'Principal', 'mcc', 'connected'], ['c_verde', 'google', 'Showroom SC', 'mcc', 'connected'],
    ['c_alvorada', 'meta', 'Principal', 'direct', 'error'], ['c_alvorada', 'google', 'Principal', 'mcc', 'connected'],
    ['c_ramos', 'meta', 'Principal', 'direct', 'connected'], ['c_ramos', 'google', 'Principal', 'mcc', 'pending'],
    ['c_pizza', 'google', 'Principal', 'direct', 'connected'], ['c_pizza', 'meta', 'Principal', 'direct', 'connected'],
    ['c_burger', 'meta', 'Principal', 'direct', 'connected'],
    ['c_rede', 'meta', 'Marca', 'mcc', 'connected'], ['c_rede', 'google', 'Marca', 'mcc', 'connected'],
    ['c_rede_tj', 'meta', 'Filial', 'mcc', 'connected'], ['c_rede_bz', 'meta', 'Filial', 'mcc', 'connected'],
    ['c_rede_ip', 'meta', 'Filial', 'mcc', 'connected'], ['c_rede_mr', 'meta', 'Filial', 'mcc', 'connected'],
    ['c_rede_nt', 'meta', 'Filial', 'mcc', 'connected'], ['c_rede_bg', 'meta', 'Filial', 'mcc', 'connected'],
    ['c_rede_tj', 'google', 'Filial', 'mcc', 'connected'], ['c_rede_bz', 'google', 'Filial', 'mcc', 'connected']
  ];

  const shortId = { c_flora: 'flora', c_nutri: 'nutri', c_pet: 'pet', c_casa: 'casa', c_odonto: 'odonto', c_bronze: 'bronze', c_vet: 'vet', c_verde: 'verde', c_alvorada: 'alvorada', c_ramos: 'ramos', c_pizza: 'pizza', c_burger: 'burger',
    c_rede: 'rede', c_rede_tj: 'redetj', c_rede_bz: 'redebz', c_rede_ip: 'redeip', c_rede_mr: 'redemr', c_rede_nt: 'redent', c_rede_bg: 'redebg' };

  const adAccounts = accountSpecs.map(function (s, i) {
    const clientId = s[0], platform = s[1], group = s[2], access = s[3], status = s[4];
    const c = clients.find(function (x) { return x.id === clientId; });
    const base = 'acc_' + shortId[clientId] + '_' + platform;
    const id = group === 'Principal' ? base : base + '_' + group.toLowerCase().replace(/[^a-z0-9]/g, '');
    return {
      id: id, organizationId: c.organizationId, clientId: clientId, platform: platform, group: group,
      name: (platform === 'meta' ? 'Meta — ' : 'Google — ') + c.name + ' | ' + group,
      externalId: platform === 'meta' ? 'act_' + rng.int(1000000000, 9999999999) : [rng.int(100, 999), rng.int(100, 999), rng.int(1000, 9999)].join('-'),
      accessType: access,
      connectionId: c.organizationId === 'org_2' ? (platform === 'google' ? 'conn_pizza_g' : 'conn_pizza_m')
        : access === 'mcc' ? (platform === 'google' ? 'conn_mcc' : 'conn_bm')
          : clientId === 'c_flora' ? 'conn_flora_outlet' : clientId === 'c_alvorada' ? 'conn_alvorada' : 'conn_bm',
      status: status, currency: 'BRL', timezone: 'America/Sao_Paulo',
      scopes: platform === 'meta' ? ['ads_read', 'ads_management', 'business_management'] : ['adwords.read', 'adwords.manage'],
      lastSyncAt: status === 'error' ? at(4, 6, 3) : at(0, 6, 30 + (i % 20)),
      syncRows: status === 'error' ? 0 : rng.int(380, 1600),
      error: status === 'error' ? (platform === 'meta' ? 'OAuthException 190 — token expirado. Sincronização parada há 4 dias.' : 'Permissão insuficiente para leitura de insights.') : null,
      pendingSince: status === 'pending' ? at(6, 10, 0) : null,
      inviteLink: status === 'pending' ? 'https://tria.app/connect/' + shortId[clientId] + '-8831' : null
    };
  });

  const campaignTemplates = {
    ecommerce: [
      ['meta', 'Aquisição | Catálogo', 'Vendas', .30], ['meta', 'Remarketing | Carrinho', 'Vendas', .13],
      ['meta', 'Prospecção | Vídeo', 'Tráfego', .10], ['google', 'Performance Max', 'Vendas', .23],
      ['google', 'Pesquisa | Marca', 'Vendas', .08], ['google', 'Shopping | Geral', 'Vendas', .16]
    ],
    leads: [
      ['meta', 'Geração de leads | Oferta', 'Leads', .30], ['meta', 'Remarketing | Formulário', 'Leads', .12],
      ['meta', 'Reconhecimento | Local', 'Alcance', .09], ['google', 'Pesquisa | Serviço', 'Leads', .29],
      ['google', 'Pesquisa | Marca', 'Leads', .08], ['google', 'Display | Remarketing', 'Leads', .12]
    ]
  };

  const campaigns = [];
  clients.forEach(function (c) {
    const accs = adAccounts.filter(function (a) { return a.clientId === c.id; });
    campaignTemplates[c.model].forEach(function (t, k) {
      const sameP = accs.filter(function (a) { return a.platform === t[0]; });
      if (!sameP.length) return;
      const acc = sameP[k % sameP.length];
      const paused = c.status === 'paused' || (c.id === 'c_alvorada' && k === 2) || (c.id === 'c_flora' && k === 4);
      campaigns.push({
        id: 'cmp_' + shortId[c.id] + '_' + (k + 1), organizationId: c.organizationId, clientId: c.id,
        adAccountId: acc.id, platform: t[0], name: (t[0] === 'meta' ? 'Meta — ' : 'Google — ') + t[1],
        objective: t[2], status: paused ? 'paused' : 'active',
        budgetDaily: Math.round((c.monthlyBudget * t[3]) / 30), share: t[3],
        startDate: day(rng.int(40, 260)), marketingCampaignId: null
      });
    });
  });

  const bench = { ecommerce: { cpm: 24, ctr: .013, cvr: .021 }, leads: { cpm: 31, ctr: .021, cvr: .075 } };
  const daily = [];
  const DAYS = 90;
  campaigns.forEach(function (cmp) {
    const c = clients.find(function (x) { return x.id === cmp.clientId; });
    const b = bench[c.model];
    const trend = c.id === 'c_alvorada' ? -.5 : c.id === 'c_odonto' ? -.18 : c.id === 'c_casa' ? -.3 : .25;
    for (let d = DAYS - 1; d >= 0; d--) {
      const prog = (DAYS - d) / DAYS;
      const wd = addDays(TODAY, -d).getDay();
      const weekend = (wd === 0 || wd === 6) ? .82 : 1;
      const paused = cmp.status === 'paused' && d < 12;
      const spend = paused ? 0 : rng.wobble(cmp.budgetDaily, .22) * weekend;
      const cpm = rng.wobble(b.cpm * (1 - trend * prog * .18), .12);
      const impressions = spend === 0 ? 0 : Math.round((spend / cpm) * 1000);
      const ctr = rng.wobble(b.ctr * (1 + trend * prog * .3), .15);
      const clicks = Math.round(impressions * ctr);
      const cvr = rng.wobble(b.cvr * (1 + trend * prog * .35), .2);
      const declared = Math.max(0, Math.round(clicks * cvr));
      const confirmed = Math.round(declared * rng.float(.72, .93));
      const revenue = c.model === 'ecommerce' ? declared * rng.wobble(c.ticket, .1) : 0;
      daily.push({
        date: day(d), clientId: cmp.clientId, campaignId: cmp.id, adAccountId: cmp.adAccountId, platform: cmp.platform,
        spend: Math.round(spend * 100) / 100, impressions: impressions, clicks: clicks,
        conversions: declared, conversionsConfirmed: confirmed,
        leads: c.model === 'leads' ? declared : 0, leadsQualified: c.model === 'leads' ? Math.round(declared * rng.float(.28, .52)) : 0,
        purchases: c.model === 'ecommerce' ? declared : 0,
        revenue: Math.round(revenue * 100) / 100,
        revenueConfirmed: Math.round(revenue * rng.float(.78, .95) * 100) / 100,
        frequency: Math.round(rng.float(1.3, 3.5) * 100) / 100
      });
    }
  });

  const wasteIds = ['cmp_alvorada_2', 'cmp_odonto_3', 'cmp_casa_3', 'cmp_vet_3'];
  daily.forEach(function (r) {
    if (wasteIds.indexOf(r.campaignId) >= 0 && r.date >= day(6)) {
      r.conversions = 0; r.conversionsConfirmed = 0; r.leads = 0; r.leadsQualified = 0; r.purchases = 0; r.revenue = 0; r.revenueConfirmed = 0;
    }
  });

  campaigns.forEach(function (cmp) {
    const rows = daily.filter(function (r) { return r.campaignId === cmp.id && r.date >= day(13); });
    const spend = rows.reduce(function (a, r) { return a + r.spend; }, 0);
    const conv = rows.reduce(function (a, r) { return a + r.conversions; }, 0);
    const rev = rows.reduce(function (a, r) { return a + r.revenue; }, 0);
    const strong = (rev && spend && rev / spend >= 5) || (conv > 0 && spend / conv < 60);
    cmp.budgetLimited = strong && rng.bool(.6);
    cmp.impressionShareLost = cmp.budgetLimited ? rng.int(21, 38) : rng.int(2, 15);
  });

  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  const investments = [];
  clients.forEach(function (c) {
    months.forEach(function (m, i) {
      const planned = Math.round(c.monthlyBudget * (.85 + i * .03));
      const current = i === months.length - 1;
      investments.push({
        clientId: c.id, month: m, planned: planned,
        spent: current ? Math.round(planned * rng.float(.18, .28)) : Math.round(planned * rng.float(.93, 1.02)),
        fee: Math.round(planned * .15), status: current ? 'em_curso' : 'fechado'
      });
    });
  });

  const reconciliation = clients.map(function (c) {
    const rows = daily.filter(function (r) { return r.clientId === c.id && r.date >= day(29); });
    const declared = rows.reduce(function (a, r) { return a + r.conversions; }, 0);
    const confirmed = rows.reduce(function (a, r) { return a + r.conversionsConfirmed; }, 0);
    const gap = declared ? (declared - confirmed) / declared : 0;
    return {
      clientId: c.id, declared: declared, confirmed: confirmed, gap: gap,
      source: c.model === 'ecommerce' ? 'Plataforma de e-commerce' : 'CRM',
      status: gap > .3 ? 'alerta' : gap > .2 ? 'atencao' : 'ok', checkedAt: at(0, 6, 55)
    };
  });

  const auditChecks = [
    ['conversion_tracking', 'Rastreamento de conversão', 20], ['negative_keywords', 'Palavras-chave negativas', 12],
    ['budget_pacing', 'Ritmo de orçamento', 16], ['ad_coverage', 'Cobertura de anúncios por grupo', 12],
    ['audience_overlap', 'Sobreposição de públicos', 10], ['creative_fatigue', 'Fadiga de criativo', 14],
    ['naming_convention', 'Padrão de nomenclatura', 6], ['account_structure', 'Estrutura da conta', 10]
  ];
  const auditNotes = {
    conversion_tracking: ['Conversões primárias configuradas e recebendo eventos.', 'Duas conversões secundárias sem evento há 14 dias.', 'Conversão principal sem evento há 9 dias.'],
    negative_keywords: ['Lista de negativas aplicada em todas as campanhas de pesquisa.', 'Campanha de marca sem lista compartilhada.', '17 termos irrelevantes com gasto e nenhuma conversão.'],
    budget_pacing: ['Ritmo dentro de 5% do planejado.', 'Projeção fecha 12% abaixo do orçamento.', 'Campanha bate o teto diário em 68% dos dias.'],
    ad_coverage: ['Todos os grupos com ao menos 3 anúncios.', '2 grupos com um único anúncio ativo.', '5 grupos sem anúncio responsivo.'],
    audience_overlap: ['Sobreposição abaixo de 15% entre conjuntos.', 'Sobreposição de 28% entre dois conjuntos de prospecção.', 'Sobreposição de 54% elevando o CPM.'],
    creative_fatigue: ['Frequência média abaixo de 2,2.', 'Dois criativos acima de 3,0 de frequência.', 'Criativo principal com 21 dias no ar e CTR em queda.'],
    naming_convention: ['Nomenclatura padronizada.', '3 campanhas fora do padrão da agência.', 'Sem padrão identificável, dificulta relatório cross-account.'],
    account_structure: ['Estrutura enxuta e coerente com o objetivo.', 'Campanhas duplicadas competindo no mesmo leilão.', 'Fragmentação: 14 campanhas com menos de R$ 20/dia.']
  };
  const accountAudits = adAccounts.map(function (a) {
    const findings = auditChecks.map(function (ch) {
      const r = rng.next();
      const st = r > .74 ? 'fail' : r > .48 ? 'warn' : 'pass';
      return { key: ch[0], label: ch[1], weight: ch[2], status: st, note: auditNotes[ch[0]][st === 'pass' ? 0 : st === 'warn' ? 1 : 2] };
    });
    const lost = findings.reduce(function (acc, f) { return acc + (f.status === 'fail' ? f.weight : f.status === 'warn' ? f.weight * .4 : 0); }, 0);
    return { accountId: a.id, clientId: a.clientId, score: Math.max(28, Math.round(100 - lost)), runAt: at(rng.int(0, 5), 4, 0), findings: findings };
  });

  const bulkOperations = [
    { id: 'bo_1', label: 'Pausar campanhas sem conversão em 14 dias', scope: 'Portfólio E-commerce · 4 clientes', targets: 7, status: 'pending', createdBy: 'u_rafael', createdAt: at(0, 10, 12), preview: '7 campanhas, R$ 4.820 de investimento mensal afetado' },
    { id: 'bo_2', label: 'Aplicar lista de negativas compartilhada', scope: 'Todas as contas Google Ads', targets: 11, status: 'applied', createdBy: 'u_juliana', createdAt: at(3, 9, 0), preview: '11 campanhas de pesquisa atualizadas' },
    { id: 'bo_3', label: 'Aumentar orçamento 10% em campanhas com ROAS > 4', scope: 'Portfólio E-commerce', targets: 5, status: 'applied', createdBy: 'agent', createdAt: at(8, 7, 10), preview: 'R$ 1.340/dia redistribuídos' },
    { id: 'bo_4', label: 'Padronizar nomenclatura de campanhas', scope: 'Instituto Alvorada', targets: 6, status: 'failed', createdBy: 'u_diego', createdAt: at(4, 15, 30), preview: 'Falhou: token da conta Meta expirado' }
  ];

  const agentsRoster = [
    { id: 'ag_orch', short: 'OR', name: 'AI Orchestrator', role: 'Lê o briefing, consulta o contexto e distribui o trabalho entre os agentes.', status: 'active', runs: 128, lastRun: at(0, 7, 0) },
    { id: 'ag_research', short: 'MR', name: 'Market Research Agent', role: 'Concorrentes, ofertas, público, tendências e palavras-chave, com fonte e classificação.', status: 'active', runs: 34, lastRun: at(1, 3, 0) },
    { id: 'ag_strategy', short: 'ST', name: 'Strategy Agent', role: 'Plano de mídia: estrutura, canais, verba, segmentação, criativos, KPIs e hipóteses.', status: 'active', runs: 41, lastRun: at(0, 11, 20) },
    { id: 'ag_campaign', short: 'CA', name: 'Campaign Agent', role: 'Monta campanhas, conjuntos, públicos, palavras-chave e anúncios nas contas.', status: 'limited', runs: 52, lastRun: at(0, 12, 10) },
    { id: 'ag_policy', short: 'PX', name: 'Policy & Execution Engine', role: 'Valida limites e permissões, publica pelas APIs via n8n e verifica o resultado.', status: 'active', runs: 63, lastRun: at(0, 13, 5) },
    { id: 'ag_performance', short: 'PF', name: 'Performance Agent', role: 'Monitoramento contínuo, diagnóstico, anomalia e recomendação de otimização.', status: 'active', runs: 486, lastRun: at(0, 7, 12) },
    { id: 'ag_portfolio', short: 'PI', name: 'Portfolio Intelligence Agent', role: 'Mede resultado contra o KPI, registra aprendizado e compara com a carteira.', status: 'active', runs: 22, lastRun: at(0, 7, 30) }
  ];

  const pipelineStages = [
    { id: 'st_brief', position: 1, name: 'Briefing', kind: 'human', agentId: null, slaHours: 48, desc: 'Objetivo de negócio, verba e período. Preenchido por pessoa ou gerado pelo agente.' },
    { id: 'st_orch', position: 2, name: 'AI Orchestrator', kind: 'agent', agentId: 'ag_orch', slaHours: 2, desc: 'Lê o briefing, consulta o contexto e decide quais agentes acionar.' },
    { id: 'st_research', position: 3, name: 'Market Research', kind: 'agent', agentId: 'ag_research', slaHours: 24, desc: 'Concorrentes, ofertas, público, tendências e palavras-chave.' },
    { id: 'st_strategy', position: 4, name: 'Strategy', kind: 'agent', agentId: 'ag_strategy', slaHours: 24, desc: 'Plano de mídia com estrutura, verba, KPIs e hipóteses.' },
    { id: 'st_approval', position: 5, name: 'Aprovação', kind: 'human', agentId: null, slaHours: 24, desc: 'Gestor aprova, pede ajuste ou recusa. Verba e metas confirmadas aqui.' },
    { id: 'st_build', position: 6, name: 'Campaign Agent', kind: 'agent', agentId: 'ag_campaign', slaHours: 12, desc: 'Monta campanhas, conjuntos, públicos e anúncios nas contas.' },
    { id: 'st_publish', position: 7, name: 'Policy & Execution', kind: 'agent', agentId: 'ag_policy', slaHours: 4, desc: 'Valida limites, publica pelas APIs via n8n e verifica.' },
    { id: 'st_live', position: 8, name: 'Performance Agent', kind: 'agent', agentId: 'ag_performance', slaHours: null, desc: 'No ar. Monitoramento contínuo e recomendações de otimização.' },
    { id: 'st_learn', position: 9, name: 'Portfolio Intelligence', kind: 'agent', agentId: 'ag_portfolio', slaHours: 72, desc: 'Mede contra o KPI, registra aprendizado e arquiva.' }
  ];

  const mcSpecs = [
    ['mk_1', 'c_flora', 'Black Friday 2026', 'vendas', 48000, 'st_approval', 'agent', 'u_rafael', 30, 'manual', 'Aprovar plano de mídia', '01/11 a 30/11', { roas: 4.2 }],
    ['mk_2', 'c_nutri', 'Assinatura — captação Q4', 'vendas', 22000, 'st_live', 'agent', 'u_rafael', 420, 'agent', 'Monitorando 6 campanhas', '15/10 a 15/12', { roas: 5 }],
    ['mk_3', 'c_odonto', 'Implante — demanda de fim de ano', 'leads', 18000, 'st_strategy', 'agent', 'u_juliana', 9, 'agent', 'Montando plano de mídia', '15/11 a 31/12', { cpl: 95, volume: 190 }],
    ['mk_4', 'c_alvorada', 'Matrículas turma de março', 'leads', 40000, 'st_research', 'agent', 'u_diego', 16, 'agent', 'Pesquisando concorrentes', '01/12 a 28/02', { cpl: 87, volume: 120 }],
    ['mk_5', 'c_verde', 'Showroom SC — inauguração', 'leads', 26000, 'st_build', 'manual', 'u_rafael', 6, 'agent', 'Montando 5 campanhas', '20/11 a 20/01', { cpl: 384, volume: 68 }],
    ['mk_6', 'c_pet', 'Clube de assinatura — ração', 'vendas', 14000, 'st_live', 'manual', 'u_rafael', 960, 'agent', 'Monitorando 4 campanhas', '01/10 a 31/12', { roas: 3.6 }],
    ['mk_7', 'c_casa', 'Lançamento linha Inverno', 'vendas', 18500, 'st_brief', 'manual', 'u_rafael', 52, 'manual', 'Completar briefing e verba', 'a definir', { roas: 4 }],
    ['mk_8', 'c_vet', 'Emergência 24h — always on', 'leads', 11400, 'st_live', 'manual', 'u_juliana', 1440, 'agent', 'Monitorando 5 campanhas', 'contínua', { cpl: 23, volume: 420 }],
    ['mk_9', 'c_flora', 'Remarketing de carrinho — reestruturação', 'vendas', 7000, 'st_approval', 'agent', 'u_rafael', 4, 'manual', 'Aprovar aumento de verba', '10/11 a 10/12', { roas: 6 }],
    ['mk_10', 'c_ramos', 'Captação previdenciário — entrada', 'leads', 9800, 'st_brief', 'manual', 'u_diego', 144, 'blocked', 'Conta Google aguardando autorização', 'a definir', { cpl: 156, volume: 48 }],
    ['mk_11', 'c_nutri', 'Creatina — bundle de verão', 'vendas', 9000, 'st_publish', 'agent', 'u_rafael', 3, 'agent', 'Publicando nas contas', '08/11 a 31/01', { roas: 4.8 }],
    ['mk_12', 'c_odonto', 'Ortodontia — captação local', 'leads', 6400, 'st_orch', 'agent', 'u_juliana', 1, 'agent', 'Distribuindo tarefas', '15/11 a 15/01', { cpl: 110, volume: 60 }],
    ['mk_13', 'c_alvorada', 'Rematrícula — base atual', 'leads', 8200, 'st_approval', 'agent', 'u_diego', 50, 'blocked', 'Contexto do cliente em 38%', '01/12 a 20/12', { cpl: 64, volume: 90 }],
    ['mk_14', 'c_flora', 'Dia das Mães 2026', 'vendas', 36000, 'st_learn', 'agent', 'u_rafael', 20, 'agent', 'Consolidando aprendizado', '20/04 a 12/05', { roas: 4.5 }],
    ['mk_15', 'c_bronze', 'Retomada verão', 'leads', 7200, 'st_brief', 'manual', 'u_juliana', 200, 'manual', 'Cliente pausado — confirmar retorno', 'a definir', { cpl: 54, volume: 80 }],
    ['mk_16', 'c_pet', 'Shopping — catálogo de inverno', 'vendas', 6800, 'st_research', 'agent', 'u_rafael', 20, 'agent', 'Pesquisando mercado', '25/11 a 31/01', { roas: 3.2 }],
    ['mk_17', 'c_rede', 'Fim de ano — rede inteira', 'leads', 60000, 'st_approval', 'agent', 'u_juliana', 18, 'manual', 'Aprovar plano da rede', '01/12 a 05/01', { cpl: 32, volume: 1400 }, 'client_tree'],
    ['mk_18', 'c_rede_ip', 'Verão em Ipanema', 'leads', 9000, 'st_live', 'manual', 'u_juliana', 320, 'agent', 'Monitorando 4 campanhas', '15/11 a 28/02', { cpl: 28, volume: 320 }, 'client'],
    ['mk_19', 'c_burger', 'Lançamento do segundo negócio', 'leads', 4200, 'st_strategy', 'agent', 'u_paulo', 5, 'agent', 'Montando plano de mídia', '20/11 a 20/01', { cpl: 18, volume: 230 }, 'client']
  ];

  function descendants(clientId) {
    const direct = clients.filter(function (x) { return x.parentClientId === clientId; });
    return direct.reduce(function (acc, x) { return acc.concat([x.id], descendants(x.id)); }, []);
  }

  const marketingCampaigns = mcSpecs.map(function (s) {
    const c = clients.find(function (x) { return x.id === s[1]; });
    const stage = pipelineStages.find(function (x) { return x.id === s[5]; });
    const scopeType = s[13] || 'client';
    const reach = scopeType === 'client_tree' ? [c.id].concat(descendants(c.id)) : [c.id];
    const accs = adAccounts.filter(function (a) { return reach.indexOf(a.clientId) >= 0; });
    const live = s[5] === 'st_live' || s[5] === 'st_learn';
    const child = live ? campaigns.filter(function (cp) { return reach.indexOf(cp.clientId) >= 0; }).slice(0, s[5] === 'st_learn' ? 4 : 6) : [];
    child.forEach(function (cp) { cp.marketingCampaignId = s[0]; });
    const pending = s[9];
    return {
      id: s[0], organizationId: c.organizationId, clientId: c.id, portfolioId: c.portfolioId,
      scopeType: scopeType, reachClientIds: reach,
      name: s[2], objective: s[3], model: c.model, budgetTotal: s[4],
      budgetAllocated: live ? Math.round(s[4] * rng.float(.55, .92)) : s[5] === 'st_publish' ? s[4] : 0,
      period: s[11], stageId: s[5], stageName: stage.name, stageSince: hoursAgo(s[8]),
      origin: s[6], ownerUserId: s[7],
      platforms: Array.from(new Set(accs.map(function (a) { return a.platform; }))),
      adAccountIds: accs.map(function (a) { return a.id; }),
      childCampaignIds: child.map(function (cp) { return cp.id; }),
      targetKpis: s[12],
      status: pending === 'blocked' ? 'bloqueada' : stage.kind === 'human' ? 'aguardando_humano' : s[5] === 'st_live' ? 'no_ar' : s[5] === 'st_learn' ? 'encerrada' : 'em_fluxo',
      pendingAction: { kind: pending, label: s[10], who: pending === 'manual' ? s[7] : stage.agentId },
      blockedReason: pending === 'blocked' ? s[10] : null,
      createdBy: s[6] === 'agent' ? 'ag_orch' : s[7],
      createdAt: at(rng.int(3, 40), 10, 0),
      brief: briefFor(c, s[2], s[3], s[4])
    };
  });

  function briefFor(c, name, objective, budget) {
    if (objective === 'leads') return 'Gerar leads qualificados para ' + c.name + ' com verba de R$ ' + budget.toLocaleString('pt-BR') + ', priorizando ' + c.regions.join(' e ') + '. Lead precisa chegar ao time comercial com telefone válido e interesse declarado.';
    return 'Aumentar receita de ' + c.name + ' com verba de R$ ' + budget.toLocaleString('pt-BR') + ', mantendo o ROAS acima da meta e respeitando estoque e capacidade de atendimento.';
  }

  const pipelineEvents = [];
  marketingCampaigns.forEach(function (mc) {
    const idx = pipelineStages.findIndex(function (s) { return s.id === mc.stageId; });
    let h = 0;
    for (let i = 0; i <= idx; i++) {
      const st = pipelineStages[i];
      const dur = i === idx ? null : rng.int(2, 40);
      h += (dur || 0);
      pipelineEvents.push({
        id: 'pe_' + mc.id + '_' + i, marketingCampaignId: mc.id,
        fromStageId: i ? pipelineStages[i - 1].id : null, toStageId: st.id,
        actorType: st.kind === 'human' ? 'user' : 'agent',
        actorId: st.kind === 'human' ? mc.ownerUserId : st.agentId,
        at: hoursAgo(Math.max(1, 200 - h * 4)), durationHours: dur,
        note: eventNote(st, mc)
      });
    }
  });

  function eventNote(st, mc) {
    return ({
      st_brief: mc.origin === 'agent' ? 'Briefing gerado pelo agente a partir do pedido do gestor.' : 'Briefing preenchido pelo gestor.',
      st_orch: 'Contexto do cliente carregado. Pesquisa e estratégia enfileiradas.',
      st_research: 'Pesquisa concluída com fontes classificadas.',
      st_strategy: 'Plano de mídia gerado com distribuição por campanha e hipóteses.',
      st_approval: mc.status === 'aguardando_humano' ? 'Aguardando decisão do gestor.' : 'Plano aprovado.',
      st_build: 'Estrutura montada nas contas, pendente de publicação.',
      st_publish: 'Validado pelo policy engine e enviado ao n8n.',
      st_live: 'Publicado e verificado. Monitoramento ativo.',
      st_learn: 'Resultado medido contra o KPI e aprendizado registrado.'
    })[st.id] || '';
  }

  const clientContext = {};
  const ctxBase = {
    c_flora: ['Mulheres 25-44, classes B/C, moda autoral', 'Produção própria, grade ampla, troca grátis', 'Descoberta no Instagram, decisão em até 7 dias', 'Escalar receita mantendo ROAS acima de 4', 'Sem desconto acima de 20% sem aprovação', 'Pico em maio e novembro'],
    c_nutri: ['Praticantes de atividade física 22-40', 'Assinatura com desconto, frete grátis acima de R$ 199', 'Compra impulsiva, recompra em 35 dias', 'Crescer receita recorrente via assinatura', 'Claims de saúde seguindo normas da Anvisa', 'Janeiro e setembro aquecidos'],
    c_pet: ['Tutores de cães e gatos 25-45', 'Entrega em 24h na capital, clube de assinatura', 'Recompra mensal de ração', 'Aumentar ticket médio e frequência', 'Sem anúncio de medicamento controlado', 'Estável'],
    c_casa: ['Casais 28-45 montando ou renovando a casa', 'Curadoria própria e frete fixo', 'Pesquisa longa, compra em 14 dias', 'Validar canal pago como aquisição', 'Sem uso de imagem de terceiros', 'Pico no outono'],
    c_odonto: ['Adultos 30-55 no ABC buscando implante e ortodontia', 'Parcelamento em 24x, atendimento no mesmo dia', 'Formulário e WhatsApp, fechamento em 2 visitas', 'Reduzir CPL abaixo de R$ 95 mantendo volume', 'Proibido prometer resultado clínico', 'Queda em dezembro e janeiro'],
    c_bronze: ['Mulheres 25-45 de Florianópolis', 'Tecnologia exclusiva, pacote mensal', 'Agendamento de avaliação', 'Retomar a operação em janeiro', 'Sem antes e depois nos criativos', 'Pico no verão'],
    c_vet: ['Tutores em emergência, 24h, Curitiba', 'Pronto-socorro veterinário sem fila', 'Busca urgente, decisão imediata', 'Manter volume com CPL abaixo de R$ 23', 'Sem promessa de cura', 'Picos em feriados'],
    c_verde: ['Casais 30-50 em reforma, alto padrão', 'Projeto 3D gratuito, fábrica própria', 'Lead, visita ao showroom, fechamento em 45 dias', 'Aumentar leads qualificados para o comercial', 'Atender apenas a região Sul', 'Pico no segundo semestre'],
    c_alvorada: ['Jovens 18-28 buscando primeiro emprego técnico', 'Mensalidade acessível, estágio garantido', 'Lead, contato do consultor, matrícula em 10 dias', 'Preencher turmas do próximo semestre', 'Campanhas apenas em Minas Gerais', 'Matrículas em janeiro e julho'],
    c_ramos: ['Aposentados e segurados do INSS no Paraná', 'Análise gratuita, atendimento remoto', 'Consulta inicial e contrato', 'Estruturar a primeira operação de mídia paga', 'Seguir o código de ética da OAB', 'A levantar'],
    c_pizza: ['Famílias e jovens em Recife, pedido por app e WhatsApp', 'Massa artesanal, entrega em 35 minutos', 'Decisão por impulso na hora da fome', 'Aumentar pedidos sem queimar margem', 'Sem promessa de tempo de entrega no criativo', 'Fim de semana e feriado concentram o volume'],
    c_burger: ['Jovens 18-30 em Recife, pedido noturno', 'Blend artesanal, combo com batata', 'Pedido por impulso no fim do dia', 'Validar o segundo negócio sem canibalizar a pizza', 'Sem comparação direta com concorrente', 'Sexta a domingo concentram o volume'],
    c_rede: ['Famílias e grupos no Rio, almoço e jantar', 'Cardápio regional, seis unidades na cidade', 'Busca por bairro e reserva pelo site', 'Encher as mesas nos dias fracos da semana', 'Comunicação da marca é centralizada — filial não cria criativo', 'Verão e feriados prolongados puxam o movimento'],
    c_rede_tj: ['Moradores da Tijuca e entorno', 'Única unidade com estacionamento próprio', 'Busca local, decisão no mesmo dia', 'Aumentar reservas de jantar durante a semana', 'Seguir o manual de marca da rede', 'Queda em janeiro'],
    c_rede_bz: ['Público da Barra, ticket mais alto', 'Salão maior, atende evento fechado', 'Reserva antecipada para grupos', 'Vender evento corporativo no fim do ano', 'Seguir o manual de marca da rede', 'Pico em dezembro'],
    c_rede_ip: ['Turistas e moradores de Ipanema', 'Pé na areia, cardápio de verão', 'Decisão imediata, muita busca por mapa', 'Capturar o fluxo de turista no verão', 'Seguir o manual de marca da rede', 'Verão domina o ano'],
    c_rede_mr: ['Famílias do Méier, preço sensível', 'Menu executivo no almoço', 'Recorrência no almoço de semana', 'Fidelizar o almoço corporativo', 'Seguir o manual de marca da rede', 'Estável'],
    c_rede_nt: ['Moradores de Niterói, travessia evitada', 'Primeira unidade fora da capital', 'Busca local, cliente novo para a marca', 'Consolidar a marca fora do Rio', 'Seguir o manual de marca da rede', 'Inverno mais fraco'],
    c_rede_bg: ['Público de Botafogo, pós-trabalho', 'Happy hour e cardápio reduzido', 'Decisão no fim do expediente', 'Crescer o jantar de semana', 'Seguir o manual de marca da rede', 'Estável']
  };
  clients.forEach(function (c) {
    const b = ctxBase[c.id];
    clientContext[c.id] = {
      clientId: c.id, publico: b[0], diferenciais: b[1], jornada: b[2], objetivos: b[3], restricoes: b[4], sazonalidade: b[5],
      ticket: c.ticket, margem: c.model === 'ecommerce' ? '38%' : 'não informada',
      completeness: c.id === 'c_ramos' ? 35 : c.id === 'c_alvorada' ? 38 : c.id === 'c_bronze' ? 66 : rng.int(82, 97),
      updatedAt: at(rng.int(1, 14), 10, 0), version: rng.int(3, 11)
    };
  });

  const marketResearch = [
    { id: 'mr_1', clientId: 'c_flora', marketingCampaignId: 'mk_1', date: day(6), confidence: 'alta', summary: 'Moda feminina autoral com concorrência pulverizada e forte presença em Instagram. Faixa de preço pública dos concorrentes entre R$ 159 e R$ 289 para peças equivalentes. Disputa de leilão sobe 30% a 40% na semana da Black Friday.', competitors: [{ name: 'Alma Boutique', note: 'Preço médio R$ 189, foco em vídeos curtos', type: 'fato' }, { name: 'Luma Store', note: 'Frete grátis acima de R$ 199, catálogo amplo', type: 'fato' }, { name: 'Vera Atelier', note: 'Posicionamento premium, possível ticket acima de R$ 300', type: 'estimativa' }], opportunities: ['Ângulo de produção nacional', 'Catálogo segmentado por categoria', 'Palavra-chave de marca defensiva'], sources: ['instagram.com/almaboutique', 'lumastore.com.br', 'Google Trends — moda autoral'] },
    { id: 'mr_2', clientId: 'c_alvorada', marketingCampaignId: 'mk_4', date: day(0), confidence: 'media', summary: 'Busca por curso técnico em MG concentrada em janeiro e julho, com antecedência média de 5 semanas. Concorrentes anunciam mensalidade como gancho principal e pouco exploram estágio garantido.', competitors: [{ name: 'Senac MG', note: 'Domina termos genéricos de curso técnico', type: 'fato' }, { name: 'Instituto Monte Alto', note: 'Anuncia mensalidade a partir de R$ 189', type: 'fato' }, { name: 'Centro Técnico BH', note: 'Investimento estimado acima da média local', type: 'hipotese' }], opportunities: ['Ângulo de estágio garantido', 'Campanha por curso, não genérica', 'Remarketing para quem iniciou a inscrição'], sources: ['Google Keyword Planner', 'Biblioteca de anúncios Meta', 'Google Trends — curso técnico MG'] },
    { id: 'mr_3', clientId: 'c_odonto', marketingCampaignId: 'mk_3', date: day(2), confidence: 'media', summary: 'Demanda por implante estável no ABC, com pico de busca às segundas. Parcelamento é o gancho dominante dos concorrentes.', competitors: [{ name: 'Clínica Sorriso', note: 'Anuncia 24x sem juros na busca', type: 'fato' }, { name: 'OdontoCenter', note: 'Investimento estimado acima da média', type: 'hipotese' }], opportunities: ['Campanha para urgência odontológica', 'Extensões de chamada no horário comercial', 'Raio de 12 km da unidade'], sources: ['Google Keyword Planner', 'Biblioteca de anúncios Meta'] }
  ];

  const mediaPlans = [
    { id: 'mp_1', clientId: 'c_flora', marketingCampaignId: 'mk_1', month: 'Novembro/2026', budget: 48000, status: 'pending', objective: 'Vendas', createdAt: at(1, 16, 20), items: [{ name: 'Meta — Aquisição | Catálogo', budget: 17000 }, { name: 'Meta — Remarketing | Carrinho', budget: 7000 }, { name: 'Google — Performance Max', budget: 13000 }, { name: 'Google — Pesquisa | Marca', budget: 4000 }, { name: 'Google — Shopping | Geral', budget: 7000 }], hypotheses: ['Testar três ângulos criativos de produção nacional', 'Separar catálogo por categoria para medir margem', 'Revisar termos de pesquisa semanalmente'], metrics: 'ROAS ≥ 4,2 · CPA ≤ R$ 52 · Receita ≥ R$ 201k', risks: 'Estoque limitado em vestidos. CPM sobe 30% a 40% na semana da Black Friday.' },
    { id: 'mp_2', clientId: 'c_odonto', marketingCampaignId: 'mk_3', month: 'Dezembro/2026', budget: 18000, status: 'draft', objective: 'Leads', createdAt: at(0, 11, 20), items: [{ name: 'Google — Pesquisa | Serviço', budget: 7500 }, { name: 'Meta — Geração de leads | Oferta', budget: 6000 }, { name: 'Meta — Remarketing | Formulário', budget: 2500 }, { name: 'Google — Pesquisa | Marca', budget: 2000 }], hypotheses: ['Testar avaliação gratuita contra parcelamento', 'Restringir raio para 12 km', 'Qualificar lead com 4 perguntas no formulário'], metrics: 'CPL ≤ R$ 95 · 190 leads · agendamento ≥ 32%', risks: 'Baixo volume de busca no período de festas.' },
    { id: 'mp_3', clientId: 'c_nutri', marketingCampaignId: 'mk_2', month: 'Outubro/2026', budget: 22000, status: 'approved', objective: 'Vendas', createdAt: at(26, 14, 0), approvedBy: 'u_rafael', approvedAt: at(25, 9, 30), items: [{ name: 'Google — Performance Max', budget: 8000 }, { name: 'Meta — Aquisição | Catálogo', budget: 7000 }, { name: 'Meta — Remarketing | Carrinho', budget: 3000 }, { name: 'Google — Shopping | Geral', budget: 4000 }], hypotheses: ['Campanha dedicada à assinatura', 'Bundle creatina + whey'], metrics: 'ROAS ≥ 5,0 · Receita ≥ R$ 110k', risks: 'Ruptura de estoque de creatina.' },
    { id: 'mp_4', clientId: 'c_flora', marketingCampaignId: 'mk_9', month: 'Novembro/2026', budget: 7000, status: 'pending', objective: 'Vendas', createdAt: at(0, 10, 10), items: [{ name: 'Meta — Remarketing | Carrinho 14d', budget: 4200 }, { name: 'Meta — Remarketing | Visitantes 30d', budget: 2800 }], hypotheses: ['Ampliar janela de 7 para 14 dias', 'Alternar dois criativos por semana'], metrics: 'ROAS ≥ 6,0 · frequência ≤ 2,5', risks: 'Público pequeno pode saturar.' }
  ];

  const recommendations = [
    { id: 'rc_1', clientId: 'c_alvorada', campaignId: 'cmp_alvorada_1', marketingCampaignId: 'mk_4', severity: 'high', type: 'cpl', status: 'pending', createdAt: at(0, 7, 20), title: 'CPL subiu 48% em 7 dias na campanha de leads do Meta', what: 'O custo por lead passou de R$ 71 para R$ 105 entre 24/10 e 06/11.', period: 'Últimos 7 dias contra os 7 anteriores', evidence: 'Investimento estável (R$ 1.450/semana). CTR caiu de 2,4% para 1,5%, CPM subiu 22% e a frequência chegou a 3,4. Baseline sazonal do cliente para a semana é R$ 74 ± R$ 9 — o valor está fora da banda.', cause: 'Desgaste de criativo somado a aumento de concorrência no período de matrículas.', action: 'Pausar os dois criativos com frequência acima de 3 e subir três variações do ângulo de estágio garantido.', impact: 'Redução estimada de 18% a 25% no CPL em 7 dias.', risk: 'Médio — queda temporária de volume durante o aprendizado.', needsApproval: true },
    { id: 'rc_2', clientId: 'c_flora', campaignId: 'cmp_flora_4', marketingCampaignId: 'mk_1', severity: 'opp', type: 'orcamento', status: 'pending', createdAt: at(0, 7, 24), title: 'Performance Max com ROAS 6,1 e orçamento limitado', what: 'A campanha atinge o teto diário em 68% dos dias dos últimos 14.', period: 'Últimos 14 dias', evidence: 'ROAS confirmado de 5,4 (declarado 6,1) contra 4,3 da conta. Perda de impressão por orçamento em 31%.', cause: 'Orçamento insuficiente para a demanda atual.', action: 'Aumentar o orçamento diário de R$ 322 para R$ 354 (+10%) e reavaliar em 7 dias.', impact: 'Receita incremental estimada entre R$ 9k e R$ 13k no mês.', risk: 'Baixo — dentro do limite de 10% ao dia autorizado.', needsApproval: true },
    { id: 'rc_3', clientId: 'c_odonto', campaignId: 'cmp_odonto_4', marketingCampaignId: 'mk_3', severity: 'mid', type: 'termos', status: 'pending', createdAt: at(1, 15, 2), title: '17 termos de pesquisa irrelevantes consumiram R$ 1.180', what: 'Termos de curso e emprego em odontologia geraram cliques sem conversão.', period: 'Últimos 30 dias', evidence: 'R$ 1.180 investidos, 412 cliques, zero leads nos termos listados.', cause: 'Correspondência ampla sem lista de exclusão.', action: 'Adicionar 17 palavras-chave negativas e migrar dois termos para frase.', impact: 'Economia estimada de R$ 1.100 por mês redirecionada para termos de alta intenção.', risk: 'Baixo.', needsApproval: true },
    { id: 'rc_4', clientId: 'c_vet', campaignId: 'cmp_vet_3', marketingCampaignId: 'mk_8', severity: 'mid', type: 'desperdicio', status: 'pending', createdAt: at(0, 7, 30), title: 'Campanha de reconhecimento sem conversão há 7 dias', what: 'R$ 407 investidos sem nenhum lead no período.', period: 'Últimos 7 dias', evidence: 'Volume de conversão zero com 1.980 cliques. Acima do gatilho de 3x o CPA alvo.', cause: 'Público amplo sem intenção de emergência.', action: 'Pausar e realocar para a campanha de pesquisa de urgência.', impact: 'R$ 1.740/mês realocados.', risk: 'Baixo.', needsApproval: true },
    { id: 'rc_5', clientId: 'c_pet', campaignId: 'cmp_pet_2', marketingCampaignId: 'mk_6', severity: 'low', type: 'criativo', status: 'approved', createdAt: at(3, 9, 48), decidedBy: 'u_rafael', decidedAt: at(3, 11, 0), title: 'Remarketing de carrinho com frequência acima de 3,1', what: 'Frequência semanal subiu de 2,2 para 3,1 sem aumento de conversões.', period: 'Últimos 7 dias', evidence: 'CTR estável, CPM +9%, conversões -6%.', cause: 'Público pequeno recebendo o mesmo criativo há 21 dias.', action: 'Ampliar janela de carrinho de 7 para 14 dias e alternar dois criativos.', impact: 'Frequência esperada abaixo de 2,5 em uma semana.', risk: 'Baixo.', needsApproval: true },
    { id: 'rc_6', clientId: 'c_nutri', campaignId: 'cmp_nutri_3', marketingCampaignId: 'mk_2', severity: 'mid', type: 'roas', status: 'rejected', createdAt: at(6, 8, 30), decidedBy: 'u_rafael', decidedAt: at(5, 17, 40), decisionNote: 'A campanha sustenta o topo do funil do remarketing. Reduzir 30% em vez de pausar.', title: 'Pausar campanha de prospecção por vídeo', what: 'ROAS de 1,8 contra meta de 3,0 nos últimos 21 dias.', period: 'Últimos 21 dias', evidence: 'R$ 4.100 investidos, R$ 7.380 de receita atribuída.', cause: 'Público amplo com baixa intenção.', action: 'Pausar a campanha e realocar o orçamento para Performance Max.', impact: 'Realocação de R$ 4.100 por mês.', risk: 'Alto — alimenta o topo de funil do remarketing.', needsApproval: true }
  ];

  const approvals = [
    { id: 'ap_1', clientId: 'c_flora', marketingCampaignId: 'mk_1', mediaPlanId: 'mp_1', recommendationId: null, status: 'pending', requestedBy: 'ag_strategy', requestedAt: at(1, 16, 21), title: 'Plano de mídia de Black Friday — R$ 48.000', risk: 'Médio', value: 'R$ 42.000 → R$ 48.000/mês' },
    { id: 'ap_2', clientId: 'c_flora', marketingCampaignId: 'mk_9', mediaPlanId: 'mp_4', recommendationId: null, status: 'pending', requestedBy: 'ag_strategy', requestedAt: at(0, 10, 11), title: 'Reestruturação do remarketing — R$ 7.000', risk: 'Baixo', value: null },
    { id: 'ap_3', clientId: 'c_alvorada', marketingCampaignId: 'mk_4', recommendationId: 'rc_1', status: 'pending', requestedBy: 'ag_performance', requestedAt: at(0, 7, 21), title: 'Pausar 2 criativos e subir 3 variações', risk: 'Médio', value: null },
    { id: 'ap_4', clientId: 'c_flora', marketingCampaignId: 'mk_1', recommendationId: 'rc_2', status: 'pending', requestedBy: 'ag_performance', requestedAt: at(0, 7, 25), title: 'Aumentar orçamento diário em 10%', risk: 'Baixo', value: 'R$ 322 → R$ 354/dia' },
    { id: 'ap_5', clientId: 'c_odonto', marketingCampaignId: 'mk_3', recommendationId: 'rc_3', status: 'pending', requestedBy: 'ag_performance', requestedAt: at(1, 15, 3), title: 'Adicionar 17 palavras-chave negativas', risk: 'Baixo', value: null },
    { id: 'ap_6', clientId: 'c_vet', marketingCampaignId: 'mk_8', recommendationId: 'rc_4', status: 'pending', requestedBy: 'ag_performance', requestedAt: at(0, 7, 31), title: 'Pausar campanha sem conversão', risk: 'Baixo', value: 'R$ 58/dia realocados' },
    { id: 'ap_7', clientId: 'c_pet', marketingCampaignId: 'mk_6', recommendationId: 'rc_5', status: 'approved', requestedBy: 'ag_performance', requestedAt: at(3, 9, 50), decidedBy: 'u_rafael', decidedAt: at(3, 11, 0), title: 'Ampliar janela de remarketing', risk: 'Baixo', value: null }
  ];

  const agentActions = [
    { id: 'aa_1', clientId: 'c_nutri', marketingCampaignId: 'mk_2', campaignId: 'cmp_nutri_4', type: 'budget_increase', title: 'Orçamento diário aumentado em 10%', before: 'R$ 367/dia', after: 'R$ 404/dia', reason: 'ROAS confirmado de 5,4 com perda de impressão por orçamento em 28%.', executedBy: 'agent', approvalId: 'ap_7', at: at(2, 6, 10), idempotencyKey: 'bgt-nutri-4-20261105', apiResult: 'OK · campaign.budget updated', verified: 'confirmada', outcome: 'ROAS manteve 5,2 com receita +8% em 48h', reversible: true },
    { id: 'aa_2', clientId: 'c_pet', marketingCampaignId: 'mk_6', campaignId: 'cmp_pet_2', type: 'audience_window', title: 'Janela de remarketing ampliada para 14 dias', before: '7 dias', after: '14 dias', reason: 'Frequência 3,1 com queda de conversão.', executedBy: 'u_rafael', approvalId: 'ap_7', at: at(3, 11, 2), idempotencyKey: 'aud-pet-2-20261104', apiResult: 'OK · adset.targeting updated', verified: 'confirmada', outcome: 'Frequência caiu para 2,3 em 5 dias', reversible: true },
    { id: 'aa_3', clientId: 'c_odonto', marketingCampaignId: 'mk_3', campaignId: 'cmp_odonto_4', type: 'negative_keywords', title: '9 palavras-chave negativas adicionadas', before: '12 negativas', after: '21 negativas', reason: 'Termos de curso e emprego sem conversão.', executedBy: 'u_juliana', approvalId: null, at: at(9, 10, 5), idempotencyKey: 'neg-odonto-4-20261029', apiResult: 'OK · 9 criteria added', verified: 'confirmada', outcome: 'CPL caiu 7% na semana seguinte', reversible: true },
    { id: 'aa_4', clientId: 'c_verde', marketingCampaignId: 'mk_5', campaignId: 'cmp_verde_4', type: 'campaign_create', title: '5 campanhas criadas para o showroom SC', before: '—', after: '5 campanhas em rascunho', reason: 'Plano de mídia aprovado para a inauguração.', executedBy: 'agent', approvalId: null, at: at(0, 12, 10), idempotencyKey: 'bld-verde-sc-20261107', apiResult: 'EM ANDAMENTO · 3 de 5 criadas', verified: 'pendente', outcome: '—', reversible: true },
    { id: 'aa_5', clientId: 'c_pet', marketingCampaignId: 'mk_6', campaignId: 'cmp_pet_5', type: 'budget_shift', title: 'Realocação de R$ 600 entre campanhas', before: 'Shopping R$ 1.100 / PMax R$ 2.300', after: 'Shopping R$ 500 / PMax R$ 2.900', reason: 'Shopping com CPA 2,4x maior que PMax.', executedBy: 'agent', approvalId: null, at: at(12, 7, 0), idempotencyKey: 'shf-pet-20261026', apiResult: 'ERRO · RESOURCE_TEMPORARILY_EXHAUSTED', verified: 'falhou', outcome: 'Reexecutada com sucesso 20 min depois, sem duplicar', reversible: true }
  ];

  const optimizationRules = [
    { id: 'or_1', clientId: 'c_nutri', label: 'Aumento de orçamento automático', condition: 'ROAS confirmado 7d ≥ 4,5 e perda por orçamento ≥ 20%', action: 'Aumentar orçamento diário em até 10%', limit: 'Máximo 1 alteração por dia por campanha', window: 'Seg a Sex, 06h-20h', active: true },
    { id: 'or_2', clientId: 'c_nutri', label: 'Proteção de gasto sem conversão', condition: 'Gasto ≥ 3x CPA alvo sem conversão em 72h', action: 'Notificar gestor e sugerir pausa', limit: 'Não pausa automaticamente', window: 'Sempre', active: true },
    { id: 'or_3', clientId: 'c_flora', label: 'Rotação de criativo por fadiga', condition: 'Frequência 7d ≥ 3,0 e CTR abaixo do baseline do criativo', action: 'Propor pausa e subir variação', limit: 'Requer aprovação', window: 'Sempre', active: true },
    { id: 'or_4', clientId: 'c_pet', label: 'Exclusão de termos irrelevantes', condition: '≥ 40 cliques sem conversão em um termo', action: 'Propor palavra-chave negativa', limit: 'Máximo 20 termos por semana', window: 'Semanal', active: false },
    { id: 'or_5', clientId: 'c_vet', label: 'Pico de emergência', condition: 'Volume de busca 2x acima do baseline', action: 'Liberar teto diário em 20% por 24h', limit: 'Máximo 2 vezes por semana', window: 'Sempre', active: true }
  ];

  const conversations = {
    c_flora: [
      { role: 'user', at: at(0, 9, 2), text: 'Como está a saúde das campanhas essa semana?' },
      { role: 'agent', at: at(0, 9, 2), text: 'Receita confirmada de R$ 44,1k nos últimos 7 dias (declarada R$ 48,2k), 11% acima da semana anterior, com ROAS confirmado de 4,2.|A Performance Max puxa o resultado com ROAS 5,4, mas bate o teto de orçamento em 68% dos dias — abri uma recomendação de aumento de 10%.|O ponto de atenção é o remarketing de carrinho: frequência em 3,1 e conversões caindo 6%. A iniciativa mk_9 já está na aprovação para reestruturar isso.' },
      { role: 'user', at: at(0, 9, 5), text: 'Por que o CPM subiu?' },
      { role: 'agent', at: at(0, 9, 5), text: 'O CPM médio passou de R$ 23,10 para R$ 26,40 (+14%) nos últimos 14 dias. O baseline sazonal desta semana é R$ 24,80 ± R$ 1,60, então a alta é real, mas modesta.|Dois fatores sustentam o diagnóstico: entrada no período pré-Black Friday, que aumenta a disputa no leilão em todo o segmento, e concentração de 62% do investimento em dois públicos de remarketing.|Essa é uma leitura dos seus dados de leilão. Não tenho acesso ao investimento dos concorrentes — qualquer número sobre eles seria estimativa.' }
    ],
    c_alvorada: [
      { role: 'user', at: at(0, 8, 10), text: 'Por que o CPL aumentou nesta semana?' },
      { role: 'agent', at: at(0, 8, 10), text: 'O CPL foi de R$ 71 para R$ 105 (+48%) entre 24/10 e 06/11. O baseline da semana é R$ 74 ± R$ 9, então está fora da banda — é anomalia, não sazonalidade.|Decompondo: CPM subiu 22% e o CTR caiu de 2,4% para 1,5%. A taxa de conversão da página ficou estável. Ou seja, o problema está no criativo, não na oferta nem no site.|A frequência chegou a 3,4 nos dois criativos principais, ambos no ar há 21 dias. Preparei a proposta de pausa e três variações — está na sua fila de aprovação.' }
    ]
  };

  const learnings = [
    { id: 'le_1', clientId: 'c_nutri', title: 'Aumentar 10% em PMax limitada por orçamento funciona', hypothesis: 'Campanha limitada por orçamento com ROAS acima da meta sustenta aumento sem perder eficiência.', result: 'positivo', evidence: 'ROAS confirmado manteve 5,2 (contra 5,4) e a receita subiu 8% em 48h.', confidence: 'alta', appliedTo: 4, at: at(2, 6, 10) },
    { id: 'le_2', clientId: 'c_flora', title: 'Pausar criativo acima de 3,5 de frequência melhora o CTR do conjunto', hypothesis: 'Fadiga de criativo derruba o CTR do conjunto inteiro, não só do anúncio.', result: 'positivo', evidence: 'CTR do conjunto subiu de 1,1% para 1,4% em 7 dias após a pausa.', confidence: 'alta', appliedTo: 6, at: at(16, 14, 32) },
    { id: 'le_3', clientId: 'c_nutri', title: 'Pausar prospecção por vídeo prejudica o remarketing', hypothesis: 'Campanha de ROAS baixo poderia ser desligada sem impacto no resto.', result: 'negativo', evidence: 'Teste anterior em outro cliente derrubou o volume de remarketing em 31% em duas semanas.', confidence: 'media', appliedTo: 1, at: at(5, 17, 40) },
    { id: 'le_4', clientId: 'c_odonto', title: 'Negativar termos informacionais reduz CPL sem perder volume', hypothesis: 'Termos de curso e emprego consomem verba sem intenção comercial.', result: 'positivo', evidence: 'CPL caiu 7% na semana seguinte com o mesmo investimento e volume estável.', confidence: 'alta', appliedTo: 7, at: at(9, 10, 5) },
    { id: 'le_5', clientId: 'c_flora', title: 'Black Friday: antecipar aquecimento em 3 semanas', hypothesis: 'Público aquecido antes do pico reduz o CPA na semana da Black Friday.', result: 'positivo', evidence: 'Em 2025 o CPA da semana do pico ficou 19% abaixo do ano anterior com a mesma verba.', confidence: 'media', appliedTo: 3, at: at(180, 10, 0) }
  ];

  const agentQuality = {
    approvalRate: .78, successRate: .71, avgTimeToImpact: '2,4 dias', sourceAccuracy: .94, reversalRate: .06,
    costPerAccepted: 4.12, samples: 64,
    threshold: { approvalRate: .75, successRate: .7, samples: 50 },
    byAgent: [
      { agentId: 'ag_research', metric: 'Precisão de fonte', value: '94%', ok: true },
      { agentId: 'ag_strategy', metric: 'Plano aprovado sem ajuste', value: '62%', ok: false },
      { agentId: 'ag_performance', metric: 'Recomendação com resultado positivo', value: '71%', ok: true },
      { agentId: 'ag_campaign', metric: 'Estrutura publicada sem correção', value: '88%', ok: true },
      { agentId: 'ag_policy', metric: 'Ação verificada na plataforma', value: '98%', ok: true }
    ]
  };

  const crossQuestions = [
    { id: 'nq_1', kind: 'cpl', question: 'Quais contas estão com CPL acima da meta?', answer: 'Três operações de leads estão acima da meta no período. Instituto Alvorada é o caso crítico, com CPL 66% acima e anomalia confirmada contra o baseline.' },
    { id: 'nq_2', kind: 'waste', question: 'Quais campanhas gastaram sem gerar conversão?', answer: 'Quatro campanhas acumularam gasto sem nenhuma conversão nos últimos 7 dias. A maior parte está em prospecção fria e reconhecimento no Meta.' },
    { id: 'nq_3', kind: 'opportunity', question: 'Onde há oportunidade de aumentar o orçamento?', answer: 'As campanhas abaixo estão limitadas por orçamento e dentro da meta de eficiência. O aumento somado de 10% cabe nos limites de autonomia já autorizados.' },
    { id: 'nq_4', kind: 'spendUp', question: 'Quais clientes estão aumentando o investimento?', answer: 'Estes clientes subiram o investimento contra o período anterior. O maior salto vem do pré-Black Friday no portfólio de e-commerce.' },
    { id: 'nq_5', kind: 'gap', question: 'Onde o número declarado está distante do confirmado?', answer: 'Divergência acima de 20% indica problema de rastreamento ou dupla atribuição. Recomendações de realocação ficam suspensas nessas contas.' }
  ];

  const automationRuns = [
    { id: 'ar_1', workflow: 'sync_meta_insights', clientId: null, status: 'success', startedAt: at(0, 6, 0), durationMs: 184000, records: 6821, note: '13 contas sincronizadas · rejanela de 28 dias' },
    { id: 'ar_2', workflow: 'sync_google_ads', clientId: null, status: 'success', startedAt: at(0, 6, 10), durationMs: 221000, records: 5960, note: '11 contas via MCC' },
    { id: 'ar_3', workflow: 'reconcile_conversions', clientId: null, status: 'success', startedAt: at(0, 6, 55), durationMs: 64000, records: 10, note: '2 clientes com divergência acima de 20%' },
    { id: 'ar_4', workflow: 'agent_daily_analysis', clientId: null, status: 'success', startedAt: at(0, 7, 0), durationMs: 412000, records: 10, note: '4 recomendações geradas' },
    { id: 'ar_5', workflow: 'sync_meta_insights', clientId: 'c_alvorada', status: 'error', startedAt: at(0, 6, 3), durationMs: 12000, records: 0, note: 'OAuthException 190 — token expirado' },
    { id: 'ar_6', workflow: 'execute_approved_action', clientId: 'c_nutri', status: 'success', startedAt: at(2, 6, 10), durationMs: 8400, records: 1, note: 'budget_increase aplicado e verificado' },
    { id: 'ar_7', workflow: 'build_campaign_structure', clientId: 'c_verde', status: 'running', startedAt: at(0, 12, 10), durationMs: 0, records: 3, note: '3 de 5 campanhas criadas' },
    { id: 'ar_8', workflow: 'market_research', clientId: 'c_alvorada', status: 'success', startedAt: at(0, 3, 0), durationMs: 96000, records: 1, note: '3 concorrentes, 9 fontes' },
    { id: 'ar_9', workflow: 'execute_approved_action', clientId: 'c_pet', status: 'retry', startedAt: at(12, 7, 0), durationMs: 31000, records: 0, note: 'RESOURCE_TEMPORARILY_EXHAUSTED — reagendado por quota' },
    { id: 'ar_10', workflow: 'daily_backup_postgres', clientId: null, status: 'success', startedAt: at(0, 3, 0), durationMs: 64000, records: 1, note: 'dump 612 MB enviado ao bucket' }
  ];

  const workflows = [
    { name: 'sync_meta_insights', schedule: 'Diário 06:00', desc: 'Importa campanhas, conjuntos, anúncios e métricas do Meta, com rejanela de 28 dias.' },
    { name: 'sync_google_ads', schedule: 'Diário 06:10', desc: 'Importa campanhas, grupos, termos e métricas do Google Ads via MCC.' },
    { name: 'reconcile_conversions', schedule: 'Diário 06:55', desc: 'Compara conversão declarada com a confirmada no GA4/CRM e registra o desvio.' },
    { name: 'agent_daily_analysis', schedule: 'Diário 07:00', desc: 'Dispara o Agent Service para analisar cada cliente e gerar recomendações.' },
    { name: 'market_research', schedule: 'Semanal, segunda 03:00', desc: 'Pesquisa externa de concorrentes, tendências e oportunidades.' },
    { name: 'build_campaign_structure', schedule: 'Sob demanda', desc: 'Materializa o plano aprovado em campanhas, conjuntos e anúncios.' },
    { name: 'execute_approved_action', schedule: 'Sob demanda', desc: 'Executa nas APIs oficiais apenas ações aprovadas, com chave de idempotência.' },
    { name: 'daily_backup_postgres', schedule: 'Diário 03:00', desc: 'Dump do PostgreSQL no bucket, retenção de 30 dias.' }
  ];

  const alerts = [
    { id: 'al_1', clientId: 'c_alvorada', severity: 'high', title: 'Conexão Meta com erro há 4 dias', detail: 'Token expirado. Sincronização parada desde 03/11.', at: at(0, 6, 3) },
    { id: 'al_2', clientId: 'c_alvorada', severity: 'high', title: 'CPL 48% acima da meta', detail: 'R$ 105 contra meta de R$ 87, fora do baseline.', at: at(0, 7, 20) },
    { id: 'al_3', clientId: 'c_flora', severity: 'mid', title: 'Conta Outlet sem sincronizar', detail: 'Token direto expirado — 2 campanhas sem dado.', at: at(0, 6, 4) },
    { id: 'al_4', clientId: 'c_ramos', severity: 'mid', title: 'Onboarding parado no passo 3', detail: 'Conta Google aguardando autorização há 6 dias.', at: at(0, 8, 2) },
    { id: 'al_5', clientId: 'c_casa', severity: 'mid', title: 'Divergência de conversão em 31%', detail: 'Declarado 412 × confirmado 284. Recomendações suspensas.', at: at(0, 6, 56) }
  ];

  const alertRules = [
    { id: 'alr_1', label: 'CPL fora do baseline', scope: 'Portfólio Serviços locais', condition: 'CPL 7d acima da banda de confiança do baseline sazonal', channel: 'Painel e e-mail', active: true, triggered: 2 },
    { id: 'alr_2', label: 'Gasto sem conversão', scope: 'Todas as contas', condition: 'Gasto ≥ 3x CPA alvo sem conversão em 72h', channel: 'Painel', active: true, triggered: 4 },
    { id: 'alr_3', label: 'Ritmo de orçamento fora da faixa', scope: 'Todas as contas', condition: 'Projeção do mês fora de 90%-105% do planejado', channel: 'Painel e e-mail', active: true, triggered: 3 },
    { id: 'alr_4', label: 'Falha de sincronização', scope: 'Integrações', condition: 'Conta sem sincronização há mais de 24h', channel: 'Painel, e-mail e Slack', active: true, triggered: 2 },
    { id: 'alr_5', label: 'Divergência declarado × confirmado', scope: 'Todas as contas', condition: 'Desvio acima de 20% por 3 dias seguidos', channel: 'Painel', active: true, triggered: 1 },
    { id: 'alr_6', label: 'Card parado no Kanban', scope: 'Campanhas de marketing', condition: 'Tempo na coluna acima do SLA da etapa', channel: 'Painel', active: true, triggered: 3 }
  ];

  const auditLog = [
    { id: 'au_1', at: at(0, 13, 5), actorType: 'agent', actorId: 'ag_policy', action: 'campaign.publish', target: 'Casa Verde · Showroom SC', detail: '3 de 5 campanhas publicadas · chave bld-verde-sc-20261107', ip: 'interno' },
    { id: 'au_2', at: at(0, 10, 12), actorType: 'user', actorId: 'u_rafael', action: 'bulk_operation.create', target: 'Portfólio E-commerce', detail: 'Pausar campanhas sem conversão — 7 alvos, aguardando aprovação', ip: '189.40.77.2' },
    { id: 'au_3', at: at(0, 9, 40), actorType: 'user', actorId: 'u_admin', action: 'client.update', target: 'Loja Flora', detail: 'Verba mensal de R$ 38.000 para R$ 42.000', ip: '177.54.12.9' },
    { id: 'au_4', at: at(0, 7, 21), actorType: 'agent', actorId: 'ag_performance', action: 'approval.request', target: 'Instituto Alvorada', detail: 'Pausar 2 criativos e subir 3 variações', ip: 'interno' },
    { id: 'au_5', at: at(2, 6, 10), actorType: 'agent', actorId: 'ag_policy', action: 'campaign.budget.update', target: 'Nutri Vita · PMax', detail: 'R$ 367 → R$ 404 por dia · verificado', ip: 'interno' },
    { id: 'au_6', at: at(20, 9, 0), actorType: 'user', actorId: 'u_rafael', action: 'member.grant', target: 'Letícia Nunes', detail: 'partner em 2 contas, expira em 40 dias', ip: '189.40.77.2' },
    { id: 'au_7', at: at(4, 3, 10), actorType: 'system', actorId: null, action: 'account.sync.fail', target: 'Instituto Alvorada · Meta', detail: 'OAuthException 190', ip: 'interno' },
    { id: 'au_8', at: at(7, 10, 14), actorType: 'user', actorId: 'u_juliana', action: 'member.invite', target: 'carlos@odontoprime.com.br', detail: 'Convite com papel client no escopo Odonto Prime', ip: '201.17.8.40' }
  ];

  const integrationsCatalog = [
    { id: 'in_0', name: 'Google Analytics 4 (conta de serviço)', kind: 'Analytics', status: 'pending', accounts: 0, note: 'Não usa o mesmo consentimento — o cliente adiciona o e-mail da conta de serviço na propriedade' },
    { id: 'in_1', name: 'Meta Ads', kind: 'Mídia', status: 'active', accounts: adAccounts.filter(function (a) { return a.platform === 'meta'; }).length, note: 'Marketing API · leitura e escrita' },
    { id: 'in_2', name: 'Google Ads', kind: 'Mídia', status: 'active', accounts: adAccounts.filter(function (a) { return a.platform === 'google'; }).length, note: 'Google Ads API via MCC' },
    { id: 'in_3', name: 'Google Analytics 4', kind: 'Analytics', status: 'pending', accounts: 0, note: 'Fonte da verdade confirmada — prioridade 3' },
    { id: 'in_4', name: 'CRM e vendas', kind: 'Receita', status: 'pending', accounts: 0, note: 'Closed-loop do lead — subiu para a fase 3' },
    { id: 'in_5', name: 'Google Tag Manager', kind: 'Rastreamento', status: 'planned', accounts: 0, note: 'Validação de tags e eventos' },
    { id: 'in_6', name: 'Google Merchant Center', kind: 'Catálogo', status: 'planned', accounts: 0, note: 'Saúde do feed para Shopping e PMax' }
  ];

  const reports = [
    { id: 'rp_1', name: 'Performance mensal por cliente', scope: 'Cliente', schedule: 'Mensal, dia 1', format: 'PDF e link', recipients: 'Cliente e gestor', lastRun: at(6, 8, 0) },
    { id: 'rp_2', name: 'Consolidado da carteira', scope: 'Agência', schedule: 'Semanal, segunda', format: 'PDF', recipients: 'Direção', lastRun: at(1, 7, 0) },
    { id: 'rp_3', name: 'Resultado por campanha de marketing', scope: 'Iniciativa', schedule: 'Ao encerrar', format: 'PDF', recipients: 'Cliente e gestor', lastRun: at(20, 9, 0) },
    { id: 'rp_4', name: 'Comparativo cross-account de e-commerce', scope: 'Portfólio', schedule: 'Quinzenal', format: 'Planilha', recipients: 'Gestores', lastRun: at(4, 9, 30) },
    { id: 'rp_5', name: 'Auditoria de contas', scope: 'Contas', schedule: 'Mensal', format: 'PDF', recipients: 'Gestores', lastRun: at(5, 4, 0) },
    { id: 'rp_6', name: 'Ações do agente e resultados', scope: 'Agência', schedule: 'Semanal, sexta', format: 'PDF', recipients: 'Direção e gestores', lastRun: at(2, 18, 0) }
  ];

  const modules = [
    { n: '01', name: 'Command Center', desc: 'Visão geral: clientes, contas, plataformas, investimentos, resultados, alertas e saúde das integrações.', route: 'dashboard' },
    { n: '02', name: 'Account Management', desc: 'Múltiplas contas, carteiras, clientes, estruturas, orçamentos e operações em massa.', route: 'accounts' },
    { n: '03', name: 'Performance Intelligence', desc: 'Resultados, comparações, diagnósticos, auditorias, anomalias e oportunidades.', route: 'performance' },
    { n: '04', name: 'AI Agent', desc: 'Conhece o negócio, pesquisa, cria estratégia, analisa e decide o que fazer.', route: 'agent' },
    { n: '05', name: 'Campaign Operations', desc: 'Campanhas de marketing, Kanban de agentes, execução e testes.', route: 'marketing' },
    { n: '06', name: 'Automation & Governance', desc: 'Regras, aprovações, autonomia, histórico, auditoria e execução segura.', route: 'automations' }
  ];

  g.DB = {
    meta: { now: TODAY.toISOString(), today: iso(TODAY), days: DAYS },
    core: { organizations: organizations, platformApprovals: platformApprovals, users: users, members: members, roles: roles, permissionMatrix: permissionMatrix, clients: clients, portfolios: portfolios },
    integrations: { connections: connections, adAccounts: adAccounts, catalog: integrationsCatalog },
    ads: { marketingCampaigns: marketingCampaigns, campaigns: campaigns, bulkOperations: bulkOperations, accountAudits: accountAudits },
    metrics: { daily: daily, investments: investments, reconciliation: reconciliation },
    agent: {
      roster: agentsRoster, pipelineStages: pipelineStages, pipelineEvents: pipelineEvents,
      context: clientContext, research: marketResearch, mediaPlans: mediaPlans,
      recommendations: recommendations, approvals: approvals, actions: agentActions,
      rules: optimizationRules, conversations: conversations, learnings: learnings,
      quality: agentQuality, crossQuestions: crossQuestions,
      autonomyLevels: [
        { level: 1, label: 'Consultivo', desc: 'Analisa e recomenda, sem executar.', tone: 'ok' },
        { level: 2, label: 'Assistido', desc: 'Executa ações previamente autorizadas e pede aprovação para as demais.', tone: 'info' },
        { level: 3, label: 'Autônomo', desc: 'Opera dentro dos limites definidos pela agência.', tone: 'warn' }
      ]
    },
    automation: { runs: automationRuns, workflows: workflows, alerts: alerts, alertRules: alertRules, auditLog: auditLog, reports: reports, modules: modules }
  };
})(window);
