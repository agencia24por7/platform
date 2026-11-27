import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type {
  ErroDeEstrategia,
  EventoDaVersao,
  Execucao,
  LeitorDoBrain,
  Plano,
  RepositorioDeEstrategia,
  Versao,
} from '@/modules/strategy/application/portas';
import type { MemberRole } from '@/modules/identity/domain/user';
import {
  CATALOGOS_DE_TESTE,
  CLIENTE_ID,
  ORGANIZACAO_ID,
  URN_BENCHMARK_B,
  URN_DESEMPENHO,
  URN_LIMITE,
  hashDeTeste,
  pacoteDeTeste,
  planoCompleto,
  urnDeTeste,
} from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createEstrategiaService } = await import('./estrategiaService.ts');
type DestinoParaEstrategia = import('./estrategiaService.ts').DestinoParaEstrategia;
const { err, ok } = await import('../../../shared/result/result.ts');
const { referenciasImplicitasDoPacote } = await import('../domain/referencias.ts');

const ator = { userId: '99999999-9999-4999-8999-999999999999', requestId: 'req-1', sourceIp: '10.0.0.1' };
const como = (papelDeQuemAge: MemberRole) => ({ organizationId: ORGANIZACAO_ID, papelDeQuemAge });
const PLANO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSAO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INTENCAO = planoCompleto().intencao;

type Estado = {
  planos: Plano[];
  versoes: Versao[];
  eventos: EventoDaVersao[];
  execucoes: Execucao[];
  proximoId: number;
  clienteExiste: boolean;
  falharCriarVersao: ErroDeEstrategia | null;
};

function novoEstado(): Estado {
  return { planos: [], versoes: [], eventos: [], execucoes: [], proximoId: 1, clienteExiste: true, falharCriarVersao: null };
}

const idFalso = (estado: Estado) => `00000000-0000-4000-8000-${String(estado.proximoId++).padStart(12, '0')}`;

function criarRepositorio(estado: Estado): RepositorioDeEstrategia {
  const resumo = (v: Versao) => {
    const { conteudo: _c, referencias: _r, ...resto } = v;
    return resto;
  };
  const ativa = (planoId: string) => estado.execucoes.find((e) => e.planoId === planoId && (e.status === 'pendente' || e.status === 'rodando')) ?? null;
  const estadoDe = (plano: Plano) => {
    const doPlano = estado.versoes.filter((v) => v.planoId === plano.id);
    const recente = doPlano.at(-1);
    const vigente = doPlano.find((v) => v.status === 'vigente');
    const aberta = doPlano.find((v) => v.status === 'rascunho' || v.status === 'proposto');
    const execucoes = estado.execucoes.filter((e) => e.planoId === plano.id);
    const objetivo = execucoes.find((e) => e.tipo === 'criar')?.pedido.objetivo;
    return {
      plano,
      maisRecente: recente ? resumo(recente) : null,
      vigente: vigente ? resumo(vigente) : null,
      aberta: aberta ? resumo(aberta) : null,
      objetivo: typeof objetivo === 'string' ? objetivo : null,
      ultimaExecucao: execucoes.at(-1) ?? null,
      atualizadoEm: new Date('2026-11-25T12:00:00Z'),
    };
  };
  const repo: RepositorioDeEstrategia = {
    async clienteVisivel() {
      return estado.clienteExiste;
    },
    async buscarPlanoPorId(_org, id) {
      return estado.planos.find((p) => p.id === id) ?? null;
    },
    async clienteDoRecurso(_org, tipo, recursoId) {
      const lista = tipo === 'plano' ? estado.planos : tipo === 'versao' ? estado.versoes : estado.execucoes;
      return lista.find((item) => item.id === recursoId)?.clientId ?? null;
    },
    async criarPlanoComExecucao(escopo, novo, execucao) {
      const plano: Plano = {
        id: idFalso(estado),
        organizationId: escopo.organizationId,
        clientId: escopo.clientId,
        tipo: novo.tipo,
        plataformas: novo.plataformas,
        whatsapp: novo.whatsapp,
        landingPageId: novo.landingPageId,
        criadoEm: new Date(),
      };
      estado.planos.push(plano);
      const criada = await repo.criarExecucao(escopo.organizationId, escopo.clientId, { ...execucao, planoId: plano.id });
      if (!criada.ok) return err(criada.error);
      return ok({ plano, execucao: criada.value });
    },
    async listarPlanosDoCliente(escopo) {
      return estado.planos.filter((p) => p.clientId === escopo.clientId).map(estadoDe).reverse();
    },
    async estadoDoPlano(_org, planoId) {
      const plano = estado.planos.find((p) => p.id === planoId);
      return plano ? estadoDe(plano) : null;
    },
    async criarVersaoRascunho(org, nova) {
      if (estado.falharCriarVersao) return err(estado.falharCriarVersao);
      const plano = estado.planos.find((p) => p.id === nova.planoId)!;
      for (const aberta of estado.versoes.filter((v) => v.planoId === nova.planoId && (v.status === 'rascunho' || v.status === 'proposto'))) {
        (aberta as { status: string }).status = 'cancelado';
      }
      const versao: Versao = {
        id: idFalso(estado),
        planoId: plano.id,
        organizationId: org,
        clientId: plano.clientId,
        status: 'rascunho',
        schemaVersion: nova.schemaVersion,
        supersedesId: nova.supersedesId,
        autorTipo: nova.autoria.tipo === 'agente' ? 'agente' : 'usuario',
        autorUsuarioId: nova.autoria.tipo === 'pessoa' ? nova.autoria.userId : null,
        agentId: null,
        agentRunId: null,
        redigidaEm: null,
        criadaEm: new Date(),
        conteudo: nova.conteudo,
        referencias: nova.referencias,
      };
      estado.versoes.push(versao);
      return ok(versao);
    },
    async registrarEvento(_org, novo) {
      const versao = estado.versoes.find((v) => v.id === novo.versaoId);
      if (!versao) return err({ codigo: 'nao_encontrado', mensagem: 'x' });
      const evento: EventoDaVersao = {
        id: idFalso(estado),
        versaoId: novo.versaoId,
        tipo: novo.tipo,
        atorTipo: novo.autoria.tipo === 'agente' ? 'agente' : 'usuario',
        atorUsuarioId: novo.autoria.tipo === 'pessoa' ? novo.autoria.userId : null,
        agentId: null,
        agentRunId: null,
        payload: novo.payload,
        criadoEm: new Date(),
      };
      estado.eventos.push(evento);
      const alvo = { proposta: 'proposto', efetivada: 'vigente', rejeitada: 'rejeitado', revogada: 'revogado', cancelada: 'cancelado' } as Record<string, string>;
      if (alvo[novo.tipo]) (versao as { status: string }).status = alvo[novo.tipo]!;
      return ok(evento);
    },
    async lerVersao(_org, id) {
      return estado.versoes.find((v) => v.id === id) ?? null;
    },
    async listarVersoes(_org, planoId) {
      return estado.versoes.filter((v) => v.planoId === planoId).map(resumo).reverse();
    },
    async eventosDaVersao(_org, id) {
      return estado.eventos.filter((e) => e.versaoId === id);
    },
    async criarExecucao(org, clientId, nova) {
      if (ativa(nova.planoId)) return err({ codigo: 'execucao_ativa', mensagem: 'x' });
      const execucao: Execucao = {
        id: idFalso(estado),
        planoId: nova.planoId,
        organizationId: org,
        clientId,
        tipo: nova.pedido.tipo,
        pedido: nova.pedido.tipo === 'criar' ? { ...nova.pedido.intencao } : nova.pedido.tipo === 'ajustar' ? { instrucao: nova.pedido.instrucao } : { motivo: nova.pedido.motivo },
        versaoBaseId: nova.versaoBaseId,
        status: 'pendente',
        etapa: 'ler_brain',
        rodada: 0,
        tentativas: 0,
        falhas: 0,
        erroCodigo: null,
        agentRunId: nova.agentRunId,
        solicitadoPor: nova.solicitadoPor,
        solicitadoTipo: 'usuario',
        leaseAte: null,
        criadaEm: new Date(),
        atualizadaEm: new Date(),
      };
      estado.execucoes.push(execucao);
      return ok(execucao);
    },
    async lerExecucao(_org, id) {
      return estado.execucoes.find((e) => e.id === id) ?? null;
    },
    async execucaoAtiva(_org, planoId) {
      return ativa(planoId);
    },
    async ultimaExecucao(_org, planoId) {
      return estado.execucoes.filter((e) => e.planoId === planoId).at(-1) ?? null;
    },
    async cancelarExecucao(_org, id) {
      const execucao = estado.execucoes.find((e) => e.id === id)!;
      (execucao as { status: string }).status = 'cancelada';
      return ok(execucao);
    },
    async atualizarExecucao() {
      return err({ codigo: 'invalido', mensagem: 'não usado' });
    },
    async reservarProximaExecucao() {
      return null;
    },
    async reservarExecucao() {
      return null;
    },
    async descobrirExecucoesPendentes() {
      return [];
    },
    async criarVersaoManualComRevisao(org, clientId, versao, execucao) {
      if (ativa(execucao.planoId)) return err({ codigo: 'execucao_ativa', mensagem: 'x' });
      const criada = await repo.criarVersaoRascunho(org, versao);
      if (!criada.ok) return err(criada.error);
      const gravada = await repo.criarExecucao(org, clientId, { ...execucao, versaoBaseId: criada.value.id });
      if (!gravada.ok) return err(gravada.error);
      return ok({ versao: criada.value, execucao: gravada.value });
    },
  };
  return repo;
}

const brainOk: LeitorDoBrain = { async lerPacote() { return ok(pacoteDeTeste()); } };
const brainFora: LeitorDoBrain = { async lerPacote() { return err({ codigo: 'brain_indisponivel', mensagem: 'fora' }); } };

const LANDING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LANDING_ARQUIVADA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LANDING_DE_OUTRO_CLIENTE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

type OpcoesDoDestino = { whatsapp?: string | null };

function criarDestino(opcoes: OpcoesDoDestino = {}): DestinoParaEstrategia {
  const pagina = (id: string, clientId: string, arquivadaEm: Date | null) => ({
    id,
    organizationId: ORGANIZACAO_ID,
    clientId,
    url: 'https://exemplo.com.br/oferta?ref=a',
    rotulo: 'Oferta',
    criadaEm: new Date('2026-11-01T00:00:00Z'),
    arquivadaEm,
  });
  const paginas = [
    pagina(LANDING_ID, CLIENTE_ID, null),
    pagina(LANDING_ARQUIVADA_ID, CLIENTE_ID, new Date('2026-11-10T00:00:00Z')),
    pagina(LANDING_DE_OUTRO_CLIENTE_ID, 'ffffffff-ffff-4fff-8fff-ffffffffffff', null),
  ];
  return {
    async listarLandingPages(escopo, o) {
      return ok(paginas.filter((p) => p.clientId === escopo.clientId && (o?.incluirArquivadas === true || p.arquivadaEm === null)));
    },
    async lerWhatsapp() {
      return ok(opcoes.whatsapp === undefined ? '+5511912345678' : opcoes.whatsapp);
    },
  };
}

function montar(opcoes: { brain?: LeitorDoBrain; auditFalha?: boolean; destino?: OpcoesDoDestino } = {}) {
  const estado = novoEstado();
  const auditorias: AuditEvent[] = [];
  const service = createEstrategiaService({
    repositorio: criarRepositorio(estado),
    audit: {
      async record(evento) {
        if (opcoes.auditFalha) throw new Error('auditoria fora');
        auditorias.push(evento);
      },
      async list() { return []; },
      async search() { return []; },
    },
    leitorDoBrain: opcoes.brain ?? brainOk,
    destino: criarDestino(opcoes.destino),
    catalogos: CATALOGOS_DE_TESTE,
    gerador: { novo: () => `id-${estado.proximoId++}` },
    relogio: { agora: () => new Date('2026-11-25T12:00:00Z') },
  });
  return { estado, auditorias, service };
}

const { plataformas: _p, whatsapp: _w, destino: _d, utm: _u, ...INTENCAO_BASE } = INTENCAO;
const pedido = {
  clienteId: CLIENTE_ID,
  tipoDePlano: 'aquisicao' as const,
  plataformas: ['meta' as const],
  landingPageId: LANDING_ID,
  intencao: INTENCAO_BASE,
};

function semearVersao(estado: Estado, status: 'rascunho' | 'proposto' | 'vigente', extra: Partial<Versao> = {}): Versao {
  const versao: Versao = {
    id: VERSAO_ID,
    planoId: PLANO_ID,
    organizationId: ORGANIZACAO_ID,
    clientId: CLIENTE_ID,
    status,
    schemaVersion: 1,
    supersedesId: null,
    autorTipo: 'agente',
    autorUsuarioId: null,
    agentId: 'redator',
    agentRunId: 'run-x',
    redigidaEm: null,
    criadaEm: new Date(),
    conteudo: planoCompleto(),
    referencias: [{ urn: URN_BENCHMARK_B, hash: hashDeTeste(2), papel: 'favor' }],
    ...extra,
  };
  if (!estado.planos.some((p) => p.id === PLANO_ID)) {
    estado.planos.push({ id: PLANO_ID, organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, tipo: 'aquisicao', plataformas: ['meta'], whatsapp: '+5511912345678', landingPageId: LANDING_ID, criadoEm: new Date() });
  }
  estado.versoes.push(versao);
  return versao;
}

const evento = (
  tipo: EventoDaVersao['tipo'],
  payload: Record<string, unknown> = {},
  versaoId = VERSAO_ID,
  atorTipo: EventoDaVersao['atorTipo'] = 'agente',
): EventoDaVersao => ({
  id: `e-${Math.random()}`,
  versaoId,
  tipo,
  atorTipo,
  atorUsuarioId: null,
  agentId: 'comite',
  agentRunId: 'run-x',
  payload,
  criadoEm: new Date(),
});

describe('pedirPlano', () => {
  it('operator cria o plano e a execução criar, e audita sem a intenção', async () => {
    const { service, estado, auditorias } = montar();
    const resultado = await service.pedirPlano(como('operator'), pedido, ator);
    assert.ok(resultado.ok);
    assert.equal(estado.planos.length, 1);
    assert.equal(estado.execucoes[0]?.tipo, 'criar');
    assert.match(estado.execucoes[0]!.agentRunId, /^run-/);
    assert.equal(auditorias[0]?.action, 'strategy.plan.requested');
    assert.ok(!JSON.stringify(auditorias).includes(INTENCAO.objetivo));
  });

  it('viewer é negado antes de tocar o repositório', async () => {
    const { service, estado } = montar();
    const resultado = await service.pedirPlano(como('viewer'), pedido, ator);
    assert.equal(!resultado.ok && resultado.error.code, 'forbidden');
    assert.equal(estado.planos.length, 0);
  });

  it('entrada inválida e cliente inexistente', async () => {
    const { service, estado } = montar();
    const invalida = await service.pedirPlano(como('owner'), { ...pedido, tipoDePlano: 'x' as never }, ator);
    assert.equal(!invalida.ok && invalida.error.code, 'validation');
    estado.clienteExiste = false;
    const sem = await service.pedirPlano(como('owner'), pedido, ator);
    assert.equal(!sem.ok && sem.error.code, 'not_found');
  });

  it('vários planos do mesmo tipo são independentes: cada pedido cria um plano novo com a UTM gerada por código', async () => {
    const { service, estado } = montar();
    const primeiro = await service.pedirPlano(como('admin'), pedido, ator);
    const segundo = await service.pedirPlano(como('admin'), pedido, ator);
    assert.ok(primeiro.ok && segundo.ok);
    assert.equal(estado.planos.length, 2);
    assert.notEqual(primeiro.ok && primeiro.value.plano.id, segundo.ok && segundo.value.plano.id);
    const intencao = estado.execucoes[0]!.pedido as { plataformas: string[]; whatsapp: string; destino: { landingPageId: string; url: string }; utm: Record<string, { utm_source: string; utm_medium: string; utm_campaign: string }> };
    assert.deepEqual(intencao.plataformas, ['meta']);
    assert.equal(intencao.whatsapp, '+5511912345678');
    assert.deepEqual(intencao.destino, { landingPageId: LANDING_ID, url: 'https://exemplo.com.br/oferta?ref=a' });
    assert.equal(intencao.utm.meta?.utm_medium, 'paid_social');
    assert.match(intencao.utm.meta!.utm_campaign, /^aquisicao-.*-202612$/);
    assert.equal(estado.planos[0]!.whatsapp, '+5511912345678');
    assert.equal(estado.planos[0]!.landingPageId, LANDING_ID);
  });

  it('plataforma sem catálogo, duplicada ou vazia é recusada', async () => {
    const { service, estado } = montar();
    const semCatalogo = await service.pedirPlano(como('admin'), { ...pedido, plataformas: ['tiktok'] }, ator);
    assert.equal(!semCatalogo.ok && semCatalogo.error.code, 'validation');
    const duplicada = await service.pedirPlano(como('admin'), { ...pedido, plataformas: ['meta', 'meta'] }, ator);
    assert.equal(!duplicada.ok && duplicada.error.code, 'validation');
    const vazia = await service.pedirPlano(como('admin'), { ...pedido, plataformas: [] }, ator);
    assert.equal(!vazia.ok && vazia.error.code, 'validation');
    assert.equal(estado.planos.length, 0);
  });

  it('landing page arquivada, inexistente ou de outro cliente é recusada', async () => {
    const { service, estado } = montar();
    for (const landingPageId of [LANDING_ARQUIVADA_ID, LANDING_DE_OUTRO_CLIENTE_ID, '99999999-9999-4999-8999-999999999999']) {
      const r = await service.pedirPlano(como('admin'), { ...pedido, landingPageId }, ator);
      assert.equal(!r.ok && r.error.code, 'validation', landingPageId);
      assert.ok(!r.ok && r.error.details?.landingPageId);
    }
    assert.equal(estado.planos.length, 0);
  });

  it('cliente sem WhatsApp: erro tipado whatsapp_do_cliente_ausente e nada é gravado', async () => {
    const { service, estado } = montar({ destino: { whatsapp: null } });
    const r = await service.pedirPlano(como('admin'), pedido, ator);
    assert.equal(!r.ok && r.error.details?.codigo, 'whatsapp_do_cliente_ausente');
    assert.equal(estado.planos.length, 0);
    assert.equal(estado.execucoes.length, 0);
  });

  it('o corpo do pedido não aceita destino, UTM nem WhatsApp vindos do front', async () => {
    const { service } = montar();
    const r = await service.pedirPlano(como('admin'), { ...pedido, intencao: { ...INTENCAO_BASE, utm: INTENCAO.utm } } as never, ator);
    assert.equal(!r.ok && r.error.code, 'validation');
  });

  it('falha de auditoria não derruba o fluxo', async () => {
    const { service } = montar({ auditFalha: true });
    assert.ok((await service.pedirPlano(como('operator'), pedido, ator)).ok);
  });
});

describe('pedirMudanca', () => {
  it('grava a instrução limpa e a versão base, e audita sem a instrução', async () => {
    const { service, estado, auditorias } = montar();
    semearVersao(estado, 'rascunho');
    const resultado = await service.pedirMudanca(como('operator'), { planoId: PLANO_ID, instrucao: 'Aumente a verba de busca' }, ator);
    assert.ok(resultado.ok);
    assert.deepEqual(estado.execucoes[0]?.pedido, { instrucao: 'Aumente a verba de busca' });
    assert.equal(estado.execucoes[0]?.versaoBaseId, VERSAO_ID);
    assert.ok(!JSON.stringify(auditorias).includes('verba de busca'));
  });

  it('recusa instrução que é só dado pessoal e sem versão para ajustar', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const pii = await service.pedirMudanca(como('operator'), { planoId: PLANO_ID, instrucao: 'joao.silva@exemplo.com' }, ator);
    assert.equal(!pii.ok && pii.error.code, 'validation');

    const vazio = montar();
    vazio.estado.planos.push({ id: PLANO_ID, organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, tipo: 'aquisicao', plataformas: ['meta'], whatsapp: '+5511912345678', landingPageId: '00000000-0000-4000-8000-0000000000aa', criadoEm: new Date() });
    const semVersao = await vazio.service.pedirMudanca(como('operator'), { planoId: PLANO_ID, instrucao: 'mude algo aqui' }, ator);
    assert.equal(!semVersao.ok && semVersao.error.details?.codigo, 'sem_versao');
  });

  it('viewer negado e plano inexistente', async () => {
    const { service } = montar();
    const negado = await service.pedirMudanca(como('viewer'), { planoId: PLANO_ID, instrucao: 'mude algo aqui' }, ator);
    assert.equal(!negado.ok && negado.error.code, 'forbidden');
    const nao = await service.pedirMudanca(como('owner'), { planoId: PLANO_ID, instrucao: 'mude algo aqui' }, ator);
    assert.equal(!nao.ok && nao.error.code, 'not_found');
  });
});

describe('editarManual', () => {
  it('valida, cria versão de pessoa com refs e uma execução revisar', async () => {
    const { service, estado, auditorias } = montar();
    semearVersao(estado, 'proposto');
    const resultado = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.error));
    if (!resultado.ok) return;
    assert.equal(resultado.value.versao.autorTipo, 'usuario');
    assert.equal(resultado.value.versao.status, 'rascunho');
    assert.equal(resultado.value.execucao.tipo, 'revisar');
    assert.deepEqual(resultado.value.execucao.pedido, { motivo: 'edicao_manual' });
    assert.ok(resultado.value.versao.referencias.length > 0);
    assert.equal(estado.versoes[0]?.status, 'cancelado');
    assert.equal(auditorias[0]?.action, 'strategy.version.created');
    assert.ok(!JSON.stringify(auditorias).includes('conteudo'));
  });

  it('usa o hash da versão anterior para URN conhecida e o do Brain para a nova', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const resultado = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    const porUrn = new Map(resultado.value.versao.referencias.map((r) => [r.urn, r.hash]));
    assert.equal(porUrn.get(URN_BENCHMARK_B), hashDeTeste(2));
    assert.equal(porUrn.get(URN_DESEMPENHO), hashDeTeste(1));
  });

  it('Brain indisponível só importa quando falta hash para uma URN nova', async () => {
    const { service, estado } = montar({ brain: brainFora });
    semearVersao(estado, 'rascunho');
    const falha = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    assert.equal(!falha.ok && falha.error.code, 'unavailable');
    assert.equal(estado.versoes.length, 1);

    const completo = montar({ brain: brainFora });
    const plano = planoCompleto();
    const urns = [...JSON.stringify(plano).matchAll(/orla:[0-9a-f-]{36}:[0-9a-f-]{36}:[a-z_]+:[A-Za-z0-9._-]+/g)].map((m) => m[0]);
    semearVersao(completo.estado, 'rascunho', {
      referencias: [...new Set(urns)].flatMap((urn) => (['favor', 'contra', 'premissa'] as const).map((papel) => ({ urn, hash: hashDeTeste(7), papel }))),
    });
    const sucesso = await completo.service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: plano }, ator);
    assert.ok(sucesso.ok);
  });

  it('recusa conteúdo fora do esquema, URN de outro cliente, execução ativa e viewer', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const invalido = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: { x: 1 } }, ator);
    assert.equal(!invalido.ok && invalido.error.code, 'validation');

    const viewer = await service.editarManual(como('viewer'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    assert.equal(!viewer.ok && viewer.error.code, 'forbidden');

    estado.execucoes.push({ ...(await criarRepositorio(estado).criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, { planoId: PLANO_ID, pedido: { tipo: 'revisar', motivo: 'brain_mudou' }, versaoBaseId: null, agentRunId: 'run-z', solicitadoPor: 'u', requestId: 'r' }) as { ok: true; value: Execucao }).value });
    estado.execucoes.splice(0, 1);
    const ativa = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    assert.equal(!ativa.ok && ativa.error.details?.codigo, 'execucao_ativa');
  });
});

describe('editarManual herda as referências implícitas da versão base', () => {
  it('as de regra, limite e decisão da base seguem na versão nova, sem virar citação do conteúdo', async () => {
    const { service, estado } = montar();
    const implicitas = referenciasImplicitasDoPacote(pacoteDeTeste());
    assert.ok(implicitas.length > 0);
    semearVersao(estado, 'rascunho', { referencias: [{ urn: URN_BENCHMARK_B, hash: hashDeTeste(2), papel: 'favor' }, ...implicitas] });
    const resultado = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    const urns = resultado.value.versao.referencias.map((r) => `${r.urn}|${r.papel}`);
    for (const implicita of implicitas) assert.ok(urns.includes(`${implicita.urn}|premissa`));
    assert.equal(new Set(urns).size, urns.length);
  });
});

describe('edição manual não muda o destino do plano', () => {
  it('plataformas, WhatsApp, landing page e UTM voltam aos da versão base; o resto da intenção edita', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const editado = planoCompleto();
    editado.intencao = {
      ...editado.intencao,
      objetivo: 'Objetivo reescrito pela pessoa',
      whatsapp: '+5511900000000',
      destino: { landingPageId: 'lp_outra', url: 'https://golpe.example.com/' },
      utm: { google: { utm_source: 'x', utm_medium: 'y', utm_campaign: 'z' } },
    };
    const r = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: editado }, ator);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    if (!r.ok) return;
    const gravada = (r.value.versao.conteudo as { intencao: typeof INTENCAO }).intencao;
    assert.equal(gravada.objetivo, 'Objetivo reescrito pela pessoa');
    assert.deepEqual(gravada.destino, INTENCAO.destino);
    assert.deepEqual(gravada.utm, INTENCAO.utm);
    assert.equal(gravada.whatsapp, INTENCAO.whatsapp);
  });

  it('plano anterior à página única (sem plataformas) recusa mudança, revisão e edição com código claro', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    Object.assign(estado.planos[0]!, { plataformas: null, whatsapp: null, landingPageId: null });
    const mudanca = await service.pedirMudanca(como('operator'), { planoId: PLANO_ID, instrucao: 'mais verba' }, ator);
    const revisao = await service.pedirRevisao(como('operator'), { planoId: PLANO_ID }, ator);
    const edicao = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo: planoCompleto() }, ator);
    for (const r of [mudanca, revisao, edicao]) assert.equal(!r.ok && r.error.details?.codigo, 'plano_sem_destino');
    assert.equal(estado.execucoes.length, 0);
  });
});

describe('aplicar, autorizar, rejeitar, revogar e cancelar versão', () => {
  it('aplicar devolve o que falta e não grava evento', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const resultado = await service.aplicar(como('operator'), { versaoId: VERSAO_ID }, ator);
    assert.equal(!resultado.ok && resultado.error.code, 'validation');
    assert.ok(!resultado.ok && resultado.error.details?.falta_parecer);
    assert.ok(!resultado.ok && resultado.error.details?.falta_gate);
    assert.equal(estado.eventos.length, 0);
  });

  it('aplicar com parecer e gate aprovado registra a proposta e audita', async () => {
    const { service, estado, auditorias } = montar();
    semearVersao(estado, 'rascunho');
    estado.eventos.push(evento('parecer', { persona: 'redator', veredito: 'aprova' }), evento('gate', { resultado: 'aprovado' }));
    const resultado = await service.aplicar(como('operator'), { versaoId: VERSAO_ID }, ator);
    assert.ok(resultado.ok);
    assert.equal(estado.versoes[0]?.status, 'proposto');
    assert.equal(auditorias.at(-1)?.action, 'strategy.plan.applied');
  });

  it('gate reprovado ou anterior ao parecer bloqueia', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    estado.eventos.push(evento('parecer', { persona: 'a', veredito: 'aprova' }), evento('gate', { resultado: 'reprovado' }));
    const reprovado = await service.aplicar(como('owner'), { versaoId: VERSAO_ID }, ator);
    assert.ok(!reprovado.ok && reprovado.error.details?.gate_reprovado);

    estado.eventos.length = 0;
    estado.eventos.push(evento('gate', { resultado: 'aprovado' }), evento('parecer', { persona: 'a', veredito: 'aprova' }));
    const anterior = await service.aplicar(como('owner'), { versaoId: VERSAO_ID }, ator);
    assert.ok(!anterior.ok && anterior.error.details?.gate_anterior_ao_parecer);
  });

  it('ajuste que responde versão com parecer conta como passagem pelo Comitê', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const outraId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    estado.eventos.push(
      evento('parecer', { persona: 'a', veredito: 'aprova' }, outraId),
      evento('cancelada', { motivo: 'substituida_por_edicao', por: VERSAO_ID }, outraId, 'sistema'),
      evento('ajuste', { responde_a: outraId, respostas: [] }),
      evento('gate', { resultado: 'aprovado' }),
    );
    const resultado = await service.aplicar(como('operator'), { versaoId: VERSAO_ID }, ator);
    assert.ok(resultado.ok);
  });

  it('autorizar, rejeitar e revogar exigem owner ou admin', async () => {
    for (const acao of ['autorizar', 'rejeitar', 'revogar'] as const) {
      const { service, estado } = montar();
      semearVersao(estado, acao === 'revogar' ? 'vigente' : 'proposto');
      const operador = await service[acao](como('operator'), { versaoId: VERSAO_ID }, ator);
      assert.equal(!operador.ok && operador.error.code, 'forbidden', acao);
      const admin = await service[acao](como('admin'), { versaoId: VERSAO_ID }, ator);
      assert.ok(admin.ok, acao);
    }
  });

  it('status errado vira conflito e versão inexistente vira not_found', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    const autorizar = await service.autorizar(como('admin'), { versaoId: VERSAO_ID }, ator);
    assert.equal(!autorizar.ok && autorizar.error.code, 'conflict');
    const nada = await service.revogar(como('admin'), { versaoId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, ator);
    assert.equal(!nada.ok && nada.error.code, 'not_found');
  });

  it('cancelarVersao funciona em rascunho e em proposto, audita e não em vigente', async () => {
    const a = montar();
    semearVersao(a.estado, 'proposto');
    assert.ok((await a.service.cancelarVersao(como('operator'), { versaoId: VERSAO_ID }, ator)).ok);
    assert.equal(a.auditorias.at(-1)?.action, 'strategy.version.cancelled');
    const b = montar();
    semearVersao(b.estado, 'vigente');
    const vigente = await b.service.cancelarVersao(como('operator'), { versaoId: VERSAO_ID }, ator);
    assert.equal(!vigente.ok && vigente.error.code, 'conflict');
  });

  it('erro do banco vira Failure tipada (falta_para_aplicar, sem_permissao)', async () => {
    const { estado, service } = montar();
    semearVersao(estado, 'rascunho');
    estado.eventos.push(evento('parecer', { persona: 'a', veredito: 'aprova' }), evento('gate', { resultado: 'aprovado' }));
    const repositorio = criarRepositorio(estado);
    const comFalha = createEstrategiaService({
      repositorio: { ...repositorio, registrarEvento: async () => err({ codigo: 'sem_permissao' as const, mensagem: 'x' }) },
      audit: { async record() {}, async list() { return []; }, async search() { return []; } },
      leitorDoBrain: brainOk,
      destino: criarDestino(),
    });
    const negado = await comFalha.aplicar(como('operator'), { versaoId: VERSAO_ID }, ator);
    assert.equal(!negado.ok && negado.error.code, 'forbidden');
    assert.ok(service);
  });
});

describe('cancelarExecucao', () => {
  it('cancela pendente, audita e recusa estado final', async () => {
    const { service, estado, auditorias } = montar();
    assert.ok((await service.pedirPlano(como('operator'), pedido, ator)).ok);
    const id = estado.execucoes[0]!.id;
    const cancelada = await service.cancelarExecucao(como('operator'), { execucaoId: id }, ator);
    assert.ok(cancelada.ok);
    assert.equal(auditorias.at(-1)?.action, 'strategy.run.cancelled');
    const de_novo = await service.cancelarExecucao(como('operator'), { execucaoId: id }, ator);
    assert.equal(!de_novo.ok && de_novo.error.code, 'conflict');
    const viewer = await service.cancelarExecucao(como('viewer'), { execucaoId: id }, ator);
    assert.equal(!viewer.ok && viewer.error.code, 'forbidden');
  });
});

describe('painelDoPlano', () => {
  it('mostra a versão aberta, rótulo, pareceres, gate, o que falta e a execução ativa', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    estado.eventos.push(evento('parecer', { persona: 'redator', veredito: 'aprova_com_ajuste' }), evento('gate', { resultado: 'reprovado', checagens: [{ chave: 'x' }] }));
    await service.pedirMudanca(como('operator'), { planoId: PLANO_ID, instrucao: 'mude algo aqui' }, ator);
    const painel = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    if (!painel.ok) return;
    const plano = painel.value.planos[0]!;
    assert.equal(plano.status, 'rascunho');
    assert.equal(plano.rotulo, 'Em rascunho');
    assert.equal(plano.pareceres[0]?.persona, 'redator');
    assert.equal(plano.gate?.resultado, 'reprovado');
    assert.deepEqual(plano.faltaParaAplicar, ['gate_reprovado']);
    assert.equal(plano.execucaoAtiva?.tipo, 'ajustar');
    assert.equal(plano.historico.versoes.length, 1);
    assert.equal(plano.historico.eventos.length, 2);
  });

  it('prefere a aberta à vigente e cai na vigente sem aberta', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    const painel = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    if (painel.ok) {
      assert.equal(painel.value.planos[0]?.rotulo, 'Autorizado');
      assert.equal(painel.value.planos[0]?.faltaParaAplicar, null);
    }
  });

  it('cliente fora do escopo vira not_found', async () => {
    const { service, estado } = montar();
    estado.clienteExiste = false;
    const painel = await service.painelDoPlano(como('owner'), { clienteId: CLIENTE_ID });
    assert.equal(!painel.ok && painel.error.code, 'not_found');
  });
});

describe('desatualizado e pedirRevisao', () => {
  it('plano vigente com referência cujo hash mudou no Brain fica desatualizado (material)', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente', { referencias: [{ urn: URN_BENCHMARK_B, hash: hashDeTeste(99), papel: 'favor' }] });
    const painel = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    if (!painel.ok) return;
    const desatualizado = painel.value.planos[0]!.desatualizado;
    assert.notEqual(desatualizado, 'indisponivel');
    assert.equal(desatualizado && desatualizado !== 'indisponivel' && desatualizado.impacto, 'material');
    assert.ok(desatualizado && desatualizado !== 'indisponivel' && desatualizado.itens.some((i) => i.urn === URN_BENCHMARK_B && i.motivo === 'hash_mudou'));
  });

  it('regra ou limite novo no catálogo, ausente das referências do plano vigente, o marca como desatualizado (material)', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    const painel = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    const desatualizado = painel.ok ? painel.value.planos[0]!.desatualizado : null;
    assert.notEqual(desatualizado, 'indisponivel');
    assert.equal(desatualizado && desatualizado !== 'indisponivel' && desatualizado.impacto, 'material');
    assert.ok(desatualizado && desatualizado !== 'indisponivel' && desatualizado.itens.some((i) => i.urn === URN_LIMITE && i.motivo === 'limite_ou_regra_novo'));
  });

  it('limite que mudou de hash ou saiu do catálogo também é material', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente', { referencias: [{ urn: URN_LIMITE, hash: hashDeTeste(77), papel: 'premissa' }] });
    const mudou = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    const itens = motivosDe(mudou);
    assert.ok(itens.some((i) => i.motivo === 'limite_ou_regra_mudou'));
    const sumiu = montar();
    semearVersao(sumiu.estado, 'vigente', { referencias: [{ urn: urnDeTeste('limite', 'antigo'), hash: hashDeTeste(5), papel: 'premissa' }] });
    const painel = await sumiu.service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    const itens2 = motivosDe(painel);
    assert.ok(itens2.some((i) => i.motivo === 'entrada_removida'));
  });

  it('referências iguais ao catálogo atual, incluindo as implícitas de regra e limite: impacto nenhum', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente', { referencias: [{ urn: URN_BENCHMARK_B, hash: hashDeTeste(2), papel: 'favor' }, ...referenciasImplicitasDoPacote(pacoteDeTeste())] });
    const painel = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    const desatualizado = painel.ok ? painel.value.planos[0]!.desatualizado : null;
    assert.equal(desatualizado && desatualizado !== 'indisponivel' && desatualizado.impacto, 'nenhum');
  });

  it('Brain fora do ar vira indisponivel, nunca erro da tela; sem vigente é null', async () => {
    const fora = montar({ brain: brainFora });
    semearVersao(fora.estado, 'vigente');
    const painel = await fora.service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    assert.equal(painel.ok && painel.value.planos[0]!.desatualizado, 'indisponivel');

    const semVigente = montar();
    semearVersao(semVigente.estado, 'rascunho');
    const painel2 = await semVigente.service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.equal(painel2.ok && painel2.value.planos[0]!.desatualizado, null);
  });

  it('pedirRevisao cria execução revisar/brain_mudou a partir da vigente e audita', async () => {
    const { service, estado, auditorias } = montar();
    semearVersao(estado, 'vigente');
    const resultado = await service.pedirRevisao(como('operator'), { planoId: PLANO_ID }, ator);
    assert.ok(resultado.ok);
    assert.equal(estado.execucoes[0]?.tipo, 'revisar');
    assert.deepEqual(estado.execucoes[0]?.pedido, { motivo: 'brain_mudou' });
    assert.equal(estado.execucoes[0]?.versaoBaseId, VERSAO_ID);
    assert.equal(auditorias.at(-1)?.action, 'strategy.plan.requested');
    assert.equal(auditorias.at(-1)?.metadata?.motivo, 'brain_mudou');
  });

  it('pedirRevisao: viewer negado, sem vigente conflito, execução ativa conflito', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'rascunho');
    assert.equal(codigo(await service.pedirRevisao(como('viewer'), { planoId: PLANO_ID }, ator)), 'forbidden');
    assert.equal(codigo(await service.pedirRevisao(como('owner'), { planoId: PLANO_ID }, ator)), 'sem_vigente');

    const b = montar();
    semearVersao(b.estado, 'vigente');
    assert.ok((await b.service.pedirRevisao(como('owner'), { planoId: PLANO_ID }, ator)).ok);
    assert.equal(codigo(await b.service.pedirRevisao(como('owner'), { planoId: PLANO_ID }, ator)), 'execucao_ativa');
  });
});

function motivosDe(painel: { ok: boolean; value?: { planos: readonly { desatualizado: unknown }[] } }): { motivo: string }[] {
  const desatualizado = painel.ok ? painel.value?.planos[0]?.desatualizado : null;
  if (desatualizado === null || desatualizado === undefined || desatualizado === 'indisponivel') return [];
  return [...(desatualizado as { itens: readonly { motivo: string }[] }).itens];
}

function codigo(resultado: { ok: boolean; error?: { code: string; details?: Record<string, string> } }): string {
  return resultado.ok ? 'ok' : (resultado.error?.details?.codigo ?? resultado.error?.code ?? '');
}

describe('dado pessoal no texto das pessoas', () => {
  it('pedirPlano sanitiza o objetivo com e-mail, telefone e CPF antes de gravar e audita sem o dado', async () => {
    const { service, estado, auditorias } = montar();
    const intencao = { ...INTENCAO_BASE, objetivo: 'Gerar leads; contato maria@exemplo.com, (11) 98888-7777, 123.456.789-09' };
    const resultado = await service.pedirPlano(como('operator'), { ...pedido, intencao }, ator);
    assert.ok(resultado.ok);
    const gravado = JSON.stringify(estado.execucoes[0]!.pedido);
    assert.ok(!/maria@|98888|123\.456/.test(gravado));
    assert.match(gravado, /Gerar leads/);
    assert.ok(!/maria@|98888|123\.456/.test(JSON.stringify(auditorias)));
  });

  it('pedirPlano recusa objetivo que vira só dado pessoal e nada é gravado', async () => {
    for (const dado of ['maria@exemplo.com', '(11) 98888-7777', '123.456.789-09']) {
      const { service, estado } = montar();
      const resultado = await service.pedirPlano(como('operator'), { ...pedido, intencao: { ...INTENCAO_BASE, objetivo: dado } }, ator);
      assert.equal(!resultado.ok && resultado.error.code, 'validation');
      assert.ok(!resultado.ok && resultado.error.details?.objetivo);
      assert.ok(!resultado.ok && !JSON.stringify(resultado.error).includes(dado));
      assert.equal(estado.planos.length, 0);
      assert.equal(estado.execucoes.length, 0);
    }
  });

  it('pedirPlano também limpa a descrição do retorno esperado', async () => {
    const { service, estado } = montar();
    const intencao = { ...INTENCAO_BASE, retorno_esperado: { ...INTENCAO_BASE.retorno_esperado, descricao: 'Custo baixo, falar com joao@exemplo.com' } };
    assert.ok((await service.pedirPlano(como('operator'), { ...pedido, intencao }, ator)).ok);
    assert.ok(!JSON.stringify(estado.execucoes[0]!.pedido).includes('joao@'));
  });

  it('editarManual recusa o plano com dado pessoal, aponta a seção sem repetir o dado e não grava nada', async () => {
    const { service, estado, auditorias } = montar();
    semearVersao(estado, 'rascunho');
    const conteudo = planoCompleto();
    conteudo.diagnostico.situacao.texto = 'Falar com maria@exemplo.com sobre a conta.';
    const resultado = await service.editarManual(como('operator'), { planoId: PLANO_ID, conteudo }, ator);
    assert.equal(!resultado.ok && resultado.error.code, 'validation');
    assert.ok(!resultado.ok && /diagnostico/.test(resultado.error.message));
    assert.ok(!resultado.ok && !JSON.stringify(resultado.error).includes('maria@'));
    assert.equal(estado.versoes.length, 1);
    assert.equal(estado.execucoes.length, 0);
    assert.equal(auditorias.length, 0);
    assert.equal(estado.versoes[0]!.status, 'rascunho');
  });
});

function leitorQueConta(): { leitor: LeitorDoBrain; chamadas: () => number } {
  let chamadas = 0;
  return {
    leitor: {
      async lerPacote() {
        chamadas += 1;
        return ok(pacoteDeTeste());
      },
      catalogoDoSnapshot() {
        return new Map();
      },
    },
    chamadas: () => chamadas,
  };
}

function semearSegundoPlano(estado: Estado): void {
  estado.planos.push({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, tipo: 'retencao', plataformas: ['meta'], whatsapp: '+5511912345678', landingPageId: LANDING_ID, criadoEm: new Date() });
}

describe('painelDoPlano com seleção e catálogo já lido', () => {
  it('com planoId monta o detalhe só daquele plano e devolve resumos de todos', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    semearSegundoPlano(estado);
    const todos = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(todos.ok);
    assert.equal(todos.ok && todos.value.planos.length, 2);
    assert.deepEqual(
      todos.ok && todos.value.resumos.map((r) => [r.tipo, r.status, r.rotulo]),
      [['retencao', null, null], ['aquisicao', 'vigente', 'Autorizado']],
    );
    const porId = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID, planoId: PLANO_ID });
    assert.deepEqual(porId.ok && porId.value.planos.map((p) => p.plano.id), [PLANO_ID]);
    const inexistente = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID, planoId: '99999999-9999-4999-8999-999999999999' });
    assert.equal(inexistente.ok && inexistente.value.planos.length, 0);
    assert.equal(inexistente.ok && inexistente.value.resumos.length, 2);
  });

  it('com snapshot já lido não lê o Brain e dá o mesmo impacto; sem ele, lê; de outro cliente ou organização, indisponível', async () => {
    const contador = leitorQueConta();
    const { service, estado } = montar({ brain: contador.leitor });
    semearVersao(estado, 'vigente', { referencias: [{ urn: URN_BENCHMARK_B, hash: hashDeTeste(99), papel: 'favor' }] });
    const lido = await contador.leitor.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.ok(lido.ok);
    const referencia = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.equal(contador.chamadas(), 2);
    const antes = contador.chamadas();
    const snapshot = { organizationId: ORGANIZACAO_ID, clienteId: CLIENTE_ID, entradas: [] };
    const dado = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID, planoId: PLANO_ID }, { snapshotDoBrain: snapshot });
    assert.equal(contador.chamadas(), antes);
    assert.ok(referencia.ok && dado.ok);
    if (!referencia.ok || !dado.ok) return;
    assert.notEqual(dado.value.planos[0]!.desatualizado, 'indisponivel');
    const indisponivel = await service.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID }, { snapshotDoBrain: 'indisponivel' });
    assert.equal(indisponivel.ok && indisponivel.value.planos[0]!.desatualizado, 'indisponivel');
    const outroCliente = await service.painelDoPlano(
      como('operator'),
      { clienteId: CLIENTE_ID },
      { snapshotDoBrain: { ...snapshot, clienteId: '33333333-3333-4333-8333-333333333333' } },
    );
    assert.equal(outroCliente.ok && outroCliente.value.planos[0]!.desatualizado, 'indisponivel');
    const outraOrganizacao = await service.painelDoPlano(
      como('operator'),
      { clienteId: CLIENTE_ID },
      { snapshotDoBrain: { ...snapshot, organizationId: '44444444-4444-4444-8444-444444444444' } },
    );
    assert.equal(outraOrganizacao.ok && outraOrganizacao.value.planos[0]!.desatualizado, 'indisponivel');
    assert.equal(contador.chamadas(), antes);
  });

  it('leituras de posse e versão vista devolvem null para papel que não pode ler', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    const semPapel = como('ninguem' as MemberRole);
    assert.equal(await service.clienteDoPlano(semPapel, PLANO_ID), null);
    assert.equal(await service.clienteDaVersao(semPapel, VERSAO_ID), null);
    assert.equal(await service.clienteDaExecucao(semPapel, VERSAO_ID), null);
    assert.equal(await service.versaoVistaDoPlano(semPapel, { clienteId: CLIENTE_ID, planoId: PLANO_ID }), null);
  });

  it('leituras de posse devolvem só o clientId e ignoram ids malformados ou inexistentes', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    assert.equal(await service.clienteDoPlano(como('operator'), PLANO_ID), CLIENTE_ID);
    assert.equal(await service.clienteDaVersao(como('operator'), VERSAO_ID), CLIENTE_ID);
    assert.equal(await service.clienteDaExecucao(como('operator'), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), null);
    assert.equal(await service.clienteDoPlano(como('operator'), 'não-é-uuid'), null);
  });

  it('viewer (papel do cliente, ADR 0062) é recusado em todas as leituras do plano', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    const painel = await service.painelDoPlano(como('viewer'), { clienteId: CLIENTE_ID });
    assert.equal(!painel.ok && painel.error.code, 'forbidden');
    assert.equal(await service.clienteDoPlano(como('viewer'), PLANO_ID), null);
    assert.equal(await service.clienteDaVersao(como('viewer'), VERSAO_ID), null);
    assert.equal(await service.clienteDaExecucao(como('viewer'), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), null);
    assert.equal(await service.versaoVistaDoPlano(como('viewer'), { clienteId: CLIENTE_ID, planoId: PLANO_ID, comConteudo: true }), null);
    assert.equal((await service.clienteDoPlano(como('operator'), PLANO_ID)), CLIENTE_ID);
  });

  it('versaoVistaDoPlano devolve a versão aberta ou vigente, com conteúdo só se pedido', async () => {
    const { service, estado } = montar();
    semearVersao(estado, 'vigente');
    const sem = await service.versaoVistaDoPlano(como('operator'), { clienteId: CLIENTE_ID, planoId: PLANO_ID });
    assert.deepEqual(sem, { id: VERSAO_ID, conteudo: null });
    const com = await service.versaoVistaDoPlano(como('operator'), { clienteId: CLIENTE_ID, planoId: PLANO_ID, comConteudo: true });
    assert.equal(com?.id, VERSAO_ID);
    assert.notEqual(com?.conteudo, null);
    assert.equal(await service.versaoVistaDoPlano(como('operator'), { clienteId: 'outro', planoId: PLANO_ID }), null);
  });
});

describe('modelos de visão para a página única', () => {
  const previa = { clienteId: CLIENTE_ID, tipoDePlano: 'aquisicao' as const, plataformas: ['meta' as const], landingPageId: LANDING_ID, nomeDaCampanha: 'Leads do trimestre', inicio: '2026-12-01' };

  it('modeloDeCriacao entrega tipos, só plataformas com catálogo, landing pages ativas e o WhatsApp do cliente', async () => {
    const { service } = montar();
    const r = await service.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(r.ok);
    assert.equal(r.value.tipos.length, 4);
    assert.deepEqual(r.value.plataformas.map((p) => p.plataforma), ['google', 'meta']);
    assert.deepEqual(r.value.landingPages.map((l) => l.id), [LANDING_ID]);
    assert.equal(r.value.whatsapp, '+5511912345678');
    assert.equal(r.value.podeCriar, true);
    const semZap = await montar({ destino: { whatsapp: null } }).service.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(semZap.ok && semZap.value.whatsappAusente && !semZap.value.podeCriar);
    const viewer = await service.modeloDeCriacao(como('viewer'), { clienteId: CLIENTE_ID });
    assert.equal(!viewer.ok && viewer.error.code, 'forbidden');
  });

  it('previaDeUtm calcula no servidor a URL final por plataforma', async () => {
    const { service } = montar();
    const r = await service.previaDeUtm(como('operator'), previa);
    assert.ok(r.ok);
    assert.equal(r.value.itens.length, 1);
    assert.match(r.value.itens[0]!.url, /^https:\/\/exemplo\.com\.br\/oferta\?ref=a&utm_source=meta&utm_medium=paid_social&utm_campaign=aquisicao-leads-do-trimestre-202612$/);
    const ruim = await service.previaDeUtm(como('operator'), { ...previa, landingPageId: LANDING_ARQUIVADA_ID });
    assert.equal(!ruim.ok && ruim.error.code, 'validation');
    const semCatalogo = await service.previaDeUtm(como('operator'), { ...previa, plataformas: ['linkedin'] });
    assert.equal(!semCatalogo.ok && semCatalogo.error.code, 'validation');
  });

  it('listarPlanos devolve cards de planos em qualquer status, com título, tipo, plataformas, estado e progresso', async () => {
    const { service, estado } = montar();
    await service.pedirPlano(como('admin'), pedido, ator);
    await service.pedirPlano(como('admin'), { ...pedido, tipoDePlano: 'marca' }, ator);
    (estado.execucoes[0] as { status: string }).status = 'concluida';
    const r = await service.listarPlanos(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(r.ok);
    assert.equal(r.value.cards.length, 2);
    const [marca, aquisicao] = r.value.cards;
    assert.equal(marca!.tipo, 'marca');
    assert.equal(marca!.estado, 'gerando');
    assert.ok(marca!.progresso && marca!.progresso.percentual > 0);
    assert.deepEqual(marca!.plataformas, [{ plataforma: 'meta', rotulo: 'Meta' }]);
    assert.equal(marca!.titulo, INTENCAO.objetivo);
    assert.equal(aquisicao!.estado, 'sem_versao');
    assert.equal(aquisicao!.progresso, null);
  });

  it('listarPlanos recusa cliente fora do escopo', async () => {
    const { service, estado } = montar();
    estado.clienteExiste = false;
    const r = await service.listarPlanos(como('operator'), { clienteId: CLIENTE_ID });
    assert.equal(!r.ok && r.error.code, 'not_found');
  });
});
