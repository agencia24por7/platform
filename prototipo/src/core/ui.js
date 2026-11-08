(function (g) {
  const F = g.F, ICON = g.ICON;
  function cx() { return Array.prototype.slice.call(arguments).filter(Boolean).join(' '); }

  const STATUS = {
    active: ['Ativo', 'ok'], paused: ['Pausado', 'neutral'], onboarding: ['Onboarding', 'info'],
    connected: ['Conectada', 'ok'], pending: ['Pendente', 'warn'], error: ['Erro', 'danger'],
    approved: ['Aprovado', 'ok'], rejected: ['Recusado', 'danger'], draft: ['Rascunho', 'neutral'],
    success: ['Sucesso', 'ok'], retry: ['Nova tentativa', 'warn'], failed: ['Falhou', 'danger'],
    applied: ['Aplicada', 'ok'], em_curso: ['Em curso', 'info'], fechado: ['Fechado', 'neutral'],
    confirmada: ['Confirmada', 'ok'], invited: ['Convidado', 'info'], suspended: ['Suspenso', 'warn'],
    revoked: ['Revogado', 'danger'], em_fluxo: ['Em fluxo', 'info'], aguardando_humano: ['Aguardando', 'warn'],
    bloqueada: ['Bloqueada', 'danger'], no_ar: ['No ar', 'ok'], encerrada: ['Encerrada', 'neutral'],
    ok: ['Saudável', 'ok'], warn: ['Atenção', 'warn'], danger: ['Crítico', 'danger']
  };

  const UI = {
    cx: cx,
    card: function (o) {
      o = o || {};
      const head = (o.title || o.actions) ? '<div class="card__head"><div class="col" style="gap:0"><span class="card__title">' + (o.title || '') + '</span>' + (o.sub ? '<span class="card__sub">' + o.sub + '</span>' : '') + '</div><span class="spacer"></span>' + (o.actions || '') + '</div>' : '';
      const body = '<div class="' + cx('card__body', o.tight && 'card__body--tight') + '">' + (o.body || '') + '</div>';
      const foot = o.foot ? '<div class="card__foot">' + o.foot + '</div>' : '';
      return '<div class="' + cx('card', o.className) + '"' + (o.style ? ' style="' + o.style + '"' : '') + (o.action ? ' data-action="' + o.action + '" style="cursor:pointer"' : '') + '>' + head + body + foot + '</div>';
    },
    delta: function (v, o) {
      o = o || {};
      if (!isFinite(v) || v === 0) return '<span class="delta delta--flat">—</span>';
      const good = o.inverse ? v < 0 : v > 0;
      return '<span class="delta ' + (good ? 'delta--up' : 'delta--down') + '">' + ICON(v > 0 ? 'arrowUp' : 'arrowDown', 12) + F.pct(Math.abs(v), 1) + '</span>';
    },
    stat: function (o) {
      return '<div class="' + cx('card', o.accent && 'card--accent') + '"><div class="stat">'
        + '<div class="stat__label">' + o.label + '</div><div class="stat__value">' + o.value + '</div>'
        + ((o.delta !== undefined || o.foot) ? '<div class="stat__foot">' + (o.delta !== undefined ? UI.delta(o.delta, { inverse: o.inverse }) : '') + (o.foot ? '<span>' + o.foot + '</span>' : '') + '</div>' : '')
        + '</div>' + (o.spark ? '<div>' + o.spark + '</div>' : '') + '</div>';
    },
    pill: function (label, tone, dot) { return '<span class="' + cx('pill', tone && 'pill--' + tone) + '">' + (dot ? '<span class="pill__dot"></span>' : '') + label + '</span>'; },
    statusPill: function (s) { const m = STATUS[s] || [s, 'neutral']; return UI.pill(m[0], m[1], true); },
    statusLabel: function (s) { return (STATUS[s] || [s])[0]; },
    platform: function (p) { return '<span class="platform platform--' + p + '"><span class="platform__dot"></span>' + (p === 'meta' ? 'Meta Ads' : 'Google Ads') + '</span>'; },
    platformDots: function (list) { return '<span class="row" style="gap:4px">' + list.map(function (p) { return '<span class="platform platform--' + p + '"><span class="platform__dot"></span></span>'; }).join('') + '</span>'; },
    avatar: function (name, o) {
      o = o || {};
      return '<span class="' + cx('avatar', o.lg && 'avatar--lg', o.square && 'avatar--sq', o.alt && 'avatar--alt') + '">' + (o.text || F.initials(name)) + '</span>';
    },
    table: function (cols, rows, o) {
      o = o || {};
      const head = '<thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + (c.width ? ' style="width:' + c.width + '"' : '') + '>' + c.label + '</th>'; }).join('') + '</tr></thead>';
      const body = '<tbody>' + (rows.length ? rows.map(function (r) {
        return '<tr' + (r.__action ? ' class="is-clickable" data-action="' + r.__action + '"' : '') + '>' + cols.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + '>' + (r[c.key] === undefined ? '' : r[c.key]) + '</td>'; }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + cols.length + '"><div class="empty"><span class="small">' + (o.empty || 'Nada por aqui') + '</span></div></td></tr>') + '</tbody>';
      const inner = '<div class="table-wrap"><table class="table">' + head + body + '</table></div>';
      return o.bare ? inner : UI.card({ title: o.title, sub: o.sub, actions: o.actions, body: inner, tight: true, className: o.className });
    },
    tabs: function (items, active, prefix) {
      return '<div class="tabs">' + items.map(function (t) {
        return '<div class="' + cx('tab', t.key === active && 'is-active') + '" data-action="' + prefix + ':' + t.key + '">' + t.label + (t.count ? ' <span class="pill pill--outline">' + t.count + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    },
    chips: function (items, active, prefix) {
      return '<div class="row row--wrap">' + items.map(function (c) {
        return '<span class="' + cx('chip', c.key === active && 'is-active') + '" data-action="' + prefix + ':' + c.key + '">' + c.label + '</span>';
      }).join('') + '</div>';
    },
    select: function (action, options, value, width) {
      return '<select class="select"' + (width ? ' style="width:' + width + '"' : '') + ' data-action="' + action + '">'
        + options.map(function (o) { return '<option value="' + o.value + '"' + (String(o.value) === String(value) ? ' selected' : '') + '>' + o.label + '</option>'; }).join('')
        + '</select>';
    },
    progress: function (pct, tone) { return '<div class="progress"><div class="' + cx('progress__bar', tone && 'progress__bar--' + tone) + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>'; },
    bar: function (v, max, color) { return '<span class="bar-track"><span class="bar-fill" style="width:' + Math.round((v / (max || 1)) * 100) + '%;background:' + (color || 'var(--chart-1)') + '"></span></span>'; },
    steps: function (list, cur, prefix) {
      return '<div class="steps">' + list.map(function (s, i) {
        return '<div class="' + cx('step', i === cur && 'is-active', i < cur && 'is-done') + '" data-action="' + prefix + ':' + i + '"><span class="step__n">' + (i < cur ? '✓' : i + 1) + '</span>' + s + '</div>';
      }).join('') + '</div>';
    },
    empty: function (title, sub, action) { return '<div class="empty"><div class="empty__title">' + title + '</div>' + (sub ? '<div class="small">' + sub + '</div>' : '') + (action || '') + '</div>'; },
    kv: function (pairs) { return '<dl class="kv">' + pairs.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>'; },
    dlInline: function (pairs) { return '<dl class="dl-inline">' + pairs.map(function (p) { return '<div><dt>' + p[0] + '</dt><dd>' + p[1] + '</dd></div>'; }).join('') + '</dl>'; },
    timeline: function (items) {
      return '<div class="timeline">' + items.map(function (i) {
        return '<div class="tl"><div class="tl__dot">' + (i.icon || '•') + '</div><div class="tl__body"><span class="tl__title">' + i.title + '</span>' + (i.text ? '<span class="small muted">' + i.text + '</span>' : '') + '<span class="tl__meta">' + i.meta + '</span></div></div>';
      }).join('') + '</div>';
    },
    btn: function (label, o) {
      o = o || {};
      return '<button class="' + cx('btn', o.variant && 'btn--' + o.variant, o.size && 'btn--' + o.size, o.block && 'btn--block') + '"'
        + (o.action ? ' data-action="' + o.action + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + (o.icon ? ICON(o.icon, 15) : '') + label + '</button>';
    },
    iconBtn: function (icon, action, title) { return '<button class="btn btn--ghost btn--icon" data-action="' + action + '" title="' + (title || '') + '">' + ICON(icon, 16) + '</button>'; },
    switchEl: function (on, action) { return '<span class="' + cx('switch', on && 'is-on') + '" data-action="' + (action || 'noop') + '"></span>'; },
    checkbox: function (on, action) { return '<span class="' + cx('checkbox', on && 'is-on') + '" data-action="' + (action || 'noop') + '">✓</span>'; },
    modal: function (o) {
      return '<div class="modal-backdrop" data-action="modal:close"><div class="' + cx('modal', o.wide && 'modal--wide') + '" data-stop="1">'
        + '<div class="modal__head"><div class="col" style="gap:0"><span class="card__title">' + o.title + '</span>' + (o.sub ? '<span class="card__sub">' + o.sub + '</span>' : '') + '</div><span class="spacer"></span>' + UI.iconBtn('x', 'modal:close') + '</div>'
        + '<div class="modal__body">' + o.body + '</div>'
        + (o.foot ? '<div class="modal__foot">' + o.foot + '</div>' : '') + '</div></div>';
    },
    sev: function (s) { return '<span class="sev sev--' + s + '"></span>'; },
    sevPill: function (s) {
      const m = { high: ['Alta prioridade', 'danger'], mid: ['Média', 'warn'], low: ['Baixa', 'info'], opp: ['Oportunidade', 'ok'] }[s] || ['—', 'neutral'];
      return UI.pill(m[0], m[1]);
    },
    modelPill: function (m) { return m === 'ecommerce' ? UI.pill('E-commerce', 'info') : UI.pill('Leads', 'ok'); },
    autonomyPill: function (lvl) {
      const l = g.DB.agent.autonomyLevels[lvl - 1];
      return UI.pill('Nível ' + lvl + ' · ' + l.label, l.tone);
    },
    scorePill: function (s) { return UI.pill(String(s), s >= 80 ? 'ok' : s >= 60 ? 'warn' : 'danger', true); },
    clientCell: function (c) {
      return '<span class="row" style="gap:10px">' + UI.avatar(c.name, { square: true, alt: c.model === 'ecommerce' })
        + '<span class="col" style="gap:0"><span class="strong">' + c.name + '</span><span class="xsmall subtle">' + c.segment + '</span></span></span>';
    },
    sectionTitle: function (t, s, a) {
      return '<div class="row"><div class="col" style="gap:2px"><span class="strong">' + t + '</span>' + (s ? '<span class="small muted">' + s + '</span>' : '') + '</div><span class="spacer"></span>' + (a || '') + '</div>';
    }
  };
  g.UI = UI;
})(window);
