import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { EscopoDoAgente } from '../../ia/domain/ferramenta.ts';

const { executarFerramenta } = await import('../../ia/domain/ferramenta.ts');
const { ok } = await import('../../../shared/result/result.ts');
const { ferramentasDoBrain } = await import('./ferramentas.ts');

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const URN = 'orla:22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111:regra:r1';

function escopo(extra: Partial<EscopoDoAgente> = {}): EscopoDoAgente {
  return {
    credencialId: 'cred-1',
    organizationId: '22222222-2222-4222-8222-222222222222',
    clienteIds: null,
    ferramentas: ['brain_consultar_catalogo', 'brain_consultar_item'],
    requestId: 'r-1',
    sourceIp: null,
    ...extra,
  };
}

function brainFalso() {
  const chamadas: { metodo: string; agente: unknown; clienteId: string; urn?: string }[] = [];
  const entrada = { urn: URN, tipo: 'regra', titulo: 'Teto', descricao: 'd' };
  const brain = {
    async catalogoDoAgente(agente: unknown, clienteId: string) {
      chamadas.push({ metodo: 'catalogo', agente, clienteId });
      return ok({ corpo: { clienteId, catalogHash: 'h', total: 1, proximoCursor: null, entradas: [{ ...entrada, plataforma: null, sensibilidade: { nivel: 'baixo' } }] }, etag: 'e' });
    },
    async entradaDoAgente(agente: unknown, clienteId: string, urn: string) {
      chamadas.push({ metodo: 'item', agente, clienteId, urn });
      return ok({ corpo: entrada, etag: 'e' });
    },
  };
  return { brain: brain as never, chamadas };
}

describe('ferramentas MCP do Brain', () => {
  it('expõe consultar catálogo e consultar item, somente leitura', () => {
    const ferramentas = ferramentasDoBrain(brainFalso().brain);
    assert.deepEqual(ferramentas.map((f) => f.nome), ['brain_consultar_catalogo', 'brain_consultar_item']);
    assert.ok(ferramentas.every((f) => f.classe === 'leitura'));
  });

  it('consultar item repassa cliente, URN e a visão do escopo, e devolve o conteúdo', async () => {
    const { brain, chamadas } = brainFalso();
    const item = ferramentasDoBrain(brain).find((f) => f.nome === 'brain_consultar_item')!;
    const r = await executarFerramenta(item, { clienteId: CLIENTE, urn: URN }, escopo({ visao: 'equipe' }));
    assert.ok(r.ok);
    assert.equal(chamadas[0]!.urn, URN);
    assert.equal((chamadas[0]!.agente as { visao: string }).visao, 'equipe');
  });

  it('sem visão no escopo a ferramenta não a inventa', async () => {
    const { brain, chamadas } = brainFalso();
    const item = ferramentasDoBrain(brain).find((f) => f.nome === 'brain_consultar_item')!;
    await executarFerramenta(item, { clienteId: CLIENTE, urn: URN }, escopo());
    assert.equal((chamadas[0]!.agente as { visao?: string }).visao, undefined);
  });

  it('entrada com campo a mais ou URN curta é recusada sem chamar o Brain', async () => {
    const { brain, chamadas } = brainFalso();
    const item = ferramentasDoBrain(brain).find((f) => f.nome === 'brain_consultar_item')!;
    assert.equal((await executarFerramenta(item, { clienteId: CLIENTE, urn: URN, organizationId: 'x' }, escopo())).ok, false);
    assert.equal((await executarFerramenta(item, { clienteId: CLIENTE, urn: 'x' }, escopo())).ok, false);
    assert.equal((await executarFerramenta(item, { clienteId: 'nao-uuid', urn: URN }, escopo())).ok, false);
    assert.equal(chamadas.length, 0);
  });

  it('consultar catálogo repassa a visão do escopo', async () => {
    const { brain, chamadas } = brainFalso();
    const catalogo = ferramentasDoBrain(brain).find((f) => f.nome === 'brain_consultar_catalogo')!;
    await executarFerramenta(catalogo, { clienteId: CLIENTE }, escopo({ visao: 'equipe' }));
    assert.equal((chamadas[0]!.agente as { visao: string }).visao, 'equipe');
  });
});
