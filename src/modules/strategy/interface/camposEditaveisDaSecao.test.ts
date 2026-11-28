import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGOS_DISPONIVEIS } from '../domain/catalogo/disponiveis.ts';
import { CATALOGOS_DE_TESTE, planoCompleto } from '../domain/fixturesDeTeste.ts';
import { lerPlano } from '../domain/plano.ts';
import { aplicarCampos, errosPorCampoDaSecao, gruposEditaveis, secaoEditavel, type CampoEditavel } from './camposEditaveisDaSecao.ts';

const plano = () => structuredClone(planoCompleto()) as unknown as Record<string, any>;
const todos = (grupos: ReturnType<typeof gruposEditaveis>): CampoEditavel[] => grupos.flatMap((grupo) => grupo.campos);
const resumo = () => plano()['resumo_executivo'];
const midia = () => plano()['plano_de_midia'];
const valoresDe = (grupos: ReturnType<typeof gruposEditaveis>) => Object.fromEntries(todos(grupos).map((campo) => [campo.caminho, campo.valor]));

describe('campos editáveis: resumo executivo', () => {
  it('gera só objetivo, aposta, resultado e verba, com rótulo, tipo e agrupamento legíveis', () => {
    const grupos = gruposEditaveis('resumo_executivo', resumo(), CATALOGOS_DE_TESTE);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0]?.titulo, 'Resumo executivo');
    assert.deepEqual(todos(grupos).map((c) => [c.caminho, c.rotulo, c.tipo]), [
      ['objetivo', 'Objetivo', 'texto_longo'],
      ['aposta_central.texto', 'Aposta central', 'texto_longo'],
      ['resultado_esperado.texto', 'Resultado esperado', 'texto_longo'],
      ['verba', 'Verba', 'dinheiro'],
    ]);
    const verba = todos(grupos).find((c) => c.caminho === 'verba')!;
    assert.match(verba.valor, /^R\$\s?[\d.]+,\d{2}$/);
  });

  it('nunca expõe URN, id, hash, evidência, papel ou o booleano de hipótese', () => {
    const texto = JSON.stringify(gruposEditaveis('resumo_executivo', resumo(), CATALOGOS_DE_TESTE));
    assert.doesNotMatch(texto, /orla:|urn|evidencia|hipotese|papel|hash|"id"/i);
  });

  it('seção de forma inesperada ou não editável não gera campo', () => {
    assert.deepEqual(gruposEditaveis('resumo_executivo', null, CATALOGOS_DE_TESTE), []);
    assert.deepEqual(gruposEditaveis('resumo_executivo', { objetivo: 3 }, CATALOGOS_DE_TESTE), []);
    assert.deepEqual(gruposEditaveis('intencao', plano()['intencao'], CATALOGOS_DE_TESTE), []);
    assert.deepEqual(gruposEditaveis('campanhas', plano()['campanhas'], CATALOGOS_DE_TESTE), []);
    assert.equal(secaoEditavel('resumo_executivo'), true);
    assert.equal(secaoEditavel('intencao'), false);
  });

  it('aplica texto e converte a verba de reais para centavos', () => {
    const original = resumo();
    const aplicada = aplicarCampos('resumo_executivo', original, { objetivo: 'Novo objetivo', verba: '12.345,67' }, CATALOGOS_DE_TESTE);
    assert.ok(aplicada.ok);
    const nova = aplicada.value as typeof original;
    assert.equal(nova.objetivo, 'Novo objetivo');
    assert.deepEqual(nova.verba, { centavos: '1234567', moeda: 'BRL' });
    assert.deepEqual(nova.aposta_central, original.aposta_central);
    assert.deepEqual(nova.resultado_esperado.evidencias, original.resultado_esperado.evidencias);
    assert.equal(original.objetivo, resumo().objetivo, 'a seção original não é mutada');
  });

  it('recusa vazio, texto acima do limite, verba inválida ou zero', () => {
    const r = aplicarCampos('resumo_executivo', resumo(), { objetivo: '   ', 'aposta_central.texto': 'x'.repeat(601), verba: 'abc' }, CATALOGOS_DE_TESTE);
    assert.ok(!r.ok);
    assert.equal(r.error['objetivo'], 'Preencha este campo.');
    assert.match(r.error['aposta_central.texto'] ?? '', /No máximo 600/);
    assert.match(r.error['verba'] ?? '', /reais/);
    const zero = aplicarCampos('resumo_executivo', resumo(), { verba: '0,00' }, CATALOGOS_DE_TESTE);
    assert.ok(!zero.ok && zero.error['verba']);
    const longo = aplicarCampos('resumo_executivo', resumo(), { objetivo: 'x'.repeat(401) }, CATALOGOS_DE_TESTE);
    assert.ok(!longo.ok && /No máximo 400/.test(longo.error['objetivo'] ?? ''));
  });

  it('caminho fora da lista é rejeitado: id, urn, evidências, hipótese, intenção, outra seção e caminho inventado', () => {
    for (const caminho of ['aposta_central.evidencias.0.urn', 'aposta_central.hipotese', 'resultado_esperado.evidencias', 'intencao.objetivo', 'campanhas.campanhas.0.nome', 'verba.centavos', 'objetivo.x', '__proto__.x', 'id']) {
      const r = aplicarCampos('resumo_executivo', resumo(), { [caminho]: 'x' }, CATALOGOS_DE_TESTE);
      assert.ok(!r.ok, caminho);
      assert.equal(r.error[caminho], 'Este campo não pode ser editado.');
    }
  });

  it('round-trip sem mudança devolve a seção idêntica, inclusive com quebras de linha do navegador', () => {
    const original = resumo();
    const valores = valoresDe(gruposEditaveis('resumo_executivo', original, CATALOGOS_DE_TESTE));
    const comCrlf = Object.fromEntries(Object.entries(valores).map(([caminho, valor]) => [caminho, valor.replace(/\n/g, '\r\n')]));
    for (const enviados of [valores, comCrlf]) {
      const r = aplicarCampos('resumo_executivo', original, enviados, CATALOGOS_DE_TESTE);
      assert.ok(r.ok);
      assert.deepEqual(r.value, original);
    }
  });
});

describe('campos editáveis: plano de mídia', () => {
  it('só valor e justificativa de campos do catálogo, agrupados por plataforma e seção, com o rótulo da chave', () => {
    const grupos = gruposEditaveis('plano_de_midia', midia(), CATALOGOS_DE_TESTE);
    assert.ok(grupos.length >= 2);
    assert.match(grupos[0]!.titulo, /^Google › /);
    const campos = todos(grupos);
    const objetivo = campos.find((c) => c.caminho === 'plataformas.0.secoes.0.campos.0.valor')!;
    assert.equal(objetivo.rotulo, 'objetivo da campanha');
    assert.equal(objetivo.tipo, 'escolha');
    assert.deepEqual(objetivo.opcoes.map((o) => o.valor), ['leads', 'vendas']);
    const orcamento = campos.find((c) => c.caminho === 'plataformas.0.secoes.1.campos.0.valor')!;
    assert.equal(orcamento.tipo, 'numero');
    assert.equal(orcamento.valor, '6666');
    const booleano = campos.find((c) => c.rotulo === 'posicionamento automatico')!;
    assert.equal(booleano.tipo, 'escolha');
    assert.deepEqual(booleano.opcoes.map((o) => o.rotulo), ['Sim', 'Não']);
    assert.ok(campos.some((c) => c.caminho.endsWith('.justificativa') && c.tipo === 'texto_longo'));
    assert.ok(campos.every((c) => /^plataformas\.\d+\.secoes\.\d+\.campos\.\d+\.(valor|justificativa)$/.test(c.caminho)));
  });

  it('não expõe campos com papel de destino (url, utm, whatsapp), chave fora do catálogo, evidências nem a chave da plataforma', () => {
    const dado = midia();
    dado.plataformas[0].secoes.push({
      secao: 'destino',
      campos: [
        { campo: 'url_de_destino', valor: 'https://exemplo.com.br', justificativa: 'cópia', evidencias: [] },
        { campo: 'parametros_de_url', valor: 'utm_source=x', justificativa: 'cópia', evidencias: [] },
        { campo: 'numero_do_whatsapp', valor: '+5511912345678', justificativa: 'cópia', evidencias: [] },
        { campo: 'chave_desconhecida', valor: 'x', justificativa: 'y', evidencias: [] },
      ],
    });
    const campos = todos(gruposEditaveis('plano_de_midia', dado, CATALOGOS_DE_TESTE));
    assert.ok(!campos.some((c) => /destino|whatsapp|parametros|desconhecida/.test(c.rotulo)));
    assert.ok(!campos.some((c) => c.caminho.startsWith('plataformas.0.secoes.2.')));
    assert.doesNotMatch(JSON.stringify(campos), /orla:|urn|evidencias|"plataforma"/);
  });

  it('URL e identificador de destino sem papel no catálogo também ficam fora (loja, pixel, página, link, domínio)', () => {
    const meta = { plataforma: 'meta', secoes: [{ secao: 'adset', campos: [
      { campo: 'adset_po_store_url', valor: 'https://loja.example/app', justificativa: 'j', evidencias: [] },
      { campo: 'adset_po_pixel_id', valor: '123456', justificativa: 'j', evidencias: [] },
      { campo: 'adset_po_page_id', valor: '99', justificativa: 'j', evidencias: [] },
      { campo: 'ad_conversion_domain', valor: 'exemplo.com.br', justificativa: 'j', evidencias: [] },
      { campo: 'adset_daily_budget', valor: 5000, justificativa: 'j', evidencias: [] },
    ] }] };
    const campos = todos(gruposEditaveis('plano_de_midia', { plataformas: [meta] }, CATALOGOS_DISPONIVEIS));
    assert.ok(!campos.some((c) => /store_url|pixel_id|page_id|conversion_domain|store url|pixel id|page id|conversion domain/.test(c.rotulo)), JSON.stringify(campos.map((c) => c.rotulo)));
    assert.ok(campos.every((c) => !/campos\.[0-3]\./.test(c.caminho)));
    assert.ok(campos.some((c) => c.caminho === 'plataformas.0.secoes.0.campos.4.valor'));
    const r = aplicarCampos('plano_de_midia', { plataformas: [meta] }, { 'plataformas.0.secoes.0.campos.0.valor': 'https://outro.example', 'plataformas.0.secoes.0.campos.1.valor': '1' }, CATALOGOS_DISPONIVEIS);
    assert.ok(!r.ok);
  });

  it('plataforma sem catálogo não gera campo', () => {
    const dado = midia();
    dado.plataformas[0].plataforma = 'tiktok';
    const campos = todos(gruposEditaveis('plano_de_midia', dado, CATALOGOS_DE_TESTE));
    assert.ok(campos.every((c) => !c.caminho.startsWith('plataformas.0.')));
  });

  it('escolha só aceita opção do catálogo; número só aceita número; tipo errado é rejeitado', () => {
    const dado = midia();
    const ruim = aplicarCampos(
      'plano_de_midia',
      dado,
      { 'plataformas.0.secoes.0.campos.0.valor': 'qualquer', 'plataformas.0.secoes.1.campos.0.valor': 'muito', 'plataformas.1.secoes.1.campos.0.valor': 'talvez' },
      CATALOGOS_DE_TESTE,
    );
    assert.ok(!ruim.ok);
    assert.equal(ruim.error['plataformas.0.secoes.0.campos.0.valor'], 'Escolha uma das opções.');
    assert.equal(ruim.error['plataformas.0.secoes.1.campos.0.valor'], 'Informe um número.');
    assert.equal(ruim.error['plataformas.1.secoes.1.campos.0.valor'], 'Escolha uma das opções.');
    const boa = aplicarCampos(
      'plano_de_midia',
      dado,
      { 'plataformas.0.secoes.0.campos.0.valor': 'vendas', 'plataformas.0.secoes.1.campos.0.valor': '7000.5', 'plataformas.1.secoes.1.campos.0.valor': 'false', 'plataformas.0.secoes.0.campos.0.justificativa': 'Nova justificativa' },
      CATALOGOS_DE_TESTE,
    );
    assert.ok(boa.ok);
    const nova = boa.value as typeof dado;
    assert.equal(nova.plataformas[0].secoes[0].campos[0].valor, 'vendas');
    assert.equal(nova.plataformas[0].secoes[1].campos[0].valor, 7000.5);
    assert.equal(nova.plataformas[1].secoes[1].campos[0].valor, false);
    assert.equal(nova.plataformas[0].secoes[0].campos[0].justificativa, 'Nova justificativa');
  });

  it('justificativa acima de 300 caracteres é recusada; vazia é aceita', () => {
    const caminho = 'plataformas.0.secoes.0.campos.0.justificativa';
    const grande = aplicarCampos('plano_de_midia', midia(), { [caminho]: 'x'.repeat(301) }, CATALOGOS_DE_TESTE);
    assert.ok(!grande.ok && /No máximo 300/.test(grande.error[caminho] ?? ''));
    const vazia = aplicarCampos('plano_de_midia', midia(), { [caminho]: '' }, CATALOGOS_DE_TESTE);
    assert.ok(vazia.ok);
  });

  it('não altera chaves, evidências, plataformas nem a estrutura; a seção editada continua válida no plano', () => {
    const base = plano();
    const original = base['plano_de_midia'];
    const r = aplicarCampos('plano_de_midia', original, { 'plataformas.0.secoes.0.campos.0.valor': 'vendas' }, CATALOGOS_DE_TESTE);
    assert.ok(r.ok);
    const nova = r.value as typeof original;
    assert.deepEqual(nova.plataformas.map((p: { plataforma: string }) => p.plataforma), original.plataformas.map((p: { plataforma: string }) => p.plataforma));
    assert.deepEqual(nova.plataformas[0].secoes[0].campos[0].evidencias, original.plataformas[0].secoes[0].campos[0].evidencias);
    assert.equal(nova.plataformas[0].secoes[0].campos[0].campo, 'objetivo_da_campanha');
    assert.ok(lerPlano({ ...base, plano_de_midia: nova }).ok);
    assert.deepEqual(base['intencao'], planoCompleto().intencao);
  });

  it('round-trip sem mudança produz a seção idêntica', () => {
    const original = midia();
    const valores = valoresDe(gruposEditaveis('plano_de_midia', original, CATALOGOS_DE_TESTE));
    const r = aplicarCampos('plano_de_midia', original, valores, CATALOGOS_DE_TESTE);
    assert.ok(r.ok);
    assert.deepEqual(r.value, original);
  });

  it('lista vira um item por linha e volta como lista', () => {
    const catalogos = [{ ...CATALOGOS_DE_TESTE[0]!, campos: [...CATALOGOS_DE_TESTE[0]!.campos, { chave: 'termos', secao: 'publico', obrigatorio: false, tipoDoValor: 'lista' as const }] }];
    const dado = midia();
    dado.plataformas[0].secoes[0].campos.push({ campo: 'termos', valor: ['a', 'b'], justificativa: 'j', evidencias: [] });
    const campo = todos(gruposEditaveis('plano_de_midia', dado, catalogos)).find((c) => c.rotulo === 'termos')!;
    assert.equal(campo.valor, 'a\nb');
    assert.equal(campo.dica, 'Um item por linha.');
    const r = aplicarCampos('plano_de_midia', dado, { [campo.caminho]: 'x\r\n\r\ny ' }, catalogos);
    assert.ok(r.ok);
    assert.deepEqual((r.value as typeof dado).plataformas[0].secoes[0].campos[1].valor, ['x', 'y']);
    const demais = aplicarCampos('plano_de_midia', dado, { [campo.caminho]: Array.from({ length: 51 }, (_, i) => `i${i}`).join('\n') }, catalogos);
    assert.ok(!demais.ok);
  });
});

describe('erros do servidor por campo', () => {
  it('mapeia o caminho do esquema (com ou sem o prefixo da seção, e filho de lista) para o campo certo', () => {
    const grupos = gruposEditaveis('plano_de_midia', midia(), CATALOGOS_DE_TESTE);
    const erros = errosPorCampoDaSecao(
      'plano_de_midia',
      {
        'plano_de_midia.plataformas.0.secoes.0.campos.0.valor': 'Valor inválido.',
        'plataformas.0.secoes.1.campos.0.justificativa': 'Muito longa.',
        'plano_de_midia.plataformas.0.secoes.1.campos.0.valor.2': 'Item inválido.',
        orcamento: 'Fora da seção.',
      },
      grupos,
    );
    assert.deepEqual(erros, {
      'plataformas.0.secoes.0.campos.0.valor': 'Valor inválido.',
      'plataformas.0.secoes.1.campos.0.justificativa': 'Muito longa.',
      'plataformas.0.secoes.1.campos.0.valor': 'Item inválido.',
    });
    assert.deepEqual(errosPorCampoDaSecao('resumo_executivo', undefined, []), {});
  });
});
