import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fecharColetaBody, GRAVAR_COLETA_MAX_LINHAS } from '../../../shared/config/contracts.ts';

type No = { id: string; name: string; onError?: string; parameters: { jsCode?: string } };
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
      rodar(modelo, 'calcular-qualidade-ok', [{ json: { linhas, falhas, requests: 2, volumetria: { linhas: linhas.length, bytes: 10, requests: 2, duracaoMs: 5 } } }], contexto)[0]!.json;

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

    it('coletor que quebrou ou devolveu resposta incompleta falha com falha_coletor, sem segredo', () => {
      const calcular = (json: Record<string, unknown>) => rodar(modelo, 'calcular-qualidade-ok', [{ json }], contexto)[0]!.json;
      const quebrado = calcular({ error: { message: 'timeout em https://graph.facebook.com/x?access_token=EAAsegredo123&fields=id' } });
      assert.equal(quebrado.status, 'failed');
      assert.equal(quebrado.errorCode, 'falha_coletor');
      assert.equal(quebrado.qualidadeResumo.fontesColetadas, 0);
      assert.ok(!JSON.stringify(quebrado).includes('EAAsegredo123'));
      assert.equal(fecharColetaBody.safeParse({ coletaId: '00000000-0000-4000-8000-000000000001', status: quebrado.status, requestCount: 0, qualidadeResumo: quebrado.qualidadeResumo, errorCode: quebrado.errorCode, errorMessage: quebrado.errorMessage }).success, true);
      assert.equal(calcular({ error: 'falha de execução' }).errorCode, 'falha_coletor');
      assert.equal(calcular({ falhas: [] }).errorCode, 'falha_coletor');
      assert.equal(calcular({ linhas: 'x', volumetria: {} }).status, 'failed');
      assert.equal(calcular({ linhas: [] }).status, 'failed');
      assert.equal(calcular({ linhas: [], volumetria: { linhas: 0, bytes: 0, requests: 0, duracaoMs: 0 }, falhas: [] }).status, 'success');
    });

    it('rede caindo ao gravar fecha a coleta como gravacao_bq e o laço continua', () => {
      const calculada = { json: { coletaId: 'c1', status: 'success', linhas: new Array(3), requestCount: 1, qualidadeResumo: {}, errorCode: null, errorMessage: null } };
      const conferida = rodar(modelo, 'conferir-gravacao', [{ json: { error: { message: 'connect ECONNREFUSED app:3000?access_token=EAAsegredo123' } } }], { 'Calcular qualidade': [calculada] })[0]!.json;
      assert.equal(conferida.status, 'failed');
      assert.equal(conferida.errorCode, 'gravacao_bq');
      assert.match(conferida.errorMessage, /ECONNREFUSED/);
      assert.ok(!conferida.errorMessage.includes('EAAsegredo123'));
      for (const nome of ['Gravar métricas', 'Fechar execução', 'Fechar execução (sem coletor)']) {
        assert.equal((modelo.nodes.find((no) => no.name === nome) as { onError?: string }).onError, 'continueRegularOutput', nome);
      }
    });

    it('coleta parcial fecha com um corpo aceito pela API', () => {
      const parcial = qualidade([{ causa: 'coleta_incompleta', detalhe: 'aparencia: HTTP 400' }]);
      const corpo = {
        coletaId: '00000000-0000-4000-8000-000000000001',
        status: parcial.status,
        requestCount: parcial.requestCount,
        qualidadeResumo: parcial.qualidadeResumo,
        errorCode: parcial.errorCode,
        errorMessage: parcial.errorMessage,
      };
      assert.equal(fecharColetaBody.safeParse(corpo).success, true);
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
