import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  executarPassos,
  literalBigQuery,
  passosPorClientId,
  planoDoExpurgo,
  sqlExpurgoDasSobras,
  sqlExpurgoPorPosse,
  sqlVersoesDoCliente,
  validarEntrada,
  validarFontes,
  type EntradaDoManifesto,
  type Passo,
} from '../../../../scripts/bq/expurgo.mjs';

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
    assert.match(sql, /NOT EXISTS \( SELECT 1 FROM `p\.d\.dim_fonte_scd2` o WHERE o\.client_id IS NOT NULL AND o\.client_id != @id/);
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
    assert.match(sql, /AND NOT EXISTS \( SELECT 1 FROM `p\.d\.dim_fonte_scd2` o WHERE o\.client_id IS NOT NULL AND o\.client_id != @id AND o\.organization_id = f\.organization_id AND o\.platform = 'ga4'/);
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
