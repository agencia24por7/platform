import assert from 'node:assert/strict';
import { register } from 'node:module';
import postgres from 'postgres';
import { donoPorDocker } from './bancoDeTeste.mjs';

register('../../src/shared/testing/aliasHooks.mjs', import.meta.url);
register('./stubsDoNext.mjs', import.meta.url);

Object.assign(process.env, {
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const admin = process.env.BRAIN_REPO_ADMIN_URL ? postgres(process.env.BRAIN_REPO_ADMIN_URL, { max: 1, onnotice: () => {} }) : donoPorDocker();
const { comoWorker } = await import('@/shared/db/client.ts');
const { createBrainRepository } = await import('@/modules/brain/infrastructure/brainRepository.ts');

const repo = createBrainRepository();
const sufixo = Date.now().toString(36);

async function semear(nome, clientes) {
  const [org] = await admin`INSERT INTO core.organizations (name, slug, type) VALUES (${`Brain ${nome} ${sufixo}`}, ${`brain-${nome}-${sufixo}`}, 'agency') RETURNING id`;
  const ids = [];
  for (const cliente of clientes) {
    const [c] = await admin`INSERT INTO core.clients (organization_id, name, business_model) VALUES (${org.id}, ${`${cliente} ${nome}`}, 'leads') RETURNING id`;
    ids.push(c.id);
  }
  return { org: org.id, clientes: ids };
}

const linha = (extra) => ({
  platform: 'meta',
  periodo: '2026-10-01',
  recorte: 'total',
  chave: '',
  rotulo: 'Total',
  investimentoCentavos: 100_000,
  impressoes: 1000,
  cliques: 10,
  conversoes: 2.5,
  receitaCentavos: null,
  moeda: 'BRL',
  ...extra,
});

const CHAVE_COMPLICADA = 'São Paulo, "SP" {x}\\|y';
const J = '2026-08-01';
const linhasIniciais = () => [
  linha({ periodo: '2026-09-01' }),
  linha({ periodo: '2026-10-01', investimentoCentavos: 200_000 }),
  linha({ periodo: J, recorte: 'campanha', chave: '1001', rotulo: 'Campanha 1', investimentoCentavos: 900_000 }),
  linha({ periodo: J, recorte: 'campanha', chave: '1002', rotulo: 'Campanha 2', investimentoCentavos: 400_000 }),
  linha({ periodo: J, recorte: 'regiao', chave: CHAVE_COMPLICADA, rotulo: 'SP', investimentoCentavos: 300_000 }),
  linha({ platform: 'google', periodo: J, recorte: 'dispositivo', chave: 'MOBILE', rotulo: 'MOBILE', receitaCentavos: 5_000 }),
];
const MEDIDOS_META = [
  { platform: 'meta', recorte: 'total' },
  { platform: 'meta', recorte: 'campanha' },
  { platform: 'meta', recorte: 'regiao' },
];
const MEDIDOS_TODOS = [...MEDIDOS_META, { platform: 'google', recorte: 'dispositivo' }];

const gravar = (organizationId, clienteId, linhas, medidos) =>
  comoWorker(() => repo.gravarDesempenho({ organizationId, clienteId }, { linhas, medidos }));

const estado = async (cli) => {
  const rows = await admin`
    SELECT platform || '|' || periodo::text || '|' || recorte || '|' || item AS k, investimento_centavos::text AS inv, medido_em::text AS em
    FROM core.client_brain_performance WHERE client_id = ${cli} ORDER BY 1`;
  return Object.fromEntries(rows.map((r) => [r.k, { inv: r.inv, em: r.em }]));
};
const chaveDe = (platform, periodo, recorte, chave) => `${platform}|${periodo}|${recorte}|${chave}`;
const pausa = () => new Promise((resolver) => setTimeout(resolver, 30));

try {
  const a = await semear('a', ['A1', 'A2']);
  const b = await semear('b', ['B1']);
  const [a1, a2] = a.clientes;
  const [b1] = b.clientes;

  await gravar(a.org, a1, linhasIniciais(), MEDIDOS_TODOS);
  await gravar(a.org, a2, linhasIniciais(), MEDIDOS_TODOS);
  await gravar(b.org, b1, linhasIniciais(), MEDIDOS_TODOS);
  const inicial = await estado(a1);
  assert.equal(Object.keys(inicial).length, 6);
  assert.ok(inicial[chaveDe('meta', J, 'regiao', CHAVE_COMPLICADA)], 'chave com vírgula, aspas, chaves e barra é gravada');
  const doA2 = await estado(a2);
  const doB1 = await estado(b1);

  await pausa();
  await gravar(a.org, a1, linhasIniciais(), MEDIDOS_TODOS);
  assert.deepEqual(await estado(a1), inicial, 'regravar os mesmos números não muda nada, nem medido_em');

  await pausa();
  const alteradas = linhasIniciais().map((l) => (l.chave === '1002' ? { ...l, investimentoCentavos: 400_001 } : l));
  await gravar(a.org, a1, alteradas, MEDIDOS_TODOS);
  const depoisDeMudar = await estado(a1);
  const k1002 = chaveDe('meta', J, 'campanha', '1002');
  for (const [k, v] of Object.entries(depoisDeMudar)) {
    if (k === k1002) {
      assert.equal(v.inv, '400001');
      assert.notEqual(v.em, inicial[k].em, 'a linha que mudou ganha novo medido_em');
    } else {
      assert.deepEqual(v, inicial[k], `${k} não mudou`);
    }
  }

  await pausa();
  await gravar(a.org, a1, alteradas.filter((l) => l.chave !== '1002'), MEDIDOS_TODOS);
  const semA1002 = await estado(a1);
  assert.equal(semA1002[k1002], undefined, 'chave ausente dentro do recorte medido é apagada');
  assert.equal(Object.keys(semA1002).length, 5);
  assert.deepEqual(semA1002[chaveDe('meta', J, 'campanha', '1001')], inicial[chaveDe('meta', J, 'campanha', '1001')]);

  await pausa();
  await gravar(a.org, a1, alteradas.filter((l) => l.recorte === 'total' && l.platform === 'meta'), [{ platform: 'meta', recorte: 'total' }]);
  const soTotal = await estado(a1);
  assert.equal(Object.keys(soTotal).length, 5, 'recorte que não foi medido (falhou) mantém as linhas antigas');
  assert.ok(soTotal[chaveDe('meta', J, 'regiao', CHAVE_COMPLICADA)]);
  assert.ok(soTotal[chaveDe('meta', J, 'campanha', '1001')]);
  assert.ok(soTotal[chaveDe('google', J, 'dispositivo', 'MOBILE')], 'outra plataforma não é tocada');

  await gravar(a.org, a1, [], [{ platform: 'meta', recorte: 'regiao' }]);
  const semRegiao = await estado(a1);
  assert.equal(semRegiao[chaveDe('meta', J, 'regiao', CHAVE_COMPLICADA)], undefined, 'recorte medido e vazio apaga as linhas dele');
  assert.equal(Object.keys(semRegiao).length, 4);

  await gravar(a.org, a1, [], []);
  assert.equal(Object.keys(await estado(a1)).length, 4, 'sem recortes medidos nada é apagado');

  assert.deepEqual(await estado(a2), doA2, 'outro cliente da mesma organização não é alcançado');
  assert.deepEqual(await estado(b1), doB1, 'outra organização não é alcançada');

  const cruzado = await gravar(b.org, a2, [linha({ periodo: '2026-07-01', investimentoCentavos: 1 })], MEDIDOS_TODOS).catch((e) => e);
  assert.ok(cruzado instanceof Error, 'cliente de outra organização é recusado pela RLS');
  const cruzadoApagando = await gravar(b.org, a2, [], MEDIDOS_TODOS).catch((e) => e);
  assert.equal(cruzadoApagando instanceof Error, false);
  assert.deepEqual(await estado(a2), doA2, 'apagar pela organização errada não apaga nada');
  assert.deepEqual(await estado(b1), doB1);

  console.log('cenario ok');
} finally {
  await admin.end();
  process.exit(process.exitCode ?? 0);
}
