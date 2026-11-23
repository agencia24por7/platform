import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const RAIZ = join(import.meta.dirname, '..', '..', '..');

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return entrada.name === 'node_modules' ? [] : arquivos(caminho);
    return /\.(ts|tsx|mjs)$/.test(entrada.name) && !/\.test\.ts$/.test(entrada.name) ? [caminho] : [];
  });
}

const fontes = [...arquivos('src'), ...arquivos('app')].map((caminho) => ({
  caminho: relative(RAIZ, join(RAIZ, caminho)),
  texto: readFileSync(join(RAIZ, caminho), 'utf8'),
}));

const ENTRADAS_PUBLICAS = [
  'app/api/auth/google/callback/route.ts',
  'app/api/contexto/publico/[token]/arquivos/route.ts',
  'app/api/convite/[token]/oauth/[platform]/start/route.ts',
  'app/api/meta/exclusao/route.ts',
  'app/api/webhooks/whatsapp/route.ts',
  'app/api/webhooks/zapi/[token]/route.ts',
  'app/api/oauth/[platform]/callback/route.ts',
  'app/contexto/_publico/PaginaPublica.tsx',
  'app/contexto/_publico/acoes.ts',
  'app/convite/[token]/page.tsx',
  'app/exclusao-de-dados/status/[codigo]/page.tsx',
  'src/modules/clients/application/contextoService.ts',
  'src/shared/db/client.ts',
  'src/shared/http/entradaPublica.ts',
].sort();

describe('fronteira do papel do worker (ADR 0028)', () => {
  it('só o workerRoute entra no contexto do worker', () => {
    const usam = fontes.filter((f) => /\bcomoWorker\b/.test(f.texto)).map((f) => f.caminho).sort();
    assert.deepEqual(usam, [
      'src/modules/alertas/application/alertaService.ts',
      'src/shared/db/client.ts',
      'src/shared/http/workerRoute.ts',
    ]);
  });

  it('toda rota /api/v0 passa pelo workerRoute', () => {
    const rotas = fontes.filter((f) => f.caminho.startsWith('app/api/v0/') && f.caminho.endsWith('route.ts'));
    assert.ok(rotas.length > 0);
    const fora = rotas.filter((f) => !/worker(Query)?Route\(/.test(f.texto)).map((f) => f.caminho);
    assert.deepEqual(fora, []);
  });

  it('nenhuma rota fora de /api/v0 usa o workerRoute', () => {
    const fora = fontes
      .filter((f) => f.caminho.startsWith('app/') && !f.caminho.startsWith('app/api/v0/'))
      .filter((f) => /worker(Query)?Route\(/.test(f.texto))
      .map((f) => f.caminho);
    assert.deepEqual(fora, []);
  });

  it('toda entrada que chega ao banco sem sessão declara a chamada pública (D\')', () => {
    const comSessao = /requireContext|currentUser|activeContext|carregarPainel|currentOrganization|workerRoute|workerQueryRoute|escopoDoClienteNaOrganizacao|contextoDoCliente|carregarContexto|carregarContas/;
    const isentas = [
      'app/api/auth/sair/route.ts',
      'app/api/portaria/route.ts',
      'app/api/portaria/_acesso.ts',
      'app/comecar/page.tsx',
      'app/clientes/[id]/_brain/fonte.ts',
    ];
    const sem = fontes
      .filter((f) => f.caminho.startsWith('app/') && /modules\(\)/.test(f.texto))
      .filter((f) => !comSessao.test(f.texto) && !isentas.includes(f.caminho))
      .filter((f) => !/entradaPublica|comoPublico/.test(f.texto))
      .map((f) => f.caminho);
    assert.deepEqual(sem, []);
  });

  it('só as entradas públicas e o cliente do banco usam o marcador comoPublico', () => {
    const usam = fontes.filter((f) => /\b(comoPublico|entradaPublica)\b/.test(f.texto)).map((f) => f.caminho).sort();
    assert.deepEqual(usam, ENTRADAS_PUBLICAS);
  });
});
