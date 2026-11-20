import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { criarClienteN8n } from './clienteN8n.ts';

type Chamada = { metodo: string; caminho: string; chave: string | undefined };
type Responder = (chamada: Chamada) => { status: number; corpo?: unknown };

let chamadas: Chamada[] = [];
let responder: Responder = () => ({ status: 200, corpo: {} });
let servidor: ReturnType<typeof createServer>;
let url = '';

const silencioso = { info() {}, warn() {}, error() {} };
const corpo = { name: 'teste', nodes: [], connections: {}, settings: {} };

before(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      const chamada = { metodo: req.method ?? '', caminho: req.url ?? '', chave: req.headers['x-n8n-api-key'] as string | undefined };
      chamadas.push(chamada);
      const { status, corpo: resposta } = responder(chamada);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resposta ?? {}));
    });
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => servidor.close());

beforeEach(() => {
  chamadas = [];
  responder = () => ({ status: 200, corpo: {} });
});

const cliente = () => criarClienteN8n({ url, apiKey: 'chave-de-teste', esperarMs: 1 }, silencioso);

describe('cliente do n8n', () => {
  it('cria e publica o workflow, mandando a chave de API', async () => {
    responder = (c) => (c.metodo === 'POST' && c.caminho === '/api/v1/workflows' ? { status: 200, corpo: { id: 'wf1' } } : { status: 200 });
    assert.equal(await cliente().criar(corpo, {}), 'wf1');
    assert.deepEqual(chamadas.map((c) => `${c.metodo} ${c.caminho}`), ['POST /api/v1/workflows', 'POST /api/v1/workflows/wf1/activate']);
    assert.ok(chamadas.every((c) => c.chave === 'chave-de-teste'));
  });

  it('devolve o id mesmo se a publicação falhar (o workflow existe e pode ser publicado depois)', async () => {
    responder = (c) => (c.caminho.endsWith('/activate') ? { status: 400 } : { status: 200, corpo: { id: 'wf2' } });
    assert.equal(await cliente().criar(corpo, {}), 'wf2');
  });

  it('não devolve id quando a criação é recusada', async () => {
    responder = () => ({ status: 401 });
    assert.equal(await cliente().criar(corpo, {}), null);
    assert.equal(chamadas.length, 1);
  });

  it('remove desativando antes e tenta de novo enquanto o n8n responde 409', async () => {
    let deletes = 0;
    responder = (c) => {
      if (c.metodo !== 'DELETE') return { status: 200 };
      deletes += 1;
      return { status: deletes < 3 ? 409 : 200 };
    };
    assert.equal(await cliente().remover('velho', {}), true);
    assert.equal(chamadas[0]!.caminho, '/api/v1/workflows/velho/deactivate');
    assert.equal(deletes, 3);
  });

  it('considera removido o workflow que já não existe (404)', async () => {
    responder = (c) => (c.metodo === 'DELETE' ? { status: 404 } : { status: 404 });
    assert.equal(await cliente().remover('sumiu', {}), true);
  });

  it('falha sem insistir quando o erro não é 409', async () => {
    let deletes = 0;
    responder = (c) => {
      if (c.metodo === 'DELETE') deletes += 1;
      return { status: c.metodo === 'DELETE' ? 403 : 200 };
    };
    assert.equal(await cliente().remover('protegido', {}), false);
    assert.equal(deletes, 1);
  });
});
