import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fecharColetaBody } from '../../../shared/config/contracts.ts';

type No = { id: string; parameters: { jsCode?: string } };
type Item = { json: Record<string, any> };

function conferir(arquivo: string, qualidade: Record<string, unknown>, respostas: Record<string, unknown>[]): Record<string, any> {
  const modelo = JSON.parse(readFileSync(`n8n/workflows/${arquivo}`, 'utf8')) as { nodes: No[] };
  const codigo = modelo.nodes.find((no) => no.id === 'conferir-gravacao')!.parameters.jsCode!;
  const entrada: Item[] = respostas.map((json) => ({ json }));
  const nos: Record<string, Item[]> = { 'Calcular qualidade': [{ json: qualidade }] };
  const referenciar = (outro: string) => ({ all: () => nos[outro]!, first: () => nos[outro]![0]! });
  const corpo = new Function('$input', '$', codigo) as (...argumentos: unknown[]) => Item[];
  return corpo({ all: () => entrada }, referenciar)[0]!.json;
}

const resumo = {
  fontesEsperadas: 1, fontesColetadas: 1, faltantes: [], paridade: [],
  volumetria: { linhas: 3, bytes: 10, requests: 1, duracaoMs: 5 },
};
const qualidade = {
  coletaId: '00000000-0000-4000-8000-000000000001', status: 'success', requestCount: 1,
  linhas: [{}, {}, {}], qualidadeResumo: resumo, errorCode: null, errorMessage: null,
};

for (const arquivo of ['coleta-orquestrador.json', 'coleta-backfill-janela.json']) {
  describe(`Conferir gravação: ${arquivo}`, () => {
    it('descarte por chave inválida rebaixa a success para partial e entra nos faltantes', () => {
      const saida = conferir(arquivo, qualidade, [
        { linhasGravadas: 1, linhasDescartadas: 1, descartesDeChave: { fato_meta_entrega_diaria: 1 } },
        { linhasGravadas: 0, linhasDescartadas: 1, descartesDeChave: { fato_meta_entrega_diaria: 1 } },
      ]);
      assert.equal(saida.status, 'partial');
      assert.equal(saida.errorCode, 'coleta_incompleta');
      assert.deepEqual(saida.qualidadeResumo.faltantes, [
        { fonte: 'fato_meta_entrega_diaria', causa: 'coleta_incompleta', detalhe: '2 linha(s) com chave inválida descartada(s)' },
      ]);
      assert.equal(fecharColetaBody.safeParse({ ...saida }).success, true);
    });

    it('descarte comum (dedupe do preparar) continua success', () => {
      const saida = conferir(arquivo, qualidade, [{ linhasGravadas: 2, linhasDescartadas: 1, descartesDeChave: {} }]);
      assert.equal(saida.status, 'success');
      assert.deepEqual(saida.qualidadeResumo.faltantes, []);
    });

    it('resposta antiga sem descartesDeChave continua aceita', () => {
      assert.equal(conferir(arquivo, qualidade, [{ linhasGravadas: 3, linhasDescartadas: 0 }]).status, 'success');
    });

    it('soma que não fecha continua failed', () => {
      assert.equal(conferir(arquivo, qualidade, [{ linhasGravadas: 1, linhasDescartadas: 0 }]).status, 'failed');
    });
  });
}
