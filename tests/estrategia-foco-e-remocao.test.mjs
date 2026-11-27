import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';
import { aspas, comoApp, comoWorker, dono } from './apoio/semearEstrategia.mjs';

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
    const existe = dono(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'core' AND table_name = 'strategy_plans' AND column_name = 'removido_em') AND to_regprocedure('core.strategy_plan_foco_valido(jsonb,uuid,uuid)') IS NOT NULL",
    );
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0151 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Estratégia: foco do plano e remoção lógica (0151)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

describe('Estratégia: foco do plano e remoção lógica (0151)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };
  const hash = 'a'.repeat(64);
  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Foco ${nome} ${sufixo}', 'foco-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('foco-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) => dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);
  const urnDoProduto = (organizacao, cli, id) => `orla:${organizacao}:${cli}:contexto_produto:${id}`;
  const produto = (organizacao, cli, id, extra = {}) => ({ urn: urnDoProduto(organizacao, cli, id), rotulo: `Produto ${id}`, hash, ...extra });
  const novoPlano = (organizacao, cli, quem, foco) =>
    comoApp(
      organizacao,
      quem,
      `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key, plataformas, foco)
       VALUES ('${organizacao}', '${cli}', 'aquisicao', ARRAY['meta'], ${foco === null ? 'NULL' : `${aspas(JSON.stringify(foco))}::jsonb`}) RETURNING id`,
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
  const novaExecucao = (organizacao, cli, plano, quem, pedido = { tipo: 'criar' }) =>
    comoApp(
      organizacao,
      quem,
      `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, agent_run_id, requested_by, requested_kind)
       VALUES ('${organizacao}', '${cli}', '${plano}', 'criar', ${aspas(JSON.stringify(pedido))}::jsonb, 'run-${randomBytes(5).toString('hex')}', '${quem}', 'usuario') RETURNING id`,
    );
  const apagar = (organizacao, quem, plano) =>
    comoApp(organizacao, quem, `UPDATE core.strategy_plans SET removido_em = now() WHERE id = '${plano}' RETURNING id`);

  before(() => {
    ids.orgA = org('a');
    ids.orgB = org('b');
    ids.cliA = cliente(ids.orgA, 'cli-a');
    ids.cliA2 = cliente(ids.orgA, 'cli-a2');
    ids.cliB = cliente(ids.orgB, 'cli-b');
    ids.dono = usuario('dono');
    ids.admin = usuario('admin');
    ids.operador = usuario('operador');
    ids.leitor = usuario('leitor');
    ids.donoB = usuario('dono-b');
    membro(ids.orgA, ids.dono, 'owner');
    membro(ids.orgA, ids.admin, 'admin');
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

  describe('CHECK do foco', () => {
    const cria = (foco) => novoPlano(ids.orgA, ids.cliA, ids.operador, foco);

    it('aceita legado (NULL), marca e de 1 a 20 produtos do mesmo cliente', () => {
      cria(null);
      cria({ tipo: 'marca' });
      cria({ tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA, 'tenis')] });
      cria({ tipo: 'produtos', produtos: Array.from({ length: 20 }, (_, i) => produto(ids.orgA, ids.cliA, `p${i}`)) });
    });

    it('recusa vazio, mais de 20, duplicata, hash ruim, rótulo vazio, chave extra e tipo desconhecido', () => {
      const ruins = [
        { tipo: 'produtos', produtos: [] },
        { tipo: 'produtos', produtos: Array.from({ length: 21 }, (_, i) => produto(ids.orgA, ids.cliA, `p${i}`)) },
        { tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA, 'a'), produto(ids.orgA, ids.cliA, 'a')] },
        { tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA, 'a', { hash: 'xyz' })] },
        { tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA, 'a', { rotulo: '  ' })] },
        { tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA, 'a', { extra: 1 })] },
        { tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA, 'a')], extra: 1 },
        { tipo: 'marca', produtos: [produto(ids.orgA, ids.cliA, 'a')] },
        { tipo: 'outro' },
        { tipo: 'produtos' },
      ];
      for (const foco of ruins) assert.match(recusa(() => cria(foco)) ?? '', /strategy_plans_foco_formato/, JSON.stringify(foco).slice(0, 80));
    });

    it('recusa produto de outro cliente, de outra organização ou de outro tipo de entrada', () => {
      assert.match(recusa(() => cria({ tipo: 'produtos', produtos: [produto(ids.orgA, ids.cliA2, 'a')] })) ?? '', /strategy_plans_foco_formato/);
      assert.match(recusa(() => cria({ tipo: 'produtos', produtos: [produto(ids.orgB, ids.cliA, 'a')] })) ?? '', /strategy_plans_foco_formato/);
      assert.match(
        recusa(() => cria({ tipo: 'produtos', produtos: [{ urn: `orla:${ids.orgA}:${ids.cliA}:contexto_secao:produtos`, rotulo: 'x', hash }] })) ?? '',
        /strategy_plans_foco_formato/,
      );
    });

    it('o foco é imutável depois de gravado, para o app e para o dono', () => {
      const plano = cria({ tipo: 'marca' });
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `UPDATE core.strategy_plans SET foco = NULL WHERE id = '${plano}'`)) ?? '', /permission denied|imutável|insufficient|restrict/);
      assert.match(recusa(() => dono(`UPDATE core.strategy_plans SET foco = NULL WHERE id = '${plano}'`)) ?? '', /imutável/);
      assert.equal(dono(`SELECT foco->>'tipo' FROM core.strategy_plans WHERE id = '${plano}'`), 'marca');
    });
  });

  describe('pedido da execução com o foco dentro', () => {
    it('aceita um pedido de 12 KB e recusa acima de 16 KB', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.operador, { tipo: 'marca' });
      const grande = { tipo: 'criar', texto: 'x'.repeat(12000) };
      const execucao = novaExecucao(ids.orgA, ids.cliA, plano, ids.operador, grande);
      assert.match(execucao, /^[0-9a-f-]{36}$/);
      comoApp(ids.orgA, ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${execucao}'`);
      assert.match(recusa(() => novaExecucao(ids.orgA, ids.cliA, plano, ids.operador, { tipo: 'criar', texto: Array.from({ length: 6000 }, () => randomBytes(4).toString('hex')).join('') })) ?? '', /pedido_check/);
    });
  });

  describe('remoção lógica do plano', () => {
    it('owner e admin removem; removido_em vira now() e removido_por o usuário da sessão', () => {
      for (const quem of [ids.dono, ids.admin]) {
        const plano = novoPlano(ids.orgA, ids.cliA, ids.operador, { tipo: 'marca' });
        assert.equal(comoApp(ids.orgA, quem, `UPDATE core.strategy_plans SET removido_em = '2000-01-01' WHERE id = '${plano}' RETURNING id`), plano);
        assert.equal(dono(`SELECT removido_em > now() - interval '1 minute' FROM core.strategy_plans WHERE id = '${plano}'`), 't');
        assert.equal(dono(`SELECT removido_por FROM core.strategy_plans WHERE id = '${plano}'`), quem);
      }
    });

    it('operator e viewer não removem e o plano continua ativo', () => {
      for (const quem of [ids.operador, ids.leitor]) {
        const plano = novoPlano(ids.orgA, ids.cliA, ids.dono, { tipo: 'marca' });
        assert.match(recusa(() => apagar(ids.orgA, quem, plano)) ?? '', /apagar plano exige papel owner ou admin/);
        assert.equal(dono(`SELECT removido_em IS NULL FROM core.strategy_plans WHERE id = '${plano}'`), 't');
      }
    });

    it('sem usuário na sessão e o dono do banco (sem papel de app) não removem', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.dono, { tipo: 'marca' });
      assert.match(recusa(() => apagar(ids.orgA, '', plano)) ?? '', /apagar plano exige papel owner ou admin/);
      assert.match(recusa(() => dono(`UPDATE core.strategy_plans SET removido_em = now() WHERE id = '${plano}'`)) ?? '', /imutável/);
    });

    it('só a transição NULL para valor, uma vez: não volta a NULL, não muda o valor e não mexe em outra coluna', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.dono, { tipo: 'marca' });
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `UPDATE core.strategy_plans SET removido_em = now(), whatsapp = '+5511912345678' WHERE id = '${plano}'`)) ?? '', /permission denied|apagar plano não altera|imutável/);
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `UPDATE core.strategy_plans SET removido_em = NULL WHERE id = '${plano}'`)) ?? '', /imutável/);
      apagar(ids.orgA, ids.dono, plano);
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `UPDATE core.strategy_plans SET removido_em = NULL WHERE id = '${plano}'`)) ?? '', /imutável/);
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `UPDATE core.strategy_plans SET removido_em = '2001-01-01' WHERE id = '${plano}'`)) ?? '', /imutável/);
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `UPDATE core.strategy_plans SET removido_por = NULL WHERE id = '${plano}'`)) ?? '', /imutável|permission denied/);
      assert.match(recusa(() => comoApp(ids.orgA, ids.dono, `DELETE FROM core.strategy_plans WHERE id = '${plano}'`)) ?? '', /permission denied|imutável|não pode ser apagado|restrict/);
    });

    it('isolamento: o dono de outra organização não remove o plano de A', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.operador, { tipo: 'marca' });
      const resultado = recusa(() => assert.equal(apagar(ids.orgB, ids.donoB, plano), ''));
      assert.equal(resultado, null);
      assert.equal(dono(`SELECT removido_em IS NULL FROM core.strategy_plans WHERE id = '${plano}'`), 't');
    });

    it('versões, eventos, execuções e referências do plano removido continuam, e a versão segue imutável', () => {
      const plano = novoPlano(ids.orgA, ids.cliA, ids.operador, { tipo: 'marca' });
      const versao = novaVersao(ids.orgA, ids.cliA, plano, ids.operador);
      const execucao = novaExecucao(ids.orgA, ids.cliA, plano, ids.operador);
      comoApp(ids.orgA, ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${execucao}'`);
      apagar(ids.orgA, ids.dono, plano);
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}'`), '1');
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE plan_id = '${plano}'`), '1');
      assert.match(recusa(() => dono(`UPDATE core.strategy_plan_versions SET content = '{}'::jsonb WHERE id = '${versao}'`)) ?? '', /imutável|restrict|permission/);
    });

    it('o worker não descobre execução pendente de plano removido, e a de plano ativo continua visível', () => {
      const removido = novoPlano(ids.orgA, ids.cliA, ids.operador, { tipo: 'marca' });
      const ativo = novoPlano(ids.orgA, ids.cliA2, ids.operador, { tipo: 'marca' });
      const execucaoRemovida = novaExecucao(ids.orgA, ids.cliA, removido, ids.operador);
      const execucaoAtiva = novaExecucao(ids.orgA, ids.cliA2, ativo, ids.operador);
      apagar(ids.orgA, ids.dono, removido);
      const pendentes = (id) => comoWorker(ids.orgA, `SELECT count(*) FROM core.strategy_runs_pendentes(50) WHERE id = '${id}'`);
      assert.equal(pendentes(execucaoRemovida), '0');
      assert.equal(pendentes(execucaoAtiva), '1');
    });

    it('a redação LGPD continua funcionando num plano já removido', () => {
      const plano = comoApp(
        ids.orgA,
        ids.operador,
        `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key, plataformas, whatsapp, foco)
         VALUES ('${ids.orgA}', '${ids.cliA}', 'aquisicao', ARRAY['meta'], '+5511912345678', '{"tipo":"marca"}'::jsonb) RETURNING id`,
      );
      const versao = novaVersao(ids.orgA, ids.cliA, plano, ids.operador);
      apagar(ids.orgA, ids.dono, plano);
      comoWorker(ids.orgA, `SELECT core.redigir_plano('${versao}', 'pedido do titular')`);
      assert.equal(dono(`SELECT coalesce(whatsapp, 'nulo') FROM core.strategy_plans WHERE id = '${plano}'`), 'nulo');
      assert.equal(dono(`SELECT foco->>'tipo' FROM core.strategy_plans WHERE id = '${plano}'`), 'marca');
      assert.equal(dono(`SELECT removido_em IS NOT NULL FROM core.strategy_plans WHERE id = '${plano}'`), 't');
    });
  });
});
