import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error script .mjs sem declaração de tipos
import { executar } from '../../../scripts/n8n-aplicar-clientes.mjs';

type Registro = { metodo: string; caminho: string; corpo: unknown };
type Fluxo = { id: string; name: string; active: boolean; nodes: unknown[]; connections: object; settings: object; tags?: { name: string }[] };
type Cenario = { implantados: Fluxo[]; ativacoesQueFalham?: number; statusDoPut?: number };
type Pasta = { raiz: string; backup: string };

const no = (extra = {}) => ({ id: 'a', name: 'Passo', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return [];' }, ...extra });
const modelo = (extra = {}) => ({ name: 'Credaz · Teste', nodes: [no()], connections: {}, settings: { executionOrder: 'v1' }, ...extra });
const mudado = () => modelo({ nodes: [no({ parameters: { jsCode: 'return [1];' } })] });

const fluxoImplantado = (extra: Partial<Fluxo> = {}): Fluxo => ({
  id: 'w1',
  name: 'Credaz · Teste',
  active: true,
  nodes: [no()],
  connections: {},
  settings: { executionOrder: 'v1' },
  ...extra,
});

const MANIFESTO = { 'clientes/a.json': { id: 'w1', nome: 'Credaz · Teste' } };

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let texto = '';
    req.on('data', (parte) => (texto += parte));
    req.on('end', () => resolve(texto ? JSON.parse(texto) : undefined));
  });
}

async function servidorFalso(cenario: Cenario) {
  const registros: Registro[] = [];
  const fluxos = new Map(cenario.implantados.map((f) => [f.id, structuredClone(f)]));
  let ativacoesFalhas = cenario.ativacoesQueFalham ?? 0;
  const servidor: Server = createServer(async (req, res) => {
    const corpo = await lerCorpo(req);
    const caminho = (req.url ?? '').replace('/api/v1', '');
    registros.push({ metodo: req.method ?? '', caminho, corpo });
    const responder = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.method === 'GET' && caminho.startsWith('/workflows?')) return responder(200, { data: [...fluxos.values()] });
    const id = /^\/workflows\/([^/]+)/.exec(caminho)?.[1];
    const fluxo = id ? fluxos.get(decodeURIComponent(id)) : undefined;
    if (!fluxo) return responder(404, { message: 'not found' });
    if (req.method === 'GET') return responder(200, fluxo);
    if (req.method === 'PUT') {
      if (cenario.statusDoPut) return responder(cenario.statusDoPut, { message: 'recusado' });
      Object.assign(fluxo, corpo);
      return responder(200, fluxo);
    }
    if (req.method === 'POST' && caminho.endsWith('/activate')) {
      if (ativacoesFalhas > 0) {
        ativacoesFalhas -= 1;
        return responder(400, { message: 'ativação recusada' });
      }
      fluxo.active = true;
      return responder(200, fluxo);
    }
    return responder(405, {});
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  return { servidor, url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, registros, fluxos };
}

function pastaDeTrabalho(manifesto: object | null, arquivo: object): Pasta {
  const raiz = mkdtempSync(join(tmpdir(), 'n8n-exec-'));
  mkdirSync(join(raiz, 'clientes'), { recursive: true });
  writeFileSync(join(raiz, 'clientes/a.json'), JSON.stringify(arquivo));
  if (manifesto) writeFileSync(join(raiz, 'clientes-manifesto.json'), JSON.stringify(manifesto));
  return { raiz, backup: join(mkdtempSync(join(tmpdir(), 'n8n-bkp-')), 'cofre') };
}

function saidaMuda() {
  const linhas: string[] = [];
  return { linhas, log: (m: string) => linhas.push(m), error: (m: string) => linhas.push(m) };
}

async function rodar(cenario: Cenario, manifesto: object | null, args: (p: Pasta) => string[], arquivo: object = modelo()) {
  const falso = await servidorFalso(cenario);
  const pasta = pastaDeTrabalho(manifesto, arquivo);
  const saida = saidaMuda();
  try {
    const codigo: number = await executar(args(pasta), { N8N_API_URL: falso.url, N8N_API_KEY: 'chave-de-teste' }, saida);
    return { codigo, saida: saida.linhas.join('\n'), registros: falso.registros, fluxos: falso.fluxos, pasta };
  } finally {
    falso.servidor.close();
  }
}

const aplicar = (p: Pasta) => [p.raiz, '--aplicar', '--backup-dir', p.backup];
const escritas = (r: { registros: Registro[] }) => r.registros.filter((x) => x.metodo !== 'GET');

test('aplica pelo id do manifesto, com backup 0600 gravado antes do PUT', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()] }, MANIFESTO, aplicar, mudado());
  assert.equal(r.codigo, 0, r.saida);
  assert.deepEqual(
    r.registros.map((x) => `${x.metodo} ${x.caminho}`),
    ['GET /workflows/w1', 'GET /workflows/w1', 'PUT /workflows/w1', 'POST /workflows/w1/activate'],
  );
  const arquivos = readdirSync(r.pasta.backup);
  assert.equal(arquivos.length, 1);
  const [nomeDoBackup = ''] = arquivos;
  assert.match(nomeDoBackup, /^w1-.*\.json$/);
  assert.equal(statSync(join(r.pasta.backup, nomeDoBackup)).mode & 0o777, 0o600);
  assert.equal(statSync(r.pasta.backup).mode & 0o777, 0o700);
  const guardado = JSON.parse(readFileSync(join(r.pasta.backup, nomeDoBackup), 'utf8'));
  assert.equal(guardado.id, 'w1');
  assert.deepEqual(guardado.nodes, [no()]);
});

test('--aplicar sem --backup-dir recusa antes de qualquer chamada', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()] }, MANIFESTO, (p) => [p.raiz, '--aplicar'], mudado());
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /--backup-dir/);
  assert.equal(r.registros.length, 0);
});

test('simulação não grava nem exige backup', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()] }, MANIFESTO, (p) => [p.raiz], mudado());
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /atualizaria/);
  assert.equal(escritas(r).length, 0);
});

test('recusa alvo com tag platform e com nome ORLA ·, sem escrever', async () => {
  const comTag = await rodar({ implantados: [fluxoImplantado({ tags: [{ name: 'platform' }] })] }, MANIFESTO, aplicar, mudado());
  assert.equal(comTag.codigo, 1);
  assert.match(comTag.saida, /plataforma/);
  assert.equal(escritas(comTag).length, 0);
  assert.equal(readdirSync(join(comTag.pasta.backup, '..')).length, 0, 'nenhum backup para alvo recusado');

  const nome = 'ORLA · Meta Ads · coletor';
  const orla = await rodar(
    { implantados: [fluxoImplantado({ name: nome })] },
    { 'clientes/a.json': { id: 'w1', nome } },
    aplicar,
    modelo({ name: nome, nodes: [no({ parameters: { jsCode: 'x' } })] }),
  );
  assert.equal(orla.codigo, 1);
  assert.equal(escritas(orla).length, 0);
});

test('nome divergente, id inexistente e arquivo fora do manifesto são erro definitivo', async () => {
  const divergente = await rodar({ implantados: [fluxoImplantado({ name: 'Outro nome' })] }, MANIFESTO, aplicar, mudado());
  assert.equal(divergente.codigo, 1);
  assert.match(divergente.saida, /nome divergente/);
  const inexistente = await rodar({ implantados: [] }, MANIFESTO, aplicar, mudado());
  assert.equal(inexistente.codigo, 1);
  assert.match(inexistente.saida, /não existe workflow com o id w1/);
  const fora = await rodar({ implantados: [fluxoImplantado()] }, {}, aplicar, mudado());
  assert.equal(fora.codigo, 1);
  assert.match(fora.saida, /fora do manifesto/);
  for (const r of [divergente, inexistente, fora]) assert.equal(escritas(r).length, 0);
});

test('manifesto ausente ou inválido é erro definitivo', async () => {
  const ausente = await rodar({ implantados: [] }, null, (p) => [p.raiz]);
  assert.equal(ausente.codigo, 1);
  assert.match(ausente.saida, /manifesto ausente/);
  const invalido = await rodar({ implantados: [] }, { 'clientes/a.json': { id: '' } }, (p) => [p.raiz]);
  assert.equal(invalido.codigo, 1);
  assert.match(invalido.saida, /manifesto inválido/);
});

test('ativação falha: restaura o JSON anterior, reativa e sai com 1', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], ativacoesQueFalham: 1 }, MANIFESTO, aplicar, mudado());
  assert.equal(r.codigo, 1);
  const puts = r.registros.filter((x) => x.metodo === 'PUT');
  assert.equal(puts.length, 2);
  assert.deepEqual((puts[1]?.corpo as { nodes: unknown[] }).nodes, [no()]);
  assert.equal(r.registros.filter((x) => x.caminho.endsWith('/activate')).length, 2);
  assert.equal(r.fluxos.get('w1')?.active, true);
  assert.deepEqual(r.fluxos.get('w1')?.nodes, [no()]);
  assert.match(r.saida, /restaurado/);
});

test('restauração que também falha sai com 1 e aponta o backup', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], ativacoesQueFalham: 2 }, MANIFESTO, aplicar, mudado());
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /restaurar à mão a partir de/);
});

test('PUT recusado (HTTP 400) é definitivo, código 1', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], statusDoPut: 400 }, MANIFESTO, aplicar, mudado());
  assert.equal(r.codigo, 1);
});

test('n8n indisponível (conexão recusada e HTTP 503) sai com 2', async () => {
  const falso = await servidorFalso({ implantados: [] });
  const pasta = pastaDeTrabalho(MANIFESTO, modelo());
  const url = falso.url;
  await new Promise((ok) => falso.servidor.close(ok));
  const saida = saidaMuda();
  assert.equal(await executar([pasta.raiz], { N8N_API_URL: url, N8N_API_KEY: 'k' }, saida), 2, saida.linhas.join('\n'));

  const indisponivel = createServer((_req, res) => {
    res.writeHead(503);
    res.end('x');
  });
  await new Promise<void>((ok) => indisponivel.listen(0, '127.0.0.1', ok));
  try {
    const porta = (indisponivel.address() as AddressInfo).port;
    assert.equal(await executar([pasta.raiz], { N8N_API_URL: `http://127.0.0.1:${porta}`, N8N_API_KEY: 'k' }, saidaMuda()), 2);
  } finally {
    indisponivel.close();
  }
});

test('--propor-manifesto só lê: lista candidatos por nome exato e não grava', async () => {
  const r = await rodar(
    { implantados: [fluxoImplantado(), fluxoImplantado({ id: 'w2', name: 'ORLA · X', tags: [{ name: 'platform' }] })] },
    {},
    (p) => [p.raiz, '--propor-manifesto'],
    mudado(),
  );
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /clientes\/a\.json → id w1 nome "Credaz · Teste"/);
  assert.ok(r.registros.every((x) => x.metodo === 'GET'));
});

test('--propor-manifesto funciona sem manifesto e marca ausente e repetido', async () => {
  const ausente = await rodar({ implantados: [] }, null, (p) => [p.raiz, '--propor-manifesto']);
  assert.equal(ausente.codigo, 0);
  assert.match(ausente.saida, /sem candidato/);
  const repetido = await rodar({ implantados: [fluxoImplantado(), fluxoImplantado({ id: 'w2' })] }, null, (p) => [p.raiz, '--propor-manifesto']);
  assert.match(repetido.saida, /ambíguo.*w1, w2/);
});

test('argumentos inválidos saem com 1', async () => {
  assert.equal(await executar(['--nada'], {}, saidaMuda()), 1);
  assert.equal(await executar(['--aplicar', '--backup-dir'], {}, saidaMuda()), 1);
});

test('o manifesto versionado existe e é válido', () => {
  const bruto = JSON.parse(readFileSync(join(process.cwd(), 'n8n/clientes-manifesto.json'), 'utf8'));
  assert.equal(typeof bruto, 'object');
  for (const entrada of Object.values(bruto) as { id: string; nome: string }[]) assert.ok(entrada.id && entrada.nome);
});

test('fluxos que carregam dados pessoais não guardam execução manual', () => {
  for (const arquivo of ['clientes/credaz/rd-para-meta-conversoes.json', 'clientes/credaz/lead-meta-para-rd.json', 'agencia/meta-leads-entrada.json']) {
    const w = JSON.parse(readFileSync(join(process.cwd(), 'n8n/workflows', arquivo), 'utf8'));
    assert.equal(w.settings.saveManualExecutions, false, arquivo);
  }
});
