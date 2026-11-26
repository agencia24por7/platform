import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const FLUXO = join(import.meta.dirname, '..', '..', '..', '..', 'n8n', 'workflows', 'plataforma', 'strategy-avancar-execucoes.json');
const QUINZE_MINUTOS_MS = 900_000;

describe('fluxo do worker de Estratégia no n8n', () => {
  it('o tempo limite da chamada cobre o passo mais longo (várias chamadas ao modelo em sequência)', () => {
    const fluxo = JSON.parse(readFileSync(FLUXO, 'utf8')) as { nodes: { parameters?: { options?: { timeout?: number } } }[] };
    const limites = fluxo.nodes.map((no) => no.parameters?.options?.timeout).filter((t): t is number => typeof t === 'number');
    assert.ok(limites.length > 0);
    for (const limite of limites) assert.ok(limite >= QUINZE_MINUTOS_MS, `timeout ${limite}`);
  });
});
