import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type No = { name: string; type: string; parameters: { jsCode?: string } };
type Modelo = { nodes: No[] };
type Item = { json: Record<string, unknown> };
type Saida = { falhas: { causa: string; detalhe: string | null }[] };

const carregar = (arquivo: string): Modelo => JSON.parse(readFileSync(`n8n/workflows/coletores/${arquivo}`, 'utf8')) as Modelo;

function executar(modelo: Modelo, nome: string, entrada: Item[], nos: Record<string, Item[]>): Item[] {
  const codigo = modelo.nodes.find((candidato) => candidato.name === nome)!.parameters.jsCode!;
  const referenciar = (outro: string) => ({ all: () => nos[outro]!, first: () => nos[outro]![0]!, item: nos[outro]?.[0] });
  const corpo = new Function('$input', '$json', '$', codigo) as (...argumentos: unknown[]) => Item[] | Item;
  const resultado = corpo({ all: () => entrada, first: () => entrada[0] }, entrada[0]?.json, referenciar);
  return Array.isArray(resultado) ? resultado : [resultado];
}

const recusa = (statusCode: number, erro: Record<string, unknown>): Item => ({ json: { statusCode, body: { error: erro } } });

const NEGADO = { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' };
const ESCOPO = { code: 403, status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] };
const SEM_TOKEN = { code: 401, status: 'UNAUTHENTICATED', message: 'Invalid Credentials' };

describe('coletor GBP: 403 PERMISSION_DENIED no local vira sem_acesso', () => {
  const modelo = carregar('coletor-gbp.json');
  const entrada: Item[] = [{ json: { fonte: { externalId: 'locations/5995296073319112201', comDimensoes: false }, janela: { start: '2026-11-01', end: '2026-11-03' }, modo: 'incremental' } }];
  const requisicoes = executar(modelo, 'Montar requisição', entrada, {});
  const rodar = (resposta: Item) => executar(modelo, 'Normalizar', requisicoes.map(() => resposta), { 'Montar requisição': requisicoes })[0]!.json as unknown as Saida;

  it('mensagem clara com o id do local', () => {
    const resultado = rodar(recusa(403, NEGADO));
    assert.equal(resultado.falhas[0]!.causa, 'sem_acesso');
    assert.equal(resultado.falhas[0]!.detalhe, 'Sem permissão no local 5995296073319112201 — a conta autorizada não gerencia este local');
  });

  it('escopo insuficiente e 401 continuam reauth_pending', () => {
    assert.equal(rodar(recusa(403, ESCOPO)).falhas[0]!.causa, 'reauth_pending');
    assert.equal(rodar(recusa(401, SEM_TOKEN)).falhas[0]!.causa, 'reauth_pending');
  });
});

describe('coletores Google: 403 PERMISSION_DENIED no recurso vira sem_acesso', () => {
  it('Search Console', () => {
    const modelo = carregar('coletor-searchconsole.json');
    const montado = executar(modelo, 'Montar requisição', [{ json: { fonte: { externalId: 'sc-domain:x.com' }, janela: { start: '2026-11-01', end: '2026-11-01' }, modo: 'incremental' } }], {});
    const referencia = (nome: string) => ({ first: () => (nome === 'Montar requisição' ? montado[0]! : { json: { respostas: nome === 'Fechar padrao' ? [recusa(403, NEGADO).json] : [] } }), all: () => [] });
    const codigo = modelo.nodes.find((no) => no.name === 'Normalizar')!.parameters.jsCode!;
    const normalizar = new Function('$', codigo) as (r: typeof referencia) => Item[];
    const resultado = normalizar(referencia)[0]!.json as unknown as Saida;
    assert.equal(resultado.falhas[0]!.causa, 'sem_acesso');
    assert.match(resultado.falhas[0]!.detalhe ?? '', /^Sem permissão no site sc-domain:x\.com/);
  });

  it('Google Ads: campanha obrigatória negada é sem_acesso; developer token continua api_recusou', () => {
    const modelo = carregar('coletor-google-ads.json');
    const pedidos = executar(modelo, 'Montar requisição', [{ json: { fonte: { externalId: '123-456-7890', currency: 'BRL', comDimensoes: false }, janela: { start: '2026-11-01', end: '2026-11-01' }, modo: 'incremental' } }], {});
    const rodar = (erro: Record<string, unknown>) => executar(modelo, 'Normalizar', pedidos.map(() => recusa(403, erro)), { 'Montar requisição': pedidos })[0]!.json as unknown as Saida;
    assert.equal(rodar(NEGADO).falhas[0]!.causa, 'sem_acesso');
    assert.equal(rodar({ code: 403, status: 'PERMISSION_DENIED', message: 'DEVELOPER_TOKEN_NOT_APPROVED' }).falhas[0]!.causa, 'api_recusou');
  });
});

describe('contrato e orquestrador conhecem sem_acesso', () => {
  it('constante, contrato e fluxos de coleta aceitam o nível de acesso como aviso', () => {
    const contratos = readFileSync('src/shared/config/contracts.ts', 'utf8');
    assert.match(contratos, /'limite_de_uso', 'sem_acesso'/);
    assert.match(contratos, /'parcial_aceita', 'nivel_de_acesso'/);
    for (const arquivo of ['coleta-orquestrador.json', 'coleta-backfill-janela.json']) {
      const modelo = JSON.parse(readFileSync(`n8n/workflows/${arquivo}`, 'utf8')) as Modelo;
      assert.ok(modelo.nodes.some((no) => String(no.parameters.jsCode ?? '').includes("'nivel_de_acesso'")), arquivo);
    }
  });
});
