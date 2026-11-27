import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';
import { comoApp, comoWorker, dono } from './apoio/semearEstrategia.mjs';

const sufixo = randomBytes(4).toString('hex');
const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const disponibilidade = (() => {
  try {
    const existe = dono("SELECT to_regprocedure('core.client_whatsapp_escrita()') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'strategy_plans' AND column_name = 'idempotency_key')");
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0150 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Estratégia: idempotência, redação do WhatsApp e escrita do WhatsApp do cliente (0150)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

describe('Estratégia: idempotência, redação do WhatsApp e escrita do WhatsApp do cliente (0150)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };
  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Seg ${nome} ${sufixo}', 'seg-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('seg-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) => dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);
  const novoPlano = (organizacao, cli, quem, { chave = null, whatsapp = null } = {}) =>
    comoApp(
      organizacao,
      quem,
      `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key, plataformas, whatsapp, idempotency_key)
       VALUES ('${organizacao}', '${cli}', 'aquisicao', ARRAY['meta'], ${whatsapp ? `'${whatsapp}'` : 'NULL'}, ${chave ? `'${chave}'` : 'NULL'}) RETURNING id`,
    );
  const novaVersao = (organizacao, cli, plano, quem) => {
    const id = randomUUID();
    comoApp(
      organizacao,
      quem,
      `INSERT INTO core.strategy_plan_versions (id, organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id)
       VALUES ('${id}', '${organizacao}', '${cli}', '${plano}', '{"x": 1}'::jsonb, 1, 'usuario', '${quem}')`,
    );
    return id;
  };

  before(() => {
    ids.orgA = org('a');
    ids.orgB = org('b');
    ids.cliA = cliente(ids.orgA, 'cli-a');
    ids.cliA2 = cliente(ids.orgA, 'cli-a2');
    ids.cliB = cliente(ids.orgB, 'cli-b');
    ids.operador = usuario('operador');
    ids.leitor = usuario('leitor');
    ids.donoB = usuario('dono-b');
    membro(ids.orgA, ids.operador, 'operator');
    membro(ids.orgA, ids.leitor, 'viewer');
    membro(ids.orgB, ids.donoB, 'owner');
  });

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  describe('idempotência do pedido de plano', () => {
    it('a mesma chave no mesmo cliente é recusada; outra chave, outro cliente e plano sem chave passam', () => {
      const chave = randomUUID();
      novoPlano(ids.orgA, ids.cliA, ids.operador, { chave });
      assert.match(recusa(() => novoPlano(ids.orgA, ids.cliA, ids.operador, { chave })) ?? '', /strategy_plans_idempotencia/);
      novoPlano(ids.orgA, ids.cliA, ids.operador, { chave: randomUUID() });
      novoPlano(ids.orgA, ids.cliA2, ids.operador, { chave });
      novoPlano(ids.orgA, ids.cliA, ids.operador);
      novoPlano(ids.orgA, ids.cliA, ids.operador);
    });

    it('chave fora do formato uuid é recusada pelo CHECK', () => {
      assert.match(recusa(() => novoPlano(ids.orgA, ids.cliA, ids.operador, { chave: 'abc' })) ?? '', /idempotency_key_formato/);
    });

    it('o mesmo nonce em outra organização não colide nem enxerga o plano de A', () => {
      const chave = randomUUID();
      const planoA = novoPlano(ids.orgA, ids.cliA, ids.operador, { chave });
      novoPlano(ids.orgB, ids.cliB, ids.donoB, { chave });
      assert.equal(comoApp(ids.orgB, ids.donoB, `SELECT count(*) FROM core.strategy_plans WHERE id = '${planoA}'`), '0');
    });

    it('viewer não cria plano', () => {
      assert.match(recusa(() => novoPlano(ids.orgA, ids.cliA, ids.leitor, { chave: randomUUID() })) ?? '', /criar plano exige papel/);
    });
  });

  describe('redação LGPD anula o WhatsApp do plano', () => {
    it('core.redigir_plano limpa o whatsapp só do plano redigido; o plano de outra organização e o resto do plano ficam', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.operador, { whatsapp: '+5511912345678' });
      const outroPlano = novoPlano(ids.orgA, ids.cliA2, ids.operador, { whatsapp: '+5511912345679' });
      const planoB = novoPlano(ids.orgB, ids.cliB, ids.donoB, { whatsapp: '+5511912345670' });
      const versao = novaVersao(ids.orgA, ids.cliA, plano, ids.operador);
      comoWorker(ids.orgA, `SELECT core.redigir_plano('${versao}', 'pedido do titular')`);
      assert.equal(dono(`SELECT coalesce(whatsapp, 'nulo') FROM core.strategy_plans WHERE id = '${plano}'`), 'nulo');
      assert.equal(dono(`SELECT plan_type_key || '/' || landing_page_id IS NULL FROM core.strategy_plans WHERE id = '${plano}'`), 't');
      assert.equal(dono(`SELECT whatsapp FROM core.strategy_plans WHERE id = '${outroPlano}'`), '+5511912345679');
      assert.equal(dono(`SELECT whatsapp FROM core.strategy_plans WHERE id = '${planoB}'`), '+5511912345670');
      comoWorker(ids.orgA, `SELECT core.redigir_plano('${versao}', 'repetida')`);
    });

    it('fora da redação o plano continua imutável, para o app e para o dono', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.operador, { whatsapp: '+5511912345678' });
      assert.match(recusa(() => comoApp(ids.orgA, ids.operador, `UPDATE core.strategy_plans SET whatsapp = NULL WHERE id = '${plano}'`)) ?? '', /permission denied|imutável/);
      assert.match(recusa(() => dono(`UPDATE core.strategy_plans SET whatsapp = NULL WHERE id = '${plano}'`)) ?? '', /imutável/);
      assert.match(recusa(() => dono(`UPDATE core.strategy_plans SET plataformas = ARRAY['google'] WHERE id = '${plano}'`)) ?? '', /imutável/);
      assert.equal(dono(`SELECT whatsapp FROM core.strategy_plans WHERE id = '${plano}'`), '+5511912345678');
    });
  });

  describe('gravação do WhatsApp do cliente exige papel de escrita', () => {
    const gravar = (organizacao, quem, cli, valor) =>
      comoApp(organizacao, quem, `UPDATE core.clients SET whatsapp = '${valor}' WHERE id = '${cli}' RETURNING whatsapp`);

    it('operador grava; leitor não altera o valor; sem usuário na sessão é negado', () => {
      assert.equal(gravar(ids.orgA, ids.operador, ids.cliA, '+5511911111111'), '+5511911111111');
      const negado = recusa(() => gravar(ids.orgA, ids.leitor, ids.cliA, '+5511922222222'));
      if (negado !== null) assert.match(negado, /WhatsApp do cliente exige papel/);
      assert.equal(dono(`SELECT whatsapp FROM core.clients WHERE id = '${ids.cliA}'`), '+5511911111111');
      assert.match(recusa(() => gravar(ids.orgA, '', ids.cliA, '+5511933333333')) ?? '', /exige usuário na sessão/);
      assert.equal(dono(`SELECT whatsapp FROM core.clients WHERE id = '${ids.cliA}'`), '+5511911111111');
    });

    it('outra organização não altera o WhatsApp do cliente de A, mesmo com papel de dono na sua', () => {
      const resultado = recusa(() => gravar(ids.orgB, ids.donoB, ids.cliA, '+5511944444444'));
      assert.ok(resultado === null || /exige papel|row-level|permission/.test(resultado));
      assert.equal(dono(`SELECT whatsapp FROM core.clients WHERE id = '${ids.cliA}'`), '+5511911111111');
    });

    it('atualizar outra coluna não passa pelo gatilho do WhatsApp (leitor continua sem gravar o nome)', () => {
      const resultado = recusa(() => comoApp(ids.orgA, ids.leitor, `UPDATE core.clients SET name = 'x' WHERE id = '${ids.cliA}'`));
      assert.ok(resultado === null || !/client_whatsapp_escrita|WhatsApp/.test(resultado));
    });
  });
});
