import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../brain/testes/ganchos.ts');
const { createCatalogoDeModelos } = await import('./catalogoDeModelos.ts');
const { FORNECEDORES } = await import('../domain/tarefa.ts');

const CHAVE = 'chave-real-do-fornecedor-0123456789';

function buscador(resposta: () => Response | Promise<Response>) {
  const pedidos: { url: string; headers: Record<string, string>; redirect: string }[] = [];
  const buscar = async (url: string, opcoes: { headers: Record<string, string>; redirect: string }) => {
    pedidos.push({ url, headers: opcoes.headers, redirect: opcoes.redirect });
    return resposta();
  };
  return { catalogo: createCatalogoDeModelos(buscar as never), pedidos };
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('catálogo de modelos do fornecedor (ADR 0058)', () => {
  it('cada fornecedor tem destino fixo em https e a chave vai em cabeçalho, nunca na URL', async () => {
    for (const fornecedor of FORNECEDORES) {
      const { catalogo, pedidos } = buscador(() => json({ data: [{ id: 'm1' }], models: [{ name: 'models/m1', supportedGenerationMethods: ['generateContent'] }] }));
      const r = await catalogo.listar(fornecedor, CHAVE);
      assert.deepEqual(r, { ok: true, value: ['m1'] });
      assert.equal(pedidos[0]!.url.startsWith('https://'), true);
      assert.equal(pedidos[0]!.url.includes(CHAVE), false);
      assert.equal(JSON.stringify(pedidos[0]!.headers).includes(CHAVE), true);
      assert.equal(pedidos[0]!.redirect, 'error');
    }
  });

  it('Google: só modelos que geram conteúdo, sem o prefixo', async () => {
    const { catalogo } = buscador(() => json({ models: [{ name: 'models/gera', supportedGenerationMethods: ['generateContent'] }, { name: 'models/so-embute', supportedGenerationMethods: ['embedContent'] }, { name: 7 }] }));
    assert.deepEqual(await catalogo.listar('google', CHAVE), { ok: true, value: ['gera'] });
  });

  it('400, 401 e 403 são chave recusada; o resto é fornecedor fora; a mensagem nunca traz a chave nem o corpo', async () => {
    const casos: [number, string][] = [[400, 'validation'], [401, 'validation'], [403, 'validation'], [404, 'unavailable'], [429, 'unavailable'], [500, 'unavailable']];
    for (const [status, codigo] of casos) {
      const { catalogo } = buscador(() => new Response(`erro com ${CHAVE}`, { status }));
      const r = await catalogo.listar('openai', CHAVE);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.error.code, codigo);
        assert.equal(JSON.stringify(r.error).includes(CHAVE), false);
      }
    }
  });

  it('rede fora, corpo que não é JSON e lista vazia viram falha sem exceção', async () => {
    const fora = buscador(() => { throw new Error(`falha de rede ${CHAVE}`); });
    const ruim = buscador(() => new Response('<html>', { status: 200 }));
    const vazia = buscador(() => json({ data: [] }));
    for (const { catalogo } of [fora, ruim, vazia]) {
      const r = await catalogo.listar('anthropic', CHAVE);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(JSON.stringify(r.error).includes(CHAVE), false);
    }
  });
});
