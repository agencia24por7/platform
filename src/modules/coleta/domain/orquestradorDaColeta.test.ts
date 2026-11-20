import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GRAVAR_COLETA_MAX_LINHAS } from '../../../shared/config/contracts.ts';

type No = { id: string; name: string; parameters: { jsCode?: string } };
type Modelo = { nodes: No[]; connections: Record<string, { main: { node: string }[][] }> };
type Item = { json: Record<string, any> };

const FLUXOS = ['coleta-orquestrador.json', 'coleta-backfill-janela.json'];
const carregar = (arquivo: string): Modelo => JSON.parse(readFileSync(`n8n/workflows/${arquivo}`, 'utf8')) as Modelo;

function rodar(modelo: Modelo, id: string, entrada: Item[], nos: Record<string, Item[]>): Item[] {
  const codigo = modelo.nodes.find((no) => no.id === id)!.parameters.jsCode!;
  const referenciar = (outro: string) => ({ all: () => nos[outro]!, first: () => nos[outro]![0]!, item: nos[outro]![0]! });
  const corpo = new Function('$input', '$json', '$', codigo) as (...argumentos: unknown[]) => Item | Item[];
  const saida = corpo({ all: () => entrada, first: () => entrada[0] }, entrada[0]?.json, referenciar);
  return Array.isArray(saida) ? saida : [saida];
}

const fonte = { nome: 'Conta', externalId: 'act_1', fonte: { nome: 'Conta', externalId: 'act_1' } };
const contexto = { 'Processar em série': [{ json: fonte }], Entrada: [{ json: fonte }], 'Abrir execução': [{ json: { id: 'c1' } }] };

for (const arquivo of FLUXOS) {
  describe(`gravação em lotes: ${arquivo}`, () => {
    const modelo = carregar(arquivo);
    const qualidade = (falhas: unknown[], linhas: unknown[] = [{ a: 1 }]) =>
      rodar(modelo, 'calcular-qualidade-ok', [{ json: { linhas, falhas, requests: 2 } }], contexto)[0]!.json;

    it('coleta_incompleta vira partial e sem_dados continua success', () => {
      const parcial = qualidade([{ causa: 'coleta_incompleta', detalhe: 'pais: HTTP 400' }]);
      assert.equal(parcial.status, 'partial');
      assert.equal(parcial.errorCode, 'coleta_incompleta');
      assert.equal(parcial.errorMessage, 'pais: HTTP 400');
      assert.equal(parcial.qualidadeResumo.fontesColetadas, 1);
      assert.equal(qualidade([{ causa: 'sem_dados_no_periodo', detalhe: null }], []).status, 'success');
      const falha = qualidade([{ causa: 'coleta_incompleta', detalhe: 'x' }, { causa: 'reauth_pending', detalhe: 'token' }]);
      assert.equal(falha.status, 'failed');
      assert.equal(falha.errorCode, 'reauth_pending');
    });

    it('divide as linhas em lotes de até 10.000 e sempre grava ao menos um lote', () => {
      const linhas = Array.from({ length: 23_456 }, (_, indice) => ({ indice }));
      const lotes = rodar(modelo, 'dividir-lotes', [{ json: { coletaId: 'c1', linhas } }], {});
      assert.deepEqual(lotes.map((lote) => lote.json.linhas.length), [10_000, 10_000, 3_456]);
      assert.ok(lotes.every((lote) => lote.json.linhas.length <= GRAVAR_COLETA_MAX_LINHAS));
      assert.equal(rodar(modelo, 'dividir-lotes', [{ json: { coletaId: 'c1', linhas: [] } }], {}).length, 1);
      assert.deepEqual(modelo.connections['Calcular qualidade']!.main[0]!.map((destino) => destino.node), ['Dividir em lotes']);
      assert.deepEqual(modelo.connections['Dividir em lotes']!.main[0]!.map((destino) => destino.node), ['Gravar métricas']);
    });

    it('conferência soma os lotes e falha se um lote for recusado', () => {
      const calculada = { json: { coletaId: 'c1', status: 'partial', linhas: new Array(15), requestCount: 2, qualidadeResumo: {}, errorCode: 'coleta_incompleta', errorMessage: 'm' } };
      const conferir = (respostas: Record<string, unknown>[]) =>
        rodar(modelo, 'conferir-gravacao', respostas.map((json) => ({ json })), { 'Calcular qualidade': [calculada] })[0]!.json;

      const certa = conferir([{ linhasGravadas: 10, linhasDescartadas: 0 }, { linhasGravadas: 4, linhasDescartadas: 1 }]);
      assert.equal(certa.status, 'partial');
      assert.equal(certa.rowsWritten, 14);

      const recusada = conferir([{ linhasGravadas: 10 }, { title: 'Payload inválido.', detail: 'grande' }]);
      assert.equal(recusada.status, 'failed');
      assert.equal(recusada.errorCode, 'gravacao_bq');
      assert.match(recusada.errorMessage, /lote recusado: grande/);
    });
  });
}
