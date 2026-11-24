import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { register } from 'node:module';
import { promisify } from 'node:util';
import postgres from 'postgres';

register('../../src/shared/testing/aliasHooks.mjs', import.meta.url);
register('./stubsDoNext.mjs', import.meta.url);

Object.assign(process.env, {
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const executar = promisify(execFile);
const urlDoScript = process.env.REGRAS_MIGRACAO_WORKER_URL;
const admin = postgres(process.env.REGRAS_REPO_ADMIN_URL, { max: 1, onnotice: () => {} });
const worker = postgres(urlDoScript, { max: 1, onnotice: () => {} });
const { comoWorker } = await import('@/shared/db/client.ts');
const { createRegrasRepository } = await import('@/modules/clients/infrastructure/regrasRepository.ts');
const { createContextoRepository } = await import('@/modules/clients/infrastructure/contextoRepository.ts');

const regras = createRegrasRepository();
const contexto = createContextoRepository();
const dentro = (trabalho) => comoWorker(trabalho);
const sufixo = Date.now().toString(36);
const ORIGINAL = '2026-01-05T15:00:00Z';

async function rodar(...args) {
  const { stdout } = await executar(process.execPath, ['--experimental-strip-types', 'scripts/regras-migrar-contexto.mjs', ...args], {
    env: { ...process.env, DATABASE_URL: urlDoScript },
    timeout: 60_000,
  });
  return stdout;
}

async function semear(nome) {
  const [org] = await admin`INSERT INTO core.organizations (name, slug, type) VALUES (${`Mig ${nome} ${sufixo}`}, ${`mig-${nome}-${sufixo}`}, 'agency') RETURNING id`;
  const [cli] = await admin`INSERT INTO core.clients (organization_id, name, business_model) VALUES (${org.id}, ${`Cli ${nome}`}, 'leads') RETURNING id`;
  const [user] = await admin`INSERT INTO core.users (email, name) VALUES (${`mig-${nome}-${sufixo}@tria.local`}, 'Autor') RETURNING id`;
  await admin`INSERT INTO core.members (organization_id, user_id, role) VALUES (${org.id}, ${user.id}, 'owner')`;
  return { org: org.id, cli: cli.id, user: user.id };
}

async function linha(c, secao, campo, valor, extra = {}) {
  await admin`
    INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value, source, review, updated_by, created_at, updated_at)
    VALUES (${c.org}, ${c.cli}, ${secao}, ${campo}, ${admin.json(valor)}, ${extra.source ?? 'equipe'}, ${extra.review ?? 'confirmado'},
            ${extra.semAutor ? null : (extra.autor ?? c.user)}, ${ORIGINAL}, ${ORIGINAL})`;
}

const decisoesDe = (c) =>
  admin`SELECT * FROM core.client_decisions WHERE client_id = ${c.cli} ORDER BY number`;

try {
  const a = await semear('a');
  const b = await semear('b');
  await linha(a, 'restricoes', 'quem_aprova', 'Maria, diretora', { source: 'cliente' });
  await linha(a, 'restricoes', 'regras_regulatorias', 'Não prometer mais de 30% de desconto');
  await linha(a, 'restricoes', 'prazo_de_aprovacao', '48 horas úteis', { semAutor: true });
  await linha(a, 'restricoes', 'o_que_nao_pode_ser_dito', 'Sugestão da IA', { source: 'ia', review: 'sugerido' });
  await linha(a, 'objetivos', 'orcamento_mensal_total', 1250050);
  await linha(a, 'empresa', 'nome_empresa', 'Acme');
  await linha(b, 'restricoes', 'quem_aprova', 'Outra org');
  const [exMembro] = await admin`INSERT INTO core.users (email, name) VALUES (${`mig-ex-${sufixo}@tria.local`}, 'Ex-membro') RETURNING id`;
  const [{ id: cliExMembro }] = await admin`INSERT INTO core.clients (organization_id, name, business_model) VALUES (${a.org}, 'Cli ex', 'leads') RETURNING id`;
  await linha({ ...a, cli: cliExMembro }, 'restricoes', 'quem_aprova', 'Decidido por quem saiu', { autor: exMembro.id });

  const antes = await dentro(() => contexto.carregar(a.org, a.cli));
  assert.deepEqual(
    antes.contexto.campos.map((c) => c.fieldKey),
    ['nome_empresa'],
    'o Contexto nao le mais os campos que sairam do catalogo',
  );

  const ensaio = await rodar('--org', a.org);
  assert.match(ensaio, /ENSAIO/);
  assert.match(ensaio, /Alvo: (localhost|127\.0\.0\.1):\d+\/tria/);
  assert.ok(ensaio.indexOf('Alvo:') < ensaio.indexOf('Banco:'), 'o alvo sai antes da primeira consulta');
  const senhaDoScript = decodeURIComponent(new URL(urlDoScript).password);
  assert.ok(senhaDoScript.length > 0 && !ensaio.includes(senhaDoScript), 'a senha nunca e impressa');
  assert.equal((await decisoesDe(a)).length, 0, 'o ensaio nao grava');
  assert.equal((await rodar('--org', a.org, '--ensaio').then(() => decisoesDe(a))).length, 0);

  const aplicado = await rodar('--org', a.org, '--aplicar');
  assert.match(aplicado, /"criadas":3/);
  assert.match(aplicado, /sugestao_nao_confirmada/);
  assert.match(aplicado, /ignorada_sem_autor/);
  assert.match(aplicado, /"ignorada_autor_nao_membro":1/);
  assert.equal((await admin`SELECT count(*)::int AS n FROM core.client_decisions WHERE client_id = ${cliExMembro}`)[0].n, 0, 'autor que nao e membro vivo nao vira decisao');
  const decisoes = await decisoesDe(a);
  assert.equal(decisoes.length, 3);
  assert.equal((await decisoesDe(b)).length, 0, 'outra organizacao nao e tocada');

  const porChave = Object.fromEntries(decisoes.map((d) => [d.key, d]));
  const teto = porChave['investimento.teto_mensal'];
  assert.deepEqual([teto.nature, teto.origin, teto.status, teto.definition_key], ['limite', 'agencia', 'vigente', 'investimento.teto_mensal']);
  assert.deepEqual(teto.value, { valor: '1250050', unidade: 'brl_centavos' });
  assert.equal(new Date(teto.created_at).toISOString(), '2026-01-05T15:00:00.000Z');
  assert.equal(teto.valid_from.toISOString?.().slice(0, 10) ?? String(teto.valid_from).slice(0, 10), '2026-01-05');
  assert.equal(teto.decided_by, a.user);

  const aprova = porChave['governanca.quem_aprova'];
  assert.deepEqual([aprova.nature, aprova.category, aprova.origin, aprova.review_flag], ['regra', 'governanca', 'agencia', null]);
  assert.match(aprova.context, /informado pelo cliente/);
  assert.match(aprova.evidence, /informado pelo cliente/);
  assert.equal(decisoes.filter((d) => d.origin === 'cliente').length, 0, 'migrada nunca nasce com origem cliente');
  const regulatoria = porChave['segmento.regras_regulatorias'];
  assert.equal(regulatoria.review_flag, 'revisar_e_converter_em_limite');
  assert.equal(regulatoria.nature, 'regra');
  assert.equal(porChave['governanca.prazo_de_aprovacao'], undefined, 'linha sem autor nao vira vigente sem pessoa');
  assert.equal(porChave['etica_marca.o_que_nao_pode_ser_dito'], undefined);
  assert.ok(decisoes.every((d) => d.decided_by === a.user));

  const livro = await admin`SELECT field_key, decision_id FROM core.regras_migracao_contexto WHERE client_id = ${a.cli} ORDER BY field_key`;
  assert.deepEqual(livro.map((l) => l.field_key), ['orcamento_mensal_total', 'quem_aprova', 'regras_regulatorias']);
  assert.ok(livro.every((l) => decisoes.some((d) => d.id === l.decision_id)));

  const vigentes = await dentro(() => regras.listarVigentes(a.org, a.cli));
  assert.equal(vigentes.length, 3);
  const prontidao = await dentro(() => regras.contagemParaProntidao(a.org, a.cli));
  assert.deepEqual(prontidao.essenciaisFaltando.map((e) => e.chave), ['eficiencia.cac_maximo']);
  assert.equal(prontidao.aRevisar, 1);

  const depois = await dentro(() => contexto.carregar(a.org, a.cli));
  assert.deepEqual(depois.contexto.campos.map((c) => c.fieldKey), ['nome_empresa']);
  const [{ n: linhasAntigas }] = await admin`SELECT count(*)::int AS n FROM core.client_context_entries WHERE client_id = ${a.cli}`;
  assert.equal(linhasAntigas, 6, 'as linhas antigas ficam');

  const reexecucao = await rodar('--org', a.org, '--aplicar');
  assert.match(reexecucao, /"criadas":0/);
  assert.match(reexecucao, /"ja_migrada":3/);
  assert.equal((await decisoesDe(a)).length, 3, 'reexecucao nao duplica');

  await worker.begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${a.org}, true)`;
    await tx`SELECT set_config('app.client_ids', '*', true)`;
    await tx`SELECT set_config('app.user_id', ${a.user}, true)`;
    await tx`SELECT core.redigir_decisao(${aprova.id}, 'pedido do titular')`;
    await tx`
      INSERT INTO core.client_decision_events (organization_id, client_id, decision_id, type, actor_kind, actor_user_id, reason)
      VALUES (${a.org}, ${a.cli}, ${regulatoria.id}, 'revogada', 'usuario', ${a.user}, 'revogada para testar a reexecucao')`;
  });
  await assert.rejects(
    worker.begin(async (tx) => {
      await tx`SELECT set_config('app.organization_id', ${a.org}, true)`;
      await tx`SELECT set_config('app.client_ids', '*', true)`;
      await tx`DELETE FROM core.regras_migracao_contexto WHERE client_id = ${a.cli}`;
    }),
    /permission denied/,
    'o livro da migracao nao se apaga pelo worker',
  );
  const aposRedacao = await rodar('--org', a.org, '--aplicar');
  assert.match(aposRedacao, /"criadas":0/);
  assert.match(aposRedacao, /"ja_migrada":3/);
  const depoisDaRedacao = await decisoesDe(a);
  assert.equal(depoisDaRedacao.length, 3, 'redacao e revogacao nao fazem a reexecucao recriar');
  assert.equal(depoisDaRedacao.filter((d) => JSON.stringify(d).includes('Maria, diretora')).length, 0, 'texto redigido nao volta');

  const c = { org: a.org, cli: (await admin`INSERT INTO core.clients (organization_id, name, business_model) VALUES (${a.org}, 'Cli c', 'leads') RETURNING id`)[0].id, user: a.user };
  await linha(c, 'restricoes', 'quem_aprova', 'Pedro, diretor');
  const [antiga] = await admin`
    INSERT INTO core.client_decisions (organization_id, client_id, category, nature, origin, key, title, body, decided_by)
    VALUES (${c.org}, ${c.cli}, 'governanca', 'regra', 'agencia', 'governanca.quem_aprova', 'Antiga', 'Pedro', ${c.user}) RETURNING id`;
  await admin`
    INSERT INTO core.client_decision_events (organization_id, client_id, decision_id, type, actor_kind, actor_user_id, reason)
    VALUES (${c.org}, ${c.cli}, ${antiga.id}, 'revogada', 'usuario', ${c.user}, 'revogada antes da migracao')`;
  const comChaveUsada = await rodar('--org', a.org, '--aplicar');
  assert.match(comChaveUsada, /"chave_ja_usada":1/);
  assert.equal((await decisoesDe(c)).length, 1, 'chave ja usada (mesmo revogada) nao e recriada');

  await admin`UPDATE core.client_context_entries SET value = ${admin.json('Joao, gerente')} WHERE client_id = ${a.cli} AND field_key = 'quem_aprova'`;
  const base = (await decisoesDe(a)).length;
  await rodar('--org', a.org, '--aplicar');
  assert.equal((await decisoesDe(a)).length, base, 'mudanca posterior no Contexto antigo nao regera decisao');

  const todas = await executar(process.execPath, ['--experimental-strip-types', 'scripts/regras-migrar-contexto.mjs', '--todas'], {
    env: { ...process.env, DATABASE_URL: urlDoScript, MIGRACAO_ADMIN_URL: process.env.REGRAS_REPO_ADMIN_URL },
  });
  assert.match(todas.stdout, new RegExp(b.org));
  assert.equal((await decisoesDe(b)).length, 0, '--todas em ensaio nao grava');

  await assert.rejects(
    executar(process.execPath, ['--experimental-strip-types', 'scripts/regras-migrar-contexto.mjs', '--org', a.org], {
      env: { ...process.env, DATABASE_URL: process.env.REGRAS_REPO_ADMIN_URL },
    }),
    /superusu/,
  );
  await assert.rejects(
    executar(process.execPath, ['--experimental-strip-types', 'scripts/regras-migrar-contexto.mjs', '--org', a.org], {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    }),
    /papel do worker/,
    'o papel do app e recusado: so o worker grava o livro',
  );
  console.log('cenario ok');
} finally {
  await admin.end();
  await worker.end();
}
