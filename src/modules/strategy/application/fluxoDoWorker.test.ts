import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';

const { PARALELISMO_DO_COMITE, PARALELISMO_DO_COMITE_APOS_FALHA, piorCasoDaEtapaComiteMs } = await import('./motorDoPlano.ts');
const { ORCAMENTO_TOTAL_DA_ROTA_MS } = await import('./processadorDeExecucoes.ts');

const FLUXO = join(import.meta.dirname, '..', '..', '..', '..', 'n8n', 'workflows', 'plataforma', 'strategy-avancar-execucoes.json');
const QUINZE_MINUTOS_MS = 900_000;

describe('fluxo do worker de Estratégia no n8n', () => {
  it('o tempo limite da chamada cobre o passo mais longo (várias chamadas ao modelo em sequência)', () => {
    const fluxo = JSON.parse(readFileSync(FLUXO, 'utf8')) as { nodes: { parameters?: { options?: { timeout?: number } } }[] };
    const limites = fluxo.nodes.map((no) => no.parameters?.options?.timeout).filter((t): t is number => typeof t === 'number');
    assert.ok(limites.length > 0);
    for (const limite of limites) assert.ok(limite >= QUINZE_MINUTOS_MS, `timeout ${limite}`);
  });

  it('o pior caso do Comitê (ADR 0076) termina antes do tempo limite do n8n, no paralelismo normal e no reduzido', () => {
    const fluxo = JSON.parse(readFileSync(FLUXO, 'utf8')) as { nodes: { parameters?: { options?: { timeout?: number } } }[] };
    const limiteDoN8n = Math.min(...fluxo.nodes.map((no) => no.parameters?.options?.timeout).filter((t): t is number => typeof t === 'number'));
    const MARGEM_MS = 60_000;
    for (const paralelismo of [PARALELISMO_DO_COMITE, PARALELISMO_DO_COMITE_APOS_FALHA]) {
      const fim = ORCAMENTO_TOTAL_DA_ROTA_MS + piorCasoDaEtapaComiteMs(paralelismo);
      assert.ok(fim + MARGEM_MS <= limiteDoN8n, `paralelismo ${paralelismo}: ${fim} ms`);
    }
  });
});
