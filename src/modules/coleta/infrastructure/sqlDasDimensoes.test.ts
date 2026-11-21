import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sqlAplicarDimensao } from './sqlDasDimensoes.ts';

const normalizar = (sql: string) => sql.replace(/\s+/g, ' ').trim();

type Versao = { chave: string; sk: string; valido_de: number; valido_ate: number; atual: boolean };

function aplicarComoOSql(tabela: Versao[], agora: number, fechar: string[], novas: Versao[]): void {
  for (const versao of tabela) {
    if (versao.atual && versao.valido_de < agora && fechar.includes(versao.chave)) {
      versao.valido_ate = agora;
      versao.atual = false;
    }
  }
  for (const nova of novas) {
    const jaTem = tabela.some((versao) => versao.sk === nova.sk);
    const abertaDaChave = tabela.some((versao) => versao.atual && versao.chave === nova.chave);
    if (!jaTem && !(nova.atual && abertaDaChave)) tabela.push({ ...nova });
  }
}

describe('sincronização de dim_fonte_scd2 / dim_cliente_scd2', () => {
  it('o UPDATE só fecha versão aberta antes deste @agora', () => {
    const sql = normalizar(sqlAplicarDimensao('`p.d.dim_fonte_scd2`', ['sk', 'organization_id', 'valido_de'], ['organization_id']));
    assert.match(sql, /WHERE atual AND valido_de < @agora AND CONCAT\(organization_id\) IN UNNEST\(@fechar\);/);
    assert.match(sql, /^BEGIN TRANSACTION;.*COMMIT TRANSACTION;$/);
  });

  it('repetir a mesma transação já confirmada (retentativa após 429/503) não fecha a versão recém-aberta', () => {
    const agora = 100;
    const tabela: Versao[] = [{ chave: 'f1', sk: 'v1', valido_de: 0, valido_ate: Infinity, atual: true }];
    const nova = { chave: 'f1', sk: 'v2', valido_de: agora, valido_ate: Infinity, atual: true };
    aplicarComoOSql(tabela, agora, ['f1'], [nova]);
    aplicarComoOSql(tabela, agora, ['f1'], [nova]);
    assert.deepEqual(tabela.filter((versao) => versao.atual).map((versao) => versao.sk), ['v2']);
    assert.equal(tabela.find((versao) => versao.sk === 'v1')!.valido_ate, agora);
  });
});
