import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const { CONSULTAS_DO_INVENTARIO, consultarInventario, lerJanelas, montarInventario } = await import('./inventarioSql.ts');
const { sqlDaMedicao, sqlDoMergeDaCobertura } = await import('./sqlDaCobertura.ts');
const { objetosDeMedicao } = await import('./provedores/dados.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const CLI = '22222222-2222-4222-8222-222222222222';

describe('inventário a partir das linhas do Postgres', () => {
  it('lê janelas, ignora lixo e ordena', () => {
    assert.deepEqual(lerJanelas(['2026-02-01|2026-02-03', 'x|y', '2026-01-01|2026-01-05']), [
      { de: '2026-01-01', ate: '2026-01-05' },
      { de: '2026-02-01', ate: '2026-02-03' },
    ]);
  });

  it('monta o inventário e filtra chaves estranhas das contagens', () => {
    const inventario = montarInventario({
      clientes: [{ id: CLI, organization_id: ORG, name: 'C', parent_client_id: null, status: 'active', business_model: 'leads', segment: null }],
      conexoes: [],
      fontes: [{
        fonte_tipo: 'ad_account', id: 'f', platform: 'meta', external_id: 'act_1', nome: 'n', estado: 'linked', vinculada: true,
        coleta_habilitada: true, connection_id: 'c', moeda: 'BRL', fuso: null,
      }],
      coletas: [{
        fonte_id: 'f', janelas_ok: ['2026-01-01|2026-01-02'], ultima_ok_em: null, ultima_tentativa_em: null, ultimo_status: 'success',
        parciais_recentes: 2, pausada_ate: null, falhas: { limite_de_uso: 3, 'Chave Ruim': 1 }, avisos: null, faltantes: {},
      }],
      cobertura: [{ tabela: 'fato_ads_diario', desde: '2026-01-01', ate: '2026-01-02', linhas: '42', dias_com_dado: 2, medido_em: new Date() }],
    });
    assert.ok(inventario);
    assert.deepEqual(inventario.coletas[0]!.falhasRecentes, { limite_de_uso: 3 });
    assert.equal(inventario.cobertura[0]!.linhas, 42);
    assert.equal(montarInventario({ clientes: [], conexoes: [], fontes: [], coletas: [], cobertura: [] }), null);
  });
});

describe('consultas do inventário', () => {
  function executorFalso(respostas: (sql: string) => unknown[]) {
    const consultas: string[] = [];
    const tx = (partes: TemplateStringsArray, ...valores: string[]) => {
      const sql = partes.join('?');
      consultas.push(sql);
      assert.ok(valores.every((v) => v === CLI || v === ORG), 'só parâmetros do próprio cliente e organização');
      return Promise.resolve(respostas(sql));
    };
    return { tx, consultas };
  }

  it('faz um número fixo de consultas, independente do tamanho do cliente', async () => {
    const { tx, consultas } = executorFalso((sql) => (sql.includes('FROM core.clients') ? [{ id: CLI }] : Array.from({ length: 500 }, () => ({}))));
    await consultarInventario(tx, { organizationId: ORG, clienteId: CLI });
    assert.equal(consultas.length, CONSULTAS_DO_INVENTARIO);
    assert.ok(consultas.every((sql) => !/credential_ref|account_email|webhook_token/.test(sql)), 'nunca lê segredo nem e-mail da conta');
  });

  it('cliente invisível (excluído ou fora do escopo) para na primeira consulta', async () => {
    const { tx, consultas } = executorFalso(() => []);
    const linhas = await consultarInventario(tx, { organizationId: ORG, clienteId: CLI });
    assert.equal(consultas.length, 1);
    assert.equal(montarInventario(linhas), null);
  });
});

describe('SQL da medição de cobertura (gov_cobertura_cliente)', () => {
  const destino = { projeto: 'tria-platform', conjuntoDeDados: 'tria_dw' };

  it('uma consulta por cliente, filtrada pelo dono atual e pela partição', () => {
    const objetos = objetosDeMedicao(['meta']);
    const sql = sqlDaMedicao(destino, objetos);
    assert.equal(sql.split('UNION ALL').length, objetos.length);
    assert.match(sql, /`tria-platform\.tria_dw\.vw_ads_diario` WHERE cliente_atual_id = @cliente_id AND data_dia BETWEEN @desde AND @ate/);
    assert.match(sql, /COUNTIF\(atual\)/);
    for (const parte of sql.split('UNION ALL')) assert.match(parte, /cliente_atual_id = @cliente_id/);
  });

  it('recusa identificador perigoso', () => {
    assert.throws(() => sqlDaMedicao(destino, [{ tabela: 'x', view: 'vw_x`; DROP', colunaDeData: 'data_dia', dimensao: false }]));
    assert.throws(() => sqlDaMedicao({ projeto: 'P;', conjuntoDeDados: 'd' }, objetosDeMedicao(['meta'])));
    assert.throws(() => sqlDaMedicao(destino, []));
  });

  it('MERGE idempotente pela chave organização, cliente e tabela', () => {
    const sql = sqlDoMergeDaCobertura(destino);
    assert.match(sql, /^MERGE `tria-platform\.tria_dw\.gov_cobertura_cliente` t/);
    assert.match(sql, /ON t\.organization_id = s\.organization_id AND t\.client_id = s\.client_id AND t\.tabela = s\.tabela/);
  });

  it('mede só tabelas com view com dono', () => {
    const tabelas = objetosDeMedicao(['gtm', 'meta']).map((o) => o.tabela);
    assert.ok(!tabelas.includes('gov_snapshot_fontes'));
    assert.ok(tabelas.includes('dim_gtm_tag_scd2'));
  });
});
