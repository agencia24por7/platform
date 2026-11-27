import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../src/shared/testing/aliasHooks.mjs', import.meta.url);
register('./stubsDoNext.mjs', import.meta.url);

Object.assign(process.env, {
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const c = JSON.parse(process.env.STRATEGY_CENARIO);
const { issueSession } = await import('@/modules/identity/domain/session.ts');
const { comoWorker, foraDoContextoDeChamada } = await import('@/shared/db/client.ts');
const { createEstrategiaRepository } = await import('@/modules/strategy/infrastructure/estrategiaRepository.ts');
const { createEstrategiaService } = await import('@/modules/strategy/application/estrategiaService.ts');
const { createDestinoService } = await import('@/modules/clients/application/destinoService.ts');
const { createDestinoRepository } = await import('@/modules/clients/infrastructure/destinoRepository.ts');
const { createMotorDoPlano } = await import('@/modules/strategy/application/motorDoPlano.ts');
const { createProcessadorDeExecucoes } = await import('@/modules/strategy/application/processadorDeExecucoes.ts');
const { criarIaFalsa } = await import('@/modules/strategy/infrastructure/ia/iaFalsa.ts');
const { criarIaNaoConfigurada } = await import('@/modules/strategy/infrastructure/ia/iaNaoConfigurada.ts');
const { comValidacao } = await import('@/modules/strategy/infrastructure/ia/comValidacao.ts');
const { ok, err } = await import('@/shared/result/result.ts');
const fixtures = await import('@/modules/strategy/domain/fixturesDeTeste.ts');
const { parecer, ponto } = await import('@/modules/strategy/domain/comite/fixturesDeParecer.ts');

const trocarIds = (valor) => JSON.parse(JSON.stringify(valor).replaceAll(fixtures.ORGANIZACAO_ID, c.orgA).replaceAll(fixtures.CLIENTE_ID, c.cliA));
const plano = trocarIds(fixtures.planoCompleto());
const pacote = trocarIds(fixtures.pacoteDeTeste());
const urnDoBeneficio = pacote.entradas.find((e) => e.titulo === 'Benchmark de custo por lead').urn;

const como = (userId) => {
  process.env.TESTE_SESSAO_DO_CENARIO = issueSession(userId, process.env.TRIA_SESSION_SECRET, Date.now());
};
const ator = (userId) => ({ userId, requestId: `req-${Math.random().toString(16).slice(2)}`, sourceIp: '10.0.0.1' });
const comando = (papelDeQuemAge) => ({ organizationId: c.orgA, papelDeQuemAge });
const codigoDe = (r) => (r.ok ? 'ok' : (r.error.details?.codigo ?? r.error.code));

const repo = createEstrategiaRepository();
const auditorias = [];
const audit = { async record(e) { auditorias.push(e); }, async list() { return []; }, async search() { return []; } };
const leitorDoBrain = {
  async lerPacote(org, cli) {
    return org === c.orgA && cli === c.cliA ? ok(pacote) : err({ codigo: 'brain_indisponivel', mensagem: 'fora do cenário' });
  },
};
const avaliadorDeLimites = { async avaliador() { return ok(Object.assign(() => 'ok', { medidasComLimite: [] })); } };

const roteiroBase = (pedido) => {
  if (pedido.tarefa === 'strategy_plan') {
    if (pedido.chaveDeIdempotencia.includes(':ajustar:')) {
      const pontos = pedido.dados.pontos.flatMap((argumento) => argumento.pontos);
      return { secoes: fixtures.secoesDoGrupoDaChave(pedido.chaveDeIdempotencia, plano), respostas: pontos.map((p) => ({ pontoId: p.pontoId, persona: p.persona, decisao: 'acatado', motivo: 'acatado' })) };
    }
    return fixtures.secoesDoGrupoDaChave(pedido.chaveDeIdempotencia, plano);
  }
  if (pedido.tarefa === 'comite') {
    const chave = pedido.dados.persona.chave;
    return chave === 'redator' ? parecer(chave, 'aprova_com_ajuste', [ponto('p1', 'estrategia', [urnDoBeneficio])]) : parecer(chave, 'aprova');
  }
  return { resultado: 'aprovado', problemas: [] };
};
const iaFalsa = criarIaFalsa(roteiroBase);

const destino = createDestinoService(createDestinoRepository(), audit);
const servico = createEstrategiaService({ repositorio: repo, audit, leitorDoBrain, destino, catalogos: fixtures.CATALOGOS_DE_TESTE });
const motorCom = (executorDeIA) => createMotorDoPlano({ repositorio: repo, executorDeIA, leitorDoBrain, avaliadorDeLimites, audit, catalogos: fixtures.CATALOGOS_DE_TESTE });
const { plataformas: _p, whatsapp: _w, destino: _d, utm: _u, ...intencao } = plano.intencao;

como(c.operator);
const landing = await destino.criarLandingPage({ organizationId: c.orgA, clientId: c.cliA, papelDeQuemAge: 'operator', url: plano.intencao.destino.url, rotulo: 'Oferta' }, ator(c.operator));
assert.ok(landing.ok, JSON.stringify(landing));
assert.ok((await destino.gravarWhatsapp({ organizationId: c.orgA, clientId: c.cliA, papelDeQuemAge: 'operator', whatsapp: plano.intencao.whatsapp }, ator(c.operator))).ok);
const novoPedido = (tipoDePlano) => ({ clienteId: c.cliA, tipoDePlano, plataformas: ['google', 'meta'], landingPageId: landing.value.id, intencao });

const pedido = await servico.pedirPlano(comando('operator'), novoPedido('aquisicao'), ator(c.operator));
assert.ok(pedido.ok, JSON.stringify(pedido));
const planoId = pedido.value.plano.id;
const execucaoId = pedido.value.execucao.id;

const descobertas = await comoWorker(() => repo.descobrirExecucoesPendentes(50));
assert.ok(descobertas.some((d) => d.id === execucaoId && d.organizationId === c.orgA && d.clientId === c.cliA), 'a execução é descoberta entre inquilinos');

const processador = createProcessadorDeExecucoes({ repositorio: repo, motor: motorCom(comValidacao(iaFalsa)) });
const resumo = await comoWorker(() => processador.avancar({ limite: 50 }));
assert.ok(resumo.ok, JSON.stringify(resumo));
assert.ok(resumo.value.concluidas >= 1, JSON.stringify(resumo.value));

const execucao = await comoWorker(() => repo.lerExecucao(c.orgA, execucaoId));
assert.equal(execucao.status, 'concluida', JSON.stringify(execucao));
assert.equal(execucao.etapa, 'fim');
assert.equal(execucao.erroCodigo, null);

const versoes = await repo.listarVersoes(c.orgA, planoId, 10);
assert.equal(versoes.length, 2, 'v1 do agente e v2 do ajuste');
const [v2, v1] = versoes;
assert.equal(v1.status, 'cancelado');
assert.equal(v2.status, 'rascunho');
assert.equal(v2.autorTipo, 'agente');
const eventosV1 = await repo.eventosDaVersao(c.orgA, v1.id);
const eventosV2 = await repo.eventosDaVersao(c.orgA, v2.id);
assert.equal(eventosV1.filter((e) => e.tipo === 'parecer').length, 9);
assert.deepEqual(eventosV1.map((e) => e.tipo).filter((t) => t !== 'parecer'), ['veredito_juiz', 'cancelada']);
assert.deepEqual(eventosV2.map((e) => e.tipo), ['ajuste', 'gate']);
assert.equal(eventosV2[0].payload.responde_a, v1.id);
assert.equal(eventosV2[1].payload.resultado, 'aprovado');
const lida = await repo.lerVersao(c.orgA, v2.id);
assert.ok(lida.referencias.length > 0);
const regrasDoPacote = pacote.entradas.filter((e) => ['limite', 'regra', 'decisao'].includes(e.tipo));
assert.ok(regrasDoPacote.length > 0);
for (const entrada of regrasDoPacote) {
  const ref = lida.referencias.find((r) => r.urn === entrada.urn && r.papel === 'premissa');
  assert.ok(ref, `referência implícita de ${entrada.tipo} gravada`);
  assert.equal(ref.hash, entrada.hash);
}
assert.ok(lida.referencias.every((r) => /^[0-9a-f]{64}$/.test(r.hash)));

como(c.viewer);
assert.equal(codigoDe(await servico.aplicar(comando('viewer'), { versaoId: v2.id }, ator(c.viewer))), 'forbidden');
como(c.operator);
const aplicada = await servico.aplicar(comando('operator'), { versaoId: v2.id }, ator(c.operator));
assert.ok(aplicada.ok, JSON.stringify(aplicada));
assert.equal(codigoDe(await servico.autorizar(comando('operator'), { versaoId: v2.id }, ator(c.operator))), 'forbidden');
como(c.admin);
const autorizada = await servico.autorizar(comando('admin'), { versaoId: v2.id }, ator(c.admin));
assert.ok(autorizada.ok, JSON.stringify(autorizada));
assert.equal((await repo.lerVersao(c.orgA, v2.id)).status, 'vigente');

const painel = await servico.painelDoPlano(comando('admin'), { clienteId: c.cliA });
assert.ok(painel.ok);
const doPlano = painel.value.planos.find((p) => p.plano.id === planoId);
assert.equal(doPlano.rotulo, 'Autorizado');
assert.equal(doPlano.execucaoAtiva, null);
assert.equal(doPlano.ultimaExecucao.status, 'concluida');
assert.equal(doPlano.desatualizado.impacto, 'nenhum');

como(c.operator);
const revisao = await servico.pedirRevisao(comando('operator'), { planoId }, ator(c.operator));
assert.ok(revisao.ok, JSON.stringify(revisao));
const brainMudou = await comoWorker(() => processador.avancar({ limite: 50 }));
assert.ok(brainMudou.ok);
const aposRevisao = await repo.listarVersoes(c.orgA, planoId, 10);
assert.equal(aposRevisao.length, 4, 'a revisão por mudança do Brain redige e ajusta de novo');
const nova = aposRevisao.find((v) => v.status === 'rascunho');
assert.ok(nova);
assert.equal((await repo.lerVersao(c.orgA, v2.id)).status, 'vigente', 'a vigente continua até autorizarem a nova');

como(c.operator);
const segundoPlano = await servico.pedirPlano(comando('operator'), novoPedido('marca'), ator(c.operator));
assert.ok(segundoPlano.ok, JSON.stringify(segundoPlano));
const semIA = createProcessadorDeExecucoes({ repositorio: repo, motor: motorCom(comValidacao(criarIaNaoConfigurada())) });
const resumoSemIA = await comoWorker(() => semIA.avancar({ limite: 50 }));
assert.ok(resumoSemIA.ok);
assert.ok(resumoSemIA.value.codigos.ia_nao_configurada >= 1);
const falha = await comoWorker(() => repo.lerExecucao(c.orgA, segundoPlano.value.execucao.id));
assert.equal(falha.status, 'falhou');
assert.equal(falha.erroCodigo, 'ia_nao_configurada');
assert.equal((await repo.listarVersoes(c.orgA, segundoPlano.value.plano.id, 10)).length, 0, 'nada gravado sem IA');


const tipoNovo = (nome) => novoPedido(nome);
const reservarComoWorker = (id, agora, leaseMs = 300_000) => comoWorker(() => repo.reservarExecucao(c.orgA, id, { leaseMs, agora }));
const versoesDoPlano = (idDoPlano) => repo.listarVersoes(c.orgA, idDoPlano, 20);

como(c.operator);
const pedidoCancelado = await servico.pedirPlano(comando('operator'), tipoNovo('comunidade'), ator(c.operator));
assert.ok(pedidoCancelado.ok, JSON.stringify(pedidoCancelado));
const execucaoCancelada = pedidoCancelado.value.execucao;
const fichaDaCancelada = (await reservarComoWorker(execucaoCancelada.id, new Date())).tentativas;
let cancelouNaEtapa = false;
const iaQueCancela = criarIaFalsa(async (pedido) => {
  if (pedido.tarefa === 'strategy_plan' && !cancelouNaEtapa) {
    cancelouNaEtapa = true;
    como(c.operator);
    const cancelada = await foraDoContextoDeChamada(() => servico.cancelarExecucao(comando('operator'), { execucaoId: execucaoCancelada.id }, ator(c.operator)));
    assert.ok(cancelada.ok, JSON.stringify(cancelada));
  }
  return roteiroBase(pedido);
});
const resumoCancelado = await comoWorker(() =>
  motorCom(comValidacao(iaQueCancela)).avancarExecucao(c.orgA, execucaoCancelada.id, { orcamentoMs: 120_000, ficha: fichaDaCancelada }),
);
assert.equal(cancelouNaEtapa, true);
assert.equal(resumoCancelado.estado, 'perdida', 'cancelamento durante a etapa: o motor para');
assert.equal((await repo.lerExecucao(c.orgA, execucaoCancelada.id)).status, 'cancelada');
assert.equal((await versoesDoPlano(pedidoCancelado.value.plano.id)).length, 0, 'nada foi gravado depois do cancelamento');
assert.equal(iaQueCancela.pedidos.filter((p) => p.tarefa === 'strategy_plan').length, 1, 'e nenhum pedido novo ao modelo');

como(c.operator);
const pedidoDosDois = await servico.pedirPlano(comando('operator'), tipoNovo('retencao'), ator(c.operator));
assert.ok(pedidoDosDois.ok, JSON.stringify(pedidoDosDois));
const execucaoDosDois = pedidoDosDois.value.execucao;
const ficha1 = (await reservarComoWorker(execucaoDosDois.id, new Date())).tentativas;
let segundoWorker = null;
const iaQueTrocaDeDono = criarIaFalsa(async (pedido) => {
  if (pedido.tarefa === 'strategy_plan' && segundoWorker === null) {
    const vencido = await comoWorker(() => repo.atualizarExecucao(c.orgA, execucaoDosDois.id, { leaseAte: new Date(Date.now() - 1000) }, ficha1));
    assert.ok(vencido.ok, 'o primeiro worker ainda é o dono e seu lease vence no meio da etapa');
    segundoWorker = await reservarComoWorker(execucaoDosDois.id, new Date());
  }
  return roteiroBase(pedido);
});
const primeiroWorker = await comoWorker(() =>
  motorCom(comValidacao(iaQueTrocaDeDono)).avancarExecucao(c.orgA, execucaoDosDois.id, { orcamentoMs: 120_000, ficha: ficha1 }),
);
assert.ok(segundoWorker, 'o segundo worker reservou a execução');
assert.equal(segundoWorker.tentativas, ficha1 + 1);
assert.equal(primeiroWorker.estado, 'perdida', 'o que perdeu a ficha para');
assert.equal((await versoesDoPlano(pedidoDosDois.value.plano.id)).length, 0, 'e não gravou a versão nem sobrescreveu a etapa');
const depoisDoPerdedor = await repo.lerExecucao(c.orgA, execucaoDosDois.id);
assert.equal(depoisDoPerdedor.status, 'rodando');
assert.equal(depoisDoPerdedor.tentativas, segundoWorker.tentativas);
assert.equal(depoisDoPerdedor.etapa, 'redigir', 'a etapa do dono atual não foi sobrescrita');
const vencedor = await comoWorker(() =>
  motorCom(comValidacao(iaFalsa)).avancarExecucao(c.orgA, execucaoDosDois.id, { orcamentoMs: 120_000, ficha: segundoWorker.tentativas }),
);
assert.equal(vencedor.execucao.status, 'concluida', JSON.stringify(vencedor));
assert.equal((await versoesDoPlano(pedidoDosDois.value.plano.id)).length, 2);

como(c.operator);
const pedidoManual = await servico.pedirPlano(comando('operator'), tipoNovo('marca'), ator(c.operator));
assert.ok(pedidoManual.ok, JSON.stringify(pedidoManual));
const execucaoR = pedidoManual.value.execucao;
const fichaR = (await reservarComoWorker(execucaoR.id, new Date())).tentativas;
let respostaAtrasada = null;
let edicaoFeita = null;
const iaAtrasada = criarIaFalsa(async (pedido) => {
  if (pedido.tarefa === 'strategy_plan' && respostaAtrasada === null) {
    respostaAtrasada = 'em curso';
    como(c.operator);
    assert.ok((await foraDoContextoDeChamada(() => servico.cancelarExecucao(comando('operator'), { execucaoId: execucaoR.id }, ator(c.operator)))).ok);
    edicaoFeita = await foraDoContextoDeChamada(() => servico.editarManual(comando('operator'), { planoId: pedidoManual.value.plano.id, conteudo: plano }, ator(c.operator)));
    assert.ok(edicaoFeita.ok, JSON.stringify(edicaoFeita));
  }
  return roteiroBase(pedido);
});
const resumoAtrasado = await comoWorker(() =>
  motorCom(comValidacao(iaAtrasada)).avancarExecucao(c.orgA, execucaoR.id, { orcamentoMs: 120_000, ficha: fichaR }),
);
assert.equal(resumoAtrasado.estado, 'perdida');
const versoesDaEdicao = await versoesDoPlano(pedidoManual.value.plano.id);
assert.equal(versoesDaEdicao.length, 1, 'só a edição manual existe');
assert.equal(versoesDaEdicao[0].autorTipo, 'usuario');
assert.equal(versoesDaEdicao[0].status, 'rascunho', 'a edição manual sobrevive à resposta atrasada de R');
assert.equal(edicaoFeita.value.execucao.etapa, 'ler_brain');

const passos = auditorias.filter((a) => a.action === 'strategy.run.step');
assert.ok(passos.length > 10);
const texto = JSON.stringify(auditorias);
assert.ok(!texto.includes(intencao.objetivo), 'a auditoria não leva a intenção');

void iaFalsa.pedidos;
console.log('cenario ok');
process.exit(0);
