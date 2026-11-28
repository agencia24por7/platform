import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

const CHAVE = 'chave-falsa-que-nunca-pode-aparecer-0123456789';

const WORKFLOWS = [
  { id: 'wfPlataforma01', name: 'ORLA · plataforma · teste', active: false, tags: [{ id: 't1', name: 'platform' }], nodes: [{ credentials: { httpHeaderAuth: { id: 'c1', name: 'ORLA · worker token' } } }], connections: {}, settings: {} },
  { id: 'wfCredazMisto01', name: 'Fluxo secreto do cliente', active: false, tags: [{ id: 't1', name: 'platform' }, { id: 't2', name: 'Credaz' }], nodes: [{ credentials: { x: { id: 'c2', name: 'credencial do cliente' } } }], connections: {}, settings: {} },
  { id: 'wfAgencia00001', name: 'Fluxo da agência', active: false, tags: [{ id: 't3', name: 'agencia' }], nodes: [], connections: {}, settings: {} },
  { id: 'wfSemTag000001', name: 'Fluxo solto', active: false, tags: [], nodes: [], connections: {}, settings: {} },
];

let servidor;
let url;
let chamadas = [];

before(async () => {
  servidor = createServer((req, res) => {
    chamadas.push({ metodo: req.method, caminho: req.url, chave: req.headers['x-n8n-api-key'] });
    if (req.headers['x-n8n-api-key'] !== CHAVE) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/v1/workflows?')) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: WORKFLOWS, nextCursor: null }));
      return;
    }
    if (req.method === 'POST' && /^\/api\/v1\/workflows\/[A-Za-z0-9]+\/activate$/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());
beforeEach(() => {
  chamadas = [];
});

function rodar(args) {
  return new Promise((resolver) => {
    const filho = spawn('node', ['--experimental-strip-types', 'scripts/n8n-ativar.mjs', ...args], {
      env: { ...process.env, N8N_API_URL: url, N8N_API_KEY: CHAVE },
    });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (status) => resolver({ status, saida }));
  });
}

const ativacoes = () => chamadas.filter((c) => c.metodo === 'POST');

describe('n8n-ativar.mjs (ADR 0053, ADR 0069 §2)', () => {
  it('fluxo da plataforma sem --aplicar mostra o resumo e não ativa', async () => {
    const r = await rodar(['wfPlataforma01']);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /ORLA · worker token/);
    assert.match(r.saida, /simulação/);
    assert.deepEqual(ativacoes(), []);
  });

  it('fluxo da plataforma com --aplicar ativa só esse workflow', async () => {
    const r = await rodar(['wfPlataforma01', '--aplicar']);
    assert.equal(r.status, 0, r.saida);
    assert.deepEqual(ativacoes().map((c) => c.caminho), ['/api/v1/workflows/wfPlataforma01/activate']);
  });

  for (const [id, nome] of [['wfCredazMisto01', 'Fluxo secreto do cliente'], ['wfAgencia00001', 'Fluxo da agência']]) {
    it(`${id}: tag de terceiro recusa com código 3, sem mostrar nome nem credencial, mesmo com --aplicar`, async () => {
      const r = await rodar([id, '--aplicar']);
      assert.equal(r.status, 3, r.saida);
      assert.match(r.saida, /recusado/);
      assert.ok(!r.saida.includes(nome), r.saida);
      assert.ok(!r.saida.includes('credencial do cliente'), r.saida);
      assert.deepEqual(ativacoes(), []);
    });
  }

  it('fluxo sem tag platform nem nota de origem recusa', async () => {
    const r = await rodar(['wfSemTag000001', '--aplicar']);
    assert.equal(r.status, 3, r.saida);
    assert.deepEqual(ativacoes(), []);
  });

  it('id ausente no n8n sai 1 e não ativa', async () => {
    const r = await rodar(['wfInexistente1', '--aplicar']);
    assert.equal(r.status, 1, r.saida);
    assert.deepEqual(ativacoes(), []);
  });

  it('id malformado ou mais de um id recusa sem chamar o n8n', async () => {
    for (const args of [['../x'], ['wfPlataforma01', 'wfSemTag000001'], ['--criar']]) {
      const r = await rodar(args);
      assert.equal(r.status, 2, r.saida);
    }
    assert.deepEqual(chamadas, []);
  });

  it('a chave nunca aparece na saída', async () => {
    for (const args of [['wfPlataforma01'], ['wfCredazMisto01', '--aplicar'], ['wfInexistente1']]) {
      const r = await rodar(args);
      assert.ok(!r.saida.includes(CHAVE), r.saida);
    }
  });
});
