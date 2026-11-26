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
const { comoWorker } = await import('@/shared/db/client.ts');
const { issueSession } = await import('@/modules/identity/domain/session.ts');
const { createEstrategiaRepository } = await import('@/modules/strategy/infrastructure/estrategiaRepository.ts');
const { createEstrategiaService } = await import('@/modules/strategy/application/estrategiaService.ts');
const { ok, err } = await import('@/shared/result/result.ts');
const { referenciasDoPlano, SCHEMA_VERSION } = await import('@/modules/strategy/domain/index.ts');
const fixtures = await import('@/modules/strategy/domain/fixturesDeTeste.ts');

const trocarIds = (valor) =>
  JSON.parse(JSON.stringify(valor).replaceAll(fixtures.ORGANIZACAO_ID, c.orgA).replaceAll(fixtures.CLIENTE_ID, c.cliA));
const plano = trocarIds(fixtures.planoCompleto());
const pacote = trocarIds(fixtures.pacoteDeTeste());

const como = (userId) => {
  process.env.TESTE_SESSAO_DO_CENARIO = issueSession(userId, process.env.TRIA_SESSION_SECRET, Date.now());
};
const base = createEstrategiaRepository();
const SEMPRE_DO_WORKER = ['reservarProximaExecucao', 'atualizarExecucao'];
const DO_WORKER_SE_AGENTE = ['criarVersaoRascunho', 'registrarEvento'];
const repo = new Proxy(base, {
  get: (alvo, nome) => {
    if (SEMPRE_DO_WORKER.includes(nome)) return (...argumentos) => comoWorker(() => alvo[nome](...argumentos));
    if (DO_WORKER_SE_AGENTE.includes(nome)) {
      return (...argumentos) => (argumentos[1]?.autoria?.tipo === 'agente' ? comoWorker(() => alvo[nome](...argumentos)) : alvo[nome](...argumentos));
    }
    return alvo[nome];
  },
});
const auditorias = [];
const service = createEstrategiaService({
  repositorio: repo,
  audit: { async record(e) { auditorias.push(e); }, async list() { return []; }, async search() { return []; } },
  leitorDoBrain: { async lerPacote() { return ok(pacote); } },
});
const ator = (userId) => ({ userId, requestId: `req-${Math.random().toString(16).slice(2)}`, sourceIp: '10.0.0.1' });
const comando = (papelDeQuemAge, organizationId = c.orgA) => ({ organizationId, papelDeQuemAge });
const codigoDe = (r) => (r.ok ? 'ok' : (r.error.details?.codigo ?? r.error.code));
const intencao = plano.intencao;
const escopoA = { organizationId: c.orgA, clientId: c.cliA };

como(c.operator);
const pedido = await service.pedirPlano(comando('operator'), { clienteId: c.cliA, tipoDePlano: 'aquisicao', intencao }, ator(c.operator));
assert.ok(pedido.ok, JSON.stringify(pedido));
const planoId = pedido.value.plano.id;
const execucao = pedido.value.execucao;
assert.equal(execucao.status, 'pendente');
assert.equal(execucao.etapa, 'ler_brain');
assert.equal(execucao.solicitadoPor, c.operator);
assert.match(execucao.agentRunId, /^run-/);

const repetido = await service.pedirPlano(comando('operator'), { clienteId: c.cliA, tipoDePlano: 'aquisicao', intencao }, ator(c.operator));
assert.equal(codigoDe(repetido), 'execucao_ativa');

como(c.viewer);
assert.equal(codigoDe(await service.pedirPlano(comando('viewer'), { clienteId: c.cliA, tipoDePlano: 'marca', intencao }, ator(c.viewer))), 'forbidden');
const doViewer = await repo.criarExecucao(c.orgA, c.cliA, { planoId, pedido: { tipo: 'revisar', motivo: 'brain_mudou' }, versaoBaseId: null, agentRunId: 'run-viewer', solicitadoPor: c.viewer, requestId: 'r' });
assert.equal(!doViewer.ok && doViewer.error.codigo, 'sem_permissao');
const painelDoViewer = await service.painelDoPlano(comando('viewer'), { clienteId: c.cliA });
assert.ok(painelDoViewer.ok);
assert.equal(painelDoViewer.value.planos[0].execucaoAtiva.id, execucao.id);

como(c.operator);
const segundo = await service.pedirPlano(comando('operator'), { clienteId: c.cliA, tipoDePlano: 'marca', intencao }, ator(c.operator));
assert.ok(segundo.ok);

const agora = new Date();
const [r1, r2, r3] = await Promise.all([
  repo.reservarProximaExecucao(c.orgA, { leaseMs: 60_000, agora }),
  repo.reservarProximaExecucao(c.orgA, { leaseMs: 60_000, agora }),
  repo.reservarProximaExecucao(c.orgA, { leaseMs: 60_000, agora }),
]);
const reservadas = [r1, r2, r3].filter(Boolean);
assert.equal(reservadas.length, 2, 'duas execuções pendentes, duas reservas, sem repetir');
assert.notEqual(reservadas[0].id, reservadas[1].id);
for (const reservada of reservadas) {
  assert.equal(reservada.status, 'rodando');
  assert.equal(reservada.tentativas, 1);
  assert.ok(reservada.leaseAte > agora);
}
assert.equal(await repo.reservarProximaExecucao(c.orgA, { leaseMs: 60_000, agora }), null, 'nada pendente nem vencido');
const expirada = reservadas[0];
assert.ok((await repo.atualizarExecucao(c.orgA, expirada.id, { leaseAte: new Date(Date.now() - 1000) }, expirada.tentativas)).ok);
const retomada = await repo.reservarProximaExecucao(c.orgA, { leaseMs: 60_000, agora });
assert.ok(retomada, 'lease vencido é retomado');
assert.equal(retomada.id, expirada.id);
assert.equal(retomada.tentativas, 2);
assert.equal(await repo.reservarProximaExecucao(c.orgB, { leaseMs: 60_000, agora }), null, 'outra organização não reserva');

const minha = (await repo.lerExecucao(c.orgA, execucao.id));
let fichaDaExecucao = minha.tentativas;
const avancada = await repo.atualizarExecucao(c.orgA, execucao.id, { etapa: 'redigir', rodada: 1 }, fichaDaExecucao);
assert.ok(avancada.ok);
assert.equal(avancada.value.etapa, 'redigir');
const regressao = await repo.atualizarExecucao(c.orgA, execucao.id, { rodada: 0 }, fichaDaExecucao);
assert.equal(!regressao.ok && regressao.error.codigo, 'invalido');
assert.ok(minha);

const refsComHash = (() => {
  const refs = referenciasDoPlano(plano, { organizacaoId: c.orgA, clienteId: c.cliA });
  assert.ok(refs.ok);
  const hashes = new Map(pacote.entradas.map((e) => [e.urn, e.hash]));
  return refs.value.map((r) => ({ urn: r.urn, papel: r.papel, hash: hashes.get(r.urn) }));
})();
assert.ok(refsComHash.length > 0);
const autoriaDoAgente = (chave, run = execucao.agentRunId, agente = 'redator', ficha = fichaDaExecucao) => ({ tipo: 'agente', agentId: agente, agentRunId: run, chaveDeIdempotencia: chave, ficha });

const versao = await repo.criarVersaoRascunho(c.orgA, { planoId, conteudo: plano, schemaVersion: SCHEMA_VERSION, supersedesId: null, autoria: autoriaDoAgente('v1'), referencias: refsComHash, requestId: 'r-v1' });
assert.ok(versao.ok, JSON.stringify(versao));
assert.equal(versao.value.status, 'rascunho');
assert.equal(versao.value.autorTipo, 'agente');
assert.equal(versao.value.agentRunId, execucao.agentRunId);
assert.equal(versao.value.referencias.length, refsComHash.length);
const lida = await repo.lerVersao(c.orgA, versao.value.id);
assert.deepEqual(lida.conteudo, plano);
assert.deepEqual(lida.referencias.map((r) => `${r.urn}|${r.papel}`).sort(), refsComHash.map((r) => `${r.urn}|${r.papel}`).sort());

const reenvio = await repo.criarVersaoRascunho(c.orgA, { planoId, conteudo: plano, schemaVersion: SCHEMA_VERSION, supersedesId: null, autoria: autoriaDoAgente('v1'), referencias: refsComHash, requestId: 'r-v1b' });
assert.equal(!reenvio.ok && reenvio.error.codigo, 'ja_feito');
assert.equal((await repo.lerVersao(c.orgA, versao.value.id)).status, 'rascunho', 'reenvio idempotente não cancela a aberta');
assert.equal((await repo.listarVersoes(c.orgA, planoId, 10)).length, 1);

const comUrnDeOutro = await repo.criarVersaoRascunho(c.orgA, { planoId, conteudo: plano, schemaVersion: 1, supersedesId: null, autoria: autoriaDoAgente('v2'), referencias: [{ urn: refsComHash[0].urn.replace(c.cliA, c.cliA2), papel: 'favor', hash: 'a'.repeat(64) }], requestId: 'r-v2' });
assert.equal(!comUrnDeOutro.ok && comUrnDeOutro.error.codigo, 'invalido', 'URN de outro cliente é recusada pelo banco');
assert.equal((await repo.listarVersoes(c.orgA, planoId, 10)).length, 1, 'a transação inteira desfez');

const semPlano = await repo.criarVersaoRascunho(c.orgA, { planoId: '00000000-0000-4000-8000-000000000000', conteudo: plano, schemaVersion: 1, supersedesId: null, autoria: autoriaDoAgente('v3'), referencias: [], requestId: 'r-v3' });
assert.equal(!semPlano.ok && semPlano.error.codigo, 'nao_encontrado');

const versaoId = versao.value.id;
const evento = (tipo, payload, chave, autoria = autoriaDoAgente(chave, execucao.agentRunId, 'comite')) =>
  repo.registrarEvento(c.orgA, { versaoId, tipo, payload, autoria, requestId: `r-${chave}` });

como(c.operator);
const semParecer = await service.aplicar(comando('operator'), { versaoId }, ator(c.operator));
assert.equal(!semParecer.ok && semParecer.error.code, 'validation');
assert.ok(semParecer.error.details.falta_parecer && semParecer.error.details.falta_gate);

const parecer = await evento('parecer', { persona: 'redator', veredito: 'aprova', motivo: 'ok', pontos: [] }, 'p1');
assert.ok(parecer.ok, JSON.stringify(parecer));
assert.equal((await evento('parecer', { persona: 'redator', veredito: 'aprova' }, 'p1')).error?.codigo, 'ja_feito');
assert.equal((await evento('parecer', { persona: 'redator', veredito: 'aprova' }, 'p2')).error?.codigo, 'ja_feito', 'um parecer por persona');
assert.equal((await evento('parecer', { persona: 'x', veredito: 'talvez' }, 'p3')).error?.codigo, 'invalido');

for (const tipo of ['efetivada', 'rejeitada', 'revogada', 'proposta']) {
  const negado = await evento(tipo, {}, `neg-${tipo}`);
  assert.equal(!negado.ok && negado.error.codigo, 'sem_permissao', `agente não faz ${tipo}`);
}

const semGate = await service.aplicar(comando('operator'), { versaoId }, ator(c.operator));
assert.ok(semGate.error.details.falta_gate && !semGate.error.details.falta_parecer);

const gate = await evento('gate', { resultado: 'aprovado', checagens: [{ chave: 'urns_no_pacote', resultado: 'aprovado' }] }, 'g1');
assert.ok(gate.ok, JSON.stringify(gate));

const emOrdem = await repo.eventosDaVersao(c.orgA, versaoId);
assert.deepEqual(emOrdem.map((e) => e.tipo), ['parecer', 'gate']);

como(c.viewer);
assert.equal(codigoDe(await service.aplicar(comando('viewer'), { versaoId }, ator(c.viewer))), 'forbidden');
como(c.operator);
const aplicada = await service.aplicar(comando('operator'), { versaoId }, ator(c.operator));
assert.ok(aplicada.ok, JSON.stringify(aplicada));
assert.equal((await repo.lerVersao(c.orgA, versaoId)).status, 'proposto');

assert.equal(codigoDe(await service.autorizar(comando('operator'), { versaoId }, ator(c.operator))), 'forbidden');
como(c.owner);
const autorizada = await service.autorizar(comando('owner'), { versaoId }, ator(c.owner));
assert.ok(autorizada.ok, JSON.stringify(autorizada));
assert.equal((await repo.lerVersao(c.orgA, versaoId)).status, 'vigente');
assert.equal(codigoDe(await service.autorizar(comando('owner'), { versaoId }, ator(c.owner))), 'transicao_invalida');

const concluida = await repo.atualizarExecucao(c.orgA, execucao.id, { status: 'concluida', etapa: 'fim' }, fichaDaExecucao);
assert.ok(concluida.ok, JSON.stringify(concluida));
como(c.operator);
assert.equal(codigoDe(await service.cancelarExecucao(comando('operator'), { execucaoId: execucao.id }, ator(c.operator))), 'transicao_invalida');

const painel = await service.painelDoPlano(comando('operator'), { clienteId: c.cliA });
assert.ok(painel.ok);
const doPlano = painel.value.planos.find((p) => p.plano.id === planoId);
assert.equal(doPlano.status, 'vigente');
assert.equal(doPlano.rotulo, 'Autorizado');
assert.equal(doPlano.pareceres.length, 1);
assert.equal(doPlano.gate.resultado, 'aprovado');
assert.equal(doPlano.execucaoAtiva, null);
assert.deepEqual(doPlano.historico.eventos.map((e) => e.tipo), ['parecer', 'gate', 'proposta', 'efetivada']);

const edicao = await service.editarManual(comando('operator'), { planoId, conteudo: plano }, ator(c.operator));
assert.equal(codigoDe(edicao), 'ok', JSON.stringify(edicao));
const edicaoOk = edicao.ok ? edicao : null;
if (edicaoOk) {
  assert.equal(edicaoOk.value.versao.status, 'rascunho');
  assert.equal(edicaoOk.value.versao.supersedesId, versaoId);
  assert.equal(edicaoOk.value.versao.autorTipo, 'usuario');
  assert.equal(edicaoOk.value.versao.referencias.length, refsComHash.length);
  assert.equal(edicaoOk.value.execucao.tipo, 'revisar');
  assert.equal((await repo.lerVersao(c.orgA, versaoId)).status, 'vigente', 'a vigente continua até a nova ser autorizada');
}
assert.ok(edicaoOk, 'a edição manual passa quando a execução anterior terminou');

const cancelavel = segundo.value.execucao;
const aCancelar = await service.cancelarExecucao(comando('operator'), { execucaoId: cancelavel.id }, ator(c.operator));
assert.ok(aCancelar.ok);
assert.equal(aCancelar.value.status, 'cancelada');
const tardia = await repo.atualizarExecucao(c.orgA, cancelavel.id, { status: 'concluida', etapa: 'fim' }, 1);
assert.equal(!tardia.ok && tardia.error.codigo, 'execucao_perdida', 'cancelada: a ficha não vale mais');

const instrucaoComEmail = await service.pedirMudanca(comando('operator'), { planoId: segundo.value.plano.id, instrucao: 'fale com maria@exemplo.com' }, ator(c.operator));
assert.equal(instrucaoComEmail.ok, false);

como(c.owner);
assert.ok((await service.cancelarVersao(comando('owner'), { versaoId: edicaoOk.value.versao.id }, ator(c.owner))).ok);
assert.equal((await repo.lerVersao(c.orgA, edicaoOk.value.versao.id)).status, 'cancelado');
assert.ok((await service.revogar(comando('owner'), { versaoId }, ator(c.owner))).ok);
assert.equal((await repo.lerVersao(c.orgA, versaoId)).status, 'revogado');

como(c.donoB);
const deB = comando('owner', c.orgB);
assert.equal(await repo.lerVersao(c.orgB, versaoId), null);
assert.equal(await repo.lerExecucao(c.orgB, execucao.id), null);
assert.equal(await repo.buscarPlanoPorId(c.orgB, planoId), null);
assert.deepEqual(await repo.listarPlanosDoCliente({ organizationId: c.orgB, clientId: c.cliA }), []);
assert.equal(await repo.clienteVisivel(c.orgB, c.cliA), false);
assert.equal(codigoDe(await service.painelDoPlano(deB, { clienteId: c.cliA })), 'not_found');
assert.equal(codigoDe(await service.aplicar(deB, { versaoId }, ator(c.donoB))), 'not_found');
assert.equal(codigoDe(await service.cancelarExecucao(deB, { execucaoId: execucao.id }, ator(c.donoB))), 'not_found');
const forjada = await repo.criarVersaoRascunho(c.orgB, { planoId, conteudo: plano, schemaVersion: 1, supersedesId: null, autoria: { tipo: 'pessoa', userId: c.donoB }, referencias: [], requestId: 'r' });
assert.equal(!forjada.ok && forjada.error.codigo, 'nao_encontrado');
const eventoForjado = await repo.registrarEvento(c.orgB, { versaoId, tipo: 'cancelada', payload: {}, autoria: { tipo: 'pessoa', userId: c.donoB }, requestId: 'r' });
assert.equal(!eventoForjado.ok && eventoForjado.error.codigo, 'nao_encontrado');

const acoes = auditorias.map((a) => a.action);
for (const esperada of [
  'strategy.plan.requested',
  'strategy.plan.applied',
  'strategy.plan.authorized',
  'strategy.plan.revoked',
  'strategy.version.created',
  'strategy.version.cancelled',
  'strategy.run.cancelled',
]) {
  assert.ok(acoes.includes(esperada), `auditoria ${esperada}`);
}
const textoAuditado = JSON.stringify(auditorias);
assert.ok(!textoAuditado.includes(intencao.objetivo), 'a auditoria não leva a intenção');
assert.ok(!textoAuditado.includes('maria@'), 'a auditoria não leva a instrução');


como(c.operator);
const planoDaFicha = await repo.criarPlano(escopoA, 'ficha_teste', 'r-ficha');
assert.ok(planoDaFicha.ok);
const novaExecucaoDe = async (idDoPlano, run, base = null, tipo = { tipo: 'revisar', motivo: 'brain_mudou' }) => {
  const criada = await repo.criarExecucao(c.orgA, c.cliA, { planoId: idDoPlano, pedido: tipo, versaoBaseId: base, agentRunId: run, solicitadoPor: c.operator, requestId: 'r-exec' });
  assert.ok(criada.ok, JSON.stringify(criada));
  return criada.value;
};
const reservarComo = (id, quando) => comoWorker(() => repo.reservarExecucao(c.orgA, id, { leaseMs: 60_000, agora: quando }));

const daFicha = await novaExecucaoDe(planoDaFicha.value.id, `run-ficha-${Date.now()}`);
const fichaUm = await reservarComo(daFicha.id, new Date());
assert.equal(fichaUm.tentativas, 1);
assert.ok((await repo.atualizarExecucao(c.orgA, daFicha.id, { leaseAte: new Date(Date.now() - 1000) }, 1)).ok);
const fichaDois = await reservarComo(daFicha.id, new Date());
assert.equal(fichaDois.tentativas, 2, 'o lease vencido é reservado de novo e a ficha sobe');
const perdida = await repo.atualizarExecucao(c.orgA, daFicha.id, { etapa: 'redigir' }, 1);
assert.equal(!perdida.ok && perdida.error.codigo, 'execucao_perdida', 'quem perdeu a ficha não grava');
assert.equal((await repo.lerExecucao(c.orgA, daFicha.id)).etapa, 'ler_brain');
const vencedora = await repo.atualizarExecucao(c.orgA, daFicha.id, { etapa: 'redigir' }, 2);
assert.ok(vencedora.ok);
assert.equal(vencedora.value.etapa, 'redigir');
const concorrentes = await Promise.all([
  repo.atualizarExecucao(c.orgA, daFicha.id, { etapa: 'comite' }, 1),
  repo.atualizarExecucao(c.orgA, daFicha.id, { etapa: 'ajustar' }, 2),
]);
assert.equal(!concorrentes[0].ok && concorrentes[0].error.codigo, 'execucao_perdida');
assert.ok(concorrentes[1].ok);
assert.equal((await repo.lerExecucao(c.orgA, daFicha.id)).etapa, 'ajustar');

const escritaDeAgente = (idDoPlano, run, chave, ficha = 2) =>
  repo.criarVersaoRascunho(c.orgA, { planoId: idDoPlano, conteudo: plano, schemaVersion: 1, supersedesId: null, autoria: autoriaDoAgente(chave, run, 'redator', ficha), referencias: [], requestId: `r-${chave}` });
const comFichaAntiga = await escritaDeAgente(planoDaFicha.value.id, daFicha.agentRunId, 'f-antiga', 1);
assert.equal(!comFichaAntiga.ok && comFichaAntiga.error.codigo, 'execucao_perdida', 'ficha antiga com o lease ainda vigente do novo dono: o banco recusa');
assert.equal((await repo.listarVersoes(c.orgA, planoDaFicha.value.id, 10)).length, 0);
const viva = await escritaDeAgente(planoDaFicha.value.id, daFicha.agentRunId, 'f-viva');
assert.ok(viva.ok, JSON.stringify(viva));
como(c.operator);
const canceladaPelaPessoa = await service.cancelarExecucao(comando('operator'), { execucaoId: daFicha.id }, ator(c.operator));
assert.ok(canceladaPelaPessoa.ok);
const aposCancelar = await repo.atualizarExecucao(c.orgA, daFicha.id, { etapa: 'gates' }, 2);
assert.equal(!aposCancelar.ok && aposCancelar.error.codigo, 'execucao_perdida', 'cancelada: a ficha não vale mais');
const atrasada = await escritaDeAgente(planoDaFicha.value.id, daFicha.agentRunId, 'f-atrasada');
assert.equal(!atrasada.ok && atrasada.error.codigo, 'execucao_perdida', 'a escrita atrasada de uma execução cancelada é recusada pelo banco');
const eventoAtrasado = await repo.registrarEvento(c.orgA, { versaoId: viva.value.id, tipo: 'parecer', payload: { persona: 'redator', veredito: 'aprova' }, autoria: autoriaDoAgente('f-ev', daFicha.agentRunId, 'redator', 2), requestId: 'r-ev' });
assert.equal(!eventoAtrasado.ok && eventoAtrasado.error.codigo, 'execucao_perdida');
assert.equal((await repo.listarVersoes(c.orgA, planoDaFicha.value.id, 10)).length, 1);

const planoDoTeto = await repo.criarPlano(escopoA, 'teto_reservas', 'r-teto');
assert.ok(planoDoTeto.ok);
const doTeto = await novaExecucaoDe(planoDoTeto.value.id, `run-teto-${Date.now()}`);
const momento = new Date();
for (let i = 1; i <= 20; i += 1) {
  const reservada = await reservarComo(doTeto.id, momento);
  assert.equal(reservada?.tentativas, i, `reserva ${i}`);
  assert.ok((await repo.atualizarExecucao(c.orgA, doTeto.id, { status: 'pendente', leaseAte: null }, i)).ok);
}
const descobertaNoTeto = await comoWorker(() => repo.descobrirExecucoesPendentes(50));
assert.ok(descobertaNoTeto.some((d) => d.id === doTeto.id), 'no teto ainda é descoberta, para ser encerrada');
assert.equal(await reservarComo(doTeto.id, momento), null, 'a reserva acima do teto não reserva');
const estourada = await repo.lerExecucao(c.orgA, doTeto.id);
assert.equal(estourada.status, 'falhou');
assert.equal(estourada.erroCodigo, 'interno');
assert.equal(estourada.tentativas, 21);
const depoisDoTeto = await comoWorker(() => repo.descobrirExecucoesPendentes(50));
assert.ok(!depoisDoTeto.some((d) => d.id === doTeto.id));
assert.ok((await repo.criarExecucao(c.orgA, c.cliA, { planoId: planoDoTeto.value.id, pedido: { tipo: 'revisar', motivo: 'brain_mudou' }, versaoBaseId: null, agentRunId: `run-teto2-${Date.now()}`, solicitadoPor: c.operator, requestId: 'r' })).ok, 'o plano fica livre para outra execução');

const planoManual = await repo.criarPlano(escopoA, 'edicao_atomica', 'r-atomica');
assert.ok(planoManual.ok);
const aberta = await repo.criarVersaoRascunho(c.orgA, { planoId: planoManual.value.id, conteudo: plano, schemaVersion: 1, supersedesId: null, autoria: { tipo: 'pessoa', userId: c.operator }, referencias: [], requestId: 'r-aberta' });
assert.ok(aberta.ok);
const ativa = await novaExecucaoDe(planoManual.value.id, `run-ativa-${Date.now()}`, aberta.value.id);
const novaManual = (requestId) => ({ planoId: planoManual.value.id, conteudo: plano, schemaVersion: 1, supersedesId: null, autoria: { tipo: 'pessoa', userId: c.operator }, referencias: [], requestId });
const execucaoDaEdicao = (run) => ({ planoId: planoManual.value.id, pedido: { tipo: 'revisar', motivo: 'edicao_manual' }, agentRunId: run, solicitadoPor: c.operator, requestId: 'r-edicao' });
const recusada = await repo.criarVersaoManualComRevisao(c.orgA, c.cliA, novaManual('r-recusada'), execucaoDaEdicao(`run-recusada-${Date.now()}`));
assert.equal(!recusada.ok && recusada.error.codigo, 'execucao_ativa');
assert.equal((await repo.listarVersoes(c.orgA, planoManual.value.id, 10)).length, 1, 'nada foi gravado');
assert.equal((await repo.lerVersao(c.orgA, aberta.value.id)).status, 'rascunho', 'a versão aberta anterior não foi cancelada');
assert.ok((await service.cancelarExecucao(comando('operator'), { execucaoId: ativa.id }, ator(c.operator))).ok);

const planoDaCorrida = await repo.criarPlano(escopoA, 'edicao_corrida', 'r-corrida');
assert.ok(planoDaCorrida.ok);
const abertaDaCorrida = await repo.criarVersaoRascunho(c.orgA, { ...novaManual('r-ab2'), planoId: planoDaCorrida.value.id });
assert.ok(abertaDaCorrida.ok);
const edicoes = await Promise.all(
  [1, 2, 3].map((n) =>
    service.editarManual(comando('operator'), { planoId: planoDaCorrida.value.id, conteudo: plano }, ator(c.operator)).then((r) => ({ n, r })),
  ),
);
const vencedoras = edicoes.filter(({ r }) => r.ok);
assert.equal(vencedoras.length, 1, JSON.stringify(edicoes.map(({ r }) => (r.ok ? 'ok' : r.error.details?.codigo ?? r.error.code))));
for (const { r } of edicoes.filter(({ r }) => !r.ok)) assert.equal(codigoDe(r), 'execucao_ativa');
const versoesDaCorrida = await repo.listarVersoes(c.orgA, planoDaCorrida.value.id, 10);
assert.equal(versoesDaCorrida.filter((v) => v.status === 'rascunho').length, 1);
assert.equal(versoesDaCorrida.find((v) => v.status === 'rascunho').id, vencedoras[0].r.value.versao.id, 'a vencedora continua rascunho, não foi cancelada pelas perdedoras');
assert.equal(versoesDaCorrida.length, 2, 'só a versão aberta anterior e a da vencedora');
assert.equal(vencedoras[0].r.value.execucao.versaoBaseId, vencedoras[0].r.value.versao.id);

void err;
void comoWorker;
void escopoA;
console.log('cenario ok');
process.exit(0);
