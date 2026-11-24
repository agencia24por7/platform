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

const admin = postgres(process.env.REGRAS_REPO_ADMIN_URL, { max: 1, onnotice: () => {} });
const { comoWorker } = await import('@/shared/db/client.ts');
const { createRegrasRepository } = await import('@/modules/clients/infrastructure/regrasRepository.ts');

const repo = createRegrasRepository();
const dentro = (trabalho) => comoWorker(trabalho);
const comoPessoa = (trabalho) => trabalho();
const { issueSession } = await import('@/modules/identity/domain/session.ts');
const sufixo = Date.now().toString(36);

async function semear(nome) {
  const [org] = await admin`INSERT INTO core.organizations (name, slug, type) VALUES (${`Repo ${nome} ${sufixo}`}, ${`repo-${nome}-${sufixo}`}, 'agency') RETURNING id`;
  const [cliente] = await admin`INSERT INTO core.clients (organization_id, name, business_model) VALUES (${org.id}, ${`Cli ${nome}`}, 'leads') RETURNING id`;
  const [usuario] = await admin`INSERT INTO core.users (email, name) VALUES (${`repo-${nome}-${sufixo}@tria.local`}, 'Quem decidiu') RETURNING id`;
  await admin`INSERT INTO core.members (organization_id, user_id, role) VALUES (${org.id}, ${usuario.id}, 'owner')`;
  return { org: org.id, cli: cliente.id, user: usuario.id };
}

const nova = (cli, user, extra = {}) => ({
  clienteId: cli,
  categoria: 'investimento',
  natureza: 'limite',
  origem: 'agencia',
  forca: 'dura',
  chave: 'investimento.teto_mensal',
  escopo: 'cliente',
  titulo: 'Teto mensal',
  contexto: null,
  texto: null,
  valor: { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' },
  vigenciaInicio: null,
  vigenciaFimInclusivo: null,
  status: 'vigente',
  supersedesId: null,
  decididoPor: user,
  emNomeDe: null,
  evidencia: null,
  semConfirmacaoDoAnunciante: true,
  agentId: null,
  agentRunId: null,
  agentSetHash: null,
  chaveDeIdempotencia: null,
  definicaoChave: 'investimento.teto_mensal',
  definicaoVersao: 1,
  ...extra,
});

const regraAgente = (cli, extra = {}) =>
  nova(cli, null, {
    categoria: 'etica_marca',
    natureza: 'regra',
    origem: 'agente',
    chave: 'etica_marca.tom',
    titulo: 'Tom',
    texto: 'Tom formal.',
    valor: null,
    definicaoChave: null,
    definicaoVersao: null,
    status: 'proposta',
    decididoPor: null,
    semConfirmacaoDoAnunciante: false,
    agentId: 'agente-a',
    agentRunId: 'exec-1',
    chaveDeIdempotencia: 'k1',
    ...extra,
  });

try {
  const a = await semear('a');
  const b = await semear('b');
  process.env.TESTE_SESSAO_DO_CENARIO = issueSession(a.user, process.env.TRIA_SESSION_SECRET, Date.now());

  const definicoes = await dentro(() => repo.listarDefinicoes(a.org));
  assert.ok(definicoes.length >= 7);
  const teto = definicoes.find((d) => d.key === 'investimento.teto_mensal');
  assert.deepEqual(teto.tiposDeEscopo.slice().sort(), ['cliente', 'plataforma']);
  assert.equal((await dentro(() => repo.definicaoAtiva(a.org, 'inexistente.x'))), null);
  assert.equal(await dentro(() => repo.clienteVisivel(a.org, a.cli)), true);
  assert.equal(await dentro(() => repo.clienteVisivel(b.org, a.cli)), false);

  const primeira = await comoPessoa(() => repo.inserirDecisao(a.org, nova(a.cli, a.user), 'req-1'));
  assert.equal(primeira.ok, true);
  assert.equal(primeira.valor.numero, 1);
  assert.equal(primeira.valor.status, 'vigente');
  assert.deepEqual(primeira.valor.valor, { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' });
  assert.equal(primeira.valor.decididoPor, a.user);

  const duplicada = await comoPessoa(() => repo.inserirDecisao(a.org, nova(a.cli, a.user), 'req-dup'));
  assert.equal(duplicada.ok, false);

  const segunda = await comoPessoa(() =>
    repo.inserirDecisao(
      a.org,
      nova(a.cli, a.user, { valor: { unidade: 'brl_centavos', centavos: '2000000', moeda: 'BRL' }, supersedesId: primeira.valor.id, contexto: 'Verba ampliada' }),
      'req-2',
    ),
  );
  assert.equal(segunda.ok, true);
  assert.equal(segunda.valor.numero, 2);
  assert.equal((await dentro(() => repo.buscarPorId(a.org, a.cli, primeira.valor.id))).status, 'superada');

  const historico = await dentro(() => repo.historicoDaChave(a.org, a.cli, 'investimento.teto_mensal', 'cliente'));
  assert.equal(historico.length, 2);
  const eventosDaPrimeira = historico.find((h) => h.decisao.id === primeira.valor.id).eventos;
  assert.deepEqual(eventosDaPrimeira.map((e) => e.tipo), ['efetivada', 'superada']);
  assert.equal(eventosDaPrimeira[0].requestId, 'req-1');
  assert.equal(eventosDaPrimeira[1].requestId, 'req-2');
  assert.equal(eventosDaPrimeira[1].sucessoraId, segunda.valor.id);

  const corrida = await Promise.all(
    [3, 4].map((n) =>
      comoPessoa(() =>
        repo.inserirDecisao(
          a.org,
          nova(a.cli, a.user, { valor: { unidade: 'brl_centavos', centavos: `${n}000000`, moeda: 'BRL' }, supersedesId: segunda.valor.id }),
          `req-c${n}`,
        ),
      ),
    ),
  );
  assert.deepEqual(corrida.map((r) => r.ok).sort(), [false, true]);
  const vencedora = corrida.find((r) => r.ok).valor;

  const proposta = await dentro(() => repo.inserirDecisao(a.org, regraAgente(a.cli), 'req-p'));
  assert.equal(proposta.ok, true);
  assert.equal(proposta.valor.status, 'proposta');
  assert.equal(proposta.valor.agentSetHash, null);
  const repetida = await dentro(() => repo.inserirDecisao(a.org, regraAgente(a.cli), 'req-p2'));
  assert.equal(repetida.ok, false);
  assert.equal(repetida.restricao, 'client_decisions_idempotencia');
  const porIdem = await dentro(() => repo.buscarPorIdempotencia(a.org, a.cli, 'agente-a', 'k1'));
  assert.equal(porIdem.id, proposta.valor.id);
  assert.equal((await dentro(() => repo.listarPropostas(a.org, a.cli))).length, 1);
  assert.equal((await dentro(() => repo.listarPropostas(a.org, a.cli, 'agencia'))).length, 0);

  const efetivada = await comoPessoa(() =>
    repo.inserirEvento(a.org, { clienteId: a.cli, decisaoId: proposta.valor.id, tipo: 'efetivada', atorTipo: 'usuario', atorUsuarioId: a.user, motivo: null }, 'req-e'),
  );
  assert.equal(efetivada.ok, true);
  assert.equal(efetivada.valor.status, 'vigente');
  const efetivarDeNovo = await comoPessoa(() =>
    repo.inserirEvento(a.org, { clienteId: a.cli, decisaoId: proposta.valor.id, tipo: 'efetivada', atorTipo: 'usuario', atorUsuarioId: a.user, motivo: null }, 'req-e2'),
  );
  assert.equal(efetivarDeNovo.ok, false);

  const revogada = await comoPessoa(() =>
    repo.inserirEvento(a.org, { clienteId: a.cli, decisaoId: proposta.valor.id, tipo: 'revogada', atorTipo: 'usuario', atorUsuarioId: a.user, motivo: 'Cliente mudou de ideia' }, 'req-r'),
  );
  assert.equal(revogada.ok, true);
  assert.equal(revogada.valor.status, 'revogada');
  assert.equal(revogada.valor.motivoDaRevogacao, 'Cliente mudou de ideia');

  const rejeitavel = await dentro(() => repo.inserirDecisao(a.org, regraAgente(a.cli, { chaveDeIdempotencia: 'k2', chave: 'etica_marca.outra' }), 'req-p3'));
  const rejeitada = await comoPessoa(() =>
    repo.inserirEvento(a.org, { clienteId: a.cli, decisaoId: rejeitavel.valor.id, tipo: 'rejeitada', atorTipo: 'usuario', atorUsuarioId: a.user, motivo: null }, 'req-j'),
  );
  assert.equal(rejeitada.valor.status, 'rejeitada');

  const vigentes = await dentro(() => repo.listarVigentes(a.org, a.cli));
  assert.deepEqual(vigentes.map((d) => d.id), [vencedora.id]);

  const pagina1 = await dentro(() => repo.linhaDoTempo(a.org, a.cli, { limite: 2 }));
  assert.equal(pagina1.itens.length, 2);
  assert.ok(pagina1.itens[0].numero > pagina1.itens[1].numero);
  assert.equal(pagina1.proximoCursor, pagina1.itens[1].numero);
  const pagina2 = await dentro(() => repo.linhaDoTempo(a.org, a.cli, { limite: 50, cursor: pagina1.proximoCursor }));
  assert.ok(pagina2.itens.every((d) => d.numero < pagina1.proximoCursor));
  const soAgente = await dentro(() => repo.linhaDoTempo(a.org, a.cli, { limite: 50, origem: 'agente' }));
  assert.equal(soAgente.itens.length, 2);
  const soRevogadas = await dentro(() => repo.linhaDoTempo(a.org, a.cli, { limite: 50, status: 'revogada', categoria: 'etica_marca' }));
  assert.equal(soRevogadas.itens.length, 1);

  const prontidao = await dentro(() => repo.contagemParaProntidao(a.org, a.cli));
  assert.deepEqual(prontidao.essenciaisFaltando.map((e) => e.chave), ['eficiencia.cac_maximo']);
  assert.equal(prontidao.vigentes, 1);
  assert.equal(prontidao.propostasPendentes, 0);

  const contagem = await dentro(() => repo.contarDoAgente(a.org, a.cli, 'exec-1', new Date(Date.now() - 86400000)));
  assert.deepEqual(contagem, { naExecucao: 2, noPeriodo: 2 });
  assert.deepEqual(await dentro(() => repo.filaDeRevisao(a.org, a.cli)), []);

  assert.equal(await dentro(() => repo.buscarPorId(b.org, a.cli, primeira.valor.id)), null);
  assert.deepEqual(await dentro(() => repo.listarVigentes(b.org, a.cli)), []);
  assert.equal(await dentro(() => repo.buscarPorNumero(a.org, a.cli, 1)).then((d) => d?.id), primeira.valor.id);

  const decisaoDoAgente = (cli, i, execucao = 'exec-teto') =>
    nova(cli, null, {
      categoria: 'processo',
      natureza: 'decisao',
      origem: 'agente',
      chave: null,
      titulo: `Ajuste ${i}`,
      valor: null,
      definicaoChave: null,
      definicaoVersao: null,
      decididoPor: null,
      semConfirmacaoDoAnunciante: false,
      agentId: 'agente-teto',
      agentRunId: execucao,
      chaveDeIdempotencia: `${execucao}:${i}`,
    });
  const [{ id: cliTeto }] = await admin`INSERT INTO core.clients (organization_id, name, business_model) VALUES (${a.org}, 'Cli teto', 'leads') RETURNING id`;
  const paralelas = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      dentro(() => repo.inserirDecisao(a.org, decisaoDoAgente(cliTeto, i), `req-t${i}`, { porExecucao: 2, porDia: 200 })),
    ),
  );
  assert.equal(paralelas.filter((r) => r.ok).length, 2, JSON.stringify(paralelas.map((r) => r.ok || r.motivo)));
  assert.ok(paralelas.filter((r) => !r.ok).every((r) => r.motivo === 'teto' && r.teto === 'execucao'));
  const porDia = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      dentro(() => repo.inserirDecisao(a.org, decisaoDoAgente(cliTeto, i, `exec-d${i}`), `req-d${i}`, { porExecucao: 50, porDia: 3 })),
    ),
  );
  assert.equal(porDia.filter((r) => r.ok).length, 1, 'ja havia 2 no dia; o teto 3 deixa so mais uma');
  assert.ok(porDia.filter((r) => !r.ok).every((r) => r.motivo === 'teto' && r.teto === 'dia'));

  const semPessoa = await dentro(() => repo.inserirDecisao(a.org, nova(a.cli, null, { chave: 'investimento.teto_diario', definicaoChave: 'investimento.teto_diario' }), 'req-sp')).catch((e) => e);
  assert.match(String(semPessoa?.message), /exige a pessoa que decidiu/);
  const workerEmNomeDeOutro = await dentro(() =>
    repo.inserirDecisao(a.org, nova(a.cli, a.user, { chave: 'investimento.teto_diario', definicaoChave: 'investimento.teto_diario' }), 'req-wo'),
  ).catch((e) => e);
  assert.match(String(workerEmNomeDeOutro?.message), /usuário da sessão/, 'o worker não grava em nome de uma pessoa que não declarou');

  const [{ n }] = await admin`SELECT count(*)::int AS n FROM core.client_decision_events WHERE client_id = ${a.cli} AND request_id IS NULL`;
  assert.equal(n, 0);
  console.log('cenario ok');
} finally {
  await admin.end();
  process.exit(process.exitCode ?? 0);
}
