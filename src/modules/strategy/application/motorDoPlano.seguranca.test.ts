import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { AvaliadorDeLimites, Execucao, LeitorDoBrain, PedidoDeIA } from '@/modules/strategy/application/portas';
import { parecer, ponto } from '../domain/comite/fixturesDeParecer.ts';
import { ehPedidoDeComite, respostaDoComite } from '../domain/comite/fixturesDoComite.ts';
import { CLIENTE_ID, ORGANIZACAO_ID, URN_BENCHMARK_B, CATALOGOS_DE_TESTE, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave } from '../domain/fixturesDeTeste.ts';
import type { Plano } from '../domain/plano.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createMotorDoPlano } = await import('./motorDoPlano.ts');
const { MAXIMO_DE_RESERVAS } = await import('./portas.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa, aceitaTodos } = await import('../infrastructure/ia/iaFalsa.ts');
const { ok } = await import('../../../shared/result/result.ts');

type Roteiro = (pedido: PedidoDeIA<unknown>) => unknown;

const INTENCAO = planoCompleto().intencao;
const ESCOPO = { organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID };
const brainOk: LeitorDoBrain = { async lerPacote() { return ok(pacoteDeTeste()); } };

const respostasPara = (dados: unknown) => {
  const pontos = (dados as { pontos: { pontos: { persona: string; pontoId: string }[] }[] }).pontos.flatMap((argumento) => argumento.pontos);
  return pontos.map((p) => ({ pontoId: p.pontoId, persona: p.persona, decisao: 'acatado' as const, motivo: 'acatado no ajuste' }));
};

type Sobrescrita = {
  comite?: (persona: string) => unknown;
  gate?: (n: number) => unknown;
  plano?: () => unknown;
  ajustado?: () => unknown;
};

function roteiroPadrao(sobrescrita: Sobrescrita = {}): Roteiro {
  let chamadasDoGate = 0;
  return (pedido) => {
    if (pedido.tarefa === 'strategy_plan') {
      if (pedido.chaveDeIdempotencia.includes(':ajustar:')) {
        const ajustado = (sobrescrita.ajustado ? sobrescrita.ajustado() : planoCompleto()) as Plano;
        return { secoes: secoesDoGrupoDaChave(pedido.chaveDeIdempotencia, ajustado), respostas: respostasPara(pedido.dados) };
      }
      return secoesDoGrupoDaChave(pedido.chaveDeIdempotencia, (sobrescrita.plano ? sobrescrita.plano() : planoCompleto()) as Plano);
    }
    if (ehPedidoDeComite(pedido)) return respostaDoComite(pedido, (chave) => sobrescrita.comite ? sobrescrita.comite(chave) : parecer(chave, 'aprova'));
    if (pedido.tarefa === 'juiz') return aceitaTodos(pedido.dados);
    chamadasDoGate += 1;
    return sobrescrita.gate ? sobrescrita.gate(chamadasDoGate) : { resultado: 'aprovado', problemas: [] };
  };
}

type Opcoes = {
  roteiro?: Roteiro | ((pedido: PedidoDeIA<unknown>) => Promise<unknown>);
  avaliador?: AvaliadorDeLimites;
  tipo?: 'criar' | 'ajustar';
  planoBase?: unknown;
};

async function montar(opcoes: Opcoes = {}) {
  const repositorio = criarRepositorioEmMemoria();
  const ia = criarIaFalsa(opcoes.roteiro ?? roteiroPadrao());
  const auditorias: AuditEvent[] = [];
  const planosVistosPeloAvaliador: unknown[] = [];
  const avaliador: AvaliadorDeLimites =
    opcoes.avaliador ?? {
      async avaliador(_org, _cli, plano) {
        planosVistosPeloAvaliador.push(plano);
        return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const }));
      },
    };
  const motor = createMotorDoPlano({ catalogos: CATALOGOS_DE_TESTE,
    repositorio,
    executorDeIA: ia,
    leitorDoBrain: brainOk,
    avaliadorDeLimites: avaliador,
    audit: { async record(e) { auditorias.push(e); }, async list() { return []; }, async search() { return []; } },
  });
  const plano = await repositorio.criarPlano(ESCOPO, 'aquisicao');
  assert.ok(plano.ok);
  let versaoBaseId: string | null = null;
  if (opcoes.tipo === 'ajustar') {
    const versao = await repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: plano.value.id,
      conteudo: opcoes.planoBase ?? planoCompleto(),
      schemaVersion: 1,
      supersedesId: null,
      autoria: { tipo: 'pessoa', userId: 'pessoa-1' },
      referencias: [{ urn: URN_BENCHMARK_B, hash: 'a'.repeat(64), papel: 'favor' }],
      requestId: 'r',
    });
    assert.ok(versao.ok);
    versaoBaseId = versao.value.id;
  }
  const execucao = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
    planoId: plano.value.id,
    pedido: opcoes.tipo === 'ajustar' ? { tipo: 'ajustar', instrucao: 'Aumente a verba de busca' } : { tipo: 'criar', intencao: INTENCAO },
    versaoBaseId,
    agentRunId: 'run-seg-1',
    solicitadoPor: 'pessoa-1',
    requestId: 'r',
  });
  assert.ok(execucao.ok);
  return { repositorio, ia, motor, auditorias, planosVistosPeloAvaliador, plano: plano.value, execucaoId: execucao.value.id };
}

type Montagem = Awaited<ReturnType<typeof montar>>;

const reservar = (m: Montagem, agora = new Date('2026-11-25T12:00:00Z')): Promise<Execucao | null> =>
  m.repositorio.reservarExecucao(ORGANIZACAO_ID, m.execucaoId, { leaseMs: 60_000, agora });

async function ate(m: Montagem): Promise<Execucao> {
  for (let i = 0; i < 15; i += 1) {
    const reservada = await reservar(m);
    if (!reservada) break;
    const resumo = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 10_000_000, ficha: reservada.tentativas });
    if (resumo.execucao && ['concluida', 'falhou', 'cancelada'].includes(resumo.execucao.status)) return resumo.execucao;
  }
  throw new Error('a execução não terminou');
}

const eventosDe = (m: Montagem, tipo: string) => m.repositorio.estado.eventos.filter((e) => e.tipo === tipo);
const ultimoGate = (m: Montagem) => eventosDe(m, 'gate').at(-1)!.payload as { resultado: string; checagens: { chave: string; resultado: string; onde: string[] }[] };

describe('motor: dono da execução (ficha), lease e teto de reservas', () => {
  it('dois workers na mesma execução: o que perdeu a ficha para sem gravar e sem sobrescrever', async () => {
    let m!: Montagem;
    let segunda: Execucao | null = null;
    m = await montar({
      roteiro: async (pedido) => {
        if (pedido.tarefa === 'strategy_plan' && segunda === null) {
          segunda = await reservar(m, new Date('2099-01-01T00:00:00Z'));
        }
        return roteiroPadrao()(pedido);
      },
    });
    const primeira = await reservar(m);
    assert.equal(primeira?.tentativas, 1);
    await m.motor.passo(ORGANIZACAO_ID, m.execucaoId, 1);
    const perdedor = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 10_000_000, ficha: 1 });
    assert.equal(perdedor.estado, 'perdida');
    assert.equal(segunda!.tentativas, 2);
    assert.equal(m.repositorio.estado.versoes.length, 0, 'o perdedor não gravou a versão');
    assert.equal(m.ia.pedidos.filter((p) => p.tarefa === 'strategy_plan').length, 1, 'e parou antes de pedir mais ao modelo');
    const noBanco = m.repositorio.estado.execucoes[0]!;
    assert.equal(noBanco.status, 'rodando');
    assert.equal(noBanco.tentativas, 2);
    assert.equal(noBanco.etapa, 'redigir');

    const vencedor = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 10_000_000, ficha: 2 });
    assert.equal(vencedor.execucao?.status, 'concluida');
    assert.equal(m.repositorio.estado.versoes.length, 1);
  });

  it('quem chega com a ficha velha antes de qualquer etapa não chama o modelo', async () => {
    const m = await montar();
    await reservar(m);
    await reservar(m, new Date('2099-01-01T00:00:00Z'));
    const velho = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 10_000_000, ficha: 1 });
    assert.equal(velho.estado, 'perdida');
    assert.equal(m.ia.pedidos.length, 0);
    assert.equal(m.repositorio.estado.execucoes[0]!.etapa, 'ler_brain');
  });

  it('renova o lease antes de cada pedido ao modelo, condicionado à ficha', async () => {
    const m = await montar();
    const reservada = await reservar(m);
    await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 10_000_000, ficha: reservada!.tentativas });
    const renovacoes = m.repositorio.contagemDeChamadas('atualizarExecucao');
    assert.ok(renovacoes >= m.ia.pedidos.length * 2, `renovações ${renovacoes} para ${m.ia.pedidos.length} pedidos`);
  });

  it('o lease padrão é maior que o pedido mais longo ao modelo', async () => {
    const { LEASE_DA_EXECUCAO_MS, ORCAMENTO_DA_IA } = await import('./motorDoPlano.ts');
    const maisLongo = Math.max(...Object.values(ORCAMENTO_DA_IA).map((o) => o.tempoMaximoMs));
    assert.ok(LEASE_DA_EXECUCAO_MS > maisLongo);
  });

  it('execução que estoura o teto de reservas vira falhou/interno e não é mais descoberta', async () => {
    const m = await montar();
    m.repositorio.estado.execucoes[0]!.tentativas = MAXIMO_DE_RESERVAS;
    assert.equal((await m.repositorio.descobrirExecucoesPendentes(10)).length, 1);
    assert.equal(await reservar(m), null);
    const execucao = m.repositorio.estado.execucoes[0]!;
    assert.equal(execucao.status, 'falhou');
    assert.equal(execucao.erroCodigo, 'interno');
    assert.equal((await m.repositorio.descobrirExecucoesPendentes(10)).length, 0);
    assert.equal(m.ia.pedidos.length, 0);
  });

  it('cancelamento DURANTE a etapa: o motor para e nada é gravado depois', async () => {
    let m!: Montagem;
    m = await montar({
      roteiro: async (pedido) => {
        if (pedido.tarefa === 'strategy_plan') await m.repositorio.cancelarExecucao(ORGANIZACAO_ID, m.execucaoId, 'req-cancela');
        return roteiroPadrao()(pedido);
      },
    });
    const reservada = await reservar(m);
    const resumo = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 10_000_000, ficha: reservada!.tentativas });
    assert.equal(resumo.estado, 'perdida');
    assert.equal(resumo.execucao?.status, 'cancelada');
    assert.equal(m.repositorio.estado.versoes.length, 0);
    assert.equal(m.repositorio.estado.eventos.length, 0);
    assert.equal(m.ia.pedidos.length, 1);
  });

  it('escrita de agente de execução que deixou de rodar é recusada pelo repositório (execucao_perdida)', async () => {
    const m = await montar();
    const reservada = await reservar(m);
    await m.repositorio.cancelarExecucao(ORGANIZACAO_ID, m.execucaoId, 'r');
    const gravada = await m.repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: m.plano.id,
      conteudo: planoCompleto(),
      schemaVersion: 1,
      supersedesId: null,
      autoria: { tipo: 'agente', agentId: 'agente_de_plano', agentRunId: reservada!.agentRunId, chaveDeIdempotencia: 'k', ficha: reservada!.tentativas },
      referencias: [],
      requestId: 'r',
    });
    assert.equal(!gravada.ok && gravada.error.codigo, 'execucao_perdida');
  });
});

describe('motor: a intenção é fixa', () => {
  it('a intenção gravada e a vista pelo avaliador de limites são as originais; o modelo nunca a devolve', async () => {
    const m = await montar();
    await ate(m);
    assert.deepEqual(m.repositorio.estado.versoes[0]!.conteudo, { ...planoCompleto(), intencao: INTENCAO });
    const vista = m.planosVistosPeloAvaliador[0] as ReturnType<typeof planoCompleto>;
    assert.deepEqual(vista.intencao, INTENCAO);
    for (const pedido of m.ia.pedidos.filter((p) => p.tarefa === 'strategy_plan')) {
      assert.deepEqual((pedido.dados as { intencao: unknown }).intencao, INTENCAO);
    }
  });

  it('modelo que devolve a intenção (dobrando a verba) junto das seções do grupo vira saida_invalida e nada é gravado', async () => {
    const base = roteiroPadrao();
    const m = await montar({
      roteiro: (pedido) => {
        const saida = base(pedido) as Record<string, unknown>;
        if (pedido.tarefa === 'strategy_plan') return { ...saida, intencao: { ...INTENCAO, verba: { centavos: '2000000', moeda: 'BRL' } } };
        return saida;
      },
    });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(m.repositorio.estado.versoes.length, 0);
  });

  it('plano acima do teto mensal reprova porque os Gates avaliam contra a verba original', async () => {
    const dobrado = () => {
      const plano = planoCompleto();
      const dobro = { centavos: '2000000', moeda: 'BRL' as const };
      plano.intencao.verba = dobro;
      plano.orcamento.total = dobro;
      plano.resumo_executivo.verba = dobro;
      plano.campanhas.campanhas[0]!.verba = { ...dobro, centavos: '1200000' };
      plano.campanhas.campanhas[1]!.verba = { ...dobro, centavos: '800000' };
      plano.orcamento.por_canal = [
        { canal_id: 'cn_busca', valor: { ...dobro, centavos: '1200000' } },
        { canal_id: 'cn_social', valor: { ...dobro, centavos: '800000' } },
      ];
      return plano;
    };
    const m = await montar({ roteiro: roteiroPadrao({ plano: dobrado, ajustado: dobrado }) });
    const final = await ate(m);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'gate_reprovado');
    const gate = ultimoGate(m);
    assert.equal(gate.checagens.find((c) => c.chave === 'orcamento_fecha')?.resultado, 'reprovado');
    for (const versao of m.repositorio.estado.versoes) {
      assert.equal((versao.conteudo as ReturnType<typeof planoCompleto>).intencao.verba.centavos, INTENCAO.verba.centavos);
    }
  });

  it('ajuste ao Comitê que devolve a intenção junto das seções do grupo vira saida_invalida e não cria a versão de ajuste', async () => {
    const base = roteiroPadrao({
      comite: (persona) => (persona === 'redator' ? parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'estrategia', [URN_BENCHMARK_B])]) : parecer(persona, 'aprova')),
    });
    const m = await montar({
      roteiro: (pedido) => {
        const saida = base(pedido) as { secoes?: Record<string, unknown> };
        if (pedido.chaveDeIdempotencia.includes(':ajustar:') && saida.secoes) saida.secoes.intencao = { ...INTENCAO, ousadia: 'ousado' };
        return saida;
      },
    });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(m.repositorio.estado.versoes.length, 1);
    assert.equal(eventosDe(m, 'ajuste').length, 0);
  });
});

describe('motor: limites vigentes de toda medida e "não faremos"', () => {
  const comMedidas = (medidas: readonly ('gasto' | 'custo_por_aquisicao' | 'custo_por_lead' | 'retorno')[]): AvaliadorDeLimites => ({
    async avaliador() {
      const avaliar = Object.assign(() => 'ok' as const, { medidasComLimite: medidas });
      return ok(avaliar);
    },
  });

  it('limite vigente de medida sem meta que a avalie reprova no Gate; declarar não aplicável com motivo aprova', async () => {
    const sem = await montar({ avaliador: comMedidas(['gasto', 'custo_por_aquisicao']) });
    const falhou = await ate(sem);
    assert.equal(falhou.erroCodigo, 'gate_reprovado');
    const limites = ultimoGate(sem).checagens.find((c) => c.chave === 'limites_do_cliente')!;
    assert.equal(limites.resultado, 'reprovado');
    assert.ok(limites.onde.some((o) => o.includes('custo_por_aquisicao')));

    const declarado = () => {
      const plano = planoCompleto();
      plano.riscos_e_regras.limites_nao_aplicaveis = [{ medida: 'custo_por_aquisicao', motivo: 'Plano sem venda direta.' }];
      return plano;
    };
    const com = await montar({ avaliador: comMedidas(['gasto', 'custo_por_aquisicao']), roteiro: roteiroPadrao({ plano: declarado }) });
    const concluida = await ate(com);
    assert.equal(concluida.status, 'concluida');
    const aprovado = ultimoGate(com).checagens.find((c) => c.chave === 'limites_do_cliente')!;
    assert.ok(aprovado.onde.some((o) => o.includes('declarado como não aplicável')));
    const doGate = com.ia.pedidos.find((p) => p.tarefa === 'gate')!.dados as { limitesDeclaradosComoNaoAplicaveis: unknown[] };
    assert.equal(doGate.limitesDeclaradosComoNaoAplicaveis.length, 1);
    assert.match(com.ia.pedidos.find((p) => p.tarefa === 'gate')!.instrucoes, /justificativa que procede/);
  });

  it('o Gate por modelo recebe os não faremos só de texto e as regras e decisões do cliente, com a instrução de reprovar a violação', async () => {
    const m = await montar();
    await ate(m);
    const pedido = m.ia.pedidos.find((p) => p.tarefa === 'gate')!;
    const dados = pedido.dados as { naoFaremosSoDeTexto: { id: string }[]; regrasEDecisoesDoCliente: { tipo: string }[] };
    assert.deepEqual(dados.naoFaremosSoDeTexto.map((i) => i.id), ['nf_tom']);
    assert.ok(dados.regrasEDecisoesDoCliente.every((e) => e.tipo === 'regra' || e.tipo === 'decisao'));
    assert.match(pedido.instrucoes, /REPROVE se campanha, canal, público, mensagem ou plano de mídia violar/);
  });

  it('um "não faremos" que some no ajuste reprova no Gate (nao_faremos_preservado)', async () => {
    const semItem = () => {
      const plano = planoCompleto();
      plano.estrategia.nao_faremos = plano.estrategia.nao_faremos.filter((item) => item.id !== 'nf_tiktok');
      return plano;
    };
    const m = await montar({ tipo: 'ajustar', roteiro: roteiroPadrao({ plano: semItem, ajustado: semItem }) });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'gate_reprovado');
    const checagem = ultimoGate(m).checagens.find((c) => c.chave === 'nao_faremos_preservado')!;
    assert.equal(checagem.resultado, 'reprovado');
    assert.ok(checagem.onde.some((o) => o.includes('nf_tiktok')));
  });

  it('com a base preservada, o ajuste conclui', async () => {
    const m = await montar({ tipo: 'ajustar' });
    assert.equal((await ate(m)).status, 'concluida');
    const checagem = ultimoGate(m).checagens.find((c) => c.chave === 'nao_faremos_preservado')!;
    assert.equal(checagem.resultado, 'aprovado');
  });
});

describe('motor: texto do modelo sem dado pessoal em parecer, ajuste e Gate', () => {
  const comAjuste = (persona: string, motivo = 'Precisa de ajuste') =>
    persona === 'redator'
      ? { ...parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'estrategia', [URN_BENCHMARK_B])]), motivo }
      : parecer(persona, 'aprova');

  it('parecer com e-mail no motivo vira saida_invalida e nada é gravado dele', async () => {
    const m = await montar({ roteiro: roteiroPadrao({ comite: (p) => ({ ...parecer(p, 'aprova'), motivo: 'Falar com maria@exemplo.com' }) }) });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(eventosDe(m, 'parecer').length, 0);
    assert.ok(!JSON.stringify(m.auditorias).includes('maria@'));
  });

  it('parecer com telefone no problema do ponto vira saida_invalida', async () => {
    const m = await montar({
      roteiro: roteiroPadrao({
        comite: (p) => {
          const base = comAjuste(p);
          if (p === 'redator') base.pontos[0]!.problema = 'Ligar para (11) 98888-7777';
          return base;
        },
      }),
    });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(eventosDe(m, 'parecer').filter((e) => e.payload.persona === 'redator').length, 0);
  });

  it('resposta do ajuste com e-mail no motivo vira saida_invalida e não cria a versão de ajuste', async () => {
    const base = roteiroPadrao({ comite: (p) => comAjuste(p) });
    const m = await montar({
      roteiro: (pedido) => {
        const saida = base(pedido) as { respostas?: { motivo: string }[] };
        if (pedido.chaveDeIdempotencia.includes(':ajustar:') && saida.respostas) saida.respostas[0]!.motivo = 'Avisei maria@exemplo.com';
        return saida;
      },
    });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(m.repositorio.estado.versoes.length, 1);
    assert.equal(eventosDe(m, 'ajuste').length, 0);
  });

  it('problema do Gate por modelo com dado pessoal vira saida_invalida e o gate não é gravado', async () => {
    const m = await montar({
      roteiro: roteiroPadrao({ gate: () => ({ resultado: 'reprovado', problemas: [{ trecho: 'campanhas', problema: 'Ligar para maria@exemplo.com' }] }) }),
    });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(eventosDe(m, 'gate').length, 0);
  });
});

describe('motor: Comitê de outra execução não vale', () => {
  it('pareceres de outra execução reprovam o Gate em comite_completo', async () => {
    const m = await montar();
    const reservada = await reservar(m);
    const ficha = reservada!.tentativas;
    while (m.repositorio.estado.execucoes[0]!.etapa !== 'gates') await m.motor.passo(ORGANIZACAO_ID, m.execucaoId, ficha);
    for (const evento of m.repositorio.estado.eventos.filter((e) => e.tipo === 'parecer')) {
      (evento as { agentRunId: string | null }).agentRunId = 'run-antiga';
    }
    await m.motor.passo(ORGANIZACAO_ID, m.execucaoId, ficha);
    const comite = ultimoGate(m).checagens.find((c) => c.chave === 'comite_completo')!;
    assert.equal(ultimoGate(m).resultado, 'reprovado');
    assert.equal(comite.resultado, 'reprovado');
  });
});

describe('repositório em memória: edição manual atômica', () => {
  it('com execução ativa nada é gravado e a versão aberta anterior não é cancelada', async () => {
    const m = await montar({ tipo: 'ajustar' });
    const aberta = m.repositorio.estado.versoes[0]!;
    const recusada = await m.repositorio.criarVersaoManualComRevisao(ORGANIZACAO_ID, CLIENTE_ID, { planoId: m.plano.id, conteudo: planoCompleto(), schemaVersion: 1, supersedesId: null, autoria: { tipo: 'pessoa', userId: 'pessoa-1' }, referencias: [], requestId: 'r' }, { planoId: m.plano.id, pedido: { tipo: 'revisar', motivo: 'edicao_manual' }, agentRunId: 'run-manual', solicitadoPor: 'pessoa-1', requestId: 'r' });
    assert.equal(!recusada.ok && recusada.error.codigo, 'execucao_ativa');
    assert.equal(m.repositorio.estado.versoes.length, 1);
    assert.equal(aberta.status, 'rascunho');
    await m.repositorio.cancelarExecucao(ORGANIZACAO_ID, m.execucaoId, 'r');
    const feita = await m.repositorio.criarVersaoManualComRevisao(ORGANIZACAO_ID, CLIENTE_ID, { planoId: m.plano.id, conteudo: planoCompleto(), schemaVersion: 1, supersedesId: null, autoria: { tipo: 'pessoa', userId: 'pessoa-1' }, referencias: [], requestId: 'r' }, { planoId: m.plano.id, pedido: { tipo: 'revisar', motivo: 'edicao_manual' }, agentRunId: 'run-manual', solicitadoPor: 'pessoa-1', requestId: 'r' });
    assert.ok(feita.ok);
    assert.equal(feita.ok && feita.value.execucao.versaoBaseId, feita.ok && feita.value.versao.id);
    assert.equal(aberta.status, 'cancelado');
  });
});

describe('motor: o "não faremos" da vigente não se perde por uma base aberta já afrouxada', () => {
  const semTiktok = () => {
    const plano = planoCompleto();
    plano.estrategia.nao_faremos = plano.estrategia.nao_faremos.filter((item) => item.id !== 'nf_tiktok');
    return plano;
  };

  async function rodarAte(m: Montagem, execucaoId: string): Promise<Execucao> {
    for (let i = 0; i < 15; i += 1) {
      const reservada = await m.repositorio.reservarExecucao(ORGANIZACAO_ID, execucaoId, { leaseMs: 60_000, agora: new Date('2026-11-25T12:00:00Z') });
      if (!reservada) break;
      const resumo = await m.motor.avancarExecucao(ORGANIZACAO_ID, execucaoId, { orcamentoMs: 10_000_000, ficha: reservada.tentativas });
      if (resumo.execucao && ['concluida', 'falhou', 'cancelada'].includes(resumo.execucao.status)) return resumo.execucao;
    }
    throw new Error('a execução não terminou');
  }

  const novoPedido = (m: Montagem, base: string, run: string) =>
    m.repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
      planoId: m.plano.id,
      pedido: { tipo: 'ajustar', instrucao: 'Ajuste de novo' },
      versaoBaseId: base,
      agentRunId: run,
      solicitadoPor: 'pessoa-1',
      requestId: 'r',
    });

  it('R1 redige V1 sem o item e reprova; o novo pedido usa V1 como base e V2 também reprova contra a vigente', async () => {
    const m = await montar({ tipo: 'ajustar', roteiro: roteiroPadrao({ plano: semTiktok, ajustado: semTiktok }) });
    m.repositorio.estado.versoes[0]!.status = 'vigente';
    const primeira = await rodarAte(m, m.execucaoId);
    assert.equal(primeira.erroCodigo, 'gate_reprovado');
    const aberta = m.repositorio.estado.versoes.find((v) => v.status === 'rascunho')!;
    assert.equal(aberta.autorTipo, 'agente');

    const segunda = await novoPedido(m, aberta.id, 'run-seg-2');
    assert.ok(segunda.ok);
    const final = await rodarAte(m, segunda.value.id);
    assert.equal(final.erroCodigo, 'gate_reprovado', 'sem a vigente na base, V2 passaria igual a V1');
    const checagem = ultimoGate(m).checagens.find((c) => c.chave === 'nao_faremos_preservado')!;
    assert.equal(checagem.resultado, 'reprovado');
    assert.ok(checagem.onde.some((o) => o.includes('nf_tiktok')));
  });

  it('a pessoa que remove o item por edição manual vale dali em diante: o agente seguinte passa sem ele', async () => {
    const m = await montar({ tipo: 'ajustar', roteiro: roteiroPadrao({ plano: semTiktok, ajustado: semTiktok }) });
    m.repositorio.estado.versoes[0]!.status = 'vigente';
    const editada = await m.repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: m.plano.id,
      conteudo: semTiktok(),
      schemaVersion: 1,
      supersedesId: m.repositorio.estado.versoes[0]!.id,
      autoria: { tipo: 'pessoa', userId: 'pessoa-1' },
      referencias: [],
      requestId: 'r',
    });
    assert.ok(editada.ok);
    m.repositorio.estado.execucoes[0]!.status = 'cancelada';
    const pedido = await novoPedido(m, editada.value.id, 'run-seg-3');
    assert.ok(pedido.ok);
    const final = await rodarAte(m, pedido.value.id);
    assert.equal(final.status, 'concluida');
  });
});

describe('motor: bases do "não faremos" pela regra de pessoa, revogação e execução', () => {
  const semTiktok = () => {
    const plano = planoCompleto();
    plano.estrategia.nao_faremos = plano.estrategia.nao_faremos.filter((item) => item.id !== 'nf_tiktok');
    return plano;
  };

  type Semente = {
    readonly conteudo: () => unknown;
    readonly autor: 'pessoa' | 'agente';
    readonly status: 'rascunho' | 'vigente' | 'superado' | 'rejeitado' | 'revogado' | 'cancelado';
    readonly evento?: { readonly tipo: 'rejeitada' | 'revogada' | 'cancelada'; readonly atorTipo: 'usuario' | 'sistema' };
  };

  async function semear(m: Montagem, itens: readonly Semente[]): Promise<string[]> {
    const ids: string[] = [];
    let vigenteId: string | null = null;
    for (const [indice, item] of itens.entries()) {
      const criada = await m.repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
        planoId: m.plano.id,
        conteudo: item.conteudo(),
        schemaVersion: 1,
        supersedesId: vigenteId,
        autoria: { tipo: 'pessoa', userId: 'pessoa-1' },
        referencias: [],
        requestId: 'r',
      });
      assert.ok(criada.ok);
      if (item.status === 'vigente') vigenteId = criada.value.id;
      const interna = m.repositorio.estado.versoes.find((v) => v.id === criada.value.id)!;
      if (item.autor === 'agente') Object.assign(interna, { autorTipo: 'agente', autorUsuarioId: null, agentId: 'agente_de_plano', agentRunId: `run-semente-${indice}` });
      interna.status = item.status;
      if (item.evento) {
        m.repositorio.estado.eventos.push({
          id: `evento-semente-${indice}`,
          versaoId: interna.id,
          tipo: item.evento.tipo,
          atorTipo: item.evento.atorTipo,
          atorUsuarioId: item.evento.atorTipo === 'usuario' ? 'pessoa-1' : null,
          agentId: null,
          agentRunId: null,
          payload: {},
          criadoEm: new Date('2026-11-24T12:00:00Z'),
          chave: null,
        } as never);
      }
      ids.push(interna.id);
    }
    return ids;
  }

  async function pedirAjuste(m: Montagem, base: string): Promise<Execucao> {
    m.repositorio.estado.execucoes[0]!.status = 'cancelada';
    const pedido = await m.repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
      planoId: m.plano.id,
      pedido: { tipo: 'ajustar', instrucao: 'Ajuste de novo' },
      versaoBaseId: base,
      agentRunId: 'run-pedido-novo',
      solicitadoPor: 'pessoa-1',
      requestId: 'r',
    });
    assert.ok(pedido.ok);
    return pedido.value;
  }

  async function rodar(m: Montagem, execucaoId: string): Promise<Execucao> {
    for (let i = 0; i < 15; i += 1) {
      const reservada = await m.repositorio.reservarExecucao(ORGANIZACAO_ID, execucaoId, { leaseMs: 60_000, agora: new Date('2026-11-25T12:00:00Z') });
      if (!reservada) break;
      const resumo = await m.motor.avancarExecucao(ORGANIZACAO_ID, execucaoId, { orcamentoMs: 10_000_000, ficha: reservada.tentativas });
      if (resumo.execucao && ['concluida', 'falhou', 'cancelada'].includes(resumo.execucao.status)) return resumo.execucao;
    }
    throw new Error('a execução não terminou');
  }

  const roteiroSemTiktok = () => roteiroPadrao({ plano: semTiktok, ajustado: semTiktok });
  const reprovouPorTiktok = (m: Montagem) => {
    const checagem = ultimoGate(m).checagens.find((c) => c.chave === 'nao_faremos_preservado')!;
    assert.equal(checagem.resultado, 'reprovado');
    assert.ok(checagem.onde.some((o) => o.includes('nf_tiktok')));
  };

  const vigente: Semente = { conteudo: planoCompleto, autor: 'pessoa', status: 'vigente' };
  const afrouxada: Semente = { conteudo: semTiktok, autor: 'agente', status: 'rascunho' };

  for (const [status, tipo] of [['rejeitado', 'rejeitada'], ['cancelado', 'cancelada']] as const) {
    it(`proposta ${status} por pessoa é pulada: a vigente continua nas bases e a versão afrouxada reprova`, async () => {
      const m = await montar({ roteiro: roteiroSemTiktok() });
      const [, , aberta] = await semear(m, [vigente, { conteudo: planoCompleto, autor: 'agente', status, evento: { tipo, atorTipo: 'usuario' } }, afrouxada]);
      const pedido = await pedirAjuste(m, aberta!);
      const final = await rodar(m, pedido.id);
      assert.equal(final.erroCodigo, 'gate_reprovado');
      reprovouPorTiktok(m);
    });
  }

  it('criar depois de plano revogado não herda o item do revogado nem de versões anteriores a ele', async () => {
    const m = await montar({ roteiro: roteiroSemTiktok() });
    await semear(m, [
      { conteudo: planoCompleto, autor: 'pessoa', status: 'superado' },
      { conteudo: planoCompleto, autor: 'agente', status: 'revogado', evento: { tipo: 'revogada', atorTipo: 'usuario' } },
    ]);
    assert.equal((await ate(m)).status, 'concluida');
  });

  it('ajustar com versão aberta depois de revogação não herda o item do plano revogado', async () => {
    const m = await montar({ roteiro: roteiroSemTiktok() });
    const [, , aberta] = await semear(m, [
      { conteudo: planoCompleto, autor: 'pessoa', status: 'superado' },
      { conteudo: planoCompleto, autor: 'agente', status: 'revogado', evento: { tipo: 'revogada', atorTipo: 'usuario' } },
      afrouxada,
    ]);
    const pedido = await pedirAjuste(m, aberta!);
    assert.equal((await rodar(m, pedido.id)).status, 'concluida');
  });

  it('edição manual que removeu o item vale: o pedido seguinte não o exige de volta', async () => {
    const m = await montar({ roteiro: roteiroSemTiktok() });
    const [, manual] = await semear(m, [{ ...vigente, autor: 'agente' }, { conteudo: semTiktok, autor: 'pessoa', status: 'rascunho' }]);
    const pedido = await pedirAjuste(m, manual!);
    assert.equal((await rodar(m, pedido.id)).status, 'concluida');
  });

  it('criar compara a cadeia de ajustes da própria execução contra todas as suas versões', async () => {
    const m = await montar({
      roteiro: roteiroPadrao({
        plano: planoCompleto,
        ajustado: semTiktok,
        comite: (persona) =>
          persona === 'redator' ? { ...parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'estrategia', [URN_BENCHMARK_B])]), motivo: 'Precisa de ajuste' } : parecer(persona, 'aprova'),
      }),
    });
    const final = await ate(m);
    assert.equal(final.erroCodigo, 'gate_reprovado');
    reprovouPorTiktok(m);
  });
});

describe('ficha obrigatória na porta e no motor', () => {
  it('sem ficha nada é adotado do banco: atualizarExecucao, passo e avancarExecucao não gravam', async () => {
    const m = await montar();
    await reservar(m);
    // @ts-expect-error a ficha é obrigatória
    const atualizacao = await m.repositorio.atualizarExecucao(ORGANIZACAO_ID, m.execucaoId, { etapa: 'redigir' });
    assert.equal(!atualizacao.ok && atualizacao.error.codigo, 'execucao_perdida');
    // @ts-expect-error a ficha é obrigatória
    const passo = await m.motor.passo(ORGANIZACAO_ID, m.execucaoId);
    assert.equal(passo.estado, 'perdida');
    // @ts-expect-error a ficha é obrigatória
    const avanco = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs: 1000 });
    assert.equal(avanco.estado, 'perdida');
    assert.equal(m.repositorio.estado.execucoes[0]!.etapa, 'ler_brain');
    assert.equal(m.ia.pedidos.length, 0);
  });

  it('a escrita de agente com a ficha de outro dono é recusada pelo repositório', async () => {
    const m = await montar();
    const reservada = await reservar(m);
    const velha = await m.repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: m.plano.id,
      conteudo: planoCompleto(),
      schemaVersion: 1,
      supersedesId: null,
      autoria: { tipo: 'agente', agentId: 'agente_de_plano', agentRunId: reservada!.agentRunId, chaveDeIdempotencia: 'k', ficha: reservada!.tentativas - 1 },
      referencias: [],
      requestId: 'r',
    });
    assert.equal(!velha.ok && velha.error.codigo, 'execucao_perdida');
  });
});
