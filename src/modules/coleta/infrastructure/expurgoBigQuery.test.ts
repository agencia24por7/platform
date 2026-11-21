import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  executarPassos,
  literalBigQuery,
  STATUS_DE_DONO_DESCONHECIDO,
  passosDaStaging,
  passosPorClientId,
  planoDeConformidadeDoYoutube,
  planoDoExpurgo,
  planoDoExpurgoDaFonte,
  sqlExpurgoDaStaging,
  sqlExpurgoDasSobras,
  sqlExpurgoPorPosse,
  sqlVersoesDoCliente,
  validarEntrada,
  validarFontes,
  type EntradaDoManifesto,
  type Passo,
} from '../../../../scripts/bq/expurgo.mjs';
import { STATUS_DE_DONO_DESCONHECIDO as STATUS_GRAVADO_PELA_SINCRONIZACAO } from '../domain/dimensoes.ts';

const destino = { projeto: 'p', dataset: 'd' };
const normalizar = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const ORG = '11111111-1111-4111-8111-111111111111';

const diario: EntradaDoManifesto = { tabela: 'fato_ga4_diario', chave: 'property_id', plataforma: 'ga4', data: 'data_dia' };
const compartilhado: EntradaDoManifesto = {
  tabela: 'fato_ads_diario', chave: 'ad_account_id', plataforma: 'meta', colunaPlataforma: 'platform', data: 'data_dia',
};
const entidade: EntradaDoManifesto = { tabela: 'dim_gtm_tag_scd2', chave: 'conteiner_id', plataforma: 'gtm', todoPeriodo: true };

describe('expurgo no BigQuery: período de posse', () => {
  it('fato com data apaga só o período em que a fonte foi do cliente, às 00:00 de São Paulo', () => {
    const sql = normalizar(sqlExpurgoPorPosse(diario, destino));
    assert.match(sql, /^DELETE FROM `p\.d\.fato_ga4_diario` f WHERE EXISTS/);
    assert.match(sql, /d\.client_id = @id AND d\.organization_id = f\.organization_id AND d\.platform = 'ga4' AND d\.external_id = f\.property_id/);
    assert.match(sql, /TIMESTAMP\(f\.data_dia, 'America\/Sao_Paulo'\) >= d\.valido_de AND TIMESTAMP\(f\.data_dia, 'America\/Sao_Paulo'\) < d\.valido_ate/);
  });

  it('tabela compartilhada filtra a plataforma', () => {
    assert.match(normalizar(sqlExpurgoPorPosse(compartilhado, destino)), /\) AND f\.platform = 'meta'$/);
  });

  it('todoPeriodo apaga a fonte só se ela nunca foi de outro cliente', () => {
    const sql = normalizar(sqlExpurgoPorPosse(entidade, destino));
    assert.match(sql, /NOT EXISTS \( SELECT 1 FROM `p\.d\.dim_fonte_scd2` o WHERE \(\(o\.client_id IS NOT NULL AND o\.client_id != @id\) OR o\.status = 'desconhecido'\)/);
    assert.doesNotMatch(sql, /valido_de/);
  });
});

describe('expurgo no BigQuery: sobras das fontes só do cliente', () => {
  const fontes = [
    { organizationId: ORG, platform: 'ga4', externalId: 'properties/1' },
    { organizationId: ORG, platform: 'meta', externalId: "act_1'x" },
  ];

  it('apaga por organização + chave da fonte, só nas fontes da plataforma do fato, se nunca foram de outro cliente', () => {
    const sql = normalizar(sqlExpurgoDasSobras(diario, destino, fontes)!);
    assert.match(sql, new RegExp(`CONCAT\\(f\\.organization_id, '\\|', CAST\\(f\\.property_id AS STRING\\)\\) IN UNNEST\\(\\['${ORG}\\|properties/1'\\]\\)`));
    assert.match(sql, /AND NOT EXISTS \( SELECT 1 FROM `p\.d\.dim_fonte_scd2` o WHERE \(\(o\.client_id IS NOT NULL AND o\.client_id != @id\) OR o\.status = 'desconhecido'\) AND o\.organization_id = f\.organization_id AND o\.platform = 'ga4'/);
    assert.doesNotMatch(sql, /act_1/);
  });

  it('escapa aspas e recusa caractere de controle', () => {
    assert.match(sqlExpurgoDasSobras(compartilhado, destino, fontes)!, /'11111111-1111-4111-8111-111111111111\|act_1\\'x'/);
    assert.throws(() => literalBigQuery('a\nb'), /literal/);
    assert.throws(() => validarFontes([{ organizationId: 'nao-uuid', platform: 'ga4', externalId: 'x' }]), /fonte inválida/);
  });

  it('sem fonte daquela plataforma não gera passo', () => {
    assert.equal(sqlExpurgoDasSobras(entidade, destino, fontes), null);
  });
});

describe('plano e retomada do expurgo', () => {
  const fontes = [{ organizationId: ORG, platform: 'ga4', externalId: 'properties/1' }];
  const plano = planoDoExpurgo({
    manifesto: [diario, entidade],
    tabelasComCliente: ['dim_fonte_scd2', 'dim_cliente_scd2', 'qc_execucoes'],
    fontes,
    destino,
  });

  it('ordem: posse, depois sobras, depois client_id, com dim_fonte_scd2 por último (as anteriores dependem dela)', () => {
    assert.deepEqual(plano.map((passo) => passo.nome), [
      'fato_ga4_diario[ga4] (período de posse)',
      'dim_gtm_tag_scd2[gtm] (período de posse)',
      'fato_ga4_diario[ga4] (fontes só do cliente)',
      'dim_cliente_scd2 (client_id)',
      'qc_execucoes (client_id)',
      'dim_fonte_scd2 (client_id)',
    ]);
    assert.equal(plano.at(-1)!.sql, 'DELETE FROM `p.d.dim_fonte_scd2` WHERE CAST(client_id AS STRING) = @id');
  });

  it('para no primeiro erro e devolve o passo que falhou e os pendentes', () => {
    const feitos: string[] = [];
    const resultado = executarPassos(plano, (passo: Passo) => {
      if (passo.nome.startsWith('fato_ga4_diario[ga4] (fontes')) throw new Error('timeout');
      feitos.push(passo.nome);
    });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.falhou, 'fato_ga4_diario[ga4] (fontes só do cliente)');
    assert.equal(resultado.pendentes.length, 4);
    assert.equal(feitos.length, 2);
  });

  it('só client_id quando o Postgres já foi expurgado', () => {
    assert.deepEqual(passosPorClientId(['dim_fonte_scd2', 'x'], destino).map((passo) => passo.nome), ['x (client_id)', 'dim_fonte_scd2 (client_id)']);
  });

  it('conferência de versões do cliente em dim_fonte_scd2 antes de apagar', () => {
    assert.equal(sqlVersoesDoCliente(destino), 'SELECT COUNT(*) AS versoes FROM `p.d.dim_fonte_scd2` WHERE client_id = @id');
  });

  it('manifesto exige exatamente um recorte de período', () => {
    assert.equal(validarEntrada({ ...diario }), true);
    assert.equal(validarEntrada({ ...diario, todoPeriodo: true }), false);
    assert.equal(validarEntrada({ tabela: 'x', chave: 'y', plataforma: 'z' }), false);
  });
});

describe('expurgo no BigQuery: dono desconhecido e homônimos', () => {
  it('o status de dono desconhecido é o mesmo que a sincronização de dimensões grava', () => {
    assert.equal(STATUS_DE_DONO_DESCONHECIDO, STATUS_GRAVADO_PELA_SINCRONIZACAO);
  });

  it('período de dono desconhecido nunca é apagado como se fosse do cliente', () => {
    const porPosse = normalizar(sqlExpurgoPorPosse(diario, destino));
    assert.match(porPosse, /d\.client_id = @id/);
    assert.doesNotMatch(porPosse, /client_id IS NULL/);
  });

  it('nenhum passo do expurgo de cliente identifica o cliente pelo nome', () => {
    const plano = planoDoExpurgo({
      manifesto: [diario, entidade, { ...diario, staging: 'stg_ga4_diario' }],
      tabelasComCliente: ['dim_fonte_scd2'],
      fontes: [{ organizationId: ORG, platform: 'ga4', externalId: 'properties/1' }],
      destino,
    });
    for (const passo of plano) {
      assert.doesNotMatch(passo.sql, /\bnome\b|\bname\b/, passo.nome);
      assert.ok(passo.sql.includes('@id') || passo.sql.includes(`'${ORG}|properties/1'`), passo.nome);
    }
  });
});

describe('expurgo no BigQuery: staging', () => {
  const comStaging: EntradaDoManifesto = { ...compartilhado, staging: 'stg_ads_diario' };
  const fontes = [
    { organizationId: ORG, platform: 'meta', externalId: 'act_1' },
    { organizationId: ORG, platform: 'google', externalId: '123-456-7890' },
  ];

  it('apaga a staging por organização + chave da fonte e filtra a plataforma da tabela compartilhada', () => {
    const sql = normalizar(sqlExpurgoDaStaging(comStaging, destino, fontes)!);
    assert.equal(
      sql,
      `DELETE FROM \`p.d.stg_ads_diario\` s WHERE CONCAT(s.organization_id, '|', CAST(s.ad_account_id AS STRING)) IN UNNEST(['${ORG}|act_1']) AND s.platform = 'meta'`,
    );
  });

  it('sem staging no manifesto ou sem fonte da plataforma não gera passo', () => {
    assert.equal(sqlExpurgoDaStaging(compartilhado, destino, fontes), null);
    assert.equal(sqlExpurgoDaStaging({ ...diario, staging: 'stg_ga4_diario' }, destino, fontes), null);
  });

  it('o plano apaga a staging depois das sobras e antes do client_id, sem repetir a mesma tabela', () => {
    const plano = planoDoExpurgo({
      manifesto: [comStaging, { ...comStaging }],
      tabelasComCliente: ['dim_fonte_scd2'],
      fontes,
      destino,
    });
    const nomes = plano.map((passo) => passo.nome);
    assert.deepEqual(nomes.filter((nome) => nome.includes('(staging)')), ['stg_ads_diario[meta] (staging)']);
    assert.ok(nomes.indexOf('stg_ads_diario[meta] (staging)') < nomes.indexOf('dim_fonte_scd2 (client_id)'));
    assert.equal(passosDaStaging([comStaging], destino, []).length, 0);
  });

  it('validarEntrada só aceita staging com prefixo stg_', () => {
    assert.equal(validarEntrada({ ...comStaging }), true);
    assert.equal(validarEntrada({ ...comStaging, staging: 'fato_ads_diario' }), false);
  });
});

describe('expurgo de uma fonte (conexão removida)', () => {
  const manifesto: EntradaDoManifesto[] = [
    { tabela: 'fato_youtube_diario', chave: 'channel_id', plataforma: 'youtube', data: 'data_dia', staging: 'stg_youtube_diario' },
    { tabela: 'dim_youtube_video_scd2', chave: 'channel_id', plataforma: 'youtube', todoPeriodo: true, staging: 'stg_youtube_video' },
    diario,
  ];
  const fonte = { organizationId: ORG, platform: 'youtube', externalId: 'UCabc' };

  it('apaga fatos, dimensões e staging da plataforma pela organização + chave exata, e tira o nome da fonte', () => {
    const plano = planoDoExpurgoDaFonte({ manifesto, fonte, destino });
    assert.deepEqual(plano.map((passo) => passo.nome), [
      'fato_youtube_diario[youtube] (fonte)',
      'dim_youtube_video_scd2[youtube] (fonte)',
      'stg_youtube_diario[youtube] (staging)',
      'stg_youtube_video[youtube] (staging)',
      'dim_fonte_scd2[youtube] (nome da fonte)',
    ]);
    assert.equal(
      normalizar(plano[0]!.sql),
      `DELETE FROM \`p.d.fato_youtube_diario\` f WHERE f.organization_id = '${ORG}' AND CAST(f.channel_id AS STRING) = 'UCabc'`,
    );
    assert.match(
      normalizar(plano.at(-1)!.sql),
      /^UPDATE `p\.d\.dim_fonte_scd2` d SET nome = NULL WHERE d\.organization_id = '.+' AND d\.platform = 'youtube' AND d\.external_id = 'UCabc'/,
    );
  });

  it('não toca outra plataforma, outra organização nem fonte com nome parecido', () => {
    const plano = planoDoExpurgoDaFonte({ manifesto, fonte, destino });
    assert.ok(plano.every((passo) => !passo.sql.includes('ga4')));
    assert.ok(plano.every((passo) => !passo.sql.includes('LIKE')));
    assert.ok(plano.every((passo) => passo.sql.includes(`'${ORG}'`) || passo.sql.includes(`'${ORG}|UCabc'`)));
  });

  it('fonte fora do YouTube não perde o nome em dim_fonte_scd2', () => {
    const plano = planoDoExpurgoDaFonte({ manifesto, fonte: { organizationId: ORG, platform: 'ga4', externalId: 'properties/1' }, destino });
    assert.deepEqual(plano.map((passo) => passo.nome), ['fato_ga4_diario[ga4] (fonte)']);
  });

  it('recusa fonte com organização inválida', () => {
    assert.throws(() => planoDoExpurgoDaFonte({ manifesto, fonte: { ...fonte, organizationId: 'x' }, destino }), /fonte inválida/);
  });
});

describe('conformidade de 30 dias do YouTube', () => {
  const manifesto: EntradaDoManifesto[] = [
    { tabela: 'fato_youtube_diario', chave: 'channel_id', plataforma: 'youtube', data: 'data_dia' },
    { tabela: 'dim_youtube_video_scd2', chave: 'channel_id', plataforma: 'youtube', todoPeriodo: true },
    { tabela: 'dim_youtube_playlist_scd2', chave: 'channel_id', plataforma: 'youtube', todoPeriodo: true },
    entidade,
  ];

  it('apaga das dimensões do YouTube o que não foi renovado em 30 dias e tira o nome das versões encerradas', () => {
    const plano = planoDeConformidadeDoYoutube({ manifesto, destino });
    assert.deepEqual(plano.map((passo) => normalizar(passo.sql)), [
      'DELETE FROM `p.d.dim_youtube_video_scd2` WHERE carregado_em < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)',
      'DELETE FROM `p.d.dim_youtube_playlist_scd2` WHERE carregado_em < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)',
      "UPDATE `p.d.dim_fonte_scd2` SET nome = NULL WHERE platform = 'youtube' AND NOT atual AND nome IS NOT NULL AND valido_de < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)",
    ]);
  });

  it('prazo acima de 30 dias é recusado', () => {
    assert.throws(() => planoDeConformidadeDoYoutube({ manifesto, destino, dias: 31 }), /prazo/);
  });
});
