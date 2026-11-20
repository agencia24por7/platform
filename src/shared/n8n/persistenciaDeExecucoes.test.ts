import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PASTA_DOS_WORKFLOWS } from './modelos.ts';

type Modelo = { settings: Record<string, unknown> };

const PASTAS_SEM_PERSISTENCIA = ['coletores', 'executores', 'plataforma'];
const FLUXOS_SEM_PERSISTENCIA = ['coleta-orquestrador.json', 'coleta-backfill-janela.json', 'coleta-backfill.json', 'coleta-metricas.json', 'tarefas-de-conta.json'];

function arquivosJson(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return arquivosJson(caminho);
    return entrada.name.endsWith('.json') ? [caminho] : [];
  });
}

const relativo = (caminho: string) => caminho.slice(PASTA_DOS_WORKFLOWS.length + 1);

describe('execuções do n8n não guardam resposta de API externa', () => {
  const alvos = arquivosJson(PASTA_DOS_WORKFLOWS).filter((caminho) => {
    const nome = relativo(caminho);
    return PASTAS_SEM_PERSISTENCIA.some((pasta) => nome.startsWith(`${pasta}/`)) || FLUXOS_SEM_PERSISTENCIA.includes(nome);
  });

  it('cobre coletores, executores, orquestrador e backfill', () => {
    const nomes = alvos.map(relativo);
    for (const esperado of ['coleta-orquestrador.json', 'coleta-backfill-janela.json', 'coletores/coletor-meta-insights.json', 'executores/executor-meta-partner.json', 'plataforma/retencao-diaria.json', 'plataforma/dimensoes-diarias.json', 'plataforma/contexto-brain-diario.json']) {
      assert.ok(nomes.includes(esperado), `faltou ${esperado}`);
    }
  });

  for (const caminho of alvos) {
    it(`${relativo(caminho)} não persiste execução`, () => {
      const { settings } = JSON.parse(readFileSync(caminho, 'utf8')) as Modelo;
      assert.equal(settings.saveDataSuccessExecution, 'none');
      assert.equal(settings.saveDataErrorExecution, 'none');
      assert.equal(settings.saveManualExecutions, false);
    });
  }
});
