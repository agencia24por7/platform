(function (g) {
  const UI = g.UI, ICON = g.ICON;
  g.PAGES = g.PAGES || {};
  g.PAGES.login = function () {
    return {
      bare: true,
      content: '<div class="login">'
        + '<div class="login__form"><div class="login__card">'
        + '<div class="row" style="gap:10px"><span class="brand__mark" style="width:34px;height:34px">T</span><span class="brand__name" style="font-size:var(--fs-lg)">tria</span></div>'
        + '<div class="col" style="gap:4px"><span class="page__title" style="font-size:var(--fs-lg)">Entrar na plataforma</span>'
        + '<span class="muted small">Acesso da equipe da agência, parceiros e clientes autorizados.</span></div>'
        + UI.btn('Continuar com Google', { variant: 'primary', size: 'lg', block: true, icon: 'plug', action: 'go:dashboard' })
        + '<div class="row"><span class="divider" style="flex:1"></span><span class="xsmall subtle">ou</span><span class="divider" style="flex:1"></span></div>'
        + '<div class="field"><label class="field__label">E-mail corporativo</label><input class="input" value="marina@amigo.com.br"></div>'
        + '<div class="field"><label class="field__label">Senha</label><input class="input" type="password" value="••••••••••"></div>'
        + UI.btn('Entrar', { size: 'lg', block: true, action: 'go:dashboard' })
        + '<span class="xsmall subtle">Protótipo navegável. O perfil de acesso pode ser trocado no topo depois de entrar — cada um enxerga apenas o que a tabela <span class="mono">members</span> concede.</span>'
        + '</div></div>'
        + '<div class="login__aside">'
        + '<div class="login__quote">Gestão multi-conta e um time de agentes que pesquisa, planeja, publica e otimiza — com aprovação, limites e auditoria em cada passo.</div>'
        + '<div class="col" style="gap:14px;max-width:460px">'
        + ['Kanban de campanhas de marketing com uma coluna por agente', 'Contas de anúncio independentes, com MCC e Business Manager', 'Acesso N:N por members — um usuário, várias contas', 'Conversão declarada × confirmada antes de qualquer realocação', 'Execução via n8n com idempotência, reversão e kill switch'].map(function (t) {
          return '<div class="row" style="gap:10px"><span class="avatar" style="width:22px;height:22px">' + ICON('check', 13) + '</span><span class="small">' + t + '</span></div>';
        }).join('')
        + '</div></div></div>'
    };
  };
})(window);
