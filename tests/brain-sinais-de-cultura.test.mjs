import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';
import { psqlComoApp, psqlComoDono as dono, psqlComoWorker } from './apoio/psql.mjs';

const sufixo = randomBytes(4).toString('hex');
const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();
const contexto = (organizacao, clientes, usuario) =>
  `SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; SET app.user_id = '${usuario ?? ''}'; `;
const comoApp = (organizacao, clientes, usuario, sql) => ultimaLinha(psqlComoApp(contexto(organizacao, clientes, usuario) + sql));
const comoWorker = (organizacao, clientes, sql) => ultimaLinha(psqlComoWorker(contexto(organizacao, clientes, '') + sql));
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
    const existe = dono("SELECT to_regclass('core.client_culture_signals') IS NOT NULL");
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0152 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Brain: sinais de cultura (migração 0152)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const sql = (valor) => `'${String(valor).replace(/'/g, "''")}'`;

describe('Brain: sinais de cultura (migração 0152)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };

  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Cultura ${nome} ${sufixo}', 'cultura-${nome}-${sufixo}', 'agency') RETURNING id`).split('\n')[0];
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`).split('\n')[0];
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('cultura-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`).split('\n')[0];
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) => dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);

  const endereco = () => `https://fonte-${randomBytes(4).toString('hex')}.com.br/post`;
  const dia = (deslocamento) => dono(`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date + ${deslocamento}`).split('\n')[0];

  const colunas = '(organization_id, client_id, kind, titulo, resumo, fonte_url, fonte_nome, plataforma, observado_em, valido_ate, nota_evidencia, origem)';
  const valores = (extra = {}) => {
    const v = {
      org: ids.orgA, cli: ids.cliA, kind: 'tendencia', titulo: 'Corrida de rua em alta', resumo: 'Cresce a conversa sobre corrida entre iniciantes.',
      url: endereco(), fonte: 'Google Trends', plataforma: null, observado: dia(-2), valido: dia(28), nota: 'B', origem: 'manual', ...extra,
    };
    return `('${v.org}', '${v.cli}', ${sql(v.kind)}, ${sql(v.titulo)}, ${sql(v.resumo)}, ${sql(v.url)}, ${sql(v.fonte)}, ${v.plataforma === null ? 'NULL' : sql(v.plataforma)}, ${v.observado === 'NULL' ? 'NULL' : `'${v.observado}'`}, ${v.valido === 'NULL' ? 'NULL' : `'${v.valido}'`}, ${sql(v.nota)}, ${sql(v.origem)})`;
  };
  const novo = (quem, extra = {}, escopo = {}) =>
    comoApp(escopo.sessao ?? ids.orgA, escopo.clientes ?? '*', quem, `INSERT INTO core.client_culture_signals ${colunas} VALUES ${valores(extra)} RETURNING id`);
  const doColetor = (extra = {}, escopo = {}) =>
    comoWorker(escopo.sessao ?? ids.orgA, '*', `INSERT INTO core.client_culture_signals ${colunas} VALUES ${valores({ origem: 'coletor', ...extra })} RETURNING id`);

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

  it('owner, admin e operator gravam; viewer lê mas não grava; sem usuário não grava', () => {
    for (const quem of [ids.dono, ids.admin, ids.operador]) assert.ok(novo(quem));
    assert.match(recusa(() => novo(ids.leitor)) ?? '', /exige papel owner, admin ou operator/);
    assert.match(recusa(() => novo('')) ?? '', /exige|permission denied|row-level/);
    assert.ok(Number(comoApp(ids.orgA, '*', ids.leitor, `SELECT count(*) FROM core.client_culture_signals WHERE client_id = '${ids.cliA}'`)) >= 3);
  });

  it('o gatilho fixa o autor da sessão e não aceita origem coletor vinda do app', () => {
    const id = novo(ids.operador);
    assert.equal(dono(`SELECT criado_por = '${ids.operador}' AND origem = 'manual' FROM core.client_culture_signals WHERE id = '${id}'`), 't');
    assert.match(recusa(() => novo(ids.dono, { origem: 'coletor' })) ?? '', /só grava sinal de cultura com origem manual/);
    const forjado = comoApp(ids.orgA, '*', ids.dono, `INSERT INTO core.client_culture_signals ${colunas.replace(')', ', criado_por)')} VALUES ${valores().replace(/\)$/, `, '${ids.leitor}')`)} RETURNING id`);
    assert.equal(dono(`SELECT criado_por = '${ids.dono}' FROM core.client_culture_signals WHERE id = '${forjado}'`), 't');
  });

  it('o worker grava só com origem coletor e sem autor', () => {
    const id = doColetor();
    assert.equal(dono(`SELECT origem = 'coletor' AND criado_por IS NULL FROM core.client_culture_signals WHERE id = '${id}'`), 't');
    assert.match(recusa(() => doColetor({ origem: 'manual' })) ?? '', /só grava sinal de cultura com origem coletor/);
    assert.match(
      recusa(() => comoWorker(ids.orgA, '*', `INSERT INTO core.client_culture_signals ${colunas.replace(')', ', criado_por)')} VALUES ${valores({ origem: 'coletor' }).replace(/\)$/, `, '${ids.dono}')`)}`)) ?? '',
      /sem autor/,
    );
  });

  it('worker não arquiva: arquivamento exige pessoa com papel', () => {
    const id = doColetor();
    assert.match(recusa(() => comoWorker(ids.orgA, '*', `UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${id}'`)) ?? '', /exige|permission denied|row-level/);
    assert.equal(dono(`SELECT arquivado_em IS NULL FROM core.client_culture_signals WHERE id = '${id}'`), 't');
  });

  it('isolamento: outra organização não vê, não grava e não arquiva os sinais de A', () => {
    const id = novo(ids.dono);
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `SELECT count(*) FROM core.client_culture_signals WHERE id = '${id}'`), '0');
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, 'SELECT count(*) FROM core.client_culture_signals'), '0');
    assert.match(recusa(() => novo(ids.donoB, {}, { sessao: ids.orgB })) ?? '', /row-level security|fora do contexto da sessão|exige/);
    assert.match(recusa(() => novo(ids.donoB, { org: ids.orgB }, { sessao: ids.orgB })) ?? '', /row-level security|fora do contexto da sessão|exige/);
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `WITH a AS (UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${id}' RETURNING id) SELECT count(*) FROM a`), '0');
    assert.equal(dono(`SELECT arquivado_em IS NULL FROM core.client_culture_signals WHERE id = '${id}'`), 't');
    assert.match(recusa(() => doColetor({}, { sessao: ids.orgB })) ?? '', /row-level security|fora do contexto da sessão|exige/);
  });

  it('isolamento: o cliente tem de ser da organização da sessão, mesmo com os dois ids corretos', () => {
    assert.match(recusa(() => novo(ids.dono, { org: ids.orgA, cli: ids.cliB })) ?? '', /row-level security|fora do contexto da sessão|exige/);
    assert.match(recusa(() => doColetor({ org: ids.orgB, cli: ids.cliB })) ?? '', /row-level security|fora do contexto da sessão|exige/);
  });

  it('recorte de clientes: sessão restrita a outro cliente não vê nem grava', () => {
    const id = novo(ids.dono, {}, { clientes: ids.cliA });
    assert.equal(comoApp(ids.orgA, ids.cliA2, ids.dono, `SELECT count(*) FROM core.client_culture_signals WHERE id = '${id}'`), '0');
    assert.match(recusa(() => novo(ids.dono, {}, { clientes: ids.cliA2 })) ?? '', /row-level security|fora do contexto da sessão|exige/);
  });

  describe('constraints', () => {
    const recusado = (extra, padrao) => assert.match(recusa(() => novo(ids.dono, extra)) ?? '', padrao, JSON.stringify(extra));

    it('tipo, nota e origem fora do conjunto', () => {
      recusado({ kind: 'moda' }, /violates check constraint "client_culture_signals_kind_check"/);
      recusado({ nota: 'E' }, /violates check constraint "client_culture_signals_nota_evidencia_check"/);
      assert.match(recusa(() => dono(`INSERT INTO core.client_culture_signals ${colunas} VALUES ${valores({ origem: 'robo' })}`)) ?? '', /violates check constraint "client_culture_signals_origem_check"/);
    });

    it('título e resumo: 1 a 160 e 1 a 600, sem espaço nas pontas', () => {
      recusado({ titulo: '' }, /violates check constraint "client_culture_signals_titulo_check"/);
      recusado({ titulo: 'x'.repeat(161) }, /violates check constraint "client_culture_signals_titulo_check"/);
      recusado({ titulo: ' com espaço ' }, /violates check constraint "client_culture_signals_titulo_check"/);
      recusado({ resumo: '' }, /violates check constraint "client_culture_signals_resumo_check"/);
      recusado({ resumo: 'x'.repeat(601) }, /violates check constraint "client_culture_signals_resumo_check"/);
      assert.ok(novo(ids.dono, { titulo: 'x'.repeat(160), resumo: 'y'.repeat(600) }));
    });

    it('recusa @handle, e-mail, telefone e CPF no título, no resumo e no nome da fonte', () => {
      const sujos = ['@fulana viralizou', 'o vídeo de @fulana_oficial', 'escreva maria@exemplo.com.br', 'ligue (11) 99999-8888', 'chame +55 11 99999-8888', 'cadastro 123.456.789-09', 'zap 11999998888'];
      for (const texto of sujos) {
        recusado({ titulo: texto }, /violates check constraint "client_culture_signals_titulo_check"/);
        recusado({ resumo: texto }, /violates check constraint "client_culture_signals_resumo_check"/);
        recusado({ fonte: texto }, /violates check constraint "client_culture_signals_fonte_nome_check"/);
      }
      assert.ok(novo(ids.dono, { titulo: '#corridaderua com 1.500.000 de visualizações' }));
    });

    it('URL da fonte: só https, sem credencial, até 2048', () => {
      for (const ruim of ['http://loja.com.br/', ['https://u', 'p@loja.com.br/'].join(':'), 'https:///x', 'ftp://loja.com.br/', `https://loja.com.br/${'a'.repeat(2100)}`]) {
        recusado({ url: ruim }, /violates check constraint "client_culture_signals_fonte_url_check"/);
      }
    });

    it('plataforma opcional em minúsculas', () => {
      assert.ok(novo(ids.dono, { plataforma: 'tiktok' }));
      recusado({ plataforma: 'Rede Social' }, /violates check constraint "client_culture_signals_plataforma_check"/);
    });

    it('validade obrigatória, nunca antes da observação e no máximo 90 dias depois', () => {
      recusado({ valido: 'NULL' }, /null value in column "valido_ate"/);
      recusado({ observado: 'NULL' }, /null value in column "observado_em"/);
      recusado({ observado: dia(-1), valido: dia(-2) }, /violates check constraint "client_culture_signals_validade"/);
      assert.ok(novo(ids.dono, { observado: dia(-1), valido: dia(89) }));
      recusado({ observado: dia(-1), valido: dia(90) }, /violates check constraint "client_culture_signals_validade"/);
    });

    it('observação no futuro além de amanhã é recusada pelo gatilho', () => {
      assert.ok(novo(ids.dono, { observado: dia(1), valido: dia(10) }));
      recusado({ observado: dia(3), valido: dia(10) }, /observado_em no futuro/);
    });

    it('origem coletor com autor é recusada pelo CHECK de autoria', () => {
      assert.match(recusa(() => dono(`INSERT INTO core.client_culture_signals ${colunas.replace(')', ', criado_por)')} VALUES ${valores({ origem: 'coletor' }).replace(/\)$/, `, '${ids.dono}')`)}`)) ?? '', /violates check constraint "client_culture_signals_autoria"/);
    });
  });

  describe('imutabilidade e arquivamento', () => {
    it('só se arquiva, uma vez; conteúdo não se edita; não há DELETE', () => {
      const id = novo(ids.dono);
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_culture_signals SET titulo = 'outro' WHERE id = '${id}'`)) ?? '', /permission denied/);
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_culture_signals SET valido_ate = valido_ate + 1 WHERE id = '${id}'`)) ?? '', /permission denied/);
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `DELETE FROM core.client_culture_signals WHERE id = '${id}'`)) ?? '', /permission denied/);
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.leitor, `UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${id}'`)) ?? '', /exige papel owner, admin ou operator/);
      comoApp(ids.orgA, '*', ids.operador, `UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${id}'`);
      assert.equal(dono(`SELECT arquivado_em IS NOT NULL FROM core.client_culture_signals WHERE id = '${id}'`), 't');
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${id}'`)) ?? '', /só se arquiva/);
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_culture_signals SET arquivado_em = NULL WHERE id = '${id}'`)) ?? '', /só se arquiva/);
    });

    it('apagar o usuário autor preserva o sinal e zera o autor', () => {
      const autor = usuario('autor-efemero');
      membro(ids.orgA, autor, 'operator');
      const id = novo(autor);
      dono(`DELETE FROM core.members WHERE user_id = '${autor}'`);
      dono(`DELETE FROM core.users WHERE id = '${autor}'`);
      assert.equal(dono(`SELECT criado_por IS NULL FROM core.client_culture_signals WHERE id = '${id}'`), 't');
    });
  });

  describe('idempotência e expiração', () => {
    it('único por cliente, URL sem caixa e dia observado, inclusive depois de arquivado', () => {
      const url = endereco();
      const id = doColetor({ url, observado: dia(-3) });
      assert.match(recusa(() => doColetor({ url: url.toUpperCase().replace('HTTPS', 'https'), observado: dia(-3) })) ?? '', /duplicate key value violates unique constraint "client_culture_signals_fonte_dia"/);
      comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${id}'`);
      assert.match(recusa(() => doColetor({ url, observado: dia(-3) })) ?? '', /duplicate key value violates unique constraint "client_culture_signals_fonte_dia"/);
      assert.ok(doColetor({ url, observado: dia(-4) }));
      assert.ok(doColetor({ url, observado: dia(-3), cli: ids.cliA2 }));
    });

    it('ON CONFLICT DO NOTHING sob RLS do worker devolve vazio na repetição', () => {
      const url = endereco();
      const insercao = `INSERT INTO core.client_culture_signals ${colunas} VALUES ${valores({ url, origem: 'coletor' })} ON CONFLICT (client_id, lower(fonte_url), observado_em) DO NOTHING RETURNING id`;
      assert.ok(comoWorker(ids.orgA, '*', insercao).length > 0);
      assert.equal(comoWorker(ids.orgA, '*', insercao), '');
    });

    it('sinal vencido fica no banco mas sai da leitura de vigentes; arquivado nunca volta', () => {
      const vencido = dono(`INSERT INTO core.client_culture_signals ${colunas} VALUES ${valores({ cli: ids.cliA2, observado: dia(-40), valido: dia(-10) })} RETURNING id`).split('\n')[0];
      const vigente = novo(ids.dono, { cli: ids.cliA2 });
      const arquivado = novo(ids.dono, { cli: ids.cliA2 });
      comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_culture_signals SET arquivado_em = now() WHERE id = '${arquivado}'`);
      const lidos = comoApp(
        ids.orgA, '*', ids.leitor,
        `SELECT string_agg(id::text, ',' ORDER BY id) FROM core.client_culture_signals WHERE client_id = '${ids.cliA2}' AND arquivado_em IS NULL AND valido_ate >= (now() AT TIME ZONE 'America/Sao_Paulo')::date`,
      );
      assert.ok(lidos.includes(vigente));
      assert.ok(!lidos.includes(vencido) && !lidos.includes(arquivado));
    });
  });

  it('excluir o cliente apaga os sinais em cascata', () => {
    const efemero = cliente(ids.orgA, 'cli-efemero');
    const id = novo(ids.dono, { cli: efemero });
    assert.equal(dono(`SELECT count(*) FROM core.client_culture_signals WHERE id = '${id}'`), '1');
    dono(`DELETE FROM core.clients WHERE id = '${efemero}'`);
    assert.equal(dono(`SELECT count(*) FROM core.client_culture_signals WHERE id = '${id}'`), '0');
  });

  it('o app e o worker não têm DELETE nem TRUNCATE na tabela', () => {
    assert.equal(dono("SELECT has_table_privilege('orla_app', 'core.client_culture_signals', 'DELETE') OR has_table_privilege('orla_worker', 'core.client_culture_signals', 'DELETE')"), 'f');
    assert.equal(dono("SELECT has_table_privilege('orla_app', 'core.client_culture_signals', 'UPDATE')"), 'f');
    assert.equal(dono("SELECT has_column_privilege('orla_app', 'core.client_culture_signals', 'arquivado_em', 'UPDATE')"), 't');
    assert.equal(dono("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'core.client_culture_signals'::regclass"), 't');
  });
});
