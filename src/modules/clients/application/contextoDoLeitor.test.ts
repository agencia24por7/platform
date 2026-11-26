import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { ContextoRepository, RevisaoRegistrada } from '@/modules/clients/infrastructure/contextoRepository';
import type { MemberRole } from '@/modules/identity/domain/user';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createContextoService } = await import('./contextoService.ts');
const { adaptarArmazenamento } = await import('@/modules/clients/infrastructure/armazenamentoAdaptado.ts');
const { criarArmazenamentoNulo } = await import('@/shared/storage/armazenamentoNulo.ts');
const { ORG, CLIENTE, DATA, entrada, item, anexo } = await import('@/modules/clients/domain/contexto/fixturesDeTeste.ts');
const { calcularCompletude } = await import('@/modules/clients/domain/contexto/completude.ts');
const { recortarParaOCliente, revisaoVisivelAoCliente, chavesLegiveisPeloCliente } = await import(
  '@/modules/clients/domain/contexto/visaoDoCliente.ts'
);
const { SECOES } = await import('@/modules/clients/domain/contexto/catalogo.ts');

const NOTA = 'margem negociada com o fornecedor X';
const HIPOTESE = 'acho que o público é classe A';

const contexto = {
  campos: [
    entrada('segmento', 'Padaria', { compartilhavel: true }),
    entrada('nome_empresa', 'Pão Bom', { fonte: 'cliente', compartilhavel: true, epistemico: 'hipotese' }),
    entrada('notas_internas_empresa', NOTA, { compartilhavel: true, epistemico: 'fato', revisao: 'confirmado' }),
    entrada('notas_internas_marca', NOTA, { epistemico: 'hipotese' }),
    entrada('cidade', HIPOTESE, { compartilhavel: true, epistemico: 'hipotese' }),
    entrada('site', 'sugestão da IA', { compartilhavel: true, fonte: 'ia', revisao: 'sugerido', epistemico: 'hipotese' }),
    entrada('missao', 'missão interna', { compartilhavel: false }),
  ],
  itens: [
    item('marcas_admiradas', { nome: 'Visível' }, { id: '00000000-0000-4000-8000-0000000000a1', compartilhavel: true }),
    item('marcas_admiradas', { nome: 'Interna' }, { id: '00000000-0000-4000-8000-0000000000a2', compartilhavel: false }),
    item('marcas_admiradas', { nome: 'Sugerida' }, { id: '00000000-0000-4000-8000-0000000000a3', compartilhavel: true, revisao: 'sugerido' }),
  ],
  arquivos: [
    anexo('logo', 'logo.png', '33333333-3333-4333-8333-3333333333a1'),
    { ...anexo('logo', 'rascunho.png', '33333333-3333-4333-8333-3333333333a2'), compartilhavel: false },
  ],
};

function revisao(parcial: Partial<RevisaoRegistrada> & Pick<RevisaoRegistrada, 'id' | 'secao' | 'chave'>): RevisaoRegistrada {
  return {
    alvo: 'campo',
    itemId: null,
    operacao: 'alterar',
    antes: null,
    depois: null,
    versao: 2,
    autorId: null,
    linkId: null,
    em: DATA,
    ...parcial,
  };
}

const visivel = { epistemic: 'fato', source: 'equipe', review: 'confirmado', shareable: true };

const REVISOES: RevisaoRegistrada[] = [
  revisao({ id: 'r-visivel', secao: 'empresa', chave: 'segmento', antes: { ...visivel, value: 'A' }, depois: { ...visivel, value: 'B' } }),
  revisao({ id: 'r-nota', secao: 'empresa', chave: 'notas_internas_empresa', antes: null, depois: { ...visivel, value: NOTA }, operacao: 'criar' }),
  revisao({
    id: 'r-hipotese-antes',
    secao: 'empresa',
    chave: 'segmento',
    antes: { ...visivel, epistemic: 'hipotese', value: HIPOTESE },
    depois: { ...visivel, source: 'cliente', value: 'Padaria' },
    linkId: 'link-1',
  }),
  revisao({ id: 'r-interno-depois', secao: 'empresa', chave: 'segmento', antes: { ...visivel, value: 'B' }, depois: { ...visivel, shareable: false, value: 'B' }, operacao: 'status' }),
  revisao({ id: 'r-sem-marcas', secao: 'empresa', chave: 'segmento', antes: null, depois: { value: 'C' } }),
  revisao({ id: 'r-item-sugerido', alvo: 'item', secao: 'marca', chave: 'marcas_admiradas', itemId: 'x', antes: null, depois: { ...visivel, review: 'sugerido', data: { nome: 'Sugerida' } }, operacao: 'criar' }),
];

function montar() {
  const repositorio = {
    async carregar() {
      return {
        nome: 'Padaria',
        cadastro: { nome: 'Padaria', segmento: null, modeloDeOperacao: 'leads' as const, temRede: false, redeNome: null, criadoEm: new Date(0) },
        contexto,
      };
    },
    async estadoDoBrain() {
      return null;
    },
    async listarRevisoes() {
      return REVISOES;
    },
  } as unknown as ContextoRepository;

  return createContextoService({
    repositorio,
    audit: { record: async () => undefined, list: async () => [], search: async () => [] },
    armazenamento: adaptarArmazenamento(criarArmazenamentoNulo()),
    agora: () => DATA,
    limitar: () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
    agendador: () => ({ agendar: () => undefined }),
    esperarMs: async () => undefined,
  });
}

async function carregarComo(papel: MemberRole) {
  const r = await montar().carregar({ organizationId: ORG, clientId: CLIENTE, papelDeQuemLe: papel });
  assert.ok(r.ok);
  return r.value;
}

describe('o leitor vê o que o cliente vê', () => {
  it('leitor não recebe nota interna, hipótese, sugestão nem o que não é compartilhável', async () => {
    const dados = await carregarComo('viewer');
    assert.deepEqual(Object.keys(dados.campos).sort(), ['nome_empresa', 'segmento']);
    assert.ok(!JSON.stringify(dados).includes(NOTA));
    assert.ok(!JSON.stringify(dados).includes(HIPOTESE));
    assert.ok(!JSON.stringify(dados).includes('missão interna'));
    assert.deepEqual(dados.listas['marcas_admiradas']?.map((i) => i.dados['nome']), ['Visível']);
    assert.deepEqual(dados.arquivos.map((a) => a.nome), ['logo.png']);
    assert.equal(dados.usoDeArquivosBytes, 1024);
  });

  it('o catálogo do leitor não tem campo que só a equipe vê', async () => {
    const dados = await carregarComo('viewer');
    const chaves = dados.catalogo.flatMap((s) => s.campos.map((c) => c.key));
    assert.ok(chaves.length > 0);
    assert.ok(dados.catalogo.every((s) => s.campos.every((c) => c.visivelAoCliente)));
    assert.ok(!chaves.some((c) => c.startsWith('notas_internas_')));
  });

  it('completude e próximos campos do leitor saem do recorte, sem pista de conteúdo interno', async () => {
    const dados = await carregarComo('viewer');
    assert.deepEqual(dados.completude, calcularCompletude(recortarParaOCliente(contexto)));
    const legiveis = new Set(chavesLegiveisPeloCliente(SECOES));
    assert.ok(dados.proximos.every((p) => legiveis.has(p.fieldKey)));
    assert.ok(dados.proximos.every((p) => p.motivo !== 'sugestao_pendente'));
  });

  it('operador, administrador e dono recebem tudo', async () => {
    for (const papel of ['operator', 'admin', 'owner'] as const) {
      const dados = await carregarComo(papel);
      assert.equal(Object.keys(dados.campos).length, contexto.campos.length);
      assert.equal(dados.listas['marcas_admiradas']?.length, 3);
      assert.equal(dados.arquivos.length, 2);
      assert.ok(dados.catalogo.some((s) => s.campos.some((c) => c.key === 'notas_internas_empresa')));
    }
  });

  it('a visão do cliente pedida pelo Brain é a mesma do leitor', async () => {
    const servico = montar();
    const leitor = await servico.carregar({ organizationId: ORG, clientId: CLIENTE, papelDeQuemLe: 'viewer' });
    const doCliente = await servico.carregarNaVisao({ organizationId: ORG, clientId: CLIENTE }, 'cliente');
    assert.deepEqual(doCliente, leitor);
    const equipe = await servico.carregarNaVisao({ organizationId: ORG, clientId: CLIENTE }, 'equipe');
    assert.ok(equipe.ok && Object.keys(equipe.value.campos).length === contexto.campos.length);
  });
});

describe('histórico de revisões por papel', () => {
  it('leitor só vê revisão cujos estados eram todos visíveis ao cliente', async () => {
    const r = await montar().listarRevisoes({ organizationId: ORG, clientId: CLIENTE, papelDeQuemLe: 'viewer' });
    assert.ok(r.ok);
    assert.deepEqual(r.value.map((v) => v.id), ['r-visivel']);
    assert.ok(!JSON.stringify(r.value).includes(NOTA));
    assert.ok(!JSON.stringify(r.value).includes(HIPOTESE));
  });

  it('operador vê o histórico inteiro', async () => {
    const r = await montar().listarRevisoes({ organizationId: ORG, clientId: CLIENTE, papelDeQuemLe: 'operator' });
    assert.ok(r.ok);
    assert.equal(r.value.length, REVISOES.length);
  });

  it('revisão de seção ou chave fora do catálogo do cliente nunca é visível', () => {
    assert.equal(revisaoVisivelAoCliente({ secao: 'empresa', chave: 'notas_internas_empresa', antes: null, depois: visivel }), false);
    assert.equal(revisaoVisivelAoCliente({ secao: 'empresa', chave: 'segmento', antes: null, depois: null }), false);
    assert.equal(revisaoVisivelAoCliente({ secao: 'empresa', chave: 'segmento', antes: null, depois: visivel }), true);
    assert.equal(revisaoVisivelAoCliente({ secao: 'empresa', chave: 'segmento', antes: null, depois: visivel }, ['marca']), false);
  });
});
