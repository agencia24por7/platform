import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error script .mjs sem declaração de tipos
import { assinatura, configuracaoPermitida, escolherImplantado, listarArquivos, mesclarComImplantado, planejar } from '../../../scripts/n8n-aplicar-clientes.mjs';

const no = (extra = {}) => ({ id: 'a', name: 'Passo', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return [];' }, ...extra });
const modelo = (extra = {}) => ({ name: 'Credaz · Teste', nodes: [no()], connections: {}, settings: { executionOrder: 'v1', errorWorkflow: 'x' }, ...extra });

test('assinatura ignora posição e id dos nós e campos de configuração desconhecidos', () => {
  const a = modelo();
  const b = modelo({ nodes: [no({ id: 'outro', position: [500, 900] })], settings: { executionOrder: 'v1', errorWorkflow: 'x', binaryMode: 'separate' } });
  assert.equal(assinatura(a), assinatura(b));
});

test('assinatura muda quando o código de um nó muda', () => {
  const b = modelo({ nodes: [no({ parameters: { jsCode: 'return [{ json: {} }];' } })] });
  assert.notEqual(assinatura(modelo()), assinatura(b));
});

test('configuração enviada à API só leva as chaves aceitas', () => {
  assert.deepEqual(configuracaoPermitida({ executionOrder: 'v1', binaryMode: 'separate', timezone: 'America/Recife' }), {
    executionOrder: 'v1',
    timezone: 'America/Recife',
  });
});

test('candidatos por nome para propor o manifesto: ausente, repetido, arquivado e da plataforma', () => {
  assert.deepEqual(escolherImplantado([], 'X'), { erro: 'ausente' });
  assert.deepEqual(escolherImplantado([{ id: '1', name: 'X' }, { id: '2', name: 'X' }], 'X'), { erro: 'repetido', ids: ['1', '2'] });
  assert.equal(escolherImplantado([{ id: '1', name: 'X', isArchived: true }, { id: '2', name: 'X' }], 'X').workflow.id, '2');
  assert.deepEqual(escolherImplantado([{ id: '1', name: 'X', tags: [{ name: 'platform' }] }], 'X'), { erro: 'ausente' });
});

const ENTRADA = { id: 'w1', nome: 'Credaz · Teste' };

test('planejar: igual, atualizar mantendo o estado ativo', () => {
  const implantado = { ...modelo(), id: 'w1', active: true };
  assert.equal(planejar(modelo(), ENTRADA, implantado).acao, 'igual');
  const mudado = modelo({ nodes: [no({ parameters: { jsCode: 'return [1];' } })] });
  assert.deepEqual(planejar(mudado, ENTRADA, implantado), { acao: 'atualizar', nome: 'Credaz · Teste', id: 'w1', ativo: true });
});

test('recusa arquivo com credencial de exemplo', () => {
  const comExemplo = modelo({ nodes: [no({ credentials: { facebookGraphApi: { id: 'a-definir-usuario', name: 'x' } } })] });
  assert.deepEqual(planejar(comExemplo, ENTRADA, { ...modelo(), id: 'w1' }), { acao: 'credencial-de-exemplo', nome: 'Credaz · Teste', nos: ['Passo'] });
});

test('planejar recusa alvo com tag platform e com nome ORLA ·', () => {
  const comTag = { ...modelo(), id: 'w1', tags: [{ id: 't', name: 'platform' }] };
  assert.equal(planejar(modelo(), ENTRADA, comTag).acao, 'alvo-da-plataforma');
  const orla = { ...modelo({ name: 'ORLA · Meta Ads · coletor' }), id: 'w1' };
  assert.equal(planejar(orla, { id: 'w1', nome: orla.name }, orla).acao, 'alvo-da-plataforma');
  assert.equal(planejar(modelo(), { id: 'w1', nome: orla.name }, orla).acao, 'alvo-da-plataforma');
});

test('planejar: fora do manifesto, id inexistente e nome divergente', () => {
  assert.equal(planejar(modelo(), undefined, undefined).acao, 'fora-do-manifesto');
  assert.equal(planejar(modelo(), ENTRADA, undefined).acao, 'id-inexistente');
  assert.equal(planejar(modelo(), { id: 'w1', nome: 'Outro' }, { ...modelo(), id: 'w1' }).acao, 'nome-divergente');
  assert.equal(planejar(modelo(), ENTRADA, { ...modelo({ name: 'Renomeado' }), id: 'w1' }).acao, 'nome-divergente');
});

test('webhookId gerado pelo n8n em nó comum não conta como diferença e é preservado', () => {
  const gmail = { ...no({ name: 'E-mail', type: 'n8n-nodes-base.gmail' }) };
  const repo = modelo({ nodes: [gmail] });
  const prod = modelo({ nodes: [{ ...gmail, webhookId: 'gerado-pelo-n8n' }] });
  assert.equal(assinatura(repo), assinatura(prod));
  assert.equal(mesclarComImplantado(repo, prod).nodes[0].webhookId, 'gerado-pelo-n8n');
});

test('webhookId do gatilho de webhook conta e não é sobrescrito pelo implantado', () => {
  const gatilho = no({ name: 'Aviso', type: 'n8n-nodes-base.webhook', webhookId: 'novo' });
  const prod = modelo({ nodes: [{ ...gatilho, webhookId: 'antigo' }] });
  assert.notEqual(assinatura(modelo({ nodes: [gatilho] })), assinatura(prod));
  assert.equal(mesclarComImplantado(modelo({ nodes: [gatilho] }), prod).nodes[0].webhookId, 'novo');
});

test('listarArquivos lê só clientes/ e agencia/, inclusive subpastas', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'n8n-clientes-'));
  for (const pasta of ['clientes/credaz', 'agencia', 'plataforma']) mkdirSync(join(raiz, pasta), { recursive: true });
  writeFileSync(join(raiz, 'clientes/credaz/a.json'), '{}');
  writeFileSync(join(raiz, 'agencia/b.json'), '{}');
  writeFileSync(join(raiz, 'plataforma/c.json'), '{}');
  writeFileSync(join(raiz, 'agencia/leia.md'), '');
  const nomes = listarArquivos(raiz).map((c: string) => c.slice(raiz.length + 1));
  assert.deepEqual(nomes, ['clientes/credaz/a.json', 'agencia/b.json']);
});
