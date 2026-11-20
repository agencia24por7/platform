import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('manifesto do BigQuery no app', () => {
  it('importa todo arquivo de scripts/bq/manifesto, para o expurgo de fonte não esquecer tabela', () => {
    const fonte = readFileSync('src/modules/privacidade/infrastructure/manifestoDoBigQuery.ts', 'utf8');
    for (const arquivo of readdirSync('scripts/bq/manifesto').filter((nome) => nome.endsWith('.json'))) {
      assert.ok(fonte.includes(`@/../scripts/bq/manifesto/${arquivo}'`), `${arquivo} fora de manifestoDoBigQuery.ts`);
    }
  });
});
