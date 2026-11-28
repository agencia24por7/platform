import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLIENTE_ID, ORGANIZACAO_ID, planoCompleto, URN_DESEMPENHO } from '../domain/fixturesDeTeste.ts';
import type { PainelDoPlano } from '../application/estrategiaService.ts';
import type { EventoDaVersao, Versao, VersaoResumo } from '../application/portas.ts';
import { AUTOR_AUTOMATICO, memoriaDoPlano, memoriaTemConteudo, type EntradaDaMemoria } from './memoriaDoPlano.ts';
import { escaparMarkdown as escaparMarkdownDaMemoria, memoriaEmMarkdown } from './memoriaEmMarkdown.ts';

const PLANO_ID = '44444444-4444-4444-8444-444444444444';
const V1 = '55555555-5555-4555-8555-555555555551';
const V2 = '55555555-5555-4555-8555-555555555552';
const PESSOA_A = '66666666-6666-4666-8666-666666666661';
const PESSOA_B = '66666666-6666-4666-8666-666666666662';
const T0 = new Date('2026-11-25T13:00:00.000Z');
const em = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);
const URN_CULTURA = `orla:${ORGANIZACAO_ID}:${CLIENTE_ID}:culture_tendencia:77777777-7777-4777-8777-777777777777`;

function resumo(sobrescrita: Partial<VersaoResumo>): VersaoResumo {
  return {
    id: V1, planoId: PLANO_ID, organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, status: 'superado', schemaVersion: 1, supersedesId: null,
    autorTipo: 'agente', autorUsuarioId: null, agentId: 'agente_de_plano', agentRunId: 'run-1', redigidaEm: null, criadaEm: T0, ...sobrescrita,
  };
}

function evento(versaoId: string, tipo: EventoDaVersao['tipo'], payload: Record<string, unknown>, minutos: number, ator: Partial<EventoDaVersao> = {}): EventoDaVersao {
  return { id: `${versaoId}-${tipo}-${minutos}`, versaoId, tipo, atorTipo: 'agente', atorUsuarioId: null, agentId: 'x', agentRunId: 'run-1', payload, criadoEm: em(minutos), ...ator };
}

const parecer = (persona: string) =>
  evento(V1, 'parecer', { persona, veredito: 'aprova_com_ajuste', motivo: 'RAW_PARECER_NAO_APARECE', pontos: [{ id: 'p1', trecho: 'posicionamento_e_mensagem', problema: 'PROBLEMA_BRUTO', ajustePedido: 'AJUSTE_BRUTO', fontes: [] }] }, 1);

function entrada(sobrescrita: Partial<PainelDoPlano> = {}, extra: Partial<EntradaDaMemoria> = {}): EntradaDaMemoria {
  const exibida: Versao = { ...resumo({ id: V2, supersedesId: V1, status: 'vigente', criadaEm: em(10) }), conteudo: planoCompleto(), referencias: [{ urn: URN_DESEMPENHO, hash: 'h', papel: 'favor' }, { urn: URN_CULTURA, hash: 'h', papel: 'premissa' }] };
  const painel: PainelDoPlano = {
    plano: { id: PLANO_ID, organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, tipo: 'aquisicao', plataformas: ['meta'], whatsapp: null, landingPageId: null, foco: null, criadoEm: T0 },
    versaoExibida: exibida, status: 'vigente', rotulo: null, pareceres: [], ajuste: null, gate: null, faltaParaAplicar: null, execucaoAtiva: null, ultimaExecucao: null, desatualizado: null,
    historico: {
      versoes: [resumo({ id: V2, supersedesId: V1, status: 'vigente', criadaEm: em(10) }), resumo({ id: V1, criadaEm: T0 })],
      eventos: [
        parecer('redator'),
        parecer('risco_legal'),
        evento(V2, 'ajuste', { responde_a: V1, respostas: [
          { pontoId: 'p1', persona: 'redator', decisao: 'acatado', motivo: 'Promessa com número' },
          { pontoId: 'p1', persona: 'risco_legal', decisao: 'nao_acatado', motivo: 'Juiz: sem prova no pacote' },
          { pontoId: 'pX', persona: 'persona_antiga', decisao: 'acatado', motivo: 'Sem trecho' },
        ] }, 11),
        evento(V2, 'proposta', {}, 12, { atorTipo: 'usuario', atorUsuarioId: PESSOA_A, agentId: null, agentRunId: null }),
        evento(V2, 'efetivada', {}, 13, { atorTipo: 'usuario', atorUsuarioId: PESSOA_B, agentId: null, agentRunId: null }),
        evento(V2, 'impacto_anotado', { impacto: 'material' }, 20),
      ],
    },
    ...sobrescrita,
  };
  return { painel, entradasDoBrain: new Map([[URN_DESEMPENHO, { titulo: 'Desempenho de Ads', nota: 'B' }], [URN_CULTURA, { titulo: 'Formato em alta', nota: 'C' }]]), ...extra };
}

describe('memória do plano: view-model', () => {
  const memoria = memoriaDoPlano(entrada());

  it('linha das versões em ordem cronológica com tipo, autor e marcos', () => {
    assert.deepEqual(memoria.versoes.map((v) => [v.rotulo, v.tipo, v.autor, v.status]), [
      ['Versão 1', 'Criação do plano', AUTOR_AUTOMATICO, 'Substituído'],
      ['Versão 2', 'Ajuste após a revisão', AUTOR_AUTOMATICO, 'Autorizado'],
    ]);
    assert.match(memoria.versoes[1]!.marcos.join('|'), /Enviada para autorização por Pessoa 1.*Autorizada por Pessoa 2/);
  });

  it('decisões por tema da seção, com autor Comitê, decisão e motivo, sem o texto bruto do parecer', () => {
    assert.equal(memoria.decisoes.length, 1);
    const itens = memoria.decisoes[0]!.itens;
    assert.deepEqual(itens.map((i) => [i.tema, i.autor, i.decisao, i.motivo]), [
      ['Plano', AUTOR_AUTOMATICO, 'Acatado', 'Sem trecho'],
      ['Posicionamento e mensagem', 'Comitê de mensagem', 'Acatado', 'Promessa com número'],
      ['Posicionamento e mensagem', 'Comitê de risco e legal', 'Não acatado', 'sem prova no pacote'],
    ]);
    const serializado = JSON.stringify(memoria);
    for (const bruto of ['RAW_PARECER_NAO_APARECE', 'PROBLEMA_BRUTO', 'AJUSTE_BRUTO', 'Juiz:']) assert.ok(!serializado.includes(bruto), bruto);
  });

  it('separa sinais de cultura das evidências, com título e nota e sem URL de fonte', () => {
    assert.deepEqual(memoria.cultura, [{ titulo: 'Formato em alta', nota: 'C', papel: 'premissa' }]);
    assert.deepEqual(memoria.evidencias, [{ titulo: 'Desempenho de Ads', nota: 'B', papel: 'a favor' }]);
    assert.ok(!/https?:/.test(JSON.stringify(memoria)));
  });

  it('entrada que sumiu do Brain aparece com rótulo neutro, não com a URN', () => {
    const sem = memoriaDoPlano(entrada({}, { entradasDoBrain: new Map() }));
    assert.ok(sem.evidencias[0]!.titulo.endsWith('(indisponível agora)'));
    assert.ok(!JSON.stringify(sem).includes('orla:'));
  });

  it('créditos: pessoas anônimas por papel e comitês convocados; resultados com impacto anotado', () => {
    assert.deepEqual(memoria.creditos.pessoas, ['Pessoa 1: enviou para autorização', 'Pessoa 2: autorizou']);
    assert.deepEqual(memoria.creditos.comites, ['Comitê de mensagem', 'Comitê de risco e legal']);
    assert.match(memoria.resultados[0]!, /Impacto anotado em .*: material/);
  });

  it('intenção e foco vêm do plano exibido', () => {
    assert.ok(memoria.intencao);
    assert.ok(memoria.intencao.objetivo.length > 0);
    assert.match(memoria.nomeDoArquivo, /^memoria-do-plano-[a-z0-9-]+\.md$/);
  });

  it('plano sem versão não tem memória; sem evento algum, as seções dizem "Sem registro"', () => {
    const vazio = memoriaDoPlano(entrada({ versaoExibida: null, historico: { versoes: [], eventos: [] } }));
    assert.equal(memoriaTemConteudo(vazio), false);
    assert.equal(vazio.intencao, null);
    assert.equal(memoriaTemConteudo(memoria), true);
    assert.match(memoriaEmMarkdown(vazio), /Sem registro\./);
  });
});

describe('memória do plano: Markdown', () => {
  it('escapa Markdown e HTML do texto do modelo e do Brain', () => {
    const perigoso = '<script>alert(1)</script> **negrito** [x](http://evil.example/a) ![i](u) `c` # t | a\nlinha2 a@b.com';
    const base = entrada();
    const painel: PainelDoPlano = {
      ...base.painel,
      historico: { ...base.painel.historico, eventos: base.painel.historico.eventos.map((e) => (e.tipo === 'ajuste' ? { ...e, payload: { ...e.payload, respostas: [{ pontoId: 'p1', persona: 'redator', decisao: 'acatado', motivo: perigoso }] } } : e)) },
    };
    const md = memoriaEmMarkdown(memoriaDoPlano({ painel, entradasDoBrain: new Map([[URN_DESEMPENHO, { titulo: perigoso, nota: 'A' }]]) }));
    assert.ok(!md.includes('<script>'));
    assert.ok(md.includes('&lt;script&gt;'));
    assert.ok(!md.includes('[x](http'));
    assert.ok(md.includes('\\[x\\]\\(http\\:'));
    assert.ok(md.includes('\\*\\*negrito\\*\\*'));
    assert.ok(md.includes('\\!\\[i\\]'));
    assert.ok(md.includes('\\`c\\`'));
    assert.ok(md.includes('\\|'));
    assert.ok(md.includes('a\\@b.com'));
    assert.ok(!/\n\s*linha2/.test(md), 'quebra de linha do texto não vira linha nova');
  });

  it('estrutura: título, seções na ordem e nenhum texto bruto do parecer', () => {
    const md = memoriaEmMarkdown(memoriaDoPlano(entrada()));
    const titulos = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(titulos, ['Versões', 'Intenção e foco', 'Decisões criativas', 'Sinais de cultura', 'Evidências citadas', 'Créditos', 'Resultados']);
    assert.match(md, /^# Memória do plano: /);
    assert.ok(!md.includes('PROBLEMA_BRUTO'));
    assert.ok(!md.includes(URN_DESEMPENHO));
  });
});

describe('Markdown da memória: autolink www', () => {
  it('neutraliza www. sem esquema, em qualquer caixa, e preserva o resto', () => {
    assert.equal(escaparMarkdownDaMemoria('www.golpe.com/x'), 'www\\.golpe.com/x');
    assert.equal(escaparMarkdownDaMemoria('WWW.Golpe.com'), 'WWW\\.Golpe.com');
    assert.equal(escaparMarkdownDaMemoria('veja www.golpe.com e www.b.com'), 'veja www\\.golpe.com e www\\.b.com');
    assert.equal(escaparMarkdownDaMemoria('awww.x.com e subwww'), 'awww.x.com e subwww');
  });
});
