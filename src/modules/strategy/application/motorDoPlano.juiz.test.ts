import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AvaliadorDeLimites, ErroDeIA, Execucao, PedidoDeIA } from '@/modules/strategy/application/portas';
import { parecer, ponto } from '../domain/comite/fixturesDeParecer.ts';
import { CATALOGOS_DE_TESTE, CLIENTE_ID, ORGANIZACAO_ID, URN_BENCHMARK_B, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave } from '../domain/fixturesDeTeste.ts';
import type { NaoFaremos, Plano } from '../domain/plano.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createMotorDoPlano } = await import('./motorDoPlano.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa } = await import('../infrastructure/ia/iaFalsa.ts');
const { comValidacao } = await import('../infrastructure/ia/comValidacao.ts');
const { ok } = await import('../../../shared/result/result.ts');

type Roteiro = (pedido: PedidoDeIA<unknown>) => unknown;
type Veredito = { persona: string; pontoId: string; veredito: 'aceito' | 'rejeitado'; motivo: string; prova: string[] };

const ESCOPO = { organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID };
const INTENCAO = planoCompleto().intencao;
const semMedidas = <T extends (...argumentos: never[]) => unknown>(f: T) => Object.assign(f, { medidasComLimite: [] as const });
const aprovaTudo: AvaliadorDeLimites = { async avaliador() { return ok(semMedidas(() => 'ok' as const)); } };

const pontosDoLote = (dados: unknown) => (dados as { pontos: { persona: string; pontoId: string }[] }).pontos;
const respostasAcatando = (dados: unknown) =>
  (dados as { pontos: { pontos: { persona: string; pontoId: string }[] }[] }).pontos
    .flatMap((argumento) => argumento.pontos)
    .map((p) => ({ pontoId: p.pontoId, persona: p.persona, decisao: 'acatado' as const, motivo: 'aplicado' }));

type Opcoes = {
  comite?: (persona: string) => unknown;
  juiz?: (dados: unknown) => unknown | ErroDeIA;
  gate?: (n: number) => unknown;
  plano?: () => Plano;
  ajusteDoGrupo?: (pedido: PedidoDeIA<unknown>) => unknown;
};

function roteiro(opcoes: Opcoes = {}): Roteiro {
  let chamadasDoGate = 0;
  return (pedido) => {
    if (pedido.tarefa === 'strategy_plan') {
      const secoes = secoesDoGrupoDaChave(pedido.chaveDeIdempotencia, opcoes.plano?.());
      if (pedido.chaveDeIdempotencia.includes(':corrigir:')) return { secoes, respostas: [] };
      if (pedido.chaveDeIdempotencia.includes(':ajustar:')) {
        return opcoes.ajusteDoGrupo ? opcoes.ajusteDoGrupo(pedido) : { secoes, respostas: respostasAcatando(pedido.dados) };
      }
      return secoes;
    }
    if (pedido.tarefa === 'comite') {
      const persona = (pedido.dados as { persona: { chave: string } }).persona.chave;
      return opcoes.comite ? opcoes.comite(persona) : parecer(persona, 'aprova');
    }
    if (pedido.tarefa === 'juiz') return opcoes.juiz ? opcoes.juiz(pedido.dados) : { vereditos: [] };
    chamadasDoGate += 1;
    return opcoes.gate ? opcoes.gate(chamadasDoGate) : { resultado: 'aprovado', problemas: [] };
  };
}

const comPontos = (persona: string) =>
  persona === 'redator' ? parecer(persona, 'aprova_com_ajuste', [ponto('p1', 'estrategia', [URN_BENCHMARK_B]), ponto('p2', 'campanhas')]) : parecer(persona, 'aprova');

async function montar(rot: Roteiro, tipo: 'criar' | 'ajustar' = 'criar') {
  const repositorio = criarRepositorioEmMemoria();
  const ia = criarIaFalsa(rot);
  const motor = createMotorDoPlano({
    catalogos: CATALOGOS_DE_TESTE,
    repositorio,
    executorDeIA: comValidacao(ia),
    leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
    avaliadorDeLimites: aprovaTudo,
    audit: { async record() {}, async list() { return []; }, async search() { return []; } },
  });
  const plano = await repositorio.criarPlano(ESCOPO, 'aquisicao');
  assert.ok(plano.ok);
  let versaoBaseId: string | null = null;
  if (tipo === 'ajustar') {
    const versao = await repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: plano.value.id,
      conteudo: planoCompleto(),
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
    pedido: tipo === 'criar' ? { tipo: 'criar', intencao: INTENCAO } : { tipo: 'ajustar', instrucao: 'Ajuste a verba' },
    versaoBaseId,
    agentRunId: 'run-juiz-1',
    solicitadoPor: 'pessoa-1',
    requestId: 'r',
  });
  assert.ok(execucao.ok);
  return { repositorio, ia, motor, plano: plano.value, execucaoId: execucao.value.id };
}

type Montagem = Awaited<ReturnType<typeof montar>>;

async function ate(m: Montagem, execucaoId = m.execucaoId): Promise<Execucao> {
  for (let i = 0; i < 30; i += 1) {
    const reservada = await m.repositorio.reservarExecucao(ORGANIZACAO_ID, execucaoId, { leaseMs: 60_000, agora: new Date('2026-11-25T12:00:00Z') });
    const resumo = await m.motor.avancarExecucao(ORGANIZACAO_ID, execucaoId, { orcamentoMs: 10_000_000, ficha: reservada?.tentativas ?? 0 });
    if (resumo.execucao && ['concluida', 'falhou', 'cancelada'].includes(resumo.execucao.status)) return resumo.execucao;
  }
  throw new Error('a execução não terminou');
}

const eventosDe = (m: Montagem, tipo: string) => m.repositorio.estado.eventos.filter((e) => e.tipo === tipo);
const chamadas = (m: Montagem, tarefa: string) => m.ia.pedidos.filter((p) => p.tarefa === tarefa);
const vereditoDe = (persona: string, pontoId: string, v: Veredito['veredito'], prova: string[] = []): Veredito => ({ persona, pontoId, veredito: v, motivo: `Motivo de ${pontoId}.`, prova });

describe('juiz do Comitê no motor', () => {
  it('uma chamada em lote por rodada: aceito é aplicado, rejeitado não vai ao agente de ajuste e vira não acatado com o motivo do juiz', async () => {
    const m = await montar(
      roteiro({
        comite: comPontos,
        juiz: () => ({ vereditos: [vereditoDe('redator', 'p1', 'aceito', [URN_BENCHMARK_B]), vereditoDe('redator', 'p2', 'rejeitado')] }),
      }),
    );
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(chamadas(m, 'juiz').length, 1);
    assert.equal(pontosDoLote(chamadas(m, 'juiz')[0]!.dados).length, 2);

    const veredito = eventosDe(m, 'veredito_juiz');
    assert.equal(veredito.length, 1);
    assert.equal(veredito[0]!.atorTipo, 'agente');
    assert.equal(veredito[0]!.agentId, 'juiz');
    const salvos = veredito[0]!.payload.vereditos as Veredito[];
    assert.deepEqual(salvos.map((v) => [v.pontoId, v.veredito]), [['p1', 'aceito'], ['p2', 'rejeitado']]);
    assert.deepEqual(salvos[0]!.prova, [URN_BENCHMARK_B]);

    const aoAjuste = chamadas(m, 'strategy_plan').filter((p) => p.chaveDeIdempotencia.includes(':ajustar:'));
    assert.ok(aoAjuste.length > 0);
    const enviados = aoAjuste.flatMap((p) => (p.dados as { pontos: { pontos: { pontoId: string }[] }[] }).pontos.flatMap((a) => a.pontos.map((x) => x.pontoId)));
    assert.deepEqual([...new Set(enviados)], ['p1']);

    const ajuste = eventosDe(m, 'ajuste')[0]!.payload.respostas as { pontoId: string; decisao: string; motivo: string }[];
    assert.deepEqual(ajuste.map((r) => [r.pontoId, r.decisao]).sort(), [['p1', 'acatado'], ['p2', 'nao_acatado']]);
    assert.equal(ajuste.find((r) => r.pontoId === 'p2')!.motivo, 'Juiz: Motivo de p2.');
  });

  it('sem pedido de mudança do Comitê não há chamada ao juiz', async () => {
    const m = await montar(roteiro());
    await ate(m);
    assert.equal(chamadas(m, 'juiz').length, 0);
    assert.equal(eventosDe(m, 'veredito_juiz').length, 0);
  });

  it('a reprovação obrigatória de risco e legal não passa pelo juiz e continua sendo aplicada', async () => {
    const m = await montar(
      roteiro({
        comite: (persona) => (persona === 'risco_legal' ? parecer(persona, 'reprova', [ponto('p1', 'riscos_e_regras')]) : persona === 'redator' ? comPontos(persona) : parecer(persona, 'aprova')),
        juiz: (dados) => ({ vereditos: pontosDoLote(dados).map((p) => vereditoDe(p.persona, p.pontoId, 'rejeitado')) }),
      }),
    );
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    const lote = pontosDoLote(chamadas(m, 'juiz')[0]!.dados);
    assert.ok(lote.every((p) => p.persona !== 'risco_legal'), 'a obrigatória não vai ao juiz');
    const respostas = eventosDe(m, 'ajuste')[0]!.payload.respostas as { persona: string; pontoId: string; decisao: string }[];
    assert.equal(respostas.find((r) => r.persona === 'risco_legal')!.decisao, 'acatado');
    assert.ok(respostas.filter((r) => r.persona === 'redator').every((r) => r.decisao === 'nao_acatado'));
  });

  it('se o juiz rejeita todos, o agente de ajuste não é chamado e a nova versão responde não acatado a todos', async () => {
    const m = await montar(roteiro({ comite: comPontos, juiz: (dados) => ({ vereditos: pontosDoLote(dados).map((p) => vereditoDe(p.persona, p.pontoId, 'rejeitado')) }) }));
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(chamadas(m, 'strategy_plan').filter((p) => p.chaveDeIdempotencia.includes(':ajustar:')).length, 0);
    assert.equal(m.repositorio.estado.versoes.length, 2);
    assert.deepEqual((eventosDe(m, 'ajuste')[0]!.payload.respostas as { decisao: string }[]).map((r) => r.decisao), ['nao_acatado', 'nao_acatado']);
  });

  it('falha fechada: sem modelo configurado para o juiz a execução falha e nada do ajuste é gravado', async () => {
    const naoConfigurada: ErroDeIA = { codigo: 'nao_configurada', mensagem: 'sem modelo' };
    const m = await montar(roteiro({ comite: comPontos, juiz: () => naoConfigurada }));
    const final = await ate(m);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'ia_nao_configurada');
    assert.equal(eventosDe(m, 'ajuste').length, 0);
    assert.equal(eventosDe(m, 'veredito_juiz').length, 0);
    assert.equal(m.repositorio.estado.versoes.length, 1);
    assert.equal(chamadas(m, 'juiz').length, 1, 'sem reconsulta');
  });

  it('veredito incompleto, duplicado ou sobre ponto inexistente é recusado, sem gravar', async () => {
    for (const vereditos of [
      [vereditoDe('redator', 'p1', 'aceito')],
      [vereditoDe('redator', 'p1', 'aceito'), vereditoDe('redator', 'p1', 'aceito'), vereditoDe('redator', 'p2', 'aceito')],
      [vereditoDe('redator', 'p1', 'aceito'), vereditoDe('redator', 'p2', 'aceito'), vereditoDe('sdr', 'p9', 'aceito')],
    ]) {
      const m = await montar(roteiro({ comite: comPontos, juiz: () => ({ vereditos }) }));
      const final = await ate(m);
      assert.equal(final.status, 'falhou');
      assert.equal(final.erroCodigo, 'ia_saida_invalida');
      assert.equal(eventosDe(m, 'veredito_juiz').length, 0);
    }
  });

  it('o ajuste que deixa de acatar um ponto aceito pelo juiz é recusado', async () => {
    const m = await montar(
      roteiro({
        comite: comPontos,
        juiz: (dados) => ({ vereditos: pontosDoLote(dados).map((p) => vereditoDe(p.persona, p.pontoId, 'aceito')) }),
        ajusteDoGrupo: (pedido) => ({
          secoes: secoesDoGrupoDaChave(pedido.chaveDeIdempotencia),
          respostas: respostasAcatando(pedido.dados).map((r) => ({ ...r, decisao: 'nao_acatado', motivo: 'não quero' })),
        }),
      }),
    );
    const final = await ate(m);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    assert.equal(eventosDe(m, 'ajuste').length, 0);
    assert.equal(m.repositorio.estado.versoes.length, 1);
  });

  it('prova fora do pacote é descartada do veredito gravado', async () => {
    const m = await montar(
      roteiro({
        comite: comPontos,
        juiz: (dados) => ({ vereditos: pontosDoLote(dados).map((p) => vereditoDe(p.persona, p.pontoId, 'aceito', [URN_BENCHMARK_B, URN_BENCHMARK_B.replace('benchmark-b', 'fora')])) }),
      }),
    );
    await ate(m);
    const salvos = eventosDe(m, 'veredito_juiz')[0]!.payload.vereditos as Veredito[];
    assert.ok(salvos.every((v) => v.prova.length === 1 && v.prova[0] === URN_BENCHMARK_B));
  });

  it('só o worker grava o veredito: pessoa é recusada e uma segunda chamada na mesma versão é "já feito"', async () => {
    const m = await montar(roteiro({ comite: comPontos, juiz: (dados) => ({ vereditos: pontosDoLote(dados).map((p) => vereditoDe(p.persona, p.pontoId, 'aceito')) }) }));
    await ate(m);
    const versaoId = m.repositorio.estado.versoes[0]!.id;
    const porPessoa = await m.repositorio.registrarEvento(ORGANIZACAO_ID, {
      versaoId,
      tipo: 'veredito_juiz',
      payload: { vereditos: [] },
      autoria: { tipo: 'pessoa', userId: 'pessoa-1' },
      requestId: 'r',
    });
    assert.equal(porPessoa.ok, false);
  });

  it('a segunda rodada (Gate reprovou) reaproveita o veredito: continua uma única chamada ao juiz', async () => {
    const m = await montar(
      roteiro({
        comite: comPontos,
        juiz: (dados) => ({ vereditos: pontosDoLote(dados).map((p) => vereditoDe(p.persona, p.pontoId, p.pontoId === 'p2' ? 'rejeitado' : 'aceito')) }),
        gate: (n) => (n === 1 ? { resultado: 'reprovado', problemas: [{ trecho: 'estrategia', problema: 'incoerente' }] } : { resultado: 'aprovado', problemas: [] }),
      }),
    );
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(chamadas(m, 'juiz').length, 1);
    assert.equal(eventosDe(m, 'ajuste').length, 2);
    const segunda = eventosDe(m, 'ajuste')[1]!.payload.respostas as { pontoId: string; decisao: string }[];
    assert.deepEqual(segunda.map((r) => [r.pontoId, r.decisao]).sort(), [['p1', 'acatado'], ['p2', 'nao_acatado']]);
  });
});

const itens: NaoFaremos[] = [
  { id: 'nf1', texto: 'Não prometer cura.' },
  { id: 'nf2', texto: 'Sem TikTok.', teste: { tipo: 'plataforma_proibida', valor: 'tiktok' } },
  { id: 'nf3', texto: 'Sem vídeo longo.', teste: { tipo: 'formato_proibido', valor: 'video_longo' } },
  { id: 'nf4', texto: 'Sem display.', teste: { tipo: 'canal_proibido', valor: 'display' } },
];
const comNaoFaremos = (lista: NaoFaremos[]): Plano => {
  const plano = planoCompleto();
  return { ...plano, estrategia: { ...plano.estrategia, nao_faremos: lista } };
};

async function montarCorrecao(rot: Roteiro, payloadDoGate: Record<string, unknown>) {
  const m = await montar(rot);
  const { repositorio } = m;
  const original = await repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
    planoId: m.plano.id,
    conteudo: comNaoFaremos(itens),
    schemaVersion: 1,
    supersedesId: null,
    autoria: { tipo: 'pessoa', userId: 'pessoa-1' },
    referencias: [{ urn: URN_BENCHMARK_B, hash: 'a'.repeat(64), papel: 'favor' }],
    requestId: 'r1',
  });
  assert.ok(original.ok);

  const cancelada = await repositorio.cancelarExecucao(ORGANIZACAO_ID, m.execucaoId, 'r');
  assert.ok(cancelada.ok);
  const anterior = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
    planoId: m.plano.id,
    pedido: { tipo: 'ajustar', instrucao: 'Reescreva a estratégia' },
    versaoBaseId: original.value.id,
    agentRunId: 'run-anterior',
    solicitadoPor: 'pessoa-1',
    requestId: 'r2',
  });
  assert.ok(anterior.ok);
  const reservada = await repositorio.reservarExecucao(ORGANIZACAO_ID, anterior.value.id, { leaseMs: 60_000, agora: new Date() });
  assert.ok(reservada);
  const falha = await repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
    planoId: m.plano.id,
    conteudo: comNaoFaremos([]),
    schemaVersion: 1,
    supersedesId: null,
    autoria: { tipo: 'agente', agentId: 'agente_de_plano', agentRunId: 'run-anterior', chaveDeIdempotencia: 'k-v', ficha: reservada.tentativas },
    referencias: [{ urn: URN_BENCHMARK_B, hash: 'a'.repeat(64), papel: 'favor' }],
    requestId: 'r3',
  });
  assert.ok(falha.ok);
  const gate = await repositorio.registrarEvento(ORGANIZACAO_ID, {
    versaoId: falha.value.id,
    tipo: 'gate',
    payload: payloadDoGate,
    autoria: { tipo: 'agente', agentId: 'gates', agentRunId: 'run-anterior', chaveDeIdempotencia: 'k-g', ficha: reservada.tentativas },
    requestId: 'r4',
  });
  assert.ok(gate.ok);
  const encerrada = await repositorio.atualizarExecucao(ORGANIZACAO_ID, anterior.value.id, { status: 'falhou', erroCodigo: 'gate_reprovado', leaseAte: null }, reservada.tentativas);
  assert.ok(encerrada.ok);

  const correcao = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
    planoId: m.plano.id,
    pedido: { tipo: 'corrigir_gate' },
    versaoBaseId: falha.value.id,
    agentRunId: 'run-correcao-1',
    solicitadoPor: 'pessoa-1',
    requestId: 'r5',
  });
  assert.ok(correcao.ok);
  return { ...m, correcaoId: correcao.value.id, baseId: falha.value.id, originalId: original.value.id };
}

const gateDosQuatro = {
  resultado: 'reprovado',
  checagens: [
    { chave: 'nao_faremos_preservado', resultado: 'reprovado', motivo: '4 "não faremos" das versões base perdido(s), afrouxado(s) ou reescrito(s).', onde: itens.map((i) => `estrategia/${i.id} (removido em relação à versão base)`) },
  ],
  modelo: null,
};

describe('corrigir a falha do Gate com IA (motor)', () => {
  it('restaura os 4 "não faremos" removidos no servidor, sem chamada ao agente de plano, e só segue porque o Gate real aprova', async () => {
    const m = await montarCorrecao(roteiro(), gateDosQuatro);
    const final = await ate(m, m.correcaoId);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(final.erroCodigo, null);
    assert.equal(chamadas(m, 'strategy_plan').length, 0, 'restauração determinística: zero chamadas ao agente de plano');
    assert.equal(chamadas(m, 'comite').length, 9, 'a nova execução convoca o Comitê');

    const novas = m.repositorio.estado.versoes.filter((v) => v.agentRunId === 'run-correcao-1');
    assert.equal(novas.length, 1);
    const nova = novas[0]!;
    assert.equal(nova.status, 'rascunho');
    assert.deepEqual((nova.conteudo as Plano).estrategia.nao_faremos.map((i) => i.id).sort(), ['nf1', 'nf2', 'nf3', 'nf4']);
    assert.equal(m.repositorio.estado.versoes.find((v) => v.id === m.baseId)!.status, 'cancelado');

    const gates = m.repositorio.estado.eventos.filter((e) => e.versaoId === nova.id && e.tipo === 'gate');
    assert.equal(gates.length, 1);
    assert.equal(gates[0]!.payload.resultado, 'aprovado');
    const antigo = m.repositorio.estado.eventos.find((e) => e.versaoId === m.baseId && e.tipo === 'gate')!;
    assert.equal(antigo.payload.resultado, 'reprovado', 'o gate antigo não foi alterado');
  });

  it('o que o código não restaura volta ao agente como pendência obrigatória do grupo afetado, com respostas vazias', async () => {
    const payload = {
      resultado: 'reprovado',
      checagens: [
        gateDosQuatro.checagens[0],
        { chave: 'objetivo_com_metrica', resultado: 'reprovado', motivo: 'Objetivo sem forma de medir.', onde: ['metas_e_metricas/m1'] },
        { chave: 'comite_completo', resultado: 'reprovado', motivo: 'Comitê incompleto.', onde: ['comite/ajuste'] },
      ],
      modelo: { problemas: [{ trecho: 'campanhas', problema: 'Meta incoerente com o histórico.' }] },
    };
    const m = await montarCorrecao(roteiro(), payload);
    const final = await ate(m, m.correcaoId);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    const pedidos = chamadas(m, 'strategy_plan');
    assert.ok(pedidos.length >= 1 && pedidos.every((p) => p.chaveDeIdempotencia.includes(':corrigir:')));
    const texto = JSON.stringify(pedidos.map((p) => p.dados));
    assert.ok(texto.includes('Objetivo sem forma de medir.'));
    assert.ok(texto.includes('Meta incoerente com o histórico.'));
    assert.ok(!texto.includes('Comitê incompleto'), 'comite_completo não é conteúdo: a nova execução reconvoca o Comitê');
    assert.ok(!texto.includes('removido em relação'), 'o que o servidor restaurou não volta ao modelo');
  });

  it('não converge: o gate real reprova de novo e a execução termina falhou com correcao_nao_convergiu, sem aprovar à mão', async () => {
    const m = await montarCorrecao(roteiro({ gate: () => ({ resultado: 'reprovado', problemas: [{ trecho: 'campanhas', problema: 'Segue incoerente.' }] }) }), gateDosQuatro);
    const final = await ate(m, m.correcaoId);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'correcao_nao_convergiu');
    const abertas = m.repositorio.estado.versoes.filter((v) => v.status === 'rascunho');
    assert.equal(abertas.length, 1, 'o rascunho fica visível');
    assert.ok(m.repositorio.estado.eventos.filter((e) => e.tipo === 'gate' && e.agentRunId === 'run-correcao-1').every((e) => e.payload.resultado === 'reprovado'));
    assert.equal(m.repositorio.estado.eventos.filter((e) => e.tipo === 'proposta').length, 0);
  });

  it('versão base sem gate reprovado não é corrigida', async () => {
    const m = await montarCorrecao(roteiro(), { resultado: 'aprovado', checagens: [], modelo: null });
    const final = await ate(m, m.correcaoId);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'interno');
    assert.equal(chamadas(m, 'comite').length, 0);
  });
});
