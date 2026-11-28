import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { EntradaDoCatalogo, EntradaSemSelo } from '../../brain/domain/entrada.ts';
import type { PedidoDeIA } from '@/modules/strategy/application/portas';
import { parecer, ponto } from '../domain/comite/fixturesDeParecer.ts';
import { ehPedidoDeComite, respostaDoComite } from '../domain/comite/fixturesDoComite.ts';
import { COMITES } from '../domain/comite/comites.ts';
import { CLIENTE_ID, ORGANIZACAO_ID, URN_BENCHMARK_B, CATALOGOS_DE_TESTE, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave, urnDeTeste } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { selar } = await import('../../brain/domain/entrada.ts');
const { createMotorDoPlano } = await import('./motorDoPlano.ts');
const { criarLeitorDoBrain } = await import('../infrastructure/leitorDoBrain.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa, aceitaTodos } = await import('../infrastructure/ia/iaFalsa.ts');
const { comValidacao } = await import('../infrastructure/ia/comValidacao.ts');
const { ok } = await import('../../../shared/result/result.ts');

const INTENCAO = planoCompleto().intencao;
const NEGADO = 'SEGREDO-DA-ENTRADA-NEGADA-9137';
const RESTRITO = 'RESUMO-DA-ENTRADA-RESTRITA-4821';

const base = (tipo: string, id: string, extra: Partial<EntradaSemSelo>): EntradaDoCatalogo =>
  selar({
    urn: urnDeTeste(tipo, id),
    tipo,
    id,
    titulo: `Entrada ${id}`,
    descricao: `Descrição de ${id}.`,
    provedor: 'teste',
    plataforma: null,
    referencia: { sistema: 'teste', local: id },
    esquema: null,
    grao: null,
    cobertura: null,
    frescor: null,
    qualidade: { completude: null, avisos: [] },
    acesso: { tipo: 'status' },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'x' },
    epistemico: null,
    valorResumido: null,
    tags: [],
    relacoes: [],
    versao: 1,
    ...extra,
  });

function entradasDoCatalogo(): EntradaDoCatalogo[] {
  const doPacote = pacoteDeTeste().entradas.map((e) => {
    const urn = e.urn;
    const [, id] = [e.tipo, urn.split(':').at(-1) ?? e.titulo];
    return selar({
      ...base(e.tipo, id, {}),
      urn,
      titulo: e.titulo,
      valorResumido: e.resumo,
      provedor: e.evidencia ? 'conhecimento' : 'teste',
      acesso: e.somenteMetadados ? { tipo: 'restrito', motivo: 'teste' } : { tipo: 'status' },
      sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: e.somenteMetadados ? 'restrito' : 'permitido', retencao: 'x' },
      ...(e.evidencia
        ? {
            evidencia: {
              categoria: e.evidencia.categoria,
              nota: e.evidencia.nota,
              fonte: 'Fonte',
              mercado: 'br',
              jurisdicao: e.evidencia.jurisdicao ?? 'br',
              dataDaFonte: '2026-01-01',
              ...(e.evidencia.validoAte ? { validoAte: e.evidencia.validoAte } : {}),
              ...(e.evidencia.verificadoEm ? { verificadoEm: e.evidencia.verificadoEm } : {}),
              obrigatoria: e.evidencia.obrigatoria ?? false,
              replicada: false,
            },
          }
        : {}),
    });
  });
  return [
    ...doPacote,
    base('regra', 'negada', {
      titulo: NEGADO,
      valorResumido: NEGADO,
      sensibilidade: { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'negado', retencao: 'x' },
    }),
    base('tabela_de_dados', 'restrita-extra', {
      titulo: 'Base restrita extra',
      valorResumido: RESTRITO,
      acesso: { tipo: 'restrito', motivo: 'teste' },
      sensibilidade: { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'restrito', retencao: 'x' },
    }),
    base('contexto_secao', 'suja', { titulo: 'Contato joao@exemplo.com', valorResumido: 'Fale com maria@exemplo.com ou (11) 98888-7777.' }),
  ];
}

describe('o que cada tarefa de IA recebe em dados', () => {
  it('redigir, Comitê, Gate e ajuste nunca recebem negado, resumo de restrito, e-mail nem telefone', async () => {
    const repositorio = criarRepositorioEmMemoria();
    const ia = criarIaFalsa((pedido: PedidoDeIA<unknown>) => {
      if (pedido.tarefa === 'strategy_plan') {
        if (pedido.chaveDeIdempotencia.includes(':ajustar:')) {
          const pontos = (pedido.dados as { pontos: { pontos: { persona: string; pontoId: string }[] }[] }).pontos.flatMap((a) => a.pontos);
          return {
            secoes: secoesDoGrupoDaChave(pedido.chaveDeIdempotencia),
            respostas: pontos.map((p) => ({ pontoId: p.pontoId, persona: p.persona, decisao: 'acatado', motivo: 'acatado' })),
          };
        }
        return secoesDoGrupoDaChave(pedido.chaveDeIdempotencia);
      }
      if (ehPedidoDeComite(pedido)) return respostaDoComite(pedido, (chave) => chave === 'redator' ? parecer(chave, 'aprova_com_ajuste', [ponto('p1', 'estrategia', [URN_BENCHMARK_B])]) : parecer(chave, 'aprova'));
      if (pedido.tarefa === 'juiz') return aceitaTodos(pedido.dados);
      return { resultado: 'aprovado', problemas: [] };
    });
    const leitorDoBrain = criarLeitorDoBrain({
      brain: { async montarNaOrganizacao() { return ok({ organizationId: ORGANIZACAO_ID, clienteId: CLIENTE_ID, entradas: entradasDoCatalogo() } as never); } },
    });
    const motor = createMotorDoPlano({ catalogos: CATALOGOS_DE_TESTE,
      repositorio,
      executorDeIA: comValidacao(ia),
      leitorDoBrain,
      avaliadorDeLimites: { async avaliador() { return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const })); } },
      audit: { async record() {}, async list() { return []; }, async search() { return []; } },
    });
    const plano = await repositorio.criarPlano({ organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID }, 'aquisicao');
    assert.ok(plano.ok);
    const execucao = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
      planoId: plano.value.id,
      pedido: { tipo: 'criar', intencao: INTENCAO },
      versaoBaseId: null,
      agentRunId: 'run-priv',
      solicitadoPor: 'pessoa-1',
      requestId: 'r',
    });
    assert.ok(execucao.ok);
    let final = null;
    for (let i = 0; i < 30 && final === null; i += 1) {
      const reservada = await repositorio.reservarExecucao(ORGANIZACAO_ID, execucao.value.id, { leaseMs: 60_000, agora: new Date('2026-11-25T12:00:00Z') });
      const resumo = await motor.avancarExecucao(ORGANIZACAO_ID, execucao.value.id, { orcamentoMs: 10_000_000, ficha: reservada?.tentativas ?? 0 });
      if (resumo.execucao && ['concluida', 'falhou'].includes(resumo.execucao.status)) final = resumo.execucao;
    }
    assert.equal(final?.status, 'concluida', JSON.stringify(final));

    const tarefas = new Set(ia.pedidos.map((p) => p.tarefa));
    assert.deepEqual([...tarefas].sort(), ['gate', 'juiz', 'strategy_plan', ...COMITES.map((comite) => comite.tarefa)].sort());
    assert.ok(ia.pedidos.some((p) => p.chaveDeIdempotencia.includes(':ajustar:')), 'o ajuste foi exercitado');
    const todos = JSON.stringify(ia.pedidos.map((p) => p.dados));
    assert.ok(todos.includes('Base restrita extra'), 'a entrada restrita chega, só como metadados');
    assert.ok(todos.includes('Contato'), 'a entrada suja chega, já sanitizada');
    for (const pedido of ia.pedidos) {
      const texto = JSON.stringify(pedido.dados);
      const onde = `${pedido.tarefa}/${pedido.chaveDeIdempotencia}`;
      assert.ok(!texto.includes(NEGADO), `negado em ${onde}`);
      assert.ok(!texto.includes(urnDeTeste('regra', 'negada')), `urn negada em ${onde}`);
      assert.ok(!texto.includes(RESTRITO), `resumo de restrito em ${onde}`);
      assert.ok(!/[\w.]+@[\w.]+\.\w+/.test(texto), `e-mail em ${onde}`);
      assert.ok(!texto.includes('98888'), `telefone em ${onde}`);
      assert.ok(!texto.includes('Base restrita extra') || texto.includes('"somenteMetadados":true'), `restrito sem marca em ${onde}`);
    }
  });
});
