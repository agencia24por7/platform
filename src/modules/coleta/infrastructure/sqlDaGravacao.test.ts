import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agruparPorTabela,
  colunaDeDataDaChave,
  colunasDoStagingScd2,
  dividirEmLotes,
  sqlHashDosAtributos,
  sqlInsercaoPorUnnest,
  separarPorChaveValida,
  sqlMergeFato,
  sqlMergeSnapshot,
  sqlScd2,
  tiposDoStagingScd2,
} from './sqlDaGravacao.ts';
import '../../../shared/testing/registrarAlias.mjs';

const { TABELAS_YOUTUBE } = await import('./tabelas/youtube.ts');

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

  it('MERGE preserva o valor do alvo quando a métrica opcional chega nula', () => {
    const sql = normalizar(sqlMergeFato('`f`', '`s`', { chave: ['k'], colunas: ['k', 'v', 'receita'], preservarSeNulo: ['receita'] }));
    assert.match(sql, /UPDATE SET v = origem\.v, receita = COALESCE\(origem\.receita, alvo\.receita\) WHEN NOT MATCHED/);
  });

  it('MERGE sem coluna fora da chave não gera UPDATE vazio', () => {
    const sql = normalizar(sqlMergeFato('`f`', '`s`', { chave: ['k'], colunas: ['k'] }));
    assert.doesNotMatch(sql, /WHEN MATCHED/);
  });
});

describe('MERGE de fato com filtro constante no alvo (poda de partição)', () => {
  const cfg = {
    chave: ['organization_id', 'property_id', 'canal', 'data_dia'],
    colunas: ['organization_id', 'property_id', 'canal', 'data_dia', 'sessoes', 'execucao_id', 'inserido_em'],
    tipos: { organization_id: 'STRING', property_id: 'STRING', canal: 'STRING', data_dia: 'DATE', sessoes: 'INT64' },
  };

  it('a coluna de data é a única DATE/TIMESTAMP da chave', () => {
    assert.equal(colunaDeDataDaChave(cfg), 'data_dia');
    assert.equal(colunaDeDataDaChave({ chave: ['organization_id', 'deal_id', 'entrou_em'], tipos: { entrou_em: 'TIMESTAMP' } }), 'entrou_em');
    assert.equal(colunaDeDataDaChave({ chave: ['k'], tipos: { k: 'STRING' } }), null);
    assert.throws(() => colunaDeDataDaChave({ chave: ['a', 'b'], tipos: { a: 'DATE', b: 'DATE' } }), /fato_com_varias_datas_na_chave/);
  });

  it('limites de data vêm do próprio lote na staging e filtram o alvo junto com a organização', () => {
    const sql = normalizar(sqlMergeFato('`p.d.fato`', '`p.d.stg`', cfg));
    assert.match(sql, /^DECLARE data_minima DATE DEFAULT \(SELECT MIN\(data_dia\) FROM `p\.d\.stg` WHERE execucao_id = @execucaoId AND inserido_em = @inseridoEm\);/);
    assert.match(sql, /DECLARE data_maxima DATE DEFAULT \(SELECT MAX\(data_dia\) FROM `p\.d\.stg` WHERE execucao_id = @execucaoId AND inserido_em = @inseridoEm\);/);
    assert.match(sql, /AND alvo\.data_dia = origem\.data_dia AND alvo\.organization_id = @organizationId AND alvo\.data_dia BETWEEN data_minima AND data_maxima WHEN MATCHED/);
    assert.doesNotMatch(sql, /NOT MATCHED BY SOURCE/);
  });

  it('chave TIMESTAMP declara limites TIMESTAMP', () => {
    const sql = normalizar(sqlMergeFato('`f`', '`s`', {
      chave: ['organization_id', 'deal_id', 'entrou_em'],
      colunas: ['organization_id', 'deal_id', 'entrou_em', 'data_dia', 'inserido_em'],
      tipos: { organization_id: 'STRING', deal_id: 'STRING', entrou_em: 'TIMESTAMP', data_dia: 'DATE' },
    }));
    assert.match(sql, /DECLARE data_minima TIMESTAMP DEFAULT \(SELECT MIN\(entrou_em\)/);
    assert.match(sql, /alvo\.entrou_em BETWEEN data_minima AND data_maxima/);
  });
});

describe('snapshot idempotente', () => {
  it('MERGE por organização + fonte + execução, só insere o que falta, na janela recente', () => {
    const sql = normalizar(sqlMergeSnapshot('`p.d.gov`', {
      chave: ['organization_id', 'fonte_id', 'execucao_id'], colunas: ['organization_id', 'fonte_id', 'nome', 'visto_em', 'execucao_id'], colunaMomento: 'visto_em',
    }));
    assert.match(sql, /USING \( SELECT organization_id, fonte_id, nome, visto_em, execucao_id FROM UNNEST\(@linhas\) WHERE TRUE QUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY organization_id, fonte_id, execucao_id ORDER BY visto_em DESC\) = 1 \)/);
    assert.match(sql, /ON alvo\.organization_id = origem\.organization_id AND alvo\.fonte_id = origem\.fonte_id AND alvo\.execucao_id = origem\.execucao_id AND alvo\.organization_id = @organizationId AND alvo\.visto_em >= TIMESTAMP_SUB\(CURRENT_TIMESTAMP\(\), INTERVAL 7 DAY\)/);
    assert.match(sql, /WHEN NOT MATCHED THEN INSERT/);
    assert.doesNotMatch(sql, /WHEN MATCHED/);
  });
});

describe('linhas com chave inválida', () => {
  const chave = ['organization_id', 'ad_account_id', 'ad_id', 'data_dia'];
  const tipos = { organization_id: 'STRING', ad_account_id: 'STRING', ad_id: 'STRING', data_dia: 'DATE' };
  const boa = { organization_id: 'o', ad_account_id: 'a', ad_id: '1', data_dia: '2026-11-01' };

  it('descarta chave nula, data vazia ou impossível e conta as descartadas', () => {
    const linhas = [
      boa,
      { ...boa, ad_id: null },
      { ...boa, data_dia: '' },
      { ...boa, data_dia: '2026-02-30' },
      { ...boa, data_dia: undefined },
      { ...boa, ad_id: '' },
    ];
    const { validas, descartadas } = separarPorChaveValida(linhas, chave, tipos);
    assert.deepEqual(validas, [boa, { ...boa, ad_id: '' }]);
    assert.equal(descartadas, 4);
    assert.equal(validas.length + descartadas, linhas.length);
  });

  it('valida TIMESTAMP, INT64 e BOOL', () => {
    const tiposMistos = { m: 'TIMESTAMP', n: 'INT64', b: 'BOOL' };
    const { validas } = separarPorChaveValida(
      [
        { m: '2026-11-01T10:00:00Z', n: '12', b: true },
        { m: 'ontem', n: 1, b: false },
        { m: new Date(0), n: 1.5, b: false },
        { m: new Date(0), n: 2, b: 'sim' },
      ],
      ['m', 'n', 'b'],
      tiposMistos,
    );
    assert.equal(validas.length, 1);
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
    assert.match(sql, /WHERE d\.atual AND d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id AND d\.organization_id = @organizationId AND d\.hash_versao != o\.hash_versao;/);
    assert.match(sql, /INSERT INTO `p\.d\.dim` \(organization_id, campanha_id, nome, status, valido_de, valido_ate, atual, hash_versao, execucao_id, carregado_em\)/);
    assert.match(sql, /TIMESTAMP '9999-12-31 00:00:00\+00', TRUE, o\.hash_versao, @execucaoId, @agora/);
    assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM `p\.d\.dim` d WHERE d\.atual AND d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id AND d\.organization_id = @organizationId\);/);
  });

  it('filtra a organização do lote no alvo (UPDATE e os dois EXISTS)', () => {
    const sql = normalizar(sqlScd2('`dim`', '`stg`', cfg));
    assert.equal(sql.match(/d\.organization_id = @organizationId/g)?.length, 3);
  });

  it('primeira versão da chave vale desde 1970; as seguintes desde agora', () => {
    const sql = normalizar(sqlScd2('`dim`', '`stg`', cfg));
    assert.match(sql, /IF\(EXISTS \(SELECT 1 FROM `dim` d WHERE d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id AND d\.organization_id = @organizationId\), @agora, TIMESTAMP '1970-01-01 00:00:00\+00'\)/);
  });

  it('sem renovaCarregadoEm, versão inalterada não é tocada', () => {
    assert.doesNotMatch(normalizar(sqlScd2('`dim`', '`stg`', cfg)), /SET carregado_em/);
  });

  it('com renovaCarregadoEm, a versão aberta inalterada ganha carregado_em = agora (prazo de 30 dias do YouTube)', () => {
    const sql = normalizar(sqlScd2('`dim`', '`stg`', { ...cfg, renovaCarregadoEm: true }));
    assert.match(
      sql,
      /UPDATE `dim` AS d SET carregado_em = @agora FROM \(.+\) AS o WHERE d\.atual AND d\.organization_id = o\.organization_id AND d\.campanha_id = o\.campanha_id AND d\.organization_id = @organizationId AND d\.hash_versao = o\.hash_versao; COMMIT TRANSACTION;$/,
    );
    assert.equal(sql.match(/d\.organization_id = @organizationId/g)?.length, 4);
  });

  it('as dimensões do YouTube renovam carregado_em; as outras não', () => {
    const youtube = Object.values(TABELAS_YOUTUBE).filter((tabela) => tabela.tipo === 'scd2');
    assert.ok(youtube.length >= 2);
    assert.ok(youtube.every((tabela) => tabela.tipo === 'scd2' && tabela.renovaCarregadoEm === true));
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
