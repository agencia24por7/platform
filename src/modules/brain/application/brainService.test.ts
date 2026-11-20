import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const fx = await import('../testes/fixtures.ts');
const { createBrainService } = await import('./brainService.ts');
const { PROVEDORES } = await import('../infrastructure/provedores/index.ts');
const { objetosDeMedicao } = await import('../infrastructure/provedores/dados.ts');
const { DEFINICOES_DE_CAPACIDADES } = await import('../dados/capacidades.ts');
const { CONECTORES_POSSIVEIS, plataformasDaTabela } = await import('../dados/registro.ts');
const { criarArmazenamentoNulo } = await import('../../../shared/storage/armazenamentoNulo.ts');
const { criarUrn } = await import('../domain/urn.ts');
const { carregadorDoServicoDeContexto } = await import('../infrastructure/carregadorDeContexto.ts');
const { CARREGADOR_DE_CONTEXTO_INDISPONIVEL } = await import('../domain/contexto.ts');

type Chamadas = Record<string, number>;
type Estado = { publicadoEm: Date | null; ultimoHash: string | null; pendente: boolean; ultimaTentativaEm: Date | null; ultimoErro: string | null; tentativas: number };

const WORKER = { requestId: 'r', callerFingerprint: 'f', sourceIp: null };

function repositorio(opcoes: { excluidos?: string[]; estado?: Estado | null } = {}) {
  const chamadas: Chamadas = {};
  const conta = (nome: string) => { chamadas[nome] = (chamadas[nome] ?? 0) + 1; };
  let estado = opcoes.estado ?? null;
  const falhas: string[] = [];
  const cobertura: unknown[] = [];
  const repo = {
    async resolverCliente(id: string) {
      conta('resolverCliente');
      return id === fx.CLIENTE ? { organizationId: fx.ORG, clienteId: fx.CLIENTE } : null;
    },
    async carregarInventario() { conta('carregarInventario'); return fx.inventario(); },
    async estado() { conta('estado'); return estado; },
    async registrarPublicacao(_c: unknown, p: { hash: string }) {
      conta('registrarPublicacao');
      estado = { publicadoEm: new Date(), ultimoHash: p.hash, pendente: false, ultimaTentativaEm: new Date(), ultimoErro: null, tentativas: 0 };
    },
    async registrarFalha(_c: unknown, erro: string) { conta('registrarFalha'); falhas.push(erro); },
    async marcarPendente() { conta('marcarPendente'); if (estado) estado = { ...estado, pendente: true }; },
    async clientesParaPublicar() { conta('clientesParaPublicar'); return [{ organizationId: fx.ORG, clienteId: fx.CLIENTE }]; },
    async clientesExcluidosPublicados() { conta('clientesExcluidosPublicados'); return (opcoes.excluidos ?? []).map((clienteId) => ({ organizationId: fx.ORG, clienteId })); },
    async marcarDespublicado() { conta('marcarDespublicado'); },
    async clientesParaMedir() { conta('clientesParaMedir'); return [{ organizationId: fx.ORG, clienteId: fx.CLIENTE, plataformas: ['meta', 'ga4'] }]; },
    async gravarCobertura(_c: unknown, medidas: readonly unknown[]) { conta('gravarCobertura'); cobertura.push(...medidas); },
  };
  return { repo, chamadas, falhas, cobertura, estadoAtual: () => estado };
}

function armazenamentoEmMemoria() {
  const objetos = new Map<string, string>();
  const operacoes: string[] = [];
  return {
    objetos,
    operacoes,
    armazenamento: {
      disponivel: true,
      async put(caminho: string, corpo: Buffer) { operacoes.push(`put:${caminho}`); objetos.set(caminho, corpo.toString('utf8')); return { generation: '1', size: corpo.length }; },
      async get() { return null; },
      async list(prefixo: string) { return { items: [...objetos.keys()].filter((k) => k.startsWith(prefixo)).map((path) => ({ path, size: 1, updatedAt: '', contentType: 'application/json' })) }; },
      async delete(caminho: string) { operacoes.push(`delete:${caminho}`); objetos.delete(caminho); },
      async deletePrefix(prefixo: string) {
        operacoes.push(`deletePrefix:${prefixo}`);
        let n = 0;
        for (const k of [...objetos.keys()]) if (k.startsWith(prefixo)) { objetos.delete(k); n += 1; }
        return { deleted: n };
      },
      async saudavel() { return true; },
    },
  };
}

function auditoria() {
  const eventos: { action: string; metadata?: Record<string, unknown> }[] = [];
  return { eventos, audit: { record: async (e: { action: string; metadata?: Record<string, unknown> }) => { eventos.push(e); }, list: async () => [], search: async () => [] } };
}

function servico(opcoes: { repo?: ReturnType<typeof repositorio>; armazenamento?: ReturnType<typeof armazenamentoEmMemoria>['armazenamento'] | ReturnType<typeof criarArmazenamentoNulo>; medidorDisponivel?: boolean; contexto?: boolean } = {}) {
  const repo = opcoes.repo ?? repositorio();
  const { audit, eventos } = auditoria();
  const medidas: string[] = [];
  const s = createBrainService({
    repositorio: repo.repo,
    contexto: opcoes.contexto === false
      ? CARREGADOR_DE_CONTEXTO_INDISPONIVEL
      : carregadorDoServicoDeContexto({ carregar: async () => ({ ok: true as const, value: fx.contexto() }) }),
    armazenamento: opcoes.armazenamento ?? armazenamentoEmMemoria().armazenamento,
    medidor: {
      disponivel: opcoes.medidorDisponivel ?? true,
      async medir(_c, objetos) {
        medidas.push(...objetos.map((o) => o.tabela));
        return objetos.map((o) => ({ tabela: o.tabela, desde: '2026-01-01', ate: '2026-11-19', linhas: 10, diasComDado: o.dimensao ? null : 5 }));
      },
    },
    audit,
    provedores: PROVEDORES,
    capacidades: DEFINICOES_DE_CAPACIDADES,
    conectores: CONECTORES_POSSIVEIS,
    plataformasDaTabela,
    objetosDeMedicao,
    configuracao: { conjuntoDeDados: 'tria_dw', bytesMaximosPorConsulta: 10_000_000_000, diasDeMedicao: 400 },
    relogio: () => fx.AGORA,
  });
  return { s, repo, eventos, medidas };
}

describe('API de leitura do brain (serviço)', () => {
  it('cliente desconhecido, id inválido ou excluído responde não encontrado', async () => {
    const { s } = servico();
    for (const id of [fx.OUTRO_CLIENTE, 'nao-e-uuid']) {
      const r = await s.catalogo(id, { limite: 50, cursor: null }, WORKER);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, 'not_found');
    }
  });

  it('pagina com filtros, devolve schemaVersion e ETag estável; audita só contagens', async () => {
    const { s, eventos } = servico();
    const a = await s.catalogo(fx.CLIENTE, { tipo: 'tabela_de_dados', limite: 5, cursor: null }, WORKER);
    const b = await s.catalogo(fx.CLIENTE, { tipo: 'tabela_de_dados', limite: 5, cursor: null }, WORKER);
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(a.value.etag, b.value.etag);
    assert.equal(a.value.corpo.schemaVersion, 1);
    assert.equal(a.value.corpo.entradas.length, 5);
    assert.ok(a.value.corpo.total > 5);
    assert.ok(a.value.corpo.proximoCursor);
    const c = await s.catalogo(fx.CLIENTE, { tipo: 'tabela_de_dados', limite: 5, cursor: a.value.corpo.proximoCursor }, WORKER);
    assert.ok(c.ok && c.value.etag !== a.value.etag);
    const consulta = eventos.find((e) => e.action === 'brain.consulta')!;
    assert.deepEqual(Object.keys(consulta.metadata!).sort(), ['devolvidas', 'omitidas', 'restritas', 'rota', 'total']);
  });

  it('entrada: só URN do próprio cliente', async () => {
    const { s } = servico();
    const propria = criarUrn(fx.ORG, fx.CLIENTE, 'tabela_de_dados', 'fato_ads_diario');
    const r = await s.entrada(fx.CLIENTE, propria, WORKER);
    assert.ok(r.ok && r.value.corpo.urn === propria);
    const alheia = criarUrn(fx.ORG, fx.OUTRO_CLIENTE, 'tabela_de_dados', 'fato_ads_diario');
    const x = await s.entrada(fx.CLIENTE, alheia, WORKER);
    assert.ok(!x.ok && x.error.code === 'not_found');
  });

  it('capacidades, diagnóstico e manifesto saem com hash do catálogo', async () => {
    const { s } = servico();
    const cap = await s.capacidades(fx.CLIENTE, WORKER);
    const dia = await s.diagnostico(fx.CLIENTE, WORKER);
    const man = await s.manifest(fx.CLIENTE, WORKER);
    assert.ok(cap.ok && dia.ok && man.ok);
    if (!cap.ok || !dia.ok || !man.ok) return;
    assert.equal(cap.value.corpo.catalogHash, man.value.corpo.catalogHash);
    assert.equal(dia.value.corpo.catalogHash, man.value.corpo.catalogHash);
    assert.ok(cap.value.corpo.capacidades.length >= 10);
  });

  it('monta com número fixo de idas ao Postgres, mesmo com centenas de entradas', async () => {
    const repo = repositorio();
    const { s } = servico({ repo });
    await s.catalogo(fx.CLIENTE, { limite: 200, cursor: null }, WORKER);
    assert.deepEqual(repo.chamadas, { resolverCliente: 1, carregarInventario: 1 });
  });

  it('contexto que falha ao carregar não derruba o catálogo', async () => {
    const repo = repositorio();
    const { audit } = auditoria();
    const s = createBrainService({
      ...{ repositorio: repo.repo, audit },
      contexto: { disponivel: true, carregar: async () => { throw new Error('banco fora'); } },
      armazenamento: criarArmazenamentoNulo(),
      medidor: { disponivel: false, medir: async () => [] },
      provedores: PROVEDORES,
      capacidades: DEFINICOES_DE_CAPACIDADES,
      conectores: CONECTORES_POSSIVEIS,
      plataformasDaTabela,
      objetosDeMedicao,
      configuracao: { conjuntoDeDados: 'tria_dw', bytesMaximosPorConsulta: 1, diasDeMedicao: 400 },
      relogio: () => fx.AGORA,
    });
    const r = await s.montar(fx.CLIENTE);
    assert.ok(r.ok && r.value.provedores.find((p) => p.id === 'contexto')?.status === 'indisponivel');
  });
});

describe('publicação no bucket', () => {
  it('publica todos os artefatos, manifesto por último, e não regrava o mesmo hash', async () => {
    const memoria = armazenamentoEmMemoria();
    const repo = repositorio();
    const { s } = servico({ repo, armazenamento: memoria.armazenamento });
    const prefixo = `orgs/${fx.ORG}/clientes/${fx.CLIENTE}/brain/`;
    assert.equal(await s.publicar({ organizationId: fx.ORG, clienteId: fx.CLIENTE }), 'publicado');
    const puts = memoria.operacoes.filter((o) => o.startsWith('put:'));
    assert.equal(puts[puts.length - 1], `put:${prefixo}manifest.json`);
    for (const nome of ['catalogo.json', 'catalogo.md', 'capacidades.json', 'diagnostico.json']) assert.ok(memoria.objetos.has(`${prefixo}${nome}`), nome);
    assert.ok([...memoria.objetos.keys()].some((k) => k.startsWith(`${prefixo}entradas/`)));
    assert.ok([...memoria.objetos.keys()].every((k) => k.startsWith(prefixo)));
    const antes = memoria.operacoes.length;
    assert.equal(await s.publicar({ organizationId: fx.ORG, clienteId: fx.CLIENTE }), 'inalterado');
    assert.equal(memoria.operacoes.length, antes);
  });

  it('apaga entrada que saiu do catálogo', async () => {
    const memoria = armazenamentoEmMemoria();
    const velho = `orgs/${fx.ORG}/clientes/${fx.CLIENTE}/brain/entradas/fonte--velha.json`;
    memoria.objetos.set(velho, '{}');
    const { s } = servico({ armazenamento: memoria.armazenamento });
    await s.publicar({ organizationId: fx.ORG, clienteId: fx.CLIENTE });
    assert.ok(!memoria.objetos.has(velho));
  });

  it('sem bucket configurado degrada sem erro', async () => {
    const { s, repo } = servico({ armazenamento: criarArmazenamentoNulo() });
    const r = await s.publicarPendentes(WORKER, 10);
    assert.ok(r.ok && r.value.semArmazenamento === 1 && r.value.falhas === 0);
    assert.equal(repo.chamadas.registrarPublicacao, undefined);
  });

  it('falha de escrita fica registrada no estado e não para a varredura', async () => {
    const memoria = armazenamentoEmMemoria();
    const quebrado = { ...memoria.armazenamento, put: async () => { throw new Error('gcs 503'); } };
    const repo = repositorio();
    const { s, eventos } = servico({ repo, armazenamento: quebrado });
    const r = await s.publicarPendentes(WORKER, 10);
    assert.ok(r.ok && r.value.falhas === 1);
    assert.deepEqual(repo.falhas, ['gcs 503']);
    assert.ok(eventos.some((e) => e.action === 'brain.catalogo_publicado'));
  });

  it('cliente excluído tem o catálogo apagado do bucket', async () => {
    const memoria = armazenamentoEmMemoria();
    const prefixo = `orgs/${fx.ORG}/clientes/${fx.OUTRO_CLIENTE}/brain/`;
    memoria.objetos.set(`${prefixo}manifest.json`, '{}');
    const repo = repositorio({ excluidos: [fx.OUTRO_CLIENTE] });
    const { s } = servico({ repo, armazenamento: memoria.armazenamento });
    const r = await s.publicarPendentes(WORKER, 10);
    assert.ok(r.ok && r.value.despublicados === 1);
    assert.ok(![...memoria.objetos.keys()].some((k) => k.startsWith(prefixo)));
    assert.equal(repo.chamadas.marcarDespublicado, 1);
  });
});

describe('medição de cobertura', () => {
  it('mede só views das plataformas do cliente e marca o catálogo pendente', async () => {
    const repo = repositorio();
    const { s, medidas } = servico({ repo });
    const r = await s.medirCobertura(WORKER, 10);
    assert.ok(r.ok && r.value.clientes === 1 && r.value.tabelas > 0);
    assert.ok(medidas.includes('fato_ads_diario'));
    assert.ok(medidas.includes('fato_ga4_diario'));
    assert.ok(!medidas.some((t) => t.startsWith('fato_google_')));
    assert.ok(!medidas.includes('gov_snapshot_fontes'));
    assert.equal(repo.chamadas.marcarPendente, 1);
  });

  it('sem BigQuery responde indisponível', async () => {
    const { s } = servico({ medidorDisponivel: false });
    const r = await s.medirCobertura(WORKER, 10);
    assert.ok(!r.ok && r.error.code === 'unavailable');
  });
});
