import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, signIn } from './helpers.mjs';

const VALIDADOR_DE_DESTINO = join('src', 'modules', 'clients', 'domain', 'destino', 'urlDeDestino.ts');

function arquivosDe(raiz, extensoes) {
  const encontrados = [];

  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome === '.next') continue;

    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...arquivosDe(caminho, extensoes));
    } else if (extensoes.some((ext) => nome.endsWith(ext))) {
      encontrados.push(caminho);
    }
  }

  return encontrados;
}

describe('endereços do app', () => {
  it('nenhum redirecionamento é construído a partir da requisição', () => {
    const suspeitos = [];

    for (const caminho of [...arquivosDe('app', ['.ts', '.tsx']), 'proxy.ts']) {
      const conteudo = readFileSync(caminho, 'utf8');

      for (const padrao of ['request.url', 'nextUrl.clone()']) {
        if (conteudo.includes(padrao)) suspeitos.push(`${caminho}: ${padrao}`);
      }
    }

    assert.deepEqual(
      suspeitos,
      [],
      'atrás do proxy a requisição reporta 0.0.0.0:3000; use TRIA_APP_BASE_URL',
    );
  });

  it('o código de produção não cita endereço local', () => {
    const citacoes = [];
    const locais = ['localhost', '0.0.0.0', '127.0.0.1'];

    for (const caminho of [...arquivosDe('app', ['.ts', '.tsx']), ...arquivosDe('src', ['.ts'])]) {
      if (caminho.includes('.test.')) continue;
      if (caminho === VALIDADOR_DE_DESTINO) continue;

      const conteudo = readFileSync(caminho, 'utf8');
      for (const local of locais) {
        if (conteudo.includes(local)) citacoes.push(`${caminho}: ${local}`);
      }
    }

    assert.deepEqual(citacoes, [], 'endereço local embutido no código que roda na nuvem');
  });
});

describe('redirecionamentos em execução', () => {
  it('a guarda manda para o endereço público, não para o interno', async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    const resposta = await browse('/clientes');
    const destino = resposta.headers.get('location') ?? '';

    const interno = ['0.0.0.0', '127.0.0.1', ':3000'].some(
      (marca) => destino.includes(marca) && !destino.startsWith(BASE),
    );

    assert.ok(!interno, `destino aponta para o host interno: ${destino}`);
    assert.ok(
      destino.startsWith('/') || destino.startsWith(BASE),
      `destino nem relativo nem na base: ${destino}`,
    );
  });

  it('o retorno do OAuth com erro também usa o endereço público', async () => {
    signIn(ensureUser('enderecos@tria.local'));

    const resposta = await browse('/api/oauth/tiktok/start');
    const destino = resposta.headers.get('location') ?? '';

    assert.ok(!destino.includes('0.0.0.0'), `destino aponta para o host interno: ${destino}`);
  });
});
