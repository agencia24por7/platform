import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { CLIENTE_ID, ORGANIZACAO_ID, CATALOGOS_DE_TESTE, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave } from '../domain/fixturesDeTeste.ts';
import { parecer } from '../domain/comite/fixturesDeParecer.ts';
import { ehPedidoDeComite, respostaDoComite } from '../domain/comite/fixturesDoComite.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createMotorDoPlano } = await import('./motorDoPlano.ts');
const { createProcessadorDeExecucoes } = await import('./processadorDeExecucoes.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa, aceitaTodos } = await import('../infrastructure/ia/iaFalsa.ts');
const { criarIaNaoConfigurada } = await import('../infrastructure/ia/iaNaoConfigurada.ts');
const { ok } = await import('../../../shared/result/result.ts');

async function montar(executor: 'falsa' | 'nao_configurada', quantidade: number) {
  const repositorio = criarRepositorioEmMemoria();
  const ia = criarIaFalsa((p) => {
    if (p.tarefa === 'strategy_plan') return secoesDoGrupoDaChave(p.chaveDeIdempotencia);
    if (ehPedidoDeComite(p)) return respostaDoComite(p);
    if (p.tarefa === 'juiz') return aceitaTodos(p.dados);
    return { resultado: 'aprovado', problemas: [] };
  });
  const motor = createMotorDoPlano({ catalogos: CATALOGOS_DE_TESTE,
    repositorio,
    executorDeIA: executor === 'falsa' ? ia : criarIaNaoConfigurada(),
    leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
    avaliadorDeLimites: { async avaliador() { return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const })); } },
    audit: { async record() {}, async list() { return []; }, async search() { return []; } },
  });
  const tipos = ['aquisicao', 'marca', 'comunidade', 'retencao'] as const;
  for (let i = 0; i < quantidade; i += 1) {
    const plano = await repositorio.criarPlano({ organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID }, tipos[i]!);
    assert.ok(plano.ok);
    await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
      planoId: plano.value.id,
      pedido: { tipo: 'criar', intencao: planoCompleto().intencao },
      versaoBaseId: null,
      agentRunId: `run-${i}`,
      solicitadoPor: 'p',
      requestId: 'r',
    });
  }
  return { repositorio, ia, processador: createProcessadorDeExecucoes({ repositorio, motor }) };
}

describe('processadorDeExecucoes', () => {
  it('descobre, reserva e avança todas as execuções pendentes, devolvendo só contagens', async () => {
    const { processador, repositorio } = await montar('falsa', 3);
    const resultado = await processador.avancar({ limite: 10 });
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    assert.equal(resultado.value.encontradas, 3);
    assert.equal(resultado.value.reservadas, 3);
    assert.equal(resultado.value.concluidas, 3);
    assert.equal(resultado.value.falhas, 0);
    assert.deepEqual(Object.keys(resultado.value).sort(), ['adiadas', 'avancadas', 'codigos', 'concluidas', 'encontradas', 'falhas', 'perdidas', 'reservadas']);
    assert.ok(repositorio.estado.execucoes.every((e) => e.status === 'concluida'));
    const segunda = await processador.avancar({ limite: 10 });
    assert.equal(segunda.ok && segunda.value.encontradas, 0);
  });

  it('o limite restringe quantas são descobertas', async () => {
    const { processador } = await montar('falsa', 3);
    const resultado = await processador.avancar({ limite: 2 });
    assert.equal(resultado.ok && resultado.value.encontradas, 2);
    assert.equal(resultado.ok && resultado.value.concluidas, 2);
  });

  it('com a IA não configurada as execuções falham com o código, sem conteúdo na resposta', async () => {
    const { processador } = await montar('nao_configurada', 2);
    const resultado = await processador.avancar({ limite: 10 });
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    assert.equal(resultado.value.falhas, 2);
    assert.deepEqual(resultado.value.codigos, { ia_nao_configurada: 2 });
  });

  it('exceção numa execução não derruba o lote: as demais seguem e a falha é contada', async () => {
    const { repositorio } = await montar('falsa', 3);
    const original = repositorio.reservarExecucao.bind(repositorio);
    let chamadas = 0;
    const comExcecao = createProcessadorDeExecucoes({
      repositorio: { ...repositorio, reservarExecucao: async (org, id, opcoes) => { if ((chamadas += 1) === 1) throw new Error('banco caiu'); return original(org, id, opcoes); } },
      motor: createMotorDoPlano({ catalogos: CATALOGOS_DE_TESTE,
        repositorio,
        executorDeIA: criarIaFalsa((p) => (p.tarefa === 'strategy_plan' ? secoesDoGrupoDaChave(p.chaveDeIdempotencia) : ehPedidoDeComite(p) ? respostaDoComite(p) : { resultado: 'aprovado', problemas: [] })),
        leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
        avaliadorDeLimites: { async avaliador() { return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const })); } },
        audit: { async record() {}, async list() { return []; }, async search() { return []; } },
      }),
    });
    const r = await comExcecao.avancar({ limite: 10 });
    assert.ok(r.ok);
    assert.equal(r.value.falhas, 1);
    assert.deepEqual(r.value.codigos, { excecao: 1 });
    assert.equal(r.value.concluidas, 2);
  });

  it('sem orçamento de tempo não reserva nada; falha ao descobrir vira unavailable', async () => {
    const { processador, repositorio } = await montar('falsa', 2);
    const semTempo = createProcessadorDeExecucoes({ repositorio, motor: createMotorDoPlano({ catalogos: CATALOGOS_DE_TESTE,
      repositorio,
      executorDeIA: criarIaNaoConfigurada(),
      leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
      avaliadorDeLimites: { async avaliador() { return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const })); } },
      audit: { async record() {}, async list() { return []; }, async search() { return []; } },
    }), orcamentoTotalMs: 0 });
    const resultado = await semTempo.avancar({ limite: 10 });
    assert.equal(resultado.ok && resultado.value.reservadas, 0);
    assert.ok(repositorio.estado.execucoes.every((e) => e.status === 'pendente'));

    const quebrado = createProcessadorDeExecucoes({
      repositorio: { ...repositorio, descobrirExecucoesPendentes: async () => { throw new Error('banco'); } },
      motor: createMotorDoPlano({ catalogos: CATALOGOS_DE_TESTE,
        repositorio,
        executorDeIA: criarIaNaoConfigurada(),
        leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
        avaliadorDeLimites: { async avaliador() { return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const })); } },
        audit: { async record() {}, async list() { return []; }, async search() { return []; } },
      }),
    });
    const falha = await quebrado.avancar({ limite: 5 });
    assert.equal(!falha.ok && falha.error.code, 'unavailable');
    assert.ok(processador);
  });

  it('só erro determinístico marca falhou/interno; o resto deixa o lease vencer, olhando também a causa', async () => {
    const casos: readonly (readonly [unknown, string])[] = [
      [undefined, 'rodando'],
      [{ code: '57014' }, 'rodando'],
      [{ code: '57P03' }, 'rodando'],
      [{ code: '08006' }, 'rodando'],
      [{ code: 'CONNECTION_CLOSED' }, 'rodando'],
      [{ code: 'ENOTFOUND' }, 'rodando'],
      [{ cause: { code: '57P01' } }, 'rodando'],
      [{ code: '23505' }, 'falhou'],
      [{ code: '42P01' }, 'falhou'],
      [{ code: '22P02' }, 'falhou'],
      [{ cause: { code: '23503' } }, 'falhou'],
    ];
    for (const [extra, esperado] of casos) {
      const { repositorio } = await montar('falsa', 1);
      const registros: { action: string; metadata?: Record<string, unknown> }[] = [];
      const processador = createProcessadorDeExecucoes({
        repositorio,
        audit: { async record(e) { registros.push(e as never); }, async list() { return []; }, async search() { return []; } },
        motor: { async avancarExecucao() { throw Object.assign(new Error('segredo-do-payload'), extra ?? {}); } } as never,
      });
      const r = await processador.avancar({ limite: 5 });
      assert.ok(r.ok);
      assert.equal(r.value.codigos['excecao'], 1);
      const execucao = repositorio.estado.execucoes[0]!;
      assert.equal(execucao.status, esperado, JSON.stringify(extra));
      if (esperado === 'falhou') {
        assert.equal(execucao.erroCodigo, 'interno');
        assert.equal(registros.length, 1);
        assert.equal(registros[0]!.metadata?.['status'], 'falhou');
      } else {
        assert.equal(registros.length, 0);
      }
    }
  });
});
