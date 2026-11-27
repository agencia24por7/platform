import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { EntradaDeRegistro } from '@/modules/clients/application/regrasEntradas';
import { CATALOGOS_DE_TESTE, CLIENTE_ID, ORGANIZACAO_ID, URN_BENCHMARK_B, URN_BENCHMARK_D, pacoteDeTeste, planoCompleto } from '../domain/fixturesDeTeste.ts';
import { lerPlano, type Plano } from '../domain/plano.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createEstrategiaService } = await import('./estrategiaService.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { ok, err } = await import('../../../shared/result/result.ts');
const { failure } = await import('../../../shared/result/failure.ts');

const ator = { userId: '99999999-9999-4999-8999-999999999999', requestId: 'req-1', sourceIp: '10.0.0.1' };
const como = (papelDeQuemAge: MemberRole, organizationId = ORGANIZACAO_ID) => ({ organizationId, papelDeQuemAge });
const ESCOPO = { organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID };
const OUTRO_CLIENTE = '44444444-4444-4444-8444-444444444444';
const OUTRA_ORG = '55555555-5555-4555-8555-555555555555';

const valorCpl = { unidade: 'brl_centavos', centavos: '5000', moeda: 'BRL' } as const;
const planoComLacunas = (): Plano => {
  const base = planoCompleto();
  const lido = lerPlano({
    ...base,
    lacunas: {
      itens: [
        {
          id: 'lim_cpl',
          tipo: 'limite_ausente',
          medida: 'custo_por_lead',
          descricao: 'Sem teto de custo por lead.',
          impacto: 'Meta sem teto.',
          regra: { natureza: 'limite', escopo: 'cliente' },
          sugestao: { valor: valorCpl, origem: 'evidencia', evidencias: [{ urn: URN_BENCHMARK_B, papel: 'favor' }], justificativa: 'Benchmark do setor.' },
        },
        {
          id: 'lim_gasto',
          tipo: 'limite_ausente',
          medida: 'gasto',
          descricao: 'Sem teto de gasto.',
          impacto: 'Verba sem teto.',
          regra: { natureza: 'limite', escopo: 'cliente' },
          sugestao: { valor: null, origem: 'hipotese', evidencias: [], justificativa: 'Sem dado no Brain.' },
        },
        { id: 'dado', tipo: 'dado_ausente', descricao: 'Sem margem.', impacto: 'Meta é hipótese.' },
      ],
    },
  });
  assert.ok(lido.ok, JSON.stringify(lido));
  return lido.ok ? lido.value : base;
};

type Decisao = { id: string; numero: number; natureza: 'limite' | 'regra'; chave: string; escopo: string; definicaoChave: string | null; valor: unknown; texto: string | null };

function criarRegrasFalsa(opcoes: { semDefinicoes?: boolean } = {}) {
  const decisoes: Decisao[] = [];
  const registros: { entrada: EntradaDeRegistro; papel: MemberRole; organizationId: string; clientId: string }[] = [];
  const definicoes = opcoes.semDefinicoes
    ? []
    : [
        { key: 'eficiencia.custo_por_lead', version: 1, nome: 'Custo por lead máximo', categoria: 'eficiencia', medida: 'custo_por_lead', unidade: 'brl_centavos', ativo: true, tiposDeEscopo: ['cliente', 'plataforma'] },
        { key: 'investimento.gasto_mensal', version: 1, nome: 'Gasto mensal máximo', categoria: 'investimento', medida: 'gasto', unidade: 'brl_centavos', ativo: true, tiposDeEscopo: ['cliente'] },
        { key: 'investimento.teto_diario', version: 1, nome: 'Gasto diário máximo', categoria: 'investimento', medida: 'gasto', unidade: 'brl_centavos', ativo: true, tiposDeEscopo: ['cliente'] },
      ];
  return {
    decisoes,
    registros,
    async listarDefinicoes() {
      return ok(definicoes as never);
    },
    async listarVigentes() {
      return ok({ decisoes: decisoes as never, conflitos: [], hash: 'h' });
    },
    async registrar(comando: { organizationId: string; clientId: string; papelDeQuemAge: MemberRole }, entrada: EntradaDeRegistro) {
      registros.push({ entrada, papel: comando.papelDeQuemAge, organizationId: comando.organizationId, clientId: comando.clientId });
      if (entrada.natureza === 'limite') {
        const definicao = definicoes.find((d) => d.key === entrada.chave);
        if (!definicao) return err(failure('validation', 'Tipo de limite desconhecido.'));
        if ((entrada.valor as { unidade?: string } | null)?.unidade !== definicao.unidade) return err(failure('validation', 'A unidade difere da definição.', { valor: 'unidade_incompativel' }));
      }
      const decisao: Decisao = {
        id: `dec-${decisoes.length + 1}`,
        numero: decisoes.length + 1,
        natureza: entrada.natureza as 'limite' | 'regra',
        chave: String(entrada.chave),
        escopo: String(entrada.escopo ?? 'cliente'),
        definicaoChave: entrada.natureza === 'limite' ? String(entrada.chave) : null,
        valor: entrada.valor ?? null,
        texto: (entrada.texto as string | null | undefined) ?? null,
      };
      decisoes.push(decisao);
      return ok(decisao as never);
    },
  };
}

async function montar(opcoes: { regras?: ReturnType<typeof criarRegrasFalsa> | null } = {}) {
  const repositorio = criarRepositorioEmMemoria();
  const auditorias: AuditEvent[] = [];
  const regras = opcoes.regras === null ? undefined : (opcoes.regras ?? criarRegrasFalsa());
  const servico = createEstrategiaService({
    repositorio,
    audit: { async record(e) { auditorias.push(e); }, async list() { return []; }, async search() { return []; } },
    leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
    destino: { async listarLandingPages() { return ok([]); }, async lerWhatsapp() { return ok(null); } } as never,
    catalogos: CATALOGOS_DE_TESTE,
    ...(regras ? { regras: regras as never } : {}),
  });
  const plano = await repositorio.criarPlano(ESCOPO, 'aquisicao');
  assert.ok(plano.ok);
  const versao = await repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
    planoId: plano.value.id,
    conteudo: planoComLacunas(),
    schemaVersion: 1,
    supersedesId: null,
    autoria: { tipo: 'pessoa', userId: ator.userId },
    referencias: [{ urn: URN_BENCHMARK_B, hash: 'a'.repeat(64), papel: 'favor' }],
    requestId: 'r',
  });
  assert.ok(versao.ok);
  return { repositorio, servico, auditorias, regras, planoId: plano.value.id, versaoId: versao.value.id };
}

const codigoDe = (r: { ok: boolean; error?: { code: string; details?: Record<string, unknown> } }) => (r.ok ? 'ok' : (r.error?.details?.codigo ?? r.error?.code));

describe('aprovar sugestões de lacunas', () => {
  it('grava a regra do cliente pelo caminho oficial, com evidência, por quê e origem, e a lacuna some da lista', async () => {
    const m = await montar();
    const antes = await m.servico.painelDoPlano(como('admin'), { clienteId: CLIENTE_ID });
    assert.ok(antes.ok);
    assert.deepEqual(antes.value.planos[0]!.lacunas!.map((l) => l.id), ['lim_cpl', 'lim_gasto', 'dado']);

    const r = await m.servico.aprovarSugestoesDeLacunas(como('owner'), { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl' }] }, ator);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.value.itens.map((i) => [i.lacunaId, i.estado]), [['lim_cpl', 'aprovada']]);
    assert.equal(r.value.aprovadas, 1);
    assert.equal(m.regras!.registros.length, 1);
    const registro = m.regras!.registros[0]!;
    assert.equal(registro.organizationId, ORGANIZACAO_ID);
    assert.equal(registro.clientId, CLIENTE_ID);
    assert.equal(registro.papel, 'owner');
    assert.equal(registro.entrada.natureza, 'limite');
    assert.equal(registro.entrada.categoria, 'eficiencia');
    assert.equal(registro.entrada.chave, 'eficiencia.custo_por_lead');
    assert.equal(registro.entrada.escopo, 'cliente');
    assert.deepEqual(registro.entrada.valor, valorCpl);
    assert.equal(registro.entrada.evidencia, URN_BENCHMARK_B);
    assert.match(String(registro.entrada.contexto), /lacuna "lim_cpl"/);
    assert.match(String(registro.entrada.contexto), /Origem: evidência do Brain/);
    assert.match(String(registro.entrada.contexto), /Benchmark do setor/);

    const depois = await m.servico.painelDoPlano(como('admin'), { clienteId: CLIENTE_ID });
    assert.ok(depois.ok);
    assert.deepEqual(depois.value.planos[0]!.lacunas!.map((l) => l.id), ['lim_gasto', 'dado']);
    const auditoria = m.auditorias.find((a) => a.action === 'strategy.lacuna.approved')!;
    assert.equal(auditoria.actorId, ator.userId);
    assert.ok(!JSON.stringify(auditoria.metadata).includes('Benchmark'), 'a auditoria não leva texto livre');
  });

  it('é idempotente: reenviar não duplica a regra', async () => {
    const m = await montar();
    const entrada = { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl' }] };
    await m.servico.aprovarSugestoesDeLacunas(como('admin'), entrada, ator);
    const segunda = await m.servico.aprovarSugestoesDeLacunas(como('admin'), entrada, ator);
    assert.ok(segunda.ok);
    assert.deepEqual(segunda.value.itens.map((i) => i.estado), ['ja_aprovada']);
    assert.equal(m.regras!.registros.length, 1);
    assert.equal(m.regras!.decisoes.length, 1);
    const duplicadoNoPedido = await m.servico.aprovarSugestoesDeLacunas(como('admin'), { ...entrada, itens: [{ lacunaId: 'lim_cpl' }, { lacunaId: 'lim_cpl' }] }, ator);
    assert.ok(duplicadoNoPedido.ok);
    assert.equal(duplicadoNoPedido.value.itens.length, 1);
  });

  it('a pessoa pode editar o valor; a origem registrada deixa de ser a evidência', async () => {
    const m = await montar();
    const r = await m.servico.aprovarSugestoesDeLacunas(
      como('admin'),
      { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl', valor: { unidade: 'brl_centavos', centavos: '7000', moeda: 'BRL' } }] },
      ator,
    );
    assert.ok(r.ok);
    const registro = m.regras!.registros[0]!;
    assert.deepEqual(registro.entrada.valor, { unidade: 'brl_centavos', centavos: '7000', moeda: 'BRL' });
    assert.match(String(registro.entrada.contexto), /Origem: valor informado pela pessoa/);
    assert.equal(registro.entrada.evidencia, null);
  });

  it('atômico por item, com relatório: um item falha e os outros seguem', async () => {
    const m = await montar();
    const r = await m.servico.aprovarSugestoesDeLacunas(
      como('admin'),
      {
        clienteId: CLIENTE_ID,
        planoId: m.planoId,
        itens: [{ lacunaId: 'inexistente' }, { lacunaId: 'dado', valor: { texto: 'x' } }, { lacunaId: 'lim_gasto' }, { lacunaId: 'lim_cpl' }],
      },
      ator,
    );
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.itens.map((i) => [i.lacunaId, i.estado, i.erro?.codigo ?? null]),
      [
        ['inexistente', 'falhou', 'lacuna_inexistente'],
        ['dado', 'falhou', 'sem_regra_estruturada'],
        ['lim_gasto', 'falhou', 'sem_valor'],
        ['lim_cpl', 'aprovada', null],
      ],
    );
    assert.equal(r.value.aprovadas, 1);
    assert.equal(r.value.falhas, 3);
  });

  it('o valor informado pela pessoa passa pelas mesmas validações de Regras (unidade errada falha só aquele item)', async () => {
    const m = await montar();
    const errada = await m.servico.aprovarSugestoesDeLacunas(
      como('admin'),
      { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl', valor: { unidade: 'percentual', decimal: '10' } }] },
      ator,
    );
    assert.ok(errada.ok);
    assert.equal(errada.value.itens[0]!.estado, 'falhou');
    assert.equal(errada.value.itens[0]!.erro?.mensagem, 'A unidade difere da definição.');
    assert.equal(m.regras!.decisoes.length, 0);
    const certa = await m.servico.aprovarSugestoesDeLacunas(
      como('admin'),
      { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl', valor: { unidade: 'brl_centavos', centavos: '7000', moeda: 'BRL' } }] },
      ator,
    );
    assert.ok(certa.ok);
    assert.equal(certa.value.itens[0]!.estado, 'aprovada');
  });

  it('limite com mais de um tipo possível para a medida (gasto) não é adivinhado: falha só aquele item pedindo a escolha', async () => {
    const m = await montar();
    const r = await m.servico.aprovarSugestoesDeLacunas(
      como('admin'),
      { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_gasto', valor: { unidade: 'brl_centavos', centavos: '100000', moeda: 'BRL' } }] },
      ator,
    );
    assert.ok(r.ok);
    assert.equal(r.value.itens[0]!.erro?.codigo, 'definicao_ambigua');
    assert.equal(m.regras!.registros.length, 0);
  });

  it('sem tipo de limite ativo que atenda a lacuna, o item falha sem gravar', async () => {
    const m = await montar({ regras: criarRegrasFalsa({ semDefinicoes: true }) });
    const r = await m.servico.aprovarSugestoesDeLacunas(como('admin'), { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl' }] }, ator);
    assert.ok(r.ok);
    assert.equal(r.value.itens[0]!.erro?.codigo, 'sem_definicao_de_limite');
    assert.equal(m.regras!.registros.length, 0);
  });

  it('regra já vigente com outro valor não é sobrescrita', async () => {
    const m = await montar();
    m.regras!.decisoes.push({ id: 'x', numero: 9, natureza: 'limite', chave: 'eficiencia.custo_por_lead', escopo: 'cliente', definicaoChave: 'eficiencia.custo_por_lead', valor: { unidade: 'brl_centavos', centavos: '9999', moeda: 'BRL' }, texto: null });
    const r = await m.servico.aprovarSugestoesDeLacunas(como('admin'), { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl' }] }, ator);
    assert.ok(r.ok);
    assert.equal(r.value.itens[0]!.erro?.codigo, 'regra_ja_existe');
    assert.equal(m.regras!.registros.length, 0);
  });

  it('só owner e admin aprovam; operator, viewer e agente não gravam nada', async () => {
    const m = await montar();
    for (const papel of ['operator', 'viewer'] as const) {
      const r = await m.servico.aprovarSugestoesDeLacunas(como(papel), { clienteId: CLIENTE_ID, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl' }] }, ator);
      assert.equal(codigoDe(r), 'forbidden', papel);
    }
    assert.equal(m.regras!.registros.length, 0);
  });

  it('isola cliente e organização: plano de outro cliente ou sem regras disponíveis não grava', async () => {
    const m = await montar();
    const outroCliente = await m.servico.aprovarSugestoesDeLacunas(como('admin'), { clienteId: OUTRO_CLIENTE, planoId: m.planoId, itens: [{ lacunaId: 'lim_cpl' }] }, ator);
    assert.equal(codigoDe(outroCliente), 'not_found');
    const semRegras = await (await montar({ regras: null })).servico.aprovarSugestoesDeLacunas(como('admin'), { clienteId: CLIENTE_ID, planoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', itens: [{ lacunaId: 'lim_cpl' }] }, ator);
    assert.notEqual(codigoDe(semRegras), 'ok');
    assert.equal(m.regras!.registros.length, 0);
  });

  it('valida a entrada: lista vazia, id fora do padrão e campo extra', async () => {
    const m = await montar();
    for (const itens of [[], [{ lacunaId: 'Maiúscula' }], [{ lacunaId: 'lim_cpl', extra: 1 }]]) {
      const r = await m.servico.aprovarSugestoesDeLacunas(como('admin'), { clienteId: CLIENTE_ID, planoId: m.planoId, itens } as never, ator);
      assert.equal(codigoDe(r), 'validation');
    }
  });

  it('lacuna cuja única evidência é nota D não traz valor pré-preenchido no esquema (hipótese) e o gate recusa o contrário', async () => {
    const base = planoComLacunas();
    const comD = lerPlano({
      ...base,
      lacunas: {
        itens: [
          {
            id: 'lim_cpl',
            tipo: 'limite_ausente',
            medida: 'custo_por_lead',
            descricao: 'Sem teto.',
            impacto: 'Sem meta.',
            regra: { natureza: 'limite', escopo: 'cliente' },
            sugestao: { valor: valorCpl, origem: 'hipotese', evidencias: [{ urn: URN_BENCHMARK_D, papel: 'favor' }], justificativa: 'Chute.' },
          },
        ],
      },
    });
    assert.equal(comD.ok, false, 'sugestão sem origem em evidência não é aceita pelo esquema');
  });
});

describe('corrigir a falha do Gate', () => {
  async function comGate(resultado: 'reprovado' | 'aprovado') {
    const m = await montar();
    const anterior = await m.repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
      planoId: m.planoId,
      pedido: { tipo: 'ajustar', instrucao: 'x' },
      versaoBaseId: m.versaoId,
      agentRunId: 'run-0',
      solicitadoPor: 'p',
      requestId: 'r',
    });
    assert.ok(anterior.ok);
    const reservada = await m.repositorio.reservarExecucao(ORGANIZACAO_ID, anterior.value.id, { leaseMs: 60_000, agora: new Date() });
    assert.ok(reservada);
    const gate = await m.repositorio.registrarEvento(ORGANIZACAO_ID, {
      versaoId: m.versaoId,
      tipo: 'gate',
      payload: { resultado, checagens: [{ chave: 'nao_faremos_preservado', resultado: 'reprovado', motivo: '4 perdidos', onde: ['estrategia/nf1 (removido em relação à versão base)'] }], modelo: null },
      autoria: { tipo: 'agente', agentId: 'gates', agentRunId: 'run-0', chaveDeIdempotencia: 'g', ficha: reservada.tentativas },
      requestId: 'r',
    });
    assert.ok(gate.ok);
    const fim = await m.repositorio.atualizarExecucao(ORGANIZACAO_ID, anterior.value.id, { status: 'falhou', erroCodigo: 'gate_reprovado', leaseAte: null }, reservada.tentativas);
    assert.ok(fim.ok);
    return m;
  }

  const pedido = (m: { planoId: string }) => ({ clienteId: CLIENTE_ID, planoId: m.planoId });

  it('cria a execução corrigir_gate sobre o rascunho reprovado, sem tocar no gate, e audita', async () => {
    const m = await comGate('reprovado');
    const r = await m.servico.corrigirFalhaDoGate(como('operator'), pedido(m), ator);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.value.execucao.tipo, 'corrigir_gate');
    assert.equal(r.value.execucao.versaoBaseId, m.versaoId);
    assert.deepEqual(r.value.execucao.pedido, {});
    const eventos = await m.repositorio.eventosDaVersao(ORGANIZACAO_ID, m.versaoId);
    assert.equal(eventos.filter((e) => e.tipo === 'gate').length, 1);
    assert.equal(eventos.filter((e) => e.tipo === 'proposta').length, 0);
    const auditoria = m.auditorias.find((a) => a.metadata?.kind === 'corrigir_gate')!;
    assert.equal(auditoria.metadata?.baseVersionId, m.versaoId);
  });

  it('a tela recebe a falha em português e se a correção é possível', async () => {
    const m = await comGate('reprovado');
    const painel = await m.servico.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    const falha = painel.value.planos[0]!.falhaDoGate;
    assert.equal(falha?.possivel, true);
    assert.equal(falha?.falhas[0]?.gate, 'O que "não faremos" da versão base foi mantido');
  });

  it('recusa sem permissão, sem gate reprovado, com execução ativa e em plano de outro cliente', async () => {
    const m = await comGate('reprovado');
    assert.equal(codigoDe(await m.servico.corrigirFalhaDoGate(como('viewer'), pedido(m), ator)), 'forbidden');
    assert.equal(codigoDe(await m.servico.corrigirFalhaDoGate(como('operator'), { clienteId: OUTRO_CLIENTE, planoId: m.planoId }, ator)), 'not_found');
    const aprovada = await comGate('aprovado');
    assert.equal(codigoDe(await aprovada.servico.corrigirFalhaDoGate(como('operator'), pedido(aprovada), ator)), 'gate_nao_reprovou');
    const primeira = await m.servico.corrigirFalhaDoGate(como('operator'), pedido(m), ator);
    assert.ok(primeira.ok);
    assert.equal(codigoDe(await m.servico.corrigirFalhaDoGate(como('operator'), pedido(m), ator)), 'execucao_ativa');
  });

  it('no máximo 2 correções por versão-raiz', async () => {
    const m = await comGate('reprovado');
    for (let i = 0; i < 2; i += 1) {
      const r = await m.servico.corrigirFalhaDoGate(como('operator'), pedido(m), ator);
      assert.ok(r.ok, `correção ${i + 1}`);
      const reservada = await m.repositorio.reservarExecucao(ORGANIZACAO_ID, r.value.execucao.id, { leaseMs: 60_000, agora: new Date() });
      assert.ok(reservada);
      const fim = await m.repositorio.atualizarExecucao(ORGANIZACAO_ID, r.value.execucao.id, { status: 'falhou', erroCodigo: 'correcao_nao_convergiu', leaseAte: null }, reservada.tentativas);
      assert.ok(fim.ok);
    }
    const terceira = await m.servico.corrigirFalhaDoGate(como('operator'), pedido(m), ator);
    assert.equal(codigoDe(terceira), 'limite_de_correcoes');
    const painel = await m.servico.painelDoPlano(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(painel.ok);
    const falha = painel.value.planos[0]!.falhaDoGate;
    assert.equal(falha?.possivel, false);
    assert.match(falha?.motivoLegivel ?? '', /limite de 2 correções/);
  });
});

void OUTRA_ORG;
