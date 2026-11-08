(function (g) {
  const UI = g.UI, R = g.Repo, F = g.F, C = g.CHART, ICON = g.ICON, DB = g.DB;
  g.PAGES = g.PAGES || {};

  g.PAGES.performance = function (route) {
    const st = g.Store.get(), sc = R.scope(g.Store.me().id);
    const tab = route.tab || 'cross';
    const tabsEl = UI.tabs([
      { key: 'cross', label: 'Cross-account' },
      { key: 'anomalias', label: 'Anomalias', count: R.alertsOf().filter(function (a) { return sc.clientIds.indexOf(a.clientId) >= 0; }).length },
      { key: 'oportunidades', label: 'Oportunidades', count: R.budgetOpportunities(14).length },
      { key: 'dados', label: 'Qualidade do dado' },
      { key: 'auditorias', label: 'Auditorias' }
    ], tab, 'tab:performance/_');

    const ask = UI.card({
      className: 'card--accent',
      title: 'Pergunte à carteira inteira',
      sub: 'Em vez de abrir ' + sc.accountIds.length + ' contas, pergunte. Vale filtro tradicional ou linguagem natural.',
      body: '<div class="row"><span class="search" style="flex:1">' + ICON('search', 15) + '<input class="input" placeholder="Ex.: quais contas estão com CPL acima da meta?"></span>'
        + UI.btn('Perguntar', { variant: 'primary', icon: 'agent', action: 'ask-nl:nq_1' }) + '</div>'
        + '<div class="row row--wrap">' + DB.agent.crossQuestions.map(function (q) {
          return '<span class="chip' + (st.nlAnswer === q.id ? ' is-active' : '') + '" data-action="ask-nl:' + q.id + '">' + q.question + '</span>';
        }).join('') + '</div>'
        + (st.nlAnswer ? answer(st.nlAnswer, st.period, sc) : '')
    });

    const body = { cross: tabCross, anomalias: tabAnom, oportunidades: tabOpp, dados: tabData, auditorias: tabAudits }[tab](st.period, sc);

    return {
      nav: 'performance', title: 'Performance', right: g.Shell.periodPicker(st.period),
      content: '<div class="page__head"><div><div class="page__title">Performance Intelligence</div>'
        + '<div class="page__sub">Comparação entre contas, anomalia contra baseline, oportunidade de orçamento e qualidade do dado que sustenta cada decisão.</div></div></div>'
        + ask + tabsEl + body
    };
  };

  function answer(id, period, sc) {
    const q = DB.agent.crossQuestions.find(function (x) { return x.id === id; });
    if (!q) return '';
    let evidence = '';
    if (q.kind === 'cpl') {
      const rows = R.clientRows(period, sc.clientIds).filter(function (c) { return c.model === 'leads'; });
      evidence = UI.table([{ key: 'c', label: 'Cliente' }, { key: 'cpl', label: 'CPL', num: true }, { key: 'g', label: 'Meta', num: true }, { key: 'q', label: 'CPL qualificado', num: true }, { key: 's', label: '' }],
        rows.map(function (c) {
          const over = c.metrics.cpl > c.goalCpl;
          return {
            __action: 'go:clients/' + c.id, c: '<span class="small">' + c.name + '</span>',
            cpl: '<span class="num strong">' + F.moneyCents(c.metrics.cpl) + '</span>',
            g: '<span class="num muted">' + F.moneyCents(c.goalCpl) + '</span>',
            q: '<span class="num muted">' + F.moneyCents(c.metrics.cpql) + '</span>',
            s: UI.pill(over ? 'Acima da meta' : 'Dentro', over ? 'danger' : 'ok', true)
          };
        }), { bare: true });
    } else if (q.kind === 'waste') {
      evidence = UI.table([{ key: 'n', label: 'Campanha' }, { key: 'c', label: 'Cliente' }, { key: 'a', label: 'Conta' }, { key: 's', label: 'Gasto 7d', num: true }],
        R.wasteCampaigns(7).map(function (r) {
          return { __action: 'modal:campaign:' + r.id, n: '<span class="small">' + r.name + '</span>', c: '<span class="small muted">' + R.client(r.clientId).name + '</span>', a: '<span class="small muted">' + R.account(r.adAccountId).group + '</span>', s: '<span class="num strong">' + F.money(r.metrics.spend) + '</span>' };
        }), { bare: true });
    } else if (q.kind === 'opportunity') {
      evidence = UI.table([{ key: 'n', label: 'Campanha' }, { key: 'c', label: 'Cliente' }, { key: 'i', label: 'Perda por orçamento', num: true }, { key: 'u', label: '+10%/dia', num: true }],
        R.budgetOpportunities(14).slice(0, 6).map(function (r) {
          return { __action: 'modal:campaign:' + r.id, n: '<span class="small">' + r.name + '</span>', c: '<span class="small muted">' + R.client(r.clientId).name + '</span>', i: '<span class="num delta delta--down">' + r.impressionShareLost + '%</span>', u: '<span class="num strong">' + F.money(r.budgetDaily * .1) + '</span>' };
        }), { bare: true });
    } else if (q.kind === 'gap') {
      evidence = UI.table([{ key: 'c', label: 'Cliente' }, { key: 'd', label: 'Declarado', num: true }, { key: 'cf', label: 'Confirmado', num: true }, { key: 'g', label: 'Desvio', num: true }, { key: 'f', label: 'Fonte' }, { key: 's', label: '' }],
        DB.metrics.reconciliation.filter(function (r) { return sc.clientIds.indexOf(r.clientId) >= 0; }).sort(function (a, b) { return b.gap - a.gap; }).map(function (r) {
          return {
            __action: 'go:clients/' + r.clientId, c: '<span class="small">' + R.client(r.clientId).name + '</span>',
            d: '<span class="num">' + F.number(r.declared) + '</span>', cf: '<span class="num">' + F.number(r.confirmed) + '</span>',
            g: '<span class="num strong">' + F.pct(r.gap, 0) + '</span>', f: '<span class="small muted">' + r.source + '</span>',
            s: UI.pill(r.status === 'ok' ? 'Dentro' : r.status === 'atencao' ? 'Atenção' : 'Alerta', r.status === 'ok' ? 'ok' : r.status === 'atencao' ? 'warn' : 'danger', true)
          };
        }), { bare: true });
    } else {
      evidence = UI.table([{ key: 'c', label: 'Cliente' }, { key: 's', label: 'Investido', num: true }, { key: 'd', label: 'Variação', num: true }],
        R.clientRows(period, sc.clientIds).filter(function (c) { return c.deltaSpend > 0; }).sort(function (a, b) { return b.deltaSpend - a.deltaSpend; }).map(function (c) {
          return { __action: 'go:clients/' + c.id, c: '<span class="small">' + c.name + '</span>', s: '<span class="num">' + F.money(c.metrics.spend) + '</span>', d: UI.delta(c.deltaSpend) };
        }), { bare: true });
    }
    return '<div class="msg"><span class="avatar avatar--alt">PI</span><div class="msg__bubble" style="flex:1"><p>' + q.answer + '</p></div></div>'
      + '<div class="card card--flat">' + evidence + '</div>'
      + '<span class="xsmall subtle">Resposta do Portfolio Intelligence Agent. Padrões agregados são permitidos; dados confidenciais de um cliente nunca aparecem para outro.</span>';
  }

  function tabCross(period, sc) {
    const rows = R.clientRows(period, sc.clientIds);
    function block(title, list, isE) {
      if (!list.length) return '';
      const max = Math.max.apply(null, list.map(function (c) { return isE ? c.metrics.roasConfirmed : c.metrics.cpl; }).concat([1]));
      return UI.table([
        { key: 'c', label: 'Cliente', width: '20%' }, { key: 'sp', label: 'Investido', num: true },
        { key: 'res', label: isE ? 'Receita conf.' : 'Leads', num: true }, { key: 'eff', label: isE ? 'ROAS conf.' : 'CPL', num: true },
        { key: 'bar', label: '', width: '12%' }, { key: 'ctr', label: 'CTR', num: true }, { key: 'cpm', label: 'CPM', num: true },
        { key: 'cv', label: 'Conversão', num: true }, { key: 'gap', label: 'Desvio', num: true }, { key: 'g', label: 'Meta' }
      ], list.map(function (c) {
        const gs = R.goalStatus(c, c.metrics);
        return {
          __action: 'go:clients/' + c.id, c: UI.clientCell(c),
          sp: '<span class="num">' + F.money(c.metrics.spend) + '</span>',
          res: '<span class="num">' + (isE ? F.money(c.metrics.revenueConfirmed) : F.number(c.metrics.leads)) + '</span>',
          eff: '<span class="num strong">' + (isE ? F.ratio(c.metrics.roasConfirmed) : F.moneyCents(c.metrics.cpl)) + '</span>',
          bar: UI.bar(isE ? c.metrics.roasConfirmed : c.metrics.cpl, max, gs.ok ? 'var(--chart-1)' : 'var(--chart-5)'),
          ctr: '<span class="num">' + F.pct(c.metrics.ctr, 2) + '</span>',
          cpm: '<span class="num">' + F.moneyCents(c.metrics.cpm) + '</span>',
          cv: '<span class="num">' + F.pct(c.metrics.convRate) + '</span>',
          gap: '<span class="num ' + (c.metrics.gap > .2 ? 'delta delta--down' : 'muted') + '">' + F.pct(c.metrics.gap, 0) + '</span>',
          g: UI.pill(gs.ok ? 'Na meta' : 'Fora', gs.ok ? 'ok' : 'danger', true)
        };
      }), { title: title, sub: 'Benchmark interno — mesma régua entre operações comparáveis' });
    }
    return block('Geração de leads', rows.filter(function (c) { return c.model === 'leads'; }), false)
      + block('E-commerce', rows.filter(function (c) { return c.model === 'ecommerce'; }), true);
  }

  function tabAnom(period, sc) {
    const recs = DB.agent.recommendations.filter(function (r) { return r.severity !== 'opp' && sc.clientIds.indexOf(r.clientId) >= 0; });
    return '<div class="grid grid--2a">'
      + UI.card({
        title: 'Anomalias detectadas', sub: 'Comparadas com o baseline sazonal da própria conta, não com o período anterior cru', tight: true,
        body: recs.map(function (r) {
          return '<div class="rec">' + UI.sev(r.severity) + '<div class="col" style="gap:4px">'
            + '<div class="row"><span class="rec__title">' + r.title + '</span><span class="spacer"></span>' + UI.sevPill(r.severity) + '</div>'
            + '<span class="small muted">' + R.client(r.clientId).name + ' · ' + r.period + '</span>'
            + '<div class="rec__grid"><div><b>Evidência</b>' + r.evidence + '</div><div><b>Causa provável</b>' + r.cause + '</div></div>'
            + '<div class="row" style="margin-top:4px">' + UI.btn('Ver no agente', { size: 'sm', action: 'go:agent/' + r.clientId + '/otimizacoes' }) + '</div></div></div>';
        }).join('') || UI.empty('Nenhuma anomalia aberta')
      })
      + UI.card({
        title: 'Regras de alerta', tight: true,
        body: UI.table([{ key: 'l', label: 'Regra' }, { key: 's', label: 'Escopo' }, { key: 't', label: 'Disparos', num: true }, { key: 'o', label: '' }],
          DB.automation.alertRules.map(function (r) {
            return {
              l: '<span class="col" style="gap:0"><span class="small strong">' + r.label + '</span><span class="xsmall subtle">' + r.condition + '</span></span>',
              s: '<span class="small muted">' + r.scope + '</span>', t: '<span class="num">' + r.triggered + '</span>', o: UI.switchEl(r.active, 'noop')
            };
          }), { bare: true })
      })
      + '</div>';
  }

  function tabOpp(period, sc) {
    const opps = R.budgetOpportunities(14);
    const waste = R.wasteCampaigns(7);
    const up = opps.reduce(function (a, r) { return a + r.budgetDaily * .1; }, 0);
    const wasted = waste.reduce(function (a, r) { return a + r.metrics.spend; }, 0);
    return '<div class="grid grid--4">'
      + UI.stat({ label: 'Limitadas por orçamento', value: String(opps.length), foot: 'dentro da meta de eficiência' })
      + UI.stat({ label: 'Aumento possível', value: F.money(up) + '/dia', foot: 'dentro do limite de 10%' })
      + UI.stat({ label: 'Gasto sem conversão (7d)', value: F.money(wasted), foot: waste.length + ' campanhas' })
      + UI.stat({ label: 'Realocação líquida', value: F.money(wasted / 7 + up) + '/dia', foot: 'aplicando os dois lados' })
      + '</div>'
      + '<div class="grid grid--2">'
      + UI.table([{ key: 'n', label: 'Campanha' }, { key: 'c', label: 'Cliente' }, { key: 'e', label: 'Eficiência', num: true }, { key: 'i', label: 'Perda orç.', num: true }, { key: 'u', label: '+10%', num: true }],
        opps.slice(0, 8).map(function (r) {
          const cl = R.client(r.clientId);
          return {
            __action: 'modal:campaign:' + r.id, n: '<span class="small strong">' + r.name + '</span>',
            c: '<span class="small muted">' + cl.name + '</span>',
            e: '<span class="num">' + (cl.model === 'ecommerce' ? F.ratio(r.metrics.roasConfirmed) : F.moneyCents(r.metrics.cpl)) + '</span>',
            i: '<span class="num delta delta--down">' + r.impressionShareLost + '%</span>',
            u: '<span class="num strong">' + F.money(r.budgetDaily * .1) + '</span>'
          };
        }), { title: 'Onde aumentar orçamento', actions: UI.btn('Propor em massa', { size: 'sm', icon: 'bolt', action: 'go:accounts/bulk' }) })
      + UI.table([{ key: 'n', label: 'Campanha' }, { key: 'c', label: 'Cliente' }, { key: 's', label: 'Gasto 7d', num: true }, { key: 'v', label: 'Conversões', num: true }],
        waste.map(function (r) {
          return { __action: 'modal:campaign:' + r.id, n: '<span class="small strong">' + r.name + '</span>', c: '<span class="small muted">' + R.client(r.clientId).name + '</span>', s: '<span class="num">' + F.money(r.metrics.spend) + '</span>', v: '<span class="num">0</span>' };
        }), { title: 'Onde cortar desperdício', actions: UI.btn('Propor em massa', { size: 'sm', icon: 'bolt', action: 'go:accounts/bulk' }) })
      + '</div>';
  }

  function tabData(period, sc) {
    const recon = DB.metrics.reconciliation.filter(function (r) { return sc.clientIds.indexOf(r.clientId) >= 0; }).sort(function (a, b) { return b.gap - a.gap; });
    const q = DB.agent.quality;
    return '<div class="grid grid--2a">'
      + UI.table([
        { key: 'c', label: 'Cliente', width: '22%' }, { key: 'd', label: 'Declarado', num: true }, { key: 'cf', label: 'Confirmado', num: true },
        { key: 'g', label: 'Desvio', num: true }, { key: 'bar', label: '', width: '14%' }, { key: 'f', label: 'Fonte da verdade' }, { key: 's', label: 'Status' }
      ], recon.map(function (r) {
        return {
          __action: 'go:clients/' + r.clientId,
          c: UI.clientCell(R.client(r.clientId)),
          d: '<span class="num">' + F.number(r.declared) + '</span>', cf: '<span class="num">' + F.number(r.confirmed) + '</span>',
          g: '<span class="num strong">' + F.pct(r.gap, 0) + '</span>',
          bar: UI.bar(r.gap, .4, r.gap > .3 ? 'var(--chart-5)' : r.gap > .2 ? 'var(--chart-4)' : 'var(--chart-1)'),
          f: '<span class="small muted">' + r.source + '</span>',
          s: UI.pill(r.status === 'ok' ? 'Dentro' : r.status === 'atencao' ? 'Atenção' : 'Alerta', r.status === 'ok' ? 'ok' : r.status === 'atencao' ? 'warn' : 'danger', true)
        };
      }), { title: 'Conversão declarada × confirmada', sub: 'Realocação entre canais só usa o número confirmado. Desvio acima de 20% suspende recomendações de orçamento.' })
      + UI.card({
        title: 'Qualidade do agente', sub: q.samples + ' casos avaliados',
        body: UI.kv([
          ['Taxa de aprovação', F.pct(q.approvalRate, 0) + ' <span class="xsmall subtle">(limiar ' + F.pct(q.threshold.approvalRate, 0) + ')</span>'],
          ['Taxa de acerto', F.pct(q.successRate, 0) + ' <span class="xsmall subtle">(limiar ' + F.pct(q.threshold.successRate, 0) + ')</span>'],
          ['Tempo até impacto', q.avgTimeToImpact],
          ['Precisão de fonte', F.pct(q.sourceAccuracy, 0)],
          ['Reversões', F.pct(q.reversalRate, 0)],
          ['Custo por recomendação aceita', F.moneyCents(q.costPerAccepted)]
        ]) + '<div class="divider"></div>'
          + '<span class="small muted">A autonomia só sobe de nível quando aprovação e acerto passam do limiar com volume mínimo de casos. Hoje: ' + (q.approvalRate >= q.threshold.approvalRate && q.successRate >= q.threshold.successRate && q.samples >= q.threshold.samples ? '<b style="color:var(--c-ok)">elegível</b>' : '<b style="color:var(--c-warn)">ainda não elegível</b>') + '.</span>'
      })
      + '</div>'
      + UI.table([{ key: 'a', label: 'Agente' }, { key: 'm', label: 'Métrica' }, { key: 'v', label: 'Valor', num: true }, { key: 's', label: '' }],
        q.byAgent.map(function (x) {
          const ag = R.agent(x.agentId);
          return {
            a: '<span class="row" style="gap:8px">' + UI.avatar(ag.name, { text: ag.short, alt: true }) + '<span class="small strong">' + ag.name + '</span></span>',
            m: '<span class="small muted">' + x.metric + '</span>', v: '<span class="num strong">' + x.value + '</span>',
            s: UI.pill(x.ok ? 'No limiar' : 'Abaixo', x.ok ? 'ok' : 'warn', true)
          };
        }), { title: 'Qualidade por agente', sub: 'É isso que autoriza (ou não) subir o nível de autonomia' });
  }

  function tabAudits(period, sc) {
    const rows = R.accountRows(period, sc.accountIds).sort(function (a, b) { return a.audit.score - b.audit.score; });
    const fails = {};
    rows.forEach(function (a) { a.audit.findings.forEach(function (f) { if (f.status === 'fail') fails[f.label] = (fails[f.label] || 0) + 1; }); });
    const top = Object.keys(fails).map(function (k) { return { label: k, value: fails[k] }; }).sort(function (a, b) { return b.value - a.value; });
    return '<div class="grid grid--2a">'
      + UI.table([{ key: 'a', label: 'Conta' }, { key: 'c', label: 'Cliente' }, { key: 'p', label: 'Plataforma' }, { key: 'f', label: 'Falhas', num: true }, { key: 'w', label: 'Atenção', num: true }, { key: 's', label: 'Nota', num: true }],
        rows.map(function (a) {
          return {
            __action: 'go:accounts/' + a.id + '/auditoria',
            a: '<span class="small strong">' + a.name + '</span>', c: '<span class="small muted">' + a.client.name + '</span>', p: UI.platform(a.platform),
            f: '<span class="num">' + a.audit.findings.filter(function (f) { return f.status === 'fail'; }).length + '</span>',
            w: '<span class="num">' + a.audit.findings.filter(function (f) { return f.status === 'warn'; }).length + '</span>',
            s: UI.scorePill(a.audit.score)
          };
        }), { title: 'Saúde das contas', sub: 'Da pior para a melhor nota' })
      + UI.card({
        title: 'Falhas mais comuns',
        body: C.bars(top.map(function (f) { return { value: f.value }; }), { height: 150 })
          + '<div class="col">' + top.map(function (f) { return '<div class="row small"><span>' + f.label + '</span><span class="spacer"></span><span class="num strong">' + f.value + ' contas</span></div>'; }).join('') + '</div>'
      })
      + '</div>';
  }
})(window);
