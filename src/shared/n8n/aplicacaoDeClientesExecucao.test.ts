import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error script .mjs sem declaração de tipos
import { RETENCAO_DE_BACKUPS, ehDaPlataforma, executar, gravarBackup, listarArquivos, planejar, validarManifesto } from '../../../scripts/n8n-aplicar-clientes.mjs';

type Registro = { metodo: string; caminho: string; corpo: unknown };
type Fluxo = {
  id: string;
  name: string;
  active: boolean;
  nodes: unknown[];
  connections: object;
  settings: object;
  tags?: { name: string }[];
  pinData?: object;
  staticData?: object;
};
type Cenario = {
  implantados: Fluxo[];
  ativacoesQueFalham?: number;
  statusDoPut?: number;
  putsQueGravamEFalham?: number;
  ativacaoSemEfeito?: boolean;
  statusPorId?: Record<string, number>;
  semRespostaPorId?: string[];
};
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
  tags: [],
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
  let putsFalhos = cenario.putsQueGravamEFalham ?? 0;
  const servidor: Server = createServer(async (req, res) => {
    const corpo = await lerCorpo(req);
    const caminho = (req.url ?? '').replace('/api/v1', '');
    registros.push({ metodo: req.method ?? '', caminho, corpo });
    const responder = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.method === 'GET' && caminho.startsWith('/workflows?')) return responder(200, { data: [...fluxos.values()] });
    const id = decodeURIComponent(/^\/workflows\/([^/]+)/.exec(caminho)?.[1] ?? '');
    if (req.method === 'GET' && cenario.semRespostaPorId?.includes(id)) return;
    const statusForcado = cenario.statusPorId?.[id];
    if (req.method === 'GET' && statusForcado) return responder(statusForcado, { message: 'indisponível' });
    const fluxo = fluxos.get(id);
    if (!fluxo) return responder(404, { message: 'not found' });
    if (req.method === 'GET') return responder(200, fluxo);
    if (req.method === 'PUT') {
      if (cenario.statusDoPut) return responder(cenario.statusDoPut, { message: 'recusado' });
      if (putsFalhos > 0) {
        putsFalhos -= 1;
        Object.assign(fluxo, corpo);
        return responder(400, { message: 'falha ao registrar os gatilhos' });
      }
      Object.assign(fluxo, corpo, { active: false });
      return responder(200, fluxo);
    }
    if (req.method === 'POST' && caminho.endsWith('/activate')) {
      if (ativacoesFalhas > 0) {
        ativacoesFalhas -= 1;
        return responder(400, { message: 'ativação recusada' });
      }
      if (!cenario.ativacaoSemEfeito) fluxo.active = true;
      return responder(200, fluxo);
    }
    return responder(405, {});
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  return { servidor, url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, registros, fluxos };
}

function pastaDeTrabalho(manifesto: object | null, arquivo: object, extras: Record<string, object>): Pasta {
  const raiz = mkdtempSync(join(tmpdir(), 'n8n-exec-'));
  mkdirSync(join(raiz, 'clientes'), { recursive: true });
  writeFileSync(join(raiz, 'clientes/a.json'), JSON.stringify(arquivo));
  for (const [nome, conteudo] of Object.entries(extras)) writeFileSync(join(raiz, nome), JSON.stringify(conteudo));
  if (manifesto) writeFileSync(join(raiz, 'clientes-manifesto.json'), JSON.stringify(manifesto));
  return { raiz, backup: join(mkdtempSync(join(tmpdir(), 'n8n-bkp-')), 'cofre') };
}

function saidaMuda() {
  const linhas: string[] = [];
  return { linhas, log: (m: string) => linhas.push(m), error: (m: string) => linhas.push(m) };
}

type Opcoes = { arquivo?: object; extras?: Record<string, object>; ambiente?: Record<string, string> };

async function rodar(cenario: Cenario, manifesto: object | null, args: (p: Pasta) => string[], opcoes: Opcoes = {}) {
  const falso = await servidorFalso(cenario);
  const pasta = pastaDeTrabalho(manifesto, opcoes.arquivo ?? modelo(), opcoes.extras ?? {});
  const saida = saidaMuda();
  try {
    const codigo: number = await executar(args(pasta), { N8N_API_URL: falso.url, N8N_API_KEY: 'chave-de-teste', ...opcoes.ambiente }, saida);
    return { codigo, saida: saida.linhas.join('\n'), registros: falso.registros, fluxos: falso.fluxos, pasta };
  } finally {
    falso.servidor.closeAllConnections();
    falso.servidor.close();
  }
}

const aplicar = (p: Pasta) => [p.raiz, '--aplicar', '--backup-dir', p.backup];
const escritas = (r: { registros: Registro[] }) => r.registros.filter((x) => x.metodo !== 'GET');
const comMudanca: Opcoes = { arquivo: mudado() };

test('aplica pelo id do manifesto, confere o resultado e grava backup 0600 sem pinData nem staticData', async () => {
  const implantado = fluxoImplantado({ pinData: { Passo: [{ json: { a: 1 } }] }, staticData: { global: { x: 1 } } });
  const r = await rodar({ implantados: [implantado] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 0, r.saida);
  assert.deepEqual(
    r.registros.map((x) => `${x.metodo} ${x.caminho}`),
    ['GET /workflows/w1', 'GET /workflows/w1', 'PUT /workflows/w1', 'POST /workflows/w1/activate', 'GET /workflows/w1'],
  );
  assert.match(r.saida, /conferido/);
  const arquivos = readdirSync(r.pasta.backup);
  assert.equal(arquivos.length, 1);
  const [nomeDoBackup = ''] = arquivos;
  assert.match(nomeDoBackup, /^w1-.*\.json$/);
  assert.equal(statSync(join(r.pasta.backup, nomeDoBackup)).mode & 0o777, 0o600);
  assert.equal(statSync(r.pasta.backup).mode & 0o777, 0o700);
  const guardado = JSON.parse(readFileSync(join(r.pasta.backup, nomeDoBackup), 'utf8'));
  assert.deepEqual(Object.keys(guardado).sort(), ['active', 'connections', 'name', 'nodes', 'settings']);
  assert.equal(guardado.active, true);
  assert.deepEqual(guardado.nodes, [no()]);
});

test('workflow inativo é aplicado sem ativar e confere que continua inativo', async () => {
  const r = await rodar({ implantados: [fluxoImplantado({ active: false })] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 0, r.saida);
  assert.equal(r.registros.filter((x) => x.caminho.endsWith('/activate')).length, 0);
  assert.equal(r.fluxos.get('w1')?.active, false);
});

test('--aplicar sem --backup-dir recusa antes de qualquer chamada', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()] }, MANIFESTO, (p) => [p.raiz, '--aplicar'], comMudanca);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /--backup-dir/);
  assert.equal(r.registros.length, 0);
});

test('simulação não grava nem exige backup', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()] }, MANIFESTO, (p) => [p.raiz], comMudanca);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /atualizaria/);
  assert.equal(escritas(r).length, 0);
});

test('recusa alvo com tag platform e com nome ORLA ·, sem escrever', async () => {
  const comTag = await rodar({ implantados: [fluxoImplantado({ tags: [{ name: 'platform' }] })] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(comTag.codigo, 1);
  assert.match(comTag.saida, /plataforma/);
  assert.equal(escritas(comTag).length, 0);
  assert.equal(readdirSync(join(comTag.pasta.backup, '..')).length, 0, 'nenhum backup para alvo recusado');

  const nome = 'ORLA · Meta Ads · coletor';
  const orla = await rodar(
    { implantados: [fluxoImplantado({ name: nome })] },
    { 'clientes/a.json': { id: 'w1', nome } },
    aplicar,
    { arquivo: modelo({ name: nome, nodes: [no({ parameters: { jsCode: 'x' } })] }) },
  );
  assert.equal(orla.codigo, 1);
  assert.equal(escritas(orla).length, 0);
});

test('nome com NBSP, largura total e caixa diferente ainda é reconhecido como da plataforma', async () => {
  assert.equal(ehDaPlataforma({ name: 'ORLA · Meta' }), true);
  assert.equal(ehDaPlataforma({ name: '  orla   ·  meta' }), true);
  assert.equal(ehDaPlataforma({ name: 'ＯＲＬＡ · meta' }), true);
  assert.equal(ehDaPlataforma({ name: 'Credaz', tags: [{ name: ' PLATFORM ' }] }), true);
  assert.equal(ehDaPlataforma({ name: 'Credaz', tags: [{ name: 'Plat form' }] }), false);
  const nome = 'orla · Meta Ads';
  const r = await rodar(
    { implantados: [fluxoImplantado({ name: nome })] },
    { 'clientes/a.json': { id: 'w1', nome } },
    aplicar,
    { arquivo: modelo({ name: nome, nodes: [no({ parameters: { jsCode: 'x' } })] }) },
  );
  assert.equal(r.codigo, 1);
  assert.equal(escritas(r).length, 0);
  const comTagEmCaixaAlta = await rodar({ implantados: [fluxoImplantado({ tags: [{ name: ' PLATFORM ' }] })] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(comTagEmCaixaAlta.codigo, 1);
  assert.equal(escritas(comTagEmCaixaAlta).length, 0);
});

test('GET por id sem o array de tags é recusado', async () => {
  const semTags = fluxoImplantado();
  delete semTags.tags;
  const r = await rodar({ implantados: [semTags] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /não devolveu as tags/);
  assert.equal(escritas(r).length, 0);
  assert.equal(planejar(modelo(), { id: 'w1', nome: 'Credaz · Teste' }, { ...modelo(), id: 'w1' }).acao, 'tags-ausentes');
});

test('nome divergente, id inexistente e arquivo fora do manifesto são erro definitivo', async () => {
  const divergente = await rodar({ implantados: [fluxoImplantado({ name: 'Outro nome' })] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(divergente.codigo, 1);
  assert.match(divergente.saida, /nome divergente/);
  const inexistente = await rodar({ implantados: [] }, MANIFESTO, aplicar, comMudanca);
  assert.equal(inexistente.codigo, 1);
  assert.match(inexistente.saida, /não existe workflow com o id w1/);
  const fora = await rodar({ implantados: [fluxoImplantado()] }, {}, aplicar, comMudanca);
  assert.equal(fora.codigo, 1);
  assert.match(fora.saida, /fora do manifesto/);
  for (const r of [divergente, inexistente, fora]) assert.equal(escritas(r).length, 0);
});

test('manifesto ausente, inválido ou com id repetido é erro definitivo', async () => {
  const ausente = await rodar({ implantados: [] }, null, (p) => [p.raiz]);
  assert.equal(ausente.codigo, 1);
  assert.match(ausente.saida, /manifesto ausente/);
  const invalido = await rodar({ implantados: [] }, { 'clientes/a.json': { id: '' } }, (p) => [p.raiz]);
  assert.equal(invalido.codigo, 1);
  assert.match(invalido.saida, /manifesto inválido/);
  const duplicado = { 'clientes/a.json': { id: 'w1', nome: 'A' }, 'clientes/b.json': { id: 'w1', nome: 'B' } };
  assert.throws(() => validarManifesto(duplicado), /mais de um arquivo/);
  const r = await rodar({ implantados: [] }, duplicado, (p) => [p.raiz]);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /mais de um arquivo/);
});

test('PUT que grava e devolve 400: detecta a mudança, restaura o backup e sai com 1', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], putsQueGravamEFalham: 1 }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 1, r.saida);
  const puts = r.registros.filter((x) => x.metodo === 'PUT');
  assert.equal(puts.length, 2);
  assert.deepEqual((puts[1]?.corpo as { nodes: unknown[] }).nodes, [no()]);
  assert.deepEqual(r.fluxos.get('w1')?.nodes, [no()]);
  assert.equal(r.fluxos.get('w1')?.active, true);
  assert.match(r.saida, /restaurado/);
  assert.doesNotMatch(r.saida, /conferido/);
});

test('PUT recusado sem gravar nada não dispara restauração', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], statusDoPut: 400 }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 1);
  assert.equal(r.registros.filter((x) => x.metodo === 'PUT').length, 1);
  assert.doesNotMatch(r.saida, /restaurado/);
});

test('ativação falha: restaura o JSON anterior, reativa e sai com 1', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], ativacoesQueFalham: 1 }, MANIFESTO, aplicar, comMudanca);
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
  const r = await rodar({ implantados: [fluxoImplantado()], ativacoesQueFalham: 2 }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /restaurar à mão a partir de/);
});

test('ativação que responde 200 sem efeito é pega pela conferência, restaura e sai com 1', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], ativacaoSemEfeito: true }, MANIFESTO, aplicar, comMudanca);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /conferência após aplicar falhou/);
  assert.doesNotMatch(r.saida, /conferido/);
});

for (const status of [502, 503, 504]) {
  test(`n8n respondendo ${status} sai com 2`, async () => {
    const r = await rodar({ implantados: [fluxoImplantado()], statusPorId: { w1: status } }, MANIFESTO, aplicar, comMudanca);
    assert.equal(r.codigo, 2, r.saida);
    assert.equal(escritas(r).length, 0);
  });
}

test('timeout sai com 2', async () => {
  const r = await rodar({ implantados: [fluxoImplantado()], semRespostaPorId: ['w1'] }, MANIFESTO, aplicar, { arquivo: mudado(), ambiente: { N8N_API_TIMEOUT_MS: '150' } });
  assert.equal(r.codigo, 2, r.saida);
});

test('conexão recusada sai com 2', async () => {
  const falso = await servidorFalso({ implantados: [] });
  const pasta = pastaDeTrabalho(MANIFESTO, modelo(), {});
  const url = falso.url;
  await new Promise((ok) => falso.servidor.close(ok));
  const saida = saidaMuda();
  assert.equal(await executar([pasta.raiz], { N8N_API_URL: url, N8N_API_KEY: 'k' }, saida), 2, saida.linhas.join('\n'));
});

test('erro definitivo e erro de conexão na mesma execução saem com 1', async () => {
  const manifesto = { ...MANIFESTO, 'clientes/b.json': { id: 'w2', nome: 'Outro' } };
  const r = await rodar(
    { implantados: [fluxoImplantado()], statusPorId: { w1: 503 } },
    manifesto,
    (p) => [p.raiz],
    { arquivo: mudado(), extras: { 'clientes/b.json': modelo({ name: 'Outro' }) } },
  );
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /HTTP 503/);
  assert.match(r.saida, /não existe workflow com o id w2/);
});

test('--propor-manifesto só lê: lista candidatos por nome exato e não grava', async () => {
  const r = await rodar(
    { implantados: [fluxoImplantado(), fluxoImplantado({ id: 'w2', name: 'ORLA · X', tags: [{ name: 'platform' }] })] },
    {},
    (p) => [p.raiz, '--propor-manifesto'],
    comMudanca,
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

test('retenção: mantém só os últimos backups de cada id e não toca em outros ids', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'n8n-ret-')), 'cofre');
  const base = Date.UTC(2026, 10, 24, 12, 0, 0);
  for (let i = 0; i < RETENCAO_DE_BACKUPS + 2; i += 1) gravarBackup(dir, { id: 'w1', name: 'x', nodes: [], connections: {}, settings: {}, active: false }, new Date(base + i * 1000));
  gravarBackup(dir, { id: 'w2', name: 'y', nodes: [], connections: {}, settings: {}, active: false }, new Date(base));
  const arquivos = readdirSync(dir).sort();
  assert.equal(arquivos.filter((n) => n.startsWith('w1-')).length, RETENCAO_DE_BACKUPS);
  assert.equal(arquivos.filter((n) => n.startsWith('w2-')).length, 1);
  assert.ok(!arquivos.includes('w1-2026-11-24T12-00-00-000Z.json'));
  assert.ok(arquivos.includes('w1-2026-11-24T12-00-21-000Z.json'));
});

test('o manifesto versionado existe e é válido', () => {
  const bruto = JSON.parse(readFileSync(join(process.cwd(), 'n8n/clientes-manifesto.json'), 'utf8'));
  assert.equal(typeof bruto, 'object');
  validarManifesto(bruto);
});

test('todos os fluxos de clientes e da agência têm saveManualExecutions false', () => {
  const arquivos: string[] = listarArquivos(join(process.cwd(), 'n8n/workflows'));
  assert.ok(arquivos.length >= 6, 'a listagem de fluxos não pode vir vazia');
  for (const arquivo of arquivos) {
    const w = JSON.parse(readFileSync(arquivo, 'utf8'));
    assert.equal(w.settings?.saveManualExecutions, false, arquivo);
  }
});

const DIGEST = 'a'.repeat(64);
const trechoDeValidacaoDaImagem = (): string => {
  const yml = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
  const inicio = yml.indexOf('imagem="$IMAGEM_N8N_CLIENTES"');
  assert.ok(inicio > 0, 'validação da imagem não encontrada no deploy.yml');
  const fim = yml.indexOf('\n          fi\n', inicio);
  return yml.slice(inicio, fim + '\n          fi\n'.length);
};
const imagemAceita = (valor: string): boolean => {
  try {
    execFileSync('bash', ['-c', trechoDeValidacaoDaImagem()], { env: { ...process.env, IMAGEM_N8N_CLIENTES: valor }, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

test('deploy.yml valida a imagem do passo do n8n por digest', () => {
  assert.equal(imagemAceita(`node:22-alpine@sha256:${DIGEST}`), true);
  assert.equal(imagemAceita(`docker.io/library/node@sha256:${DIGEST}`), true);
  assert.equal(imagemAceita('node:22-alpine'), false);
  assert.equal(imagemAceita(''), false);
  assert.equal(imagemAceita(`node@sha256:${'a'.repeat(63)}`), false);
  assert.equal(imagemAceita(`node:22-alpine@sha256:${DIGEST}\nx`), false);
  assert.equal(imagemAceita(`x\nnode:22-alpine@sha256:${DIGEST}`), false);
  assert.equal(imagemAceita(`node:22-alpine@sha256:${DIGEST}\r`), false);
  assert.equal(imagemAceita(`node:22@sha256:${DIGEST};id`), false);
  assert.equal(imagemAceita(`node$(id)@sha256:${DIGEST}`), false);
  assert.equal(imagemAceita('node`id`@sha256:' + DIGEST), false);
  assert.equal(imagemAceita(`node @sha256:${DIGEST}`), false);
});

test('deploy.yml: timeout no passo do n8n, lock, trap completo e smoke condicionado ao passo', () => {
  const yml = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
  assert.match(yml, /id: n8n_clientes\n\s+timeout-minutes: 8/);
  assert.match(yml, /EXIT HUP INT TERM PIPE/);
  assert.match(yml, /flock -n 9/);
  assert.match(yml, /--cap-drop=ALL/);
  assert.match(yml, /no-new-privileges/);
  assert.match(yml, /if: \$\{\{ !cancelled\(\) && steps\.n8n_clientes\.conclusion != 'skipped' \}\}/);
});
