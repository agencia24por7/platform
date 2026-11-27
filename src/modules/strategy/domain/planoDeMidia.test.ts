import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { esquemaCatalogoDeCampos } from './catalogo/tipos.ts';
import { CATALOGOS_DE_TESTE, URN_DESEMPENHO, evidencia, intencaoDeTeste, planoCompletoBruto, planoMinimoBruto } from './fixturesDeTeste.ts';
import { ESQUEMAS_DAS_SECOES, SECOES_DO_PLANO, TAMANHO_MAXIMO_DO_PLANO_BYTES, esquemaIntencao, lerPlano, tamanhoDoPlano } from './plano.ts';
import { esquemaDoGrupo, GRUPOS_DE_REDACAO } from './gruposDoPlano.ts';
import { gerarUtmPorPlataforma } from './utm.ts';

type Registro = Record<string, any>;

const comoLegado = (): Registro => {
  const bruto = JSON.parse(JSON.stringify(planoCompletoBruto())) as Registro;
  bruto.criativos = { conceitos: [{ id: 'cc_orcamento', titulo: 'Orçamento rápido', ideia: 'Resposta em um dia.', o_que_testar: 'Prazo contra preço.' }] };
  for (const campanha of bruto.campanhas.campanhas) campanha.conceito_id = 'cc_orcamento';
  delete bruto.plano_de_midia;
  for (const chave of ['plataformas', 'whatsapp', 'destino', 'utm']) delete bruto.intencao[chave];
  return bruto;
};

describe('esquema único em dois blocos', () => {
  it('criativos saiu das seções, dos grupos e do esquema; plano_de_midia entrou', () => {
    assert.equal((SECOES_DO_PLANO as readonly string[]).includes('criativos'), false);
    assert.equal((SECOES_DO_PLANO as readonly string[]).includes('plano_de_midia'), true);
    assert.equal('criativos' in ESQUEMAS_DAS_SECOES, false);
    assert.equal((GRUPOS_DE_REDACAO.flat() as string[]).includes('criativos'), false);
    assert.equal(GRUPOS_DE_REDACAO.flat().filter((s) => s === 'plano_de_midia').length, 1);
  });

  it('o grupo do modelo recusa criativos e conceito_id', () => {
    const grupo = esquemaDoGrupo(GRUPOS_DE_REDACAO.length - 1);
    assert.equal(grupo.safeParse({ criativos: { conceitos: [] } }).success, false);
    const campanhas = JSON.parse(JSON.stringify(planoCompletoBruto().campanhas)) as Registro;
    campanhas.campanhas[0].conceito_id = 'cc_x';
    assert.equal(ESQUEMAS_DAS_SECOES.campanhas.safeParse(campanhas).success, false);
  });

  it('versão antiga com criativos, conceito_id e sem plano de mídia continua sendo lida', () => {
    const lido = lerPlano(comoLegado());
    assert.equal(lido.ok, true, JSON.stringify(!lido.ok && lido.error));
    if (!lido.ok) return;
    assert.equal('criativos' in lido.value, false);
    assert.equal('conceito_id' in lido.value.campanhas.campanhas[0]!, false);
    assert.deepEqual(lido.value.plano_de_midia, { plataformas: [] });
    assert.equal(lido.value.intencao.plataformas, undefined);
  });

  it('a leitura do legado não altera o JSON recebido', () => {
    const bruto = comoLegado();
    const antes = JSON.stringify(bruto);
    lerPlano(bruto);
    assert.equal(JSON.stringify(bruto), antes);
  });

  it('campo desconhecido no plano de mídia é recusado', () => {
    const extra = planoCompletoBruto();
    (extra.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0] as Record<string, unknown>).livre = 'x';
    assert.equal(lerPlano(extra).ok, false);
  });
});

describe('plano de mídia', () => {
  const problemas = (plano: unknown) => {
    const r = lerPlano(plano);
    return r.ok ? [] : r.error.problemas.map((p) => p.mensagem);
  };

  it('plataforma fora das escolhidas na intenção é recusada', () => {
    const plano = planoCompletoBruto();
    plano.plano_de_midia.plataformas.push({ plataforma: 'tiktok', secoes: [] });
    assert.ok(problemas(plano).some((m) => m.includes('Plataforma não escolhida: tiktok')));
  });

  it('plataforma e campo repetidos são recusados', () => {
    const plano = planoCompletoBruto();
    plano.plano_de_midia.plataformas.push(structuredClone(plano.plano_de_midia.plataformas[0]!));
    assert.ok(problemas(plano).some((m) => m.includes('Plataforma repetida: google')));
    const campo = planoCompletoBruto();
    campo.plano_de_midia.plataformas[0]!.secoes[0]!.campos.push({ ...campo.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]! });
    assert.ok(problemas(campo).some((m) => m.includes('Campo repetido')));
  });

  it('campanha em plataforma não escolhida é recusada', () => {
    const plano = planoCompletoBruto();
    plano.campanhas.campanhas[0]!.plataforma = 'linkedin';
    assert.ok(problemas(plano).some((m) => m.includes('Plataforma não escolhida: linkedin')));
  });

  it('chave de campo com maiúscula e valor de tipo livre são recusados', () => {
    const plano = planoCompletoBruto();
    plano.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.campo = 'Objetivo';
    assert.equal(lerPlano(plano).ok, false);
    const valor = planoCompletoBruto();
    (valor.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0] as { valor: unknown }).valor = { a: 1 };
    assert.equal(lerPlano(valor).ok, false);
  });

  it('evidência é opcional na entrada (assume vazia) e limitada a três', () => {
    const plano = JSON.parse(JSON.stringify(planoCompletoBruto())) as Registro;
    delete plano.plano_de_midia.plataformas[0].secoes[0].campos[0].evidencias;
    const lido = lerPlano(plano);
    assert.equal(lido.ok, true);
    if (lido.ok) assert.deepEqual(lido.value.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.evidencias, []);
    const muitas = planoCompletoBruto();
    muitas.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.evidencias = Array.from({ length: 4 }, () => evidencia(URN_DESEMPENHO));
    assert.equal(lerPlano(muitas).ok, false);
  });

  it('o teto de 256 KB comporta 100 campos gordos e o limite de 400 campos o protege do excesso', () => {
    const plano = planoCompletoBruto();
    const campos = Array.from({ length: 100 }, (_, i) => ({
      campo: `campo_${i}`,
      valor: 'v'.repeat(200),
      justificativa: 'j'.repeat(200),
      evidencias: [evidencia(URN_DESEMPENHO), evidencia(URN_DESEMPENHO)],
    }));
    plano.plano_de_midia = { plataformas: [{ plataforma: 'google', secoes: [{ secao: 'objetivo', campos: campos.slice(0, 50) }, { secao: 'publico', campos: campos.slice(50) }] }] };
    assert.equal(lerPlano(plano).ok, true);
    assert.ok(tamanhoDoPlano(plano) < TAMANHO_MAXIMO_DO_PLANO_BYTES / 2);

    const grande = planoCompletoBruto();
    grande.plano_de_midia = {
      plataformas: (['google', 'meta'] as const).map((plataforma) => ({
        plataforma,
        secoes: [0, 1, 2, 3].map((n) => ({
          secao: `s_${n}`,
          campos: Array.from({ length: 80 }, (_, i) => ({ campo: `c_${n}_${i}`, valor: 'x', justificativa: 'j', evidencias: [] })),
        })),
      })),
    };
    assert.ok(problemas(grande).some((m) => m.includes('o máximo é 400')));
  });
});

describe('intenção com entradas fixas', () => {
  const intencao = intencaoDeTeste();

  it('exige plataformas (mínimo 1, sem repetição), destino e UTM só de plataforma escolhida', () => {
    assert.equal(esquemaIntencao.safeParse(intencao).success, true);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, plataformas: [] }).success, false);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, plataformas: ['google', 'google'] }).success, false);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, plataformas: ['rede_x'] }).success, false);
    const { destino: _destino, ...semDestino } = intencao;
    assert.equal(esquemaIntencao.safeParse(semDestino).success, false);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, utm: gerarUtmPorPlataforma(['tiktok'], { tipoDePlano: 'aquisicao', nomeDaCampanha: 'x', periodo: '2026-12' }) }).success, false);
  });

  it('whatsapp é E.164 e opcional; destino exige https', () => {
    const { whatsapp: _whatsapp, ...semWhatsapp } = intencao;
    assert.equal(esquemaIntencao.safeParse(semWhatsapp).success, true);
    for (const ruim of ['11999998888', '+0123456789', '+55 11 99999-8888', '+55119']) {
      assert.equal(esquemaIntencao.safeParse({ ...intencao, whatsapp: ruim }).success, false, ruim);
    }
    assert.equal(esquemaIntencao.safeParse({ ...intencao, destino: { ...intencao.destino, url: 'http://exemplo.com' } }).success, false);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, destino: { ...intencao.destino, url: 'javascript:alert(1)' } }).success, false);
  });

  it('o plano gravado guarda a intenção completa', () => {
    const lido = lerPlano(planoMinimoBruto());
    assert.equal(lido.ok, true);
    if (lido.ok) assert.deepEqual(lido.value.intencao, intencao);
  });
});

describe('UTM gerado por código', () => {
  it('gera uma UTM por plataforma no padrão único de src/shared/utm', () => {
    const utm = gerarUtmPorPlataforma(['google', 'meta'], { tipoDePlano: 'aquisicao', nomeDaCampanha: 'Leads do Trimestre — Promoção!', periodo: '2026-12' });
    assert.deepEqual(Object.keys(utm), ['google', 'meta']);
    assert.equal(utm.google?.utm_campaign, 'aquisicao-leads-do-trimestre-promocao-202612');
    assert.equal(utm.google?.utm_medium, 'cpc');
    assert.equal(utm.meta?.utm_medium, 'paid_social');
    assert.equal(utm.meta?.utm_source, 'meta');
  });

  it('nome sem letras vira "plano"; nome longo é cortado para caber em 50 caracteres', () => {
    assert.equal(gerarUtmPorPlataforma(['google'], { tipoDePlano: 'aquisicao', nomeDaCampanha: '???', periodo: '2026-12' }).google?.utm_campaign, 'aquisicao-plano-202612');
    const longa = gerarUtmPorPlataforma(['meta'], { tipoDePlano: 'comunidade', nomeDaCampanha: 'a'.repeat(300), periodo: '2026-12' }).meta?.utm_campaign ?? '';
    assert.equal(longa.length <= 50, true);
    assert.equal(esquemaIntencao.shape.utm.safeParse({ meta: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: longa } }).success, true);
  });
});

describe('catálogo de campos', () => {
  it('os catálogos de teste cumprem o esquema; chave repetida e escolha sem opções não', () => {
    for (const catalogo of CATALOGOS_DE_TESTE) assert.equal(esquemaCatalogoDeCampos.safeParse(catalogo).success, true);
    const base = CATALOGOS_DE_TESTE[0]!;
    assert.equal(esquemaCatalogoDeCampos.safeParse({ ...base, campos: [base.campos[0], base.campos[0]] }).success, false);
    assert.equal(esquemaCatalogoDeCampos.safeParse({ ...base, campos: [{ chave: 'x', secao: 'objetivo', obrigatorio: true, tipoDoValor: 'escolha' }] }).success, false);
    assert.equal(esquemaCatalogoDeCampos.safeParse({ ...base, campos: [] }).success, false);
  });
});
