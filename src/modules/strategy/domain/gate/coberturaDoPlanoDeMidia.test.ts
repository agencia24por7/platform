import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { catalogoMeta } from '../catalogo/meta.ts';
import type { CatalogoDeCampos } from '../catalogo/tipos.ts';
import type { CampoDeMidia, IntencaoDoPlano } from '../plano.ts';
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

  describe('destino, UTM e WhatsApp no catálogo real da Meta', () => {
    const campo = (nome: string, valor: CampoDeMidia['valor']) => ({ campo: nome, valor, justificativa: 'copiado da intenção', evidencias: [] });
    const cenario = (valores: { link: string; cta?: string; tags?: string; zap?: string }, catalogo: CatalogoDeCampos = catalogoMeta) => {
      const base = contextoDeTeste();
      const intencao = { ...base.plano.intencao, plataformas: ['meta' as const] };
      const nomes = new Set(catalogo.campos.map((c) => c.chave));
      const colocados = [
        campo('creative_link', valores.link),
        campo('adset_daily_budget', 1000),
        ...(valores.cta === undefined ? [] : [campo('creative_cta_link', valores.cta)]),
        ...(valores.tags === undefined ? [] : [campo('creative_url_tags', valores.tags)]),
        ...(valores.zap === undefined ? [] : [campo('adset_po_whatsapp_phone', valores.zap)]),
      ].filter((c) => nomes.has(c.campo));
      const doCatalogo = catalogo.campos.filter((c) => c.obrigatorio && c.aplicavelA === undefined && !colocados.some((p) => p.campo === c.chave));
      const obrigatorios = doCatalogo.map((c) => campo(c.chave, c.tipoDoValor === 'lista' ? [] : c.tipoDoValor === 'booleano' ? true : c.tipoDoValor === 'numero' ? 1 : c.tipoDoValor === 'escolha' ? c.opcoes![0]! : c.evidenciaDaApi === 'nao_verificado_pela_api' ? 'a_confirmar' : 'x'));
      const porSecao = new Map<string, CampoDeMidia[]>();
      for (const c of [...obrigatorios, ...colocados]) {
        const secao = catalogo.campos.find((k) => k.chave === c.campo)!.secao;
        porSecao.set(secao, [...(porSecao.get(secao) ?? []), c]);
      }
      const secoes = [...porSecao].map(([secao, campos]) => ({ secao, campos }));
      return { intencao, contexto: { ...base, catalogosDeCampos: [catalogo], plano: { ...base.plano, intencao, plano_de_midia: { plataformas: [{ plataforma: 'meta' as const, secoes }] } } } };
    };
    const utmCerto = (intencao: IntencaoDoPlano) => {
      const utm = intencao.utm!.meta!;
      return `utm_source=${utm.utm_source}&utm_medium=${utm.utm_medium}&utm_campaign=${utm.utm_campaign}`;
    };
    const veredito = (c: ReturnType<typeof cenario>['contexto']) => checarCoberturaDoPlanoDeMidia(c);

    it('valor exato da intenção aprova', () => {
      const { intencao, contexto } = cenario({ link: 'https://exemplo.com.br/oferta', cta: 'https://exemplo.com.br/oferta', zap: '+5511912345678' });
      const exato = cenario({ link: intencao.destino!.url, cta: intencao.destino!.url, tags: utmCerto(intencao), zap: intencao.whatsapp! });
      assert.equal(veredito(exato.contexto).resultado, 'aprovado');
      assert.ok(veredito(exato.contexto).onde.every((o) => o.includes('a confirmar')));
      assert.ok(contexto);
    });

    it('Meta: campo de app fora de app_promotion não reprova por objetivo', () => {
      const { intencao, contexto } = cenario({ link: 'x' });
      const exato = cenario({ link: intencao.destino!.url, tags: utmCerto(intencao) });
      const secoes = exato.contexto.plano.plano_de_midia.plataformas[0]!.secoes;
      const todos = secoes.flatMap((secao) => secao.campos);
      todos.find((c) => c.campo === 'campaign_objective')!.valor = 'OUTCOME_TRAFFIC';
      const conjunto = secoes.find((secao) => secao.secao === 'adset')!;
      const antes = veredito(exato.contexto).onde.filter((o) => !o.includes('a confirmar'));
      const destino = todos.find((c) => c.campo === 'adset_destination_type');
      if (destino === undefined) conjunto.campos.push(campo('adset_destination_type', 'APP'));
      else destino.valor = 'APP';
      conjunto.campos.push(campo('adset_po_application_id', '123'), campo('adset_po_store_url', 'https://exemplo.com/app'));
      const r = veredito(exato.contexto);
      assert.equal(r.resultado, 'aprovado');
      assert.ok(!r.onde.some((o) => o.includes('não se aplica ao objetivo')));
      assert.ok(!r.onde.some((o) => o.includes('adset_po_application_id') || o.includes('adset_po_store_url')));
      assert.deepEqual(r.onde.filter((o) => !o.includes('a confirmar')), antes);
      assert.ok(contexto);
    });

    it('domínio de terceiro reprova, no link e no CTA', () => {
      const { intencao } = cenario({ link: 'x' });
      const r = veredito(cenario({ link: 'https://terceiro.com', cta: 'https://terceiro.com' }).contexto);
      assert.equal(r.resultado, 'reprovado');
      assert.ok(r.onde.some((o) => o.includes('creative_link (difere da landing page')));
      assert.ok(r.onde.some((o) => o.includes('creative_cta_link (difere da landing page')));
      assert.equal(veredito(cenario({ link: intencao.destino!.url, cta: 'https://terceiro.com' }).contexto).resultado, 'reprovado');
    });

    it('número de terceiro reprova', () => {
      const { intencao } = cenario({ link: 'x' });
      const r = veredito(cenario({ link: intencao.destino!.url, zap: '+5511900000000' }).contexto);
      assert.equal(r.resultado, 'reprovado');
      assert.ok(r.onde.some((o) => o.includes('adset_po_whatsapp_phone (difere do WhatsApp')));
    });

    it('UTM adulterada, incompleta ou duplicada reprova', () => {
      const { intencao } = cenario({ link: 'x' });
      const url = intencao.destino!.url;
      for (const tags of ['utm_source=inventada', utmCerto(intencao).replace('utm_medium=', 'utm_medium=x'), `${utmCerto(intencao)}&utm_source=outra`]) {
        const r = veredito(cenario({ link: url, tags }).contexto);
        assert.equal(r.resultado, 'reprovado', tags);
        assert.ok(r.onde.some((o) => o.includes('creative_url_tags (UTM difere')));
      }
    });

    it('a_confirmar nunca vale em campo de papel de destino', () => {
      const { intencao } = cenario({ link: 'x' });
      const r = veredito(cenario({ link: 'a_confirmar', zap: 'a_confirmar', tags: 'a_confirmar' }).contexto);
      assert.equal(r.resultado, 'reprovado');
      assert.equal(r.onde.filter((o) => o.includes('a_confirmar só vale')).length, 3);
      assert.ok(intencao);
    });

    it('falha fechada: catálogo sem campo do papel reprova url_destino e utm; whatsapp só é exigido se o catálogo o declara', () => {
      const semPapel: CatalogoDeCampos = { ...catalogoMeta, campos: catalogoMeta.campos.map(({ papel: _papel, ...resto }) => resto) };
      const { intencao } = cenario({ link: 'x' });
      const r = veredito(cenario({ link: intencao.destino!.url }, semPapel).contexto);
      assert.equal(r.resultado, 'reprovado');
      for (const papel of ['url_destino', 'utm']) assert.ok(r.onde.some((o) => o.includes(`papel ${papel}`)), papel);
      assert.ok(!r.onde.some((o) => o.includes('papel whatsapp')));
    });
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
        campoCat('ad_bid_amount', 'numero'),
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
      const { destino: _destino, whatsapp: _whatsapp, utm: _utm, ...semDestino } = base.plano.intencao;
      const intencao = { ...semDestino, plataformas: ['meta' as const] };
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
      assert.ok(texto({ adset_bid_strategy: 'COST_CAP', adset_bid_amount: 300, ad_bid_amount: 300 }).includes('LOWEST_COST_WITH_BID_CAP é obrigatório com ad_bid_amount'));
      assert.ok(texto({ adset_daily_budget: undefined as never, adset_lifetime_budget: 5000 }).includes('adset_end_time (obrigatório com orçamento vitalício)'));
      assert.ok(texto({ adset_pacing_type: ['day_parting'] }).includes('day_parting exige orçamento vitalício'));
      assert.ok(texto({ adset_daily_budget: 100 }).includes('abaixo do mínimo de 570 centavos'));
      assert.ok(texto({ tg_age_min: 25 }).includes('adset_targeting_automation (obrigatório'));
      assert.equal(rodar({ adset_bid_strategy: 'COST_CAP', adset_bid_amount: 300, adset_daily_budget: 570 }).resultado, 'aprovado');
    });
  });
});
