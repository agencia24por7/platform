import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agruparPorTabela,
  colunasDoStagingScd2,
  dividirEmLotes,
  sqlHashDosAtributos,
  sqlInsercaoPorUnnest,
  sqlMergeFato,
  sqlScd2,
  tiposDoStagingScd2,
} from './sqlDaGravacao.ts';

const normalizar = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('agrupamento por _tabela', () => {
  it('linha sem _tabela vai para padrao', () => {
    const resultado = agruparPorTabela([{ a: 1 }, { a: 2 }], ['padrao']);
    assert.ok(resultado.ok);
    assert.deepEqual([...resultado.grupos.keys()], ['padrao']);
    assert.equal(resultado.grupos.get('padrao')!.length, 2);
  });

  it('separa por tabela, remove _tabela e preserva a soma das linhas', () => {
    const linhas = [{ _tabela: 'campanhas', id: 'c1' }, { id: 'x' }, { _tabela: 'campanhas', id: 'c2' }, { _tabela: null, id: 'y' }];
    const resultado = agruparPorTabela(linhas, ['padrao', 'campanhas']);
    assert.ok(resultado.ok);
    assert.deepEqual(resultado.grupos.get('campanhas'), [{ id: 'c1' }, { id: 'c2' }]);
    assert.deepEqual(resultado.grupos.get('padrao'), [{ id: 'x' }, { id: 'y' }]);
    const total = [...resultado.grupos.values()].reduce((soma, grupo) => soma + grupo.length, 0);
    assert.equal(total, linhas.length);
  });

  it('tabela desconhecida falha com o nome', () => {
    const resultado = agruparPorTabela([{ id: 'x' }, { _tabela: 'anuncios', id: 'a' }], ['padrao']);
    assert.deepEqual(resultado, { ok: false, motivo: 'tabela_desconhecida:anuncios' });
  });

  it('padrao ausente do registro também falha', () => {
    const resultado = agruparPorTabela([{ id: 'x' }], ['campanhas']);
    assert.deepEqual(resultado, { ok: false, motivo: 'tabela_desconhecida:padrao' });
  });

  it('_tabela que não é string falha', () => {
    assert.deepEqual(agruparPorTabela([{ _tabela: 3 }], ['padrao']), { ok: false, motivo: 'tabela_invalida' });
  });

  it('lista vazia não tem grupos', () => {
    const resultado = agruparPorTabela([], ['padrao']);
    assert.ok(resultado.ok);
    assert.equal(resultado.grupos.size, 0);
  });
});

describe('SQL de fato', () => {
  it('insere do UNNEST nas colunas declaradas', () => {
    assert.equal(normalizar(sqlInsercaoPorUnnest('`p.d.stg`', ['a', 'b'])), 'INSERT INTO `p.d.stg` (a, b) SELECT a, b FROM UNNEST(@linhas)');
  });

  it('MERGE deduplica pela chave e atualiza só o que não é chave', () => {
    const sql = normalizar(sqlMergeFato('`p.d.fato`', '`p.d.stg`', { chave: ['organization_id', 'k'], colunas: ['organization_id', 'k', 'v', 'inserido_em'] }));
    assert.match(sql, /MERGE `p\.d\.fato` AS alvo/);
    assert.match(sql, /WHERE execucao_id = @execucaoId AND inserido_em = @inseridoEm QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY organization_id, k ORDER BY inserido_em DESC\) = 1/);
    assert.match(sql, /ON alvo\.organization_id = origem\.organization_id AND alvo\.k = origem\.k/);
    assert.match(sql, /UPDATE SET v = origem\.v, inserido_em = origem\.inserido_em WHEN NOT MATCHED/);
    assert.doesNotMatch(sql, /SET organization_id/);
  });

  it('MERGE sem coluna fora da chave não gera UPDATE vazio', () => {
    const sql = normalizar(sqlMergeFato('`f`', '`s`', { chave: ['k'], colunas: ['k'] }));
    assert.doesNotMatch(sql, /WHEN MATCHED/);
  });
});

describe('SQL de dimensão SCD2', () => {
  const cfg = { chave: ['organization_id', 'campanha_id'], atributos: ['nome', 'status'] };

  it('staging tem chave, atributos e as colunas de controle', () => {
    assert.deepEqual(colunasDoStagingScd2(cfg), ['organization_id', 'campanha_id', 'nome', 'status', 'execucao_id', 'inserido_em']);
    assert.deepEqual(tiposDoStagingScd2({ ...cfg, tipos: { organization_id: 'STRING', campanha_id: 'STRING', nome: 'STRING', status: 'STRING' } }), {
      organization_id: 'STRING', campanha_id: 'STRING', nome: 'STRING', status: 'STRING', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    });
  });

  it('coluna sem tipo declarado é erro de configuração', () => {
    assert.throws(() => tiposDoStagingScd2({ ...cfg, tipos: { organization_id: 'STRING' } }), /scd2_sem_tipo:campanha_id,nome,status/);
  });

  it('hash cobre só os atributos, em ordem fixa', () => {
    assert.equal(sqlHashDosAtributos(['nome', 'status']), 'TO_HEX(SHA256(TO_JSON_STRING(STRUCT(nome AS nome, status AS status))))');
  });

  it('fecha a versão aberta só quando o hash muda e abre versão nova só sem versão aberta', () => {
    const sql = normalizar(sqlScd2('`p.d.dim`', '`p.d.stg`', cfg));
    assert.match(sql, /^BEGIN TRANSACTION;/);
    assert.match(sql, /COMMIT TRANSACTION;$/);
    assert.match(sql, /UPDATE `p\.d\.dim` AS d SET valido_ate = @agora, atual = FALSE/);
    assert.match(sql, /WHERE d\.atual AND d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id AND d\.hash_versao != o\.hash_versao;/);
    assert.match(sql, /INSERT INTO `p\.d\.dim` \(organization_id, campanha_id, nome, status, valido_de, valido_ate, atual, hash_versao, execucao_id, carregado_em\)/);
    assert.match(sql, /TIMESTAMP '9999-12-31 00:00:00\+00', TRUE, o\.hash_versao, @execucaoId, @agora/);
    assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM `p\.d\.dim` d WHERE d\.atual AND d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id\);/);
  });

  it('primeira versão da chave vale desde 1970; as seguintes desde agora', () => {
    const sql = normalizar(sqlScd2('`dim`', '`stg`', cfg));
    assert.match(sql, /IF\(EXISTS \(SELECT 1 FROM `dim` d WHERE d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id\), @agora, TIMESTAMP '1970-01-01 00:00:00\+00'\)/);
  });

  it('origem deduplica a staging da execução pela chave', () => {
    const sql = normalizar(sqlScd2('`dim`', '`stg`', cfg));
    const origens = sql.match(/FROM `stg` WHERE execucao_id = @execucaoId AND inserido_em = @inseridoEm QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY organization_id, campanha_id ORDER BY inserido_em DESC\) = 1/g);
    assert.equal(origens?.length, 2);
  });
});

describe('lotes da inserção', () => {
  it('corta por número de linhas', () => {
    const lotes = dividirEmLotes([1, 2, 3, 4, 5], { linhas: 2, bytes: 1_000 });
    assert.deepEqual(lotes, [[1, 2], [3, 4], [5]]);
  });

  it('corta por bytes serializados e nunca deixa lote vazio', () => {
    const linhas = [{ v: 'a'.repeat(40) }, { v: 'b'.repeat(40) }, { v: 'c'.repeat(200) }, { v: 'd' }];
    const lotes = dividirEmLotes(linhas, { linhas: 100, bytes: 100 });
    assert.deepEqual(lotes.map((lote) => lote.length), [2, 1, 1]);
  });

  it('lista vazia não gera lote', () => {
    assert.deepEqual(dividirEmLotes([], { linhas: 10, bytes: 10 }), []);
  });

  it('padrão respeita 5.000 linhas por INSERT', () => {
    const lotes = dividirEmLotes(Array.from({ length: 12_001 }, (_, indice) => ({ indice })));
    assert.deepEqual(lotes.map((lote) => lote.length), [5_000, 5_000, 2_001]);
  });
});
