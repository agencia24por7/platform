import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';

const sufixo = randomBytes(4).toString('hex');
const executar = promisify(execFile);

const variavel = (nome) => {
  if (process.env[nome]) return process.env[nome];
  const linha = readFileSync('.env', 'utf8')
    .split('\n')
    .find((candidata) => candidata.startsWith(`${nome}=`));
  return linha.slice(nome.length + 1);
};

const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-v', 'VERBOSITY=verbose', '-qtAc', sql], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
const dono = (sql) => psql(sql).split('\n').at(-1).trim();

const disponibilidade = (() => {
  try {
    const existe = dono("SELECT to_regclass('core.strategy_plan_runs') IS NOT NULL AND to_regprocedure('core.strategy_runs_pendentes(integer)') IS NOT NULL");
    return existe === 't' ? null : `container ${CONTAINER} sem as migrações 0143 a 0147`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Strategy Plan, motor do plano contra Postgres real', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const pular = disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false;

function endereco() {
  try {
    const porta = execFileSync('docker', ['port', CONTAINER, '5432/tcp'], { encoding: 'utf8' }).split('\n')[0].trim();
    return porta.replace(/^0\.0\.0\.0|^\[::\]/, '127.0.0.1');
  } catch {
    return null;
  }
}

describe('Strategy Plan, motor do plano contra Postgres real (IA falsa e IA não configurada)', { concurrency: false, skip: pular }, () => {
  const criadas = { clientes: [], orgs: [], usuarios: [] };

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('pedir plano, motor, 9 pareceres, ajuste, gate, conclusão, aplicar, autorizar, revisão por mudança do Brain e IA não configurada', async () => {
    const host = endereco();
    assert.ok(host, `a porta 5432 do container ${CONTAINER} precisa estar publicada para o cenário do motor`);
    const org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Motor ${sufixo}', 'motor-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(org);
    const cliente = (nome) => {
      const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome} ${sufixo}', 'leads') RETURNING id`);
      criadas.clientes.push(id);
      return id;
    };
    const pessoa = (nome, papel) => {
      const id = dono(`INSERT INTO core.users (email, name) VALUES ('motor-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
      criadas.usuarios.push(id);
      dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${id}', '${papel}')`);
      return id;
    };
    const cenario = {
      orgA: org,
      cliA: cliente('padaria-ficticia'),
      owner: pessoa('owner', 'owner'),
      admin: pessoa('admin', 'admin'),
      operator: pessoa('operator', 'operator'),
      viewer: pessoa('viewer', 'viewer'),
    };
    const banco = (usuario, senha) => `postgres://${usuario}:${encodeURIComponent(senha)}@${host}/tria`;
    const { stdout } = await executar(process.execPath, ['--experimental-strip-types', '--no-warnings', 'tests/apoio/estrategiaMotorCenario.mjs'], {
      env: {
        ...process.env,
        DATABASE_URL: banco('orla_app', variavel('APP_DB_PASSWORD')),
        DATABASE_URL_WORKER: banco('orla_worker', variavel('WORKER_DB_PASSWORD')),
        STRATEGY_CENARIO: JSON.stringify(cenario),
      },
      timeout: 180_000,
    });
    assert.match(stdout, /cenario ok/);
  });
});
