(function (g) {
  const root = document.getElementById('root');
  const UI = g.UI, R = g.Repo, F = g.F, DB = g.DB;

  function resolve(route) {
    if (route.page === 'login') return g.PAGES.login(route);
    const sc = R.scope(g.Store.me().id);
    if (sc.isClient && route.page !== 'portal') return g.PAGES.portal({ page: 'portal', id: null });
    const page = g.PAGES[route.page];
    if (!page) return { nav: null, title: 'Não encontrado', content: UI.empty('Tela não encontrada', 'Use o menu lateral.') };
    return page(route);
  }

  function render() {
    const route = g.Router.parse();
    const view = resolve(route);
    root.innerHTML = (view.bare ? g.Shell.bare(view.content) : g.Shell.render(view)) + modalHtml() + g.Shell.toasts();
    document.title = 'tria · ' + (view.title || 'AdTech');
    window.scrollTo(0, 0);
  }

  function modalHtml() {
    const m = g.Store.get().modal;
    if (!m) return '';
    if (m.type === 'rec') {
      const r = DB.agent.recommendations.find(function (x) { return x.id === m.id; });
      if (!r) return '';
      return UI.modal({
        title: r.title, sub: R.client(r.clientId).name,
        body: '<div class="rec__grid">' + [['what', 'O que aconteceu'], ['period', 'Período analisado'], ['evidence', 'Evidência'], ['cause', 'Causa provável'], ['action', 'Recomendação'], ['impact', 'Impacto esperado'], ['risk', 'Risco']].map(function (f) {
          return '<div><b>' + f[1] + '</b>' + r[f[0]] + '</div>';
        }).join('') + '</div>',
        foot: UI.btn('Fechar', { action: 'modal:close' }) + (R.canApprove(g.Store.get().user, r.clientId) ? UI.btn('Aprovar e executar', { variant: 'primary', action: 'approve:' + r.id }) : '')
      });
    }
    if (m.type === 'campaign') {
      const c = R.campaign(m.id);
      if (!c) return '';
      const period = g.Store.get().period;
      const t = R.totals({ campaignId: c.id, days: period });
      const client = R.client(c.clientId);
      const s = R.series({ campaignId: c.id, days: period }, 'spend');
      const mc = c.marketingCampaignId ? R.mc(c.marketingCampaignId) : null;
      return UI.modal({
        title: c.name, sub: client.name + ' · ' + R.account(c.adAccountId).name,
        body: '<div class="row">' + UI.platform(c.platform) + UI.statusPill(c.status) + UI.modelPill(client.model)
          + (mc ? UI.pill('Iniciativa: ' + mc.name, 'info') : '') + '</div>'
          + g.CHART.area(s, { height: 150, seed: 9 }) + g.CHART.axis(s)
          + UI.kv(R.kpiSet(client.model, t).map(function (k) { return [k.label, k.value]; }).concat([
            ['Orçamento diário', F.money(c.budgetDaily)], ['Objetivo', c.objective],
            ['Perda por orçamento', c.impressionShareLost + '%'],
            ['Impressões', F.number(t.impressions)], ['CTR', F.pct(t.ctr, 2)],
            ['Conversões declaradas × confirmadas', F.number(t.conversions) + ' × ' + F.number(t.conversionsConfirmed)]
          ])),
        foot: UI.btn('Fechar', { action: 'modal:close' })
          + (mc ? UI.btn('Abrir iniciativa', { action: 'go:marketing/' + mc.id }) : '')
          + UI.btn('Abrir conta', { variant: 'primary', action: 'go:accounts/' + c.adAccountId })
      });
    }
    if (m.type === 'new-mc') {
      const byAgent = m.id === 'agent';
      return UI.modal({
        title: byAgent ? 'Criar campanha de marketing com o agente' : 'Criar campanha de marketing na mão',
        sub: byAgent ? 'Descreva o resultado que você quer — o Orchestrator monta a iniciativa' : 'Você preenche o briefing e escolhe onde o fluxo começa',
        body: byAgent
          ? '<div class="field"><label class="field__label">O que você precisa?</label><textarea class="textarea">Preciso de 120 matrículas para a turma de março, com R$ 40 mil, priorizando a região metropolitana.</textarea></div>'
          + '<div class="grid grid--2">'
          + '<div class="field"><label class="field__label">Cliente</label>' + UI.select('noop', DB.core.clients.map(function (c) { return { value: c.id, label: c.name }; }), 'c_alvorada') + '</div>'
          + '<div class="field"><label class="field__label">Contas que podem ser usadas</label>' + UI.select('noop', [{ value: 'all', label: 'Todas as contas do cliente' }], 'all') + '</div>'
          + '</div>'
          + '<div class="row small muted">' + g.ICON('sparkles', 15) + 'O card nasce na coluna <b>AI Orchestrator</b>, com briefing preenchido e pesquisa e estratégia enfileiradas.</div>'
          : '<div class="grid grid--2">'
          + '<div class="field"><label class="field__label">Nome da iniciativa</label><input class="input" value="Lançamento linha Inverno"></div>'
          + '<div class="field"><label class="field__label">Cliente</label>' + UI.select('noop', DB.core.clients.map(function (c) { return { value: c.id, label: c.name }; }), 'c_casa') + '</div>'
          + '<div class="field"><label class="field__label">Verba total (R$)</label><input class="input" value="18.500"></div>'
          + '<div class="field"><label class="field__label">Período</label><input class="input" value="01/12 a 31/01"></div>'
          + '<div class="field"><label class="field__label">Começar em</label>' + UI.select('noop', DB.agent.pipelineStages.map(function (s) { return { value: s.id, label: s.name }; }), 'st_brief') + '</div>'
          + '<div class="field"><label class="field__label">Meta</label><input class="input" value="ROAS ≥ 4,0"></div>'
          + '</div>'
          + '<div class="row small muted">' + g.ICON('alert', 15) + 'Pode começar direto em <b>Performance Agent</b> se você só quer vincular campanhas que já existem nas contas.</div>',
        foot: UI.btn('Cancelar', { action: 'modal:close' }) + UI.btn(byAgent ? 'Criar com o agente' : 'Criar iniciativa', { variant: 'primary', icon: byAgent ? 'sparkles' : 'plus', action: 'toast:Iniciativa criada e colocada no Kanban (mock)' })
      });
    }
    return '';
  }

  function handle(action) {
    const parts = action.split(':');
    const kind = parts[0];
    const rest = action.slice(kind.length + 1);

    if (kind === 'noop') return;
    if (kind === 'go') { g.Store.set({ modal: null }); g.Router.go(rest); return; }
    if (kind === 'toast') { g.Store.toast(rest); return; }
    if (kind === 'period') { g.Store.set({ period: Number(rest) }); render(); return; }
    if (kind === 'model') { g.Store.set({ modelFilter: rest }); render(); return; }
    if (kind === 'group') { g.Store.set({ boardGroup: rest }); render(); return; }
    if (kind === 'step') { g.Store.set({ onboardingStep: Number(rest) }); render(); return; }
    if (kind === 'filter') { g.Store.setFilter(parts[1], parts.slice(2).join(':')); render(); return; }
    if (kind === 'clear-filters') { g.Store.resetFilters(); render(); return; }
    if (kind === 'filter-go') { g.Store.resetFilters(); g.Store.setFilter(parts[1], parts[2]); g.Router.go('marketing'); render(); return; }
    if (kind === 'filter-stage') { g.Store.resetFilters(); g.Router.go('marketing'); render(); return; }
    if (kind === 'finish-onboarding') { g.Store.toast('Cliente cadastrado e pronto para operar (mock)'); g.Router.go('clients'); return; }
    if (kind === 'ask-nl') { g.Store.set({ nlAnswer: rest }); render(); return; }
    if (kind === 'advance') {
      const m = R.mc(rest);
      if (m && !R.canOperate(g.Store.get().user, m.clientId)) {
        g.Store.toast('Sem permissão para mover esta iniciativa.');
        return;
      }
      if (m) {
        const stages = DB.agent.pipelineStages;
        const i = stages.findIndex(function (s) { return s.id === m.stageId; });
        const next = stages[Math.min(stages.length - 1, i + 1)];
        DB.agent.pipelineEvents.push({
          id: 'pe_live_' + Date.now(), marketingCampaignId: m.id, fromStageId: m.stageId, toStageId: next.id,
          actorType: 'user', actorId: g.Store.get().user, at: new Date(DB.meta.now).toISOString(), durationHours: null,
          note: 'Movido manualmente pelo gestor.'
        });
        m.stageId = next.id; m.stageName = next.name; m.stageSince = DB.meta.now;
        m.status = next.kind === 'human' ? 'aguardando_humano' : next.id === 'st_live' ? 'no_ar' : 'em_fluxo';
        m.pendingAction = { kind: next.kind === 'human' ? 'manual' : 'agent', label: next.kind === 'human' ? 'Decisão do gestor' : next.name + ' em execução', who: next.kind === 'human' ? m.ownerUserId : next.agentId };
        g.Store.toast('Iniciativa movida para ' + next.name);
      }
      render(); return;
    }
    if (kind === 'approve' || kind === 'reject' || kind === 'approve-plan') {
      const id = rest;
      const target = DB.agent.recommendations.find(function (r) { return r.id === id; })
        || DB.agent.mediaPlans.find(function (p) { return p.id === id; })
        || DB.agent.approvals.find(function (a) { return a.id === id; });
      if (!target || !R.canApprove(g.Store.get().user, target.clientId)) {
        g.Store.set({ modal: null });
        g.Store.toast(target ? 'Sem permissão para decidir nesta conta.' : 'Solicitação não encontrada.');
        render();
        return;
      }
      const rec = DB.agent.recommendations.find(function (r) { return r.id === id; });
      if (rec) {
        rec.status = kind === 'reject' ? 'rejected' : 'approved';
        rec.decidedBy = g.Store.get().user;
        rec.decidedAt = new Date(DB.meta.now).toISOString();
      }
      const plan = DB.agent.mediaPlans.find(function (p) { return p.id === id; });
      if (plan) {
        plan.status = kind === 'reject' ? 'rejected' : 'approved';
        plan.approvedBy = g.Store.get().user;
        plan.approvedAt = new Date(DB.meta.now).toISOString();
      }
      DB.agent.approvals.forEach(function (a) {
        if (a.recommendationId === id || a.mediaPlanId === id || a.id === id) {
          a.status = kind === 'reject' ? 'rejected' : 'approved';
          a.decidedAt = new Date(DB.meta.now).toISOString();
          a.decidedBy = g.Store.get().user;
        }
      });
      g.Store.set({ modal: null });
      g.Store.toast(kind === 'reject' ? 'Recusado. A decisão fica no histórico do agente.' : 'Aprovado. Execução enfileirada no n8n com chave de idempotência.');
      render(); return;
    }
    if (kind === 'modal') {
      if (rest === 'close') { g.Store.set({ modal: null }); render(); return; }
      g.Store.set({ modal: { type: parts[1], id: parts.slice(2).join(':') } });
      render(); return;
    }
    if (kind === 'tab') {
      const seg = rest.split('/');
      const target = parts[parts.length - 1];
      g.Router.go(seg[0] + (seg[1] && seg[1] !== '_' ? '/' + seg[1] : '/_') + '/' + target);
      return;
    }
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.classList.contains('modal-backdrop') && e.target.closest('[data-stop]')) return;
    if (el.tagName === 'SELECT') return;
    e.preventDefault();
    handle(el.getAttribute('data-action'));
  });

  document.addEventListener('change', function (e) {
    const el = e.target, action = el.getAttribute('data-action');
    if (!action) return;
    if (action === 'switch-user') {
      g.Store.set({ user: el.value, modal: null, organizationId: null, portalClient: null });
      g.Store.resetFilters();
      g.Router.go(R.scope(el.value).isClient ? 'portal' : 'dashboard');
      render();
      return;
    }
    if (action === 'switch-org') {
      g.Store.set({ organizationId: el.value, modal: null, portalClient: null });
      g.Store.resetFilters();
      g.Router.go(R.scope(g.Store.get().user).isClient ? 'portal' : 'dashboard');
      render();
      return;
    }
    if (action === 'switch-portal-client') { g.Store.set({ portalClient: el.value }); render(); return; }
    if (action === 'go-connections') { g.Router.go('connections/' + el.value); return; }
    if (action.indexOf('filter:') === 0) {
      const key = action.split(':')[1];
      g.Store.setFilter(key, el.value);
      if (key === 'client') g.Store.setFilter('account', 'all');
      render();
    }
  });

  g.Store.subscribe(function () {
    const stack = document.querySelector('.toast-stack');
    const html = g.Shell.toasts();
    if (stack) stack.outerHTML = html || '<div class="toast-stack hidden"></div>';
    else if (html) root.insertAdjacentHTML('beforeend', html);
  });

  g.Router.start(render);
})(window);
