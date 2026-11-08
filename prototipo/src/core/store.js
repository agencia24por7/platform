(function (g) {
  const listeners = [];
  const state = {
    user: 'u_admin',
    period: 30,
    filters: { client: 'all', account: 'all', portfolio: 'all', platform: 'all', owner: 'all', origin: 'all', status: 'all', scope: 'all' },
    boardGroup: 'stage',
    modelFilter: 'all',
    onboardingStep: 0,
    modal: null,
    toasts: [],
    nlAnswer: null,
    organizationId: null,
    portalClient: null
  };
  g.Store = {
    get: function () { return state; },
    set: function (patch) { Object.assign(state, patch); listeners.forEach(function (fn) { fn(state); }); },
    setFilter: function (k, v) { state.filters[k] = v; listeners.forEach(function (fn) { fn(state); }); },
    resetFilters: function () { state.filters = { client: 'all', account: 'all', portfolio: 'all', platform: 'all', owner: 'all', origin: 'all', status: 'all', scope: 'all' }; },
    subscribe: function (fn) { listeners.push(fn); },
    me: function () { return g.Repo.user(state.user); },
    scope: function () { return g.Repo.scope(state.user); },
    toast: function (msg) {
      state.toasts.push({ id: state.toasts.length + '-' + msg.length, message: msg });
      listeners.forEach(function (fn) { fn(state); });
      setTimeout(function () { state.toasts.shift(); listeners.forEach(function (fn) { fn(state); }); }, 2800);
    }
  };
})(window);
