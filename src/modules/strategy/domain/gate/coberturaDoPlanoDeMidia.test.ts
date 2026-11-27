import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { checarCoberturaDoPlanoDeMidia } from './coberturaDoPlanoDeMidia.ts';

describe('gate: cobertura_do_plano_de_midia', () => {
  it('aprova quando todo campo obrigatório do catálogo está no plano, com justificativa', () => {
    assert.equal(checarCoberturaDoPlanoDeMidia(contextoDeTeste()).resultado, 'aprovado');
  });

  it('falha fechada sem catálogo da plataforma escolhida', () => {
    const r = checarCoberturaDoPlanoDeMidia(contextoDeTeste({ catalogosDeCampos: undefined }));
    assert.equal(r.resultado, 'reprovado');
    assert.equal(r.onde.length, 2);
    assert.ok(r.onde.every((o) => o.includes('sem catálogo')));

    const completo = contextoDeTeste();
    const parcial = checarCoberturaDoPlanoDeMidia({ ...completo, catalogosDeCampos: completo.catalogosDeCampos!.filter((c) => c.plataforma === 'google') });
    assert.equal(parcial.resultado, 'reprovado');
    assert.deepEqual(parcial.onde, ['plano_de_midia/meta (sem catálogo de campos: não é possível conferir)']);
  });

  it('reprova intenção sem plataformas', () => {
    const contexto = contextoDeTeste();
    contexto.plano.intencao.plataformas = undefined;
    assert.equal(checarCoberturaDoPlanoDeMidia(contexto).resultado, 'reprovado');
  });

  it('reprova campo obrigatório ausente e lista onde', () => {
    const contexto = contextoDeTeste();
    const google = contexto.plano.plano_de_midia.plataformas[0]!;
    google.secoes = google.secoes.filter((s) => s.secao !== 'orcamento_e_lances');
    const r = checarCoberturaDoPlanoDeMidia(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['plano_de_midia/google/orcamento_diario (campo obrigatório ausente)']);
  });

  it('plataforma escolhida sem entrada no plano reprova todos os obrigatórios', () => {
    const contexto = contextoDeTeste();
    contexto.plano.plano_de_midia.plataformas = [];
    assert.equal(checarCoberturaDoPlanoDeMidia(contexto).onde.length, 4);
  });

  it('campo opcional pode faltar; presente, tem de ter justificativa', () => {
    const contexto = contextoDeTeste();
    assert.equal(checarCoberturaDoPlanoDeMidia(contexto).resultado, 'aprovado');
    contexto.plano.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.justificativa = '   ';
    const r = checarCoberturaDoPlanoDeMidia(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes('sem justificativa'));
  });

  it('reprova campo fora do catálogo, na seção errada ou com valor de outro tipo', () => {
    const contexto = contextoDeTeste();
    const google = contexto.plano.plano_de_midia.plataformas[0]!;
    google.secoes[0]!.campos.push({ campo: 'inventado', valor: 'x', justificativa: 'j', evidencias: [] });
    google.secoes[1]!.campos[0]!.valor = 'muito';
    google.secoes[0]!.campos[0]!.valor = 'sorteio';
    contexto.plano.plano_de_midia.plataformas[1]!.secoes[1]!.secao = 'objetivo';
    const r = checarCoberturaDoPlanoDeMidia(contexto);
    assert.equal(r.resultado, 'reprovado');
    const texto = r.onde.join('|');
    assert.ok(texto.includes('inventado (campo fora do catálogo)'));
    assert.ok(texto.includes('orcamento_diario (valor fora do tipo numero)'));
    assert.ok(texto.includes('objetivo_da_campanha (valor fora do tipo escolha)'));
    assert.ok(texto.includes('posicionamento_automatico (na seção objetivo; o catálogo pede posicionamentos)'));
  });

  it('url_de_destino, numero_do_whatsapp e parametros_de_url precisam ser os da intenção', () => {
    const catalogo = {
      plataforma: 'meta' as const,
      versaoDaApi: 'v99',
      objetivos: ['leads'],
      campoDoObjetivo: 'objetivo_da_campanha',
      campos: [
        { chave: 'objetivo_da_campanha', secao: 'objetivo', obrigatorio: true, tipoDoValor: 'texto' as const },
        { chave: 'url_de_destino', secao: 'conversao', obrigatorio: true, tipoDoValor: 'texto' as const },
        { chave: 'parametros_de_url', secao: 'conversao', obrigatorio: true, tipoDoValor: 'texto' as const },
        { chave: 'numero_do_whatsapp', secao: 'conversao', obrigatorio: true, tipoDoValor: 'texto' as const },
      ],
    };
    const base = contextoDeTeste();
    const intencao = { ...base.plano.intencao, plataformas: ['meta' as const] };
    const utm = intencao.utm!.meta!;
    const campo = (nome: string, valor: string) => ({ campo: nome, valor, justificativa: 'copiado da intenção', evidencias: [] });
    const comValores = (url: string, parametros: string, zap: string) => ({
      ...base,
      catalogosDeCampos: [catalogo],
      plano: {
        ...base.plano,
        intencao,
        plano_de_midia: { plataformas: [{ plataforma: 'meta' as const, secoes: [{ secao: 'objetivo', campos: [campo('objetivo_da_campanha', 'leads')] }, { secao: 'conversao', campos: [campo('url_de_destino', url), campo('parametros_de_url', parametros), campo('numero_do_whatsapp', zap)] }] }] },
      },
    });
    const certos = `utm_source=${utm.utm_source}&utm_medium=${utm.utm_medium}&utm_campaign=${utm.utm_campaign}`;
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores(intencao.destino!.url, certos, intencao.whatsapp!)).resultado, 'aprovado');
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores('https://outro.com', certos, intencao.whatsapp!)).resultado, 'reprovado');
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores(intencao.destino!.url, 'utm_source=inventada', intencao.whatsapp!)).resultado, 'reprovado');
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores(intencao.destino!.url, certos, '+5511900000000')).resultado, 'reprovado');
  });

  describe('obrigatoriedade condicional, a confirmar e dependências', () => {
    const campoCat = (chave: string, tipoDoValor: 'texto' | 'numero' | 'booleano' | 'lista' | 'escolha', extra: Record<string, unknown> = {}) => ({
      chave,
      secao: chave.startsWith('adset_') || chave.startsWith('tg_') ? 'adset' : 'campaign',
      obrigatorio: false,
      tipoDoValor,
      ...extra,
    });
    const catalogoMeta = () => ({
      plataforma: 'meta' as const,
      versaoDaApi: 'v99',
      objetivos: ['leads', 'app_promotion'],
      campoDoObjetivo: 'campaign_objective',
      campos: [
        campoCat('campaign_objective', 'escolha', { obrigatorio: true, opcoes: ['OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION'] }),
        campoCat('adset_po_application_id', 'texto', { obrigatorio: true, aplicavelA: ['app_promotion'] }),
        campoCat('ad_name', 'texto', { obrigatorio: true, evidenciaDaApi: 'nao_verificado_pela_api' }),
        campoCat('adset_bid_strategy', 'escolha', { opcoes: ['COST_CAP', 'LOWEST_COST_WITHOUT_CAP'] }),
        campoCat('adset_bid_amount', 'numero'),
        campoCat('adset_daily_budget', 'numero'),
        campoCat('adset_lifetime_budget', 'numero'),
        campoCat('adset_end_time', 'texto'),
        campoCat('adset_pacing_type', 'lista'),
        campoCat('adset_schedule', 'lista'),
        campoCat('tg_age_min', 'numero'),
        campoCat('adset_targeting_automation', 'booleano'),
      ],
    });
    const rodar = (campos: Record<string, string | number | boolean | string[]>, objetivo = 'OUTCOME_LEADS', catalogo: object | null = catalogoMeta()) => {
      const base = contextoDeTeste();
      const intencao = { ...base.plano.intencao, plataformas: ['meta' as const] };
      const todos: Record<string, string | number | boolean | string[]> = { campaign_objective: objetivo, ad_name: 'a_confirmar', adset_daily_budget: 1000, ...campos };
      const secoes = new Map<string, { campo: string; valor: string | number | boolean | string[]; justificativa: string; evidencias: [] }[]>();
      for (const [chave, valor] of Object.entries(todos)) {
        if (valor === undefined) continue;
        const secao = chave.startsWith('adset_') || chave.startsWith('tg_') ? 'adset' : chave === 'ad_name' ? 'ad' : 'campaign';
        const lista = secoes.get(secao) ?? [];
        lista.push({ campo: chave, valor, justificativa: 'j', evidencias: [] });
        secoes.set(secao, lista);
      }
      const catalogoFinal = catalogo === null ? undefined : [catalogo as ReturnType<typeof catalogoMeta>];
      const catalogoComSecaoDoAd = catalogoFinal?.map((c) => ({ ...c, campos: c.campos.map((campo) => (campo.chave === 'ad_name' ? { ...campo, secao: 'ad' } : campo)) }));
      return checarCoberturaDoPlanoDeMidia({
        ...base,
        catalogosDeCampos: catalogoComSecaoDoAd,
        plano: {
          ...base.plano,
          intencao,
          plano_de_midia: { plataformas: [{ plataforma: 'meta' as const, secoes: [...secoes].map(([secao, campos]) => ({ secao, campos })) }] },
        },
      });
    };

    it('campo obrigatório aplicável ao objetivo ausente reprova; não aplicável não reprova', () => {
      const semAplicavel = rodar({});
      assert.equal(semAplicavel.resultado, 'aprovado');
      const app = rodar({}, 'OUTCOME_APP_PROMOTION');
      assert.equal(app.resultado, 'reprovado');
      assert.ok(app.onde.some((o) => o.includes('adset_po_application_id (campo obrigatório ausente)')));
      assert.equal(rodar({ adset_po_application_id: 'app1' }, 'OUTCOME_APP_PROMOTION').resultado, 'aprovado');
    });

    it('objetivo ausente ou fora do catálogo reprova (falha fechada)', () => {
      const r = rodar({}, 'OUTCOME_SORTEIO');
      assert.equal(r.resultado, 'reprovado');
      assert.ok(r.onde.some((o) => o.includes('objetivo ausente ou fora do catálogo') || o.includes('valor fora do tipo')));
    });

    it("campo não verificado pela API declarado 'a confirmar' vira pendência, não reprova", () => {
      const r = rodar({});
      assert.equal(r.resultado, 'aprovado');
      assert.deepEqual(r.onde, ['plano_de_midia/meta/ad_name (a confirmar; a API não verifica este campo)']);
    });

    it("'a confirmar' em campo comprovado reprova", () => {
      const r = rodar({ adset_end_time: 'a_confirmar' });
      assert.equal(r.resultado, 'reprovado');
      assert.ok(r.onde.some((o) => o.includes('adset_end_time (a_confirmar só vale')));
    });

    it('sem catálogo reprova', () => {
      assert.equal(rodar({}, 'OUTCOME_LEADS', null).resultado, 'reprovado');
    });

    it('dependência violada reprova', () => {
      const texto = (campos: Record<string, string | number | boolean | string[]>) => rodar(campos).onde.join('|');
      assert.ok(texto({ adset_bid_strategy: 'COST_CAP' }).includes('adset_bid_amount (obrigatório com COST_CAP)'));
      assert.ok(texto({ adset_bid_strategy: 'LOWEST_COST_WITHOUT_CAP', adset_bid_amount: 100 }).includes('proibido com LOWEST_COST_WITHOUT_CAP'));
      assert.ok(texto({ adset_daily_budget: undefined as never, adset_lifetime_budget: 5000 }).includes('adset_end_time (obrigatório com orçamento vitalício)'));
      assert.ok(texto({ adset_pacing_type: ['day_parting'] }).includes('day_parting exige orçamento vitalício'));
      assert.ok(texto({ adset_daily_budget: 100 }).includes('abaixo do mínimo de 570 centavos'));
      assert.ok(texto({ tg_age_min: 25 }).includes('adset_targeting_automation (obrigatório'));
      assert.equal(rodar({ adset_bid_strategy: 'COST_CAP', adset_bid_amount: 300, adset_daily_budget: 570 }).resultado, 'aprovado');
    });
  });
});
