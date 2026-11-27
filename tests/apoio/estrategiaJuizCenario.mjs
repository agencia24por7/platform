import assert from 'node:assert/strict';
import { register } from 'node:module';
import postgres from 'postgres';

register('../../src/shared/testing/aliasHooks.mjs', import.meta.url);
register('./stubsDoNext.mjs', import.meta.url);

Object.assign(process.env, {
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const c = JSON.parse(process.env.STRATEGY_CENARIO);
const admin = postgres(process.env.STRATEGY_ADMIN_URL, { max: 1, onnotice: () => {} });
const { issueSession } = await import('@/modules/identity/domain/session.ts');
const { comoWorker } = await import('@/shared/db/client.ts');
const { createEstrategiaRepository } = await import('@/modules/strategy/infrastructure/estrategiaRepository.ts');
const { createEstrategiaService } = await import('@/modules/strategy/application/estrategiaService.ts');
const { createDestinoService } = await import('@/modules/clients/application/destinoService.ts');
const { createDestinoRepository } = await import('@/modules/clients/infrastructure/destinoRepository.ts');
const { createRegrasService } = await import('@/modules/clients/application/regrasService.ts');
const { createRegrasRepository } = await import('@/modules/clients/infrastructure/regrasRepository.ts');
const { createMotorDoPlano } = await import('@/modules/strategy/application/motorDoPlano.ts');
const { createProcessadorDeExecucoes } = await import('@/modules/strategy/application/processadorDeExecucoes.ts');
const { criarIaFalsa } = await import('@/modules/strategy/infrastructure/ia/iaFalsa.ts');
const { comValidacao } = await import('@/modules/strategy/infrastructure/ia/comValidacao.ts');
const { ok, err } = await import('@/shared/result/result.ts');
const fixtures = await import('@/modules/strategy/domain/fixturesDeTeste.ts');
const { parecer, ponto } = await import('@/modules/strategy/domain/comite/fixturesDeParecer.ts');

const trocarIds = (valor) => JSON.parse(JSON.stringify(valor).replaceAll(fixtures.ORGANIZACAO_ID, c.orgA).replaceAll(fixtures.CLIENTE_ID, c.cliA));
const planoBase = trocarIds(fixtures.planoCompleto());
const pacote = trocarIds(fixtures.pacoteDeTeste());
const urnB = pacote.entradas.find((e) => e.titulo === 'Benchmark de custo por lead').urn;

const como = (userId) => {
  process.env.TESTE_SESSAO_DO_CENARIO = issueSession(userId, process.env.TRIA_SESSION_SECRET, Date.now());
};
const ator = (userId) => ({ userId, requestId: `req-${Math.random().toString(16).slice(2)}`, sourceIp: '10.0.0.1' });
const comando = (papelDeQuemAge, organizationId = c.orgA) => ({ organizationId, papelDeQuemAge });
const codigoDe = (r) => (r.ok ? 'ok' : (r.error.details?.codigo ?? r.error.code));

const repo = createEstrategiaRepository();
const auditorias = [];
const audit = { async record(e) { auditorias.push(e); }, async list() { return []; }, async search() { return []; } };
const regras = createRegrasService({ repositorio: createRegrasRepository(), audit });
const destino = createDestinoService(createDestinoRepository(), audit);
const leitorDoBrain = {
  async lerPacote(org, cli) {
    return org === c.orgA && cli === c.cliA ? ok(pacote) : err({ codigo: 'brain_indisponivel', mensagem: 'fora do cenário' });
  },
};
const avaliadorDeLimites = { async avaliador() { return ok(Object.assign(() => 'ok', { medidasComLimite: [] })); } };
const servico = createEstrategiaService({ repositorio: repo, audit, leitorDoBrain, destino, regras, catalogos: fixtures.CATALOGOS_DE_TESTE });

const itensNaoFaremos = [
  { id: 'nf1', texto: 'Não prometer cura.' },
  { id: 'nf2', texto: 'Sem TikTok.', teste: { tipo: 'plataforma_proibida', valor: 'tiktok' } },
  { id: 'nf3', texto: 'Sem vídeo longo.', teste: { tipo: 'formato_proibido', valor: 'video_longo' } },
  { id: 'nf4', texto: 'Sem display.', teste: { tipo: 'canal_proibido', valor: 'display' } },
];
const comNaoFaremos = (lista, base = planoBase) => ({ ...base, estrategia: { ...base.estrategia, nao_faremos: lista } });

const estado = { planoDoAgente: planoBase, comite: 'aprova', juiz: null, gateDoModelo: 'aprovado' };
const roteiro = (pedido) => {
  if (pedido.tarefa === 'strategy_plan') {
    const secoes = fixtures.secoesDoGrupoDaChave(pedido.chaveDeIdempotencia, estado.planoDoAgente);
    if (pedido.chaveDeIdempotencia.includes(':ajustar:')) {
      const pontos = pedido.dados.pontos.flatMap((argumento) => argumento.pontos);
      return { secoes, respostas: pontos.map((p) => ({ pontoId: p.pontoId, persona: p.persona, decisao: 'acatado', motivo: 'aplicado' })) };
    }
    if (pedido.chaveDeIdempotencia.includes(':corrigir:')) return { secoes, respostas: [] };
    return secoes;
  }
  if (pedido.tarefa === 'comite') {
    const chave = pedido.dados.persona.chave;
    return estado.comite === 'ajuste' && chave === 'redator'
      ? parecer(chave, 'aprova_com_ajuste', [ponto('p1', 'estrategia', [urnB]), ponto('p2', 'campanhas')])
      : parecer(chave, 'aprova');
  }
  if (pedido.tarefa === 'juiz') return estado.juiz ? estado.juiz(pedido.dados) : { vereditos: [] };
  return estado.gateDoModelo === 'aprovado' ? { resultado: 'aprovado', problemas: [] } : { resultado: 'reprovado', problemas: [{ trecho: 'campanhas', problema: 'Segue incoerente.' }] };
};
const iaFalsa = criarIaFalsa(roteiro);
const motor = createMotorDoPlano({ repositorio: repo, executorDeIA: comValidacao(iaFalsa), leitorDoBrain, avaliadorDeLimites, audit, catalogos: fixtures.CATALOGOS_DE_TESTE });
const processador = createProcessadorDeExecucoes({ repositorio: repo, motor });
const processar = async () => {
  const resumo = await comoWorker(() => processador.avancar({ limite: 50 }));
  assert.ok(resumo.ok, JSON.stringify(resumo));
  return resumo.value;
};

const { plataformas: _p, whatsapp: _w, destino: _d, utm: _u, ...intencao } = planoBase.intencao;
como(c.operator);
const landing = await destino.criarLandingPage({ organizationId: c.orgA, clientId: c.cliA, papelDeQuemAge: 'operator', url: planoBase.intencao.destino.url, rotulo: 'Oferta' }, ator(c.operator));
assert.ok(landing.ok, JSON.stringify(landing));
assert.ok((await destino.gravarWhatsapp({ organizationId: c.orgA, clientId: c.cliA, papelDeQuemAge: 'operator', whatsapp: planoBase.intencao.whatsapp }, ator(c.operator))).ok);
const novoPedido = (tipoDePlano) => ({ clienteId: c.cliA, tipoDePlano, plataformas: ['google', 'meta'], landingPageId: landing.value.id, intencao });
const pedirPlano = async (tipo) => {
  como(c.operator);
  const r = await servico.pedirPlano(comando('operator'), novoPedido(tipo), ator(c.operator));
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};
const versoesDe = (planoId) => repo.listarVersoes(c.orgA, planoId, 30);
const eventosDe = async (versaoId) => repo.eventosDaVersao(c.orgA, versaoId);
const cancelarPedido = async (pedido) => {
  como(c.operator);
  const cancelada = await servico.cancelarExecucao(comando('operator'), { execucaoId: pedido.execucao.id }, ator(c.operator));
  assert.ok(cancelada.ok, JSON.stringify(cancelada));
};
const SQL = admin;

console.log('1. juiz do Comitê no banco');
estado.comite = 'ajuste';
estado.juiz = (dados) => ({
  vereditos: dados.pontos.map((p) => ({ persona: p.persona, pontoId: p.pontoId, veredito: p.pontoId === 'p2' ? 'rejeitado' : 'aceito', motivo: `Motivo ${p.pontoId}.`, prova: p.pontoId === 'p1' ? [urnB] : [] })),
});
const p1 = await pedirPlano('aquisicao');
const resumoJuiz = await processar();
assert.ok(resumoJuiz.concluidas >= 1, JSON.stringify(resumoJuiz));
const execucaoJuiz = await repo.lerExecucao(c.orgA, p1.execucao.id);
assert.equal(execucaoJuiz.status, 'concluida', JSON.stringify(execucaoJuiz));
assert.equal(iaFalsa.pedidos.filter((p) => p.tarefa === 'juiz').length, 1, 'uma chamada em lote ao juiz');
const [v2Juiz, v1Juiz] = await versoesDe(p1.plano.id);
const eventosV1 = await eventosDe(v1Juiz.id);
const veredito = eventosV1.filter((e) => e.tipo === 'veredito_juiz');
assert.equal(veredito.length, 1);
assert.equal(veredito[0].atorTipo, 'agente');
assert.equal(veredito[0].agentId, 'juiz');
assert.deepEqual(veredito[0].payload.vereditos.map((v) => [v.pontoId, v.veredito]), [['p1', 'aceito'], ['p2', 'rejeitado']]);
assert.deepEqual(veredito[0].payload.vereditos[0].prova, [urnB], 'a prova (URN do Brain) fica gravada com o veredito');
const ajusteJuiz = (await eventosDe(v2Juiz.id)).find((e) => e.tipo === 'ajuste');
assert.deepEqual(ajusteJuiz.payload.respostas.map((r) => [r.pontoId, r.decisao]).sort(), [['p1', 'acatado'], ['p2', 'nao_acatado']]);
assert.equal(ajusteJuiz.payload.respostas.find((r) => r.pontoId === 'p2').motivo, 'Juiz: Motivo p2.');

como(c.operator);
const porPessoa = await repo.registrarEvento(c.orgA, { versaoId: v2Juiz.id, tipo: 'veredito_juiz', payload: { vereditos: [{ persona: 'redator', pontoId: 'x', veredito: 'aceito', motivo: 'm', prova: [] }] }, autoria: { tipo: 'pessoa', userId: c.operator }, requestId: 'r-pessoa' });
assert.ok(!porPessoa.ok, 'pessoa não grava veredito do juiz');
await assert.rejects(
  SQL`INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, payload) VALUES (${c.orgA}, ${c.cliA}, ${v1Juiz.id}, 'veredito_juiz', 'agente', ${SQL.json({ vereditos: [] })})`,
  /veredito do juiz|execução ativa|rascunho|vereditos/i,
);
await assert.rejects(SQL`UPDATE core.strategy_plan_events SET payload = '{}'::jsonb WHERE id = ${veredito[0].id}`);

como(c.ownerB);
assert.equal((await repo.eventosDaVersao(c.orgB, v1Juiz.id)).length, 0, 'org B não lê o veredito da org A');
assert.equal(await repo.lerVersao(c.orgB, v1Juiz.id), null);
assert.deepEqual(await repo.execucoesDoPlano(c.orgB, p1.plano.id, 10), []);
estado.comite = 'aprova';
estado.juiz = null;

console.log('2. corrigir a falha do gate (os 4 não faremos)');
const p2 = await pedirPlano('marca');
await cancelarPedido(p2);
como(c.operator);
const manual = await servico.editarManual(comando('operator'), { planoId: p2.plano.id, conteudo: comNaoFaremos(itensNaoFaremos) }, ator(c.operator));
assert.ok(manual.ok, JSON.stringify(manual));
await processar();
assert.equal((await repo.lerExecucao(c.orgA, manual.value.execucao.id)).status, 'concluida', 'a base da pessoa, com os 4 itens, passa nos gates');

estado.planoDoAgente = comNaoFaremos([]);
como(c.operator);
const mudanca = await servico.pedirMudanca(comando('operator'), { planoId: p2.plano.id, instrucao: 'Simplifique a estratégia' }, ator(c.operator));
assert.ok(mudanca.ok, JSON.stringify(mudanca));
await processar();
const falhaDoAjuste = await repo.lerExecucao(c.orgA, mudanca.value.id);
assert.equal(falhaDoAjuste.status, 'falhou');
assert.equal(falhaDoAjuste.erroCodigo, 'gate_reprovado', 'o agente removeu os 4 itens e o gate reprovou');
const [vRuim] = await versoesDe(p2.plano.id);
assert.equal(vRuim.status, 'rascunho');
const gateRuim = (await eventosDe(vRuim.id)).filter((e) => e.tipo === 'gate').at(-1);
assert.equal(gateRuim.payload.resultado, 'reprovado');
const checagemRuim = gateRuim.payload.checagens.find((x) => x.chave === 'nao_faremos_preservado');
assert.equal(checagemRuim.resultado, 'reprovado');
assert.equal(checagemRuim.onde.length, 4);

const painelAntes = await servico.painelDoPlano(comando('operator'), { clienteId: c.cliA, planoId: p2.plano.id });
assert.ok(painelAntes.ok);
const falhaVisivel = painelAntes.value.planos[0].falhaDoGate;
assert.equal(falhaVisivel.possivel, true);
assert.equal(falhaVisivel.falhas[0].gate, 'O que "não faremos" da versão base foi mantido');
assert.equal(falhaVisivel.falhas[0].itens.length, 4);

como(c.viewer);
assert.equal(codigoDe(await servico.corrigirFalhaDoGate(comando('viewer'), { clienteId: c.cliA, planoId: p2.plano.id }, ator(c.viewer))), 'forbidden');
como(c.ownerB);
assert.equal(codigoDe(await servico.corrigirFalhaDoGate(comando('owner', c.orgB), { clienteId: c.cliA, planoId: p2.plano.id }, ator(c.ownerB))), 'not_found', 'org B não corrige plano da org A');

estado.planoDoAgente = planoBase;
iaFalsa.limpar();
como(c.operator);
const correcao = await servico.corrigirFalhaDoGate(comando('operator'), { clienteId: c.cliA, planoId: p2.plano.id }, ator(c.operator));
assert.ok(correcao.ok, JSON.stringify(correcao));
assert.equal(correcao.value.execucao.tipo, 'corrigir_gate');
assert.equal(codigoDe(await servico.corrigirFalhaDoGate(comando('operator'), { clienteId: c.cliA, planoId: p2.plano.id }, ator(c.operator))), 'execucao_ativa');
await processar();
const feita = await repo.lerExecucao(c.orgA, correcao.value.execucao.id);
assert.equal(feita.status, 'concluida', JSON.stringify(feita));
assert.equal(iaFalsa.pedidos.filter((p) => p.tarefa === 'strategy_plan').length, 0, 'os 4 itens foram restaurados no servidor, sem pedir ao modelo');
assert.equal(iaFalsa.pedidos.filter((p) => p.tarefa === 'comite').length, 9, 'a nova execução convoca o Comitê (exigência do banco)');
const [vNova, vRuimDepois] = await versoesDe(p2.plano.id);
assert.equal(vRuimDepois.id, vRuim.id);
assert.equal(vRuimDepois.status, 'cancelado');
assert.equal(vNova.status, 'rascunho');
const restauradas = (await repo.lerVersao(c.orgA, vNova.id)).conteudo.estrategia.nao_faremos.map((i) => i.id).sort();
assert.deepEqual(restauradas, ['nf1', 'nf2', 'nf3', 'nf4']);
const gateIntacto = (await eventosDe(vRuim.id)).filter((e) => e.tipo === 'gate').at(-1);
assert.equal(gateIntacto.payload.resultado, 'reprovado', 'o gate original nunca é alterado');
const gateNovo = (await eventosDe(vNova.id)).filter((e) => e.tipo === 'gate');
assert.equal(gateNovo.length, 1);
assert.equal(gateNovo[0].payload.resultado, 'aprovado', 'a nova versão segue porque o gate real aprovou');
como(c.operator);
const aplicada = await servico.aplicar(comando('operator'), { versaoId: vNova.id }, ator(c.operator));
assert.ok(aplicada.ok, JSON.stringify(aplicada));
assert.equal((await repo.lerVersao(c.orgA, vNova.id)).status, 'proposto');

console.log('3. limite de correções (serviço e banco)');
const p3 = await pedirPlano('retencao');
await cancelarPedido(p3);
como(c.operator);
const manual3 = await servico.editarManual(comando('operator'), { planoId: p3.plano.id, conteudo: comNaoFaremos(itensNaoFaremos) }, ator(c.operator));
assert.ok(manual3.ok, JSON.stringify(manual3));
await processar();
estado.planoDoAgente = comNaoFaremos([]);
como(c.operator);
assert.ok((await servico.pedirMudanca(comando('operator'), { planoId: p3.plano.id, instrucao: 'Simplifique' }, ator(c.operator))).ok);
await processar();
estado.planoDoAgente = planoBase;
estado.gateDoModelo = 'reprovado';
for (const tentativa of [1, 2]) {
  como(c.operator);
  const r = await servico.corrigirFalhaDoGate(comando('operator'), { clienteId: c.cliA, planoId: p3.plano.id }, ator(c.operator));
  assert.ok(r.ok, `correção ${tentativa}: ${JSON.stringify(r)}`);
  await processar();
  const fim = await repo.lerExecucao(c.orgA, r.value.execucao.id);
  assert.equal(fim.status, 'falhou');
  assert.equal(fim.erroCodigo, 'correcao_nao_convergiu');
}
como(c.operator);
assert.equal(codigoDe(await servico.corrigirFalhaDoGate(comando('operator'), { clienteId: c.cliA, planoId: p3.plano.id }, ator(c.operator))), 'limite_de_correcoes');
const painelLimite = await servico.painelDoPlano(comando('operator'), { clienteId: c.cliA, planoId: p3.plano.id });
assert.ok(painelLimite.ok);
assert.equal(painelLimite.value.planos[0].falhaDoGate.possivel, false);
assert.match(painelLimite.value.planos[0].falhaDoGate.motivoLegivel, /limite de 2 correções/);
const [vAberta] = await versoesDe(p3.plano.id);
await assert.rejects(
  SQL`INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, base_version_id, agent_run_id, requested_by, requested_kind)
      VALUES (${c.orgA}, ${c.cliA}, ${p3.plano.id}, 'corrigir_gate', '{}'::jsonb, ${vAberta.id}, ${`run-burla-${Date.now()}`}, ${c.operator}, 'usuario')`,
  /limite de 2 correções/,
);
estado.gateDoModelo = 'aprovado';

console.log('4. lacunas com sugestão');
const lacunas = [
  { id: 'lim_cpl', tipo: 'limite_ausente', medida: 'custo_por_lead', descricao: 'Sem teto de custo por lead.', impacto: 'Meta sem teto.', regra: { natureza: 'limite', escopo: 'cliente' }, sugestao: { valor: { unidade: 'brl_centavos', centavos: '5000', moeda: 'BRL' }, origem: 'evidencia', evidencias: [{ urn: urnB, papel: 'favor' }], justificativa: 'Benchmark do setor.' } },
  { id: 'lim_gasto', tipo: 'limite_ausente', medida: 'gasto', descricao: 'Sem teto de gasto.', impacto: 'Verba sem teto.', regra: { natureza: 'limite', escopo: 'cliente' }, sugestao: { valor: null, origem: 'hipotese', evidencias: [], justificativa: 'Sem dado no Brain.' } },
  { id: 'lim_gasto2', tipo: 'limite_ausente', medida: 'gasto', descricao: 'Sem teto mensal.', impacto: 'Verba sem teto.', regra: { natureza: 'limite', chave: 'investimento.teto_mensal', escopo: 'cliente' }, sugestao: { valor: null, origem: 'hipotese', evidencias: [], justificativa: 'Sem dado no Brain.' } },
  { id: 'dado', tipo: 'dado_ausente', descricao: 'Sem margem.', impacto: 'Meta é hipótese.' },
];
const p4 = await pedirPlano('comunidade');
await cancelarPedido(p4);
como(c.operator);
const manual4 = await servico.editarManual(comando('operator'), { planoId: p4.plano.id, conteudo: { ...planoBase, lacunas: { itens: lacunas } } }, ator(c.operator));
assert.ok(manual4.ok, JSON.stringify(manual4));
await processar();
const painel4 = await servico.painelDoPlano(comando('admin'), { clienteId: c.cliA, planoId: p4.plano.id });
assert.ok(painel4.ok);
assert.deepEqual(painel4.value.planos[0].lacunas.map((l) => [l.id, l.origem, l.podeAprovar]), [
  ['lim_cpl', 'evidencia', true],
  ['lim_gasto', 'hipotese', false],
  ['lim_gasto2', 'hipotese', false],
  ['dado', 'sem_sugestao', false],
]);
const regrasDoClienteA = async () => {
  como(c.admin);
  return (await regras.listarVigentes({ organizationId: c.orgA, clientId: c.cliA })).value.decisoes;
};
const regrasDoClienteB = async () => {
  como(c.ownerB);
  return (await regras.listarVigentes({ organizationId: c.orgB, clientId: c.cliB })).value.decisoes;
};
const entradaLacunas = (itens, clienteId = c.cliA, planoId = p4.plano.id) => ({ clienteId, planoId, itens });

como(c.operator);
assert.equal(codigoDe(await servico.aprovarSugestoesDeLacunas(comando('operator'), entradaLacunas([{ lacunaId: 'lim_cpl' }]), ator(c.operator))), 'forbidden');
como(c.viewer);
assert.equal(codigoDe(await servico.aprovarSugestoesDeLacunas(comando('viewer'), entradaLacunas([{ lacunaId: 'lim_cpl' }]), ator(c.viewer))), 'forbidden');
assert.equal((await regrasDoClienteA()).length, 0, 'nada gravado sem permissão');

como(c.ownerB);
assert.equal(codigoDe(await servico.aprovarSugestoesDeLacunas(comando('owner', c.orgB), entradaLacunas([{ lacunaId: 'lim_cpl' }]), ator(c.ownerB))), 'not_found', 'org B não grava regra no cliente da org A');
assert.equal((await regrasDoClienteA()).length, 0);

como(c.admin);
const aprovada = await servico.aprovarSugestoesDeLacunas(comando('admin'), entradaLacunas([{ lacunaId: 'lim_cpl' }]), ator(c.admin));
assert.ok(aprovada.ok, JSON.stringify(aprovada));
assert.deepEqual(aprovada.value.itens.map((i) => i.estado), ['aprovada']);
const vigentes = await regrasDoClienteA();
assert.equal(vigentes.length, 1);
const regra = vigentes[0];
assert.equal(regra.natureza, 'limite');
assert.equal(regra.chave, 'eficiencia.cpl_maximo');
assert.equal(regra.escopo, 'cliente');
assert.equal(regra.origem, 'agencia');
assert.equal(regra.status, 'vigente');
assert.equal(regra.decididoPor, c.admin);
assert.deepEqual(regra.valor, { unidade: 'brl_centavos', centavos: '5000', moeda: 'BRL' });
assert.equal(regra.evidencia, urnB);
assert.match(regra.contexto, /lacuna "lim_cpl"/);
assert.match(regra.contexto, /evidência do Brain/);
assert.doesNotMatch(regra.contexto, /Benchmark do setor/, 'o texto livre do modelo não entra no contexto da regra');
assert.equal(regra.semConfirmacaoDoAnunciante, false);
assert.equal((await regrasDoClienteB()).length, 0, 'a regra não vaza para outra organização');

como(c.admin);
const repetida = await servico.aprovarSugestoesDeLacunas(comando('admin'), entradaLacunas([{ lacunaId: 'lim_cpl' }]), ator(c.admin));
assert.ok(repetida.ok);
assert.deepEqual(repetida.value.itens.map((i) => i.estado), ['ja_aprovada']);
assert.equal((await regrasDoClienteA()).length, 1, 'reenvio não duplica');

const relatorio = await servico.aprovarSugestoesDeLacunas(
  comando('admin'),
  entradaLacunas([
    { lacunaId: 'lim_gasto', valor: { unidade: 'brl_centavos', centavos: '3000000', moeda: 'BRL' } },
    { lacunaId: 'lim_gasto2', valor: { unidade: 'percentual', decimal: '10' } },
    { lacunaId: 'dado', valor: { texto: 'x' } },
    { lacunaId: 'lim_gasto2', valor: { unidade: 'brl_centavos', centavos: '3000000', moeda: 'BRL' } },
  ]),
  ator(c.admin),
);
assert.ok(relatorio.ok, JSON.stringify(relatorio));
assert.deepEqual(
  relatorio.value.itens.map((i) => [i.lacunaId, i.estado, i.erro?.codigo ?? null]),
  [
    ['lim_gasto', 'falhou', 'definicao_ambigua'],
    ['lim_gasto2', 'falhou', 'validation'],
    ['dado', 'falhou', 'sem_regra_estruturada'],
  ],
);
const certa = await servico.aprovarSugestoesDeLacunas(comando('admin'), entradaLacunas([{ lacunaId: 'lim_gasto2', valor: { unidade: 'brl_centavos', centavos: '3000000', moeda: 'BRL' } }]), ator(c.admin));
assert.ok(certa.ok);
assert.deepEqual(certa.value.itens.map((i) => i.estado), ['aprovada']);
const depois = await regrasDoClienteA();
assert.deepEqual(depois.map((d) => d.chave).sort(), ['eficiencia.cpl_maximo', 'investimento.teto_mensal']);
const doValorDaPessoa = depois.find((d) => d.chave === 'investimento.teto_mensal');
assert.equal(doValorDaPessoa.evidencia, null);
assert.match(doValorDaPessoa.contexto, /Origem: valor informado pela pessoa/);
assert.equal(doValorDaPessoa.semConfirmacaoDoAnunciante, true);

const painelFinal = await servico.painelDoPlano(comando('admin'), { clienteId: c.cliA, planoId: p4.plano.id });
assert.ok(painelFinal.ok);
assert.deepEqual(painelFinal.value.planos[0].lacunas.map((l) => l.id), ['dado'], 'as lacunas atendidas somem da lista, inclusive a de gasto sem chave, atendida por qualquer limite de gasto do cliente');

const aprovacoes = auditorias.filter((a) => a.action === 'strategy.lacuna.approved');
assert.equal(aprovacoes.length, 2);
assert.ok(aprovacoes.every((a) => a.actorId === c.admin && a.organizationId === c.orgA));
assert.ok(!JSON.stringify(aprovacoes).includes('Benchmark'), 'a auditoria não leva texto livre');

await admin.end();
console.log('cenario ok');
process.exit(0);
