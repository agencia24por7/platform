import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import type { Ator } from '@/modules/audit/domain/actor';
import type { MemberRole } from '@/modules/identity/domain/user';
import { textoSeguro, TEXTO_OMITIDO } from '@/modules/brain/domain/privacidade';
import {
  MAXIMO_DE_SALTOS_DA_CADEIA,
  MENSAGEM_DA_FALTA,
  passouPeloComite,
  respostaDoAjuste,
  substituidaPor,
  ROTULO_DO_STATUS,
  SCHEMA_VERSION,
  TIPOS_DE_REGRA_NO_PACOTE,
  avaliarImpacto,
  planoSemDadoPessoal,
  sanitizarIntencao,
  combinarReferencias,
  type AvaliacaoDeImpacto,
  hashesDoPacote,
  lerPlano,
  podeAplicar,
  podeExecutar,
  referenciasDoPlano,
  statusAposEvento,
  type AcaoDoPlano,
  type EventoParaAplicar,
  type FaltaParaAplicar,
  type StatusDaVersao,
} from '@/modules/strategy/domain/index';
import {
  EditarManualSchema,
  ExecucaoAlvoSchema,
  PainelSchema,
  PedirMudancaSchema,
  PedirPlanoSchema,
  PedirRevisaoSchema,
  VersaoAlvoSchema,
  detalhesDoZod,
  type EntradaDeEditarManual,
  type EntradaDeExecucaoAlvo,
  type EntradaDePedirMudanca,
  type EntradaDePedirPlano,
  type EntradaDePedirRevisao,
  type EntradaDeVersaoAlvo,
  type EntradaDoPainel,
} from '@/modules/strategy/application/estrategiaEntradas';
import type {
  ErroDeEstrategia,
  EventoDaVersao,
  Execucao,
  GeradorDeId,
  LeitorDoBrain,
  SnapshotDoBrainLido,
  Plano,
  ReferenciaDaVersao,
  Relogio,
  RepositorioDeEstrategia,
  TipoDeEventoRegistravel,
  TipoDeRecurso,
  Versao,
  VersaoResumo,
} from '@/modules/strategy/application/portas';
import { lerUrn } from '@/modules/brain/domain/urn';
import { catalogoAtualDoPacote, type CatalogoAtual } from '@/modules/strategy/application/catalogoAtual';
import { carregarCadeia } from '@/modules/strategy/application/cadeiaDoComite';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type ComandoDeEstrategia = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

export type DependenciasDeEstrategia = {
  readonly repositorio: RepositorioDeEstrategia;
  readonly audit: AuditRecorder;
  readonly leitorDoBrain: LeitorDoBrain;
  readonly relogio?: Relogio;
  readonly gerador?: GeradorDeId;
};

export type PedidoDePlano = { readonly plano: Plano; readonly execucao: Execucao };
export type EdicaoManual = { readonly versao: Versao; readonly execucao: Execucao };

export type ParecerNoPainel = { readonly persona: string; readonly veredito: string; readonly criadoEm: Date; readonly payload: Readonly<Record<string, unknown>> };
export type GateNoPainel = {
  readonly resultado: 'aprovado' | 'reprovado';
  readonly checagens: readonly unknown[];
  readonly criadoEm: Date;
};

export type PainelDoPlano = {
  readonly plano: Plano;
  readonly versaoExibida: Versao | null;
  readonly status: StatusDaVersao | null;
  readonly rotulo: string | null;
  readonly pareceres: readonly ParecerNoPainel[];
  readonly ajuste: EventoDaVersao | null;
  readonly gate: GateNoPainel | null;
  readonly faltaParaAplicar: readonly FaltaParaAplicar[] | null;
  readonly execucaoAtiva: Execucao | null;
  readonly ultimaExecucao: Execucao | null;
  readonly desatualizado: AvaliacaoDeImpacto | 'indisponivel' | null;
  readonly historico: {
    readonly versoes: readonly VersaoResumo[];
    readonly eventos: readonly EventoDaVersao[];
  };
};

export type ResumoDoPlano = {
  readonly planoId: string;
  readonly tipo: string;
  readonly status: StatusDaVersao | null;
  readonly rotulo: string | null;
};

export type PainelDoCliente = {
  readonly geradoEm: Date;
  readonly planos: readonly PainelDoPlano[];
  readonly resumos: readonly ResumoDoPlano[];
};

export type OpcoesDoPainel = { readonly snapshotDoBrain?: SnapshotDoBrainLido | 'indisponivel' };

export type VersaoVistaDoPlano = { readonly id: string; readonly conteudo: unknown };

export type EstrategiaService = {
  pedirPlano(comando: ComandoDeEstrategia, entrada: EntradaDePedirPlano, ator: Ator): Promise<Result<PedidoDePlano, Failure>>;
  pedirRevisao(comando: ComandoDeEstrategia, entrada: EntradaDePedirRevisao, ator: Ator): Promise<Result<Execucao, Failure>>;
  pedirMudanca(comando: ComandoDeEstrategia, entrada: EntradaDePedirMudanca, ator: Ator): Promise<Result<Execucao, Failure>>;
  editarManual(comando: ComandoDeEstrategia, entrada: EntradaDeEditarManual, ator: Ator): Promise<Result<EdicaoManual, Failure>>;
  aplicar(comando: ComandoDeEstrategia, entrada: EntradaDeVersaoAlvo, ator: Ator): Promise<Result<EventoDaVersao, Failure>>;
  autorizar(comando: ComandoDeEstrategia, entrada: EntradaDeVersaoAlvo, ator: Ator): Promise<Result<EventoDaVersao, Failure>>;
  rejeitar(comando: ComandoDeEstrategia, entrada: EntradaDeVersaoAlvo, ator: Ator): Promise<Result<EventoDaVersao, Failure>>;
  revogar(comando: ComandoDeEstrategia, entrada: EntradaDeVersaoAlvo, ator: Ator): Promise<Result<EventoDaVersao, Failure>>;
  cancelarVersao(comando: ComandoDeEstrategia, entrada: EntradaDeVersaoAlvo, ator: Ator): Promise<Result<EventoDaVersao, Failure>>;
  cancelarExecucao(comando: ComandoDeEstrategia, entrada: EntradaDeExecucaoAlvo, ator: Ator): Promise<Result<Execucao, Failure>>;
  painelDoPlano(comando: ComandoDeEstrategia, entrada: EntradaDoPainel, opcoes?: OpcoesDoPainel): Promise<Result<PainelDoCliente, Failure>>;
  clienteDoPlano(comando: ComandoDeEstrategia, planoId: string): Promise<string | null>;
  clienteDaVersao(comando: ComandoDeEstrategia, versaoId: string): Promise<string | null>;
  clienteDaExecucao(comando: ComandoDeEstrategia, execucaoId: string): Promise<string | null>;
  versaoVistaDoPlano(comando: ComandoDeEstrategia, escopo: { readonly clienteId: string; readonly planoId: string; readonly comConteudo?: boolean }): Promise<VersaoVistaDoPlano | null>;
};

export const LIMITE_DE_VERSOES_NO_HISTORICO = 10;

const IDENTIFICADOR = z.string().uuid();
const SEM_PERMISSAO = failure('forbidden', 'Seu papel não permite esta ação sobre o plano.');
const SEM_USUARIO = failure('unauthorized', 'Sessão sem usuário.');
const CLIENTE_NAO_ENCONTRADO = failure('not_found', 'Cliente não encontrado.');
const PLANO_NAO_ENCONTRADO = failure('not_found', 'Plano não encontrado.');
const VERSAO_NAO_ENCONTRADA = failure('not_found', 'Versão do plano não encontrada.');
const EXECUCAO_NAO_ENCONTRADA = failure('not_found', 'Execução não encontrada.');
const EXECUCAO_EM_ANDAMENTO = failure('conflict', 'Já há uma execução em andamento para este plano. Cancele-a ou aguarde.', {
  codigo: 'execucao_ativa',
});

const PADROES_DE_AUDITORIA: Readonly<Record<'aplicar' | 'autorizar' | 'rejeitar' | 'revogar' | 'cancelarVersao', {
  readonly acao: AcaoDoPlano;
  readonly evento: TipoDeEventoRegistravel;
  readonly auditoria: string;
}>> = {
  aplicar: { acao: 'aplicar', evento: 'proposta', auditoria: 'strategy.plan.applied' },
  autorizar: { acao: 'autorizar', evento: 'efetivada', auditoria: 'strategy.plan.authorized' },
  rejeitar: { acao: 'rejeitar', evento: 'rejeitada', auditoria: 'strategy.plan.rejected' },
  revogar: { acao: 'revogar', evento: 'revogada', auditoria: 'strategy.plan.revoked' },
  cancelarVersao: { acao: 'cancelar', evento: 'cancelada', auditoria: 'strategy.version.cancelled' },
};

export function falhaDeEstrategia(erro: ErroDeEstrategia): Failure {
  switch (erro.codigo) {
    case 'sem_permissao':
      return SEM_PERMISSAO;
    case 'teto_do_agente':
      return failure('rate_limited', erro.mensagem, { teto: erro.teto ?? 'execucao' });
    case 'execucao_ativa':
      return EXECUCAO_EM_ANDAMENTO;
    case 'execucao_perdida':
      return failure('conflict', 'A execução não está mais ativa.', { codigo: 'execucao_perdida' });
    case 'nao_encontrado':
      return failure('not_found', erro.mensagem);
    case 'falta_para_aplicar':
    case 'invalido':
      return failure('validation', erro.mensagem, { codigo: erro.codigo });
    case 'ja_feito':
    case 'conflito':
    case 'transicao_invalida':
      return failure('conflict', erro.mensagem, { codigo: erro.codigo });
  }
}

function detalhesDasFaltas(faltas: readonly FaltaParaAplicar[]): Record<string, string> {
  return Object.fromEntries(faltas.map((falta) => [falta, MENSAGEM_DA_FALTA[falta]]));
}

function eventosParaAplicar(eventos: readonly EventoDaVersao[]): EventoParaAplicar[] {
  return eventos.map((evento): EventoParaAplicar => {
    if (evento.tipo === 'parecer') return { tipo: 'parecer', agentRunId: evento.agentRunId };
    if (evento.tipo === 'ajuste') {
      const alvo = evento.payload.responde_a;
      return { tipo: 'ajuste', respondeA: typeof alvo === 'string' ? alvo : null, agentRunId: evento.agentRunId };
    }
    if (evento.tipo === 'gate') {
      return { tipo: 'gate', resultado: evento.payload.resultado === 'aprovado' ? 'aprovado' : 'reprovado', agentRunId: evento.agentRunId };
    }
    return { tipo: 'outro' };
  });
}

export function createEstrategiaService(deps: DependenciasDeEstrategia): EstrategiaService {
  const { repositorio, audit, leitorDoBrain } = deps;
  const relogio = deps.relogio ?? { agora: () => new Date() };
  const gerador = deps.gerador ?? { novo: () => randomUUID() };

  const pode = (acao: AcaoDoPlano, papel: MemberRole) => podeExecutar(acao, { tipo: 'pessoa', papel });

  const auditar = (
    comando: ComandoDeEstrategia,
    ator: Ator,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) =>
    registrarSemFalhar(audit, {
      organizationId: comando.organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action,
      targetType,
      targetId,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata,
    });

  const novoIdDeExecucao = () => `run-${gerador.novo()}`;

  async function planoDoCliente(comando: ComandoDeEstrategia, planoId: string) {
    return repositorio.buscarPlanoPorId(comando.organizationId, planoId);
  }

  async function estadoDoPlano(plano: Plano) {
    const planos = await repositorio.listarPlanosDoCliente({ organizationId: plano.organizationId, clientId: plano.clientId });
    return planos.find((candidato) => candidato.plano.id === plano.id) ?? null;
  }

  async function pedirPlano(comando: ComandoDeEstrategia, entrada: EntradaDePedirPlano, ator: Ator) {
    const lida = PedirPlanoSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('criar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);
    const { clienteId, tipoDePlano } = lida.data;
    const intencaoLimpa = sanitizarIntencao(lida.data.intencao);
    if (!intencaoLimpa.ok) {
      const detalhes = Object.fromEntries(intencaoLimpa.error.map((erro) => [erro.campo, 'Contém dado pessoal ou ficou vazio.']));
      return err(failure('validation', 'A intenção contém dado pessoal ou ficou vazia. Reescreva sem dados pessoais.', detalhes));
    }
    const intencao = intencaoLimpa.value;
    const escopo = { organizationId: comando.organizationId, clientId: clienteId };
    if (!(await repositorio.clienteVisivel(comando.organizationId, clienteId))) return err(CLIENTE_NAO_ENCONTRADO);

    let plano = await repositorio.buscarPlano(escopo, tipoDePlano);
    if (!plano) {
      const criado = await repositorio.criarPlano(escopo, tipoDePlano, ator.requestId);
      if (criado.ok) plano = criado.value;
      else if (criado.error.codigo === 'ja_feito') plano = await repositorio.buscarPlano(escopo, tipoDePlano);
      else return err(falhaDeEstrategia(criado.error));
    }
    if (!plano) return err(PLANO_NAO_ENCONTRADO);

    const estado = await estadoDoPlano(plano);
    if (estado?.vigente || estado?.aberta) {
      return err(failure('conflict', 'Este cliente já tem plano deste tipo. Peça uma mudança em vez de criar de novo.', { codigo: 'plano_ja_existe' }));
    }

    const execucao = await repositorio.criarExecucao(comando.organizationId, clienteId, {
      planoId: plano.id,
      pedido: { tipo: 'criar', intencao },
      versaoBaseId: null,
      agentRunId: novoIdDeExecucao(),
      solicitadoPor: ator.userId,
      requestId: ator.requestId,
    });
    if (!execucao.ok) return err(falhaDeEstrategia(execucao.error));

    await auditar(comando, ator, 'strategy.plan.requested', 'strategy_plan', plano.id, {
      clientId: clienteId,
      tipoDePlano,
      execucaoId: execucao.value.id,
      kind: 'criar',
    });
    return ok({ plano, execucao: execucao.value });
  }

  async function pedirMudanca(comando: ComandoDeEstrategia, entrada: EntradaDePedirMudanca, ator: Ator) {
    const lida = PedirMudancaSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('editar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);

    const instrucao = textoSeguro(lida.data.instrucao);
    if (instrucao === TEXTO_OMITIDO || instrucao.length < 3) {
      return err(failure('validation', 'A instrução contém dado pessoal ou ficou vazia. Reescreva sem dados pessoais.', { instrucao: 'dado pessoal na instrução' }));
    }

    const plano = await planoDoCliente(comando, lida.data.planoId);
    if (!plano) return err(PLANO_NAO_ENCONTRADO);
    const estado = await estadoDoPlano(plano);
    const base = estado?.aberta ?? estado?.vigente ?? null;
    if (!base) return err(failure('conflict', 'O plano ainda não tem versão para ajustar.', { codigo: 'sem_versao' }));

    const execucao = await repositorio.criarExecucao(comando.organizationId, plano.clientId, {
      planoId: plano.id,
      pedido: { tipo: 'ajustar', instrucao },
      versaoBaseId: base.id,
      agentRunId: novoIdDeExecucao(),
      solicitadoPor: ator.userId,
      requestId: ator.requestId,
    });
    if (!execucao.ok) return err(falhaDeEstrategia(execucao.error));

    await auditar(comando, ator, 'strategy.plan.requested', 'strategy_plan', plano.id, {
      clientId: plano.clientId,
      tipoDePlano: plano.tipo,
      execucaoId: execucao.value.id,
      kind: 'ajustar',
      baseVersionId: base.id,
    });
    return ok(execucao.value);
  }

  async function pedirRevisao(comando: ComandoDeEstrategia, entrada: EntradaDePedirRevisao, ator: Ator) {
    const lida = PedirRevisaoSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('editar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);
    const plano = await planoDoCliente(comando, lida.data.planoId);
    if (!plano) return err(PLANO_NAO_ENCONTRADO);
    const estado = await estadoDoPlano(plano);
    if (!estado?.vigente) return err(failure('conflict', 'Só o plano autorizado se revisa por mudança do Brain.', { codigo: 'sem_vigente' }));

    const execucao = await repositorio.criarExecucao(comando.organizationId, plano.clientId, {
      planoId: plano.id,
      pedido: { tipo: 'revisar', motivo: 'brain_mudou' },
      versaoBaseId: estado.vigente.id,
      agentRunId: novoIdDeExecucao(),
      solicitadoPor: ator.userId,
      requestId: ator.requestId,
    });
    if (!execucao.ok) return err(falhaDeEstrategia(execucao.error));

    await auditar(comando, ator, 'strategy.plan.requested', 'strategy_plan', plano.id, {
      clientId: plano.clientId,
      tipoDePlano: plano.tipo,
      execucaoId: execucao.value.id,
      kind: 'revisar',
      motivo: 'brain_mudou',
      baseVersionId: estado.vigente.id,
    });
    return ok(execucao.value);
  }

  async function impactoDoBrain(
    comando: ComandoDeEstrategia,
    plano: Plano,
    vigente: VersaoResumo,
    catalogoDado?: CatalogoAtual | 'indisponivel',
  ): Promise<AvaliacaoDeImpacto | 'indisponivel'> {
    try {
      if (catalogoDado === 'indisponivel') return 'indisponivel';
      const [versao, catalogoAtual] = await Promise.all([
        repositorio.lerVersao(comando.organizationId, vigente.id),
        catalogoDado ?? catalogoDoBrain(comando, plano.clientId),
      ]);
      if (!versao || !catalogoAtual) return 'indisponivel';
      const lidasNaCriacao = new Map<string, string>(versao.referencias.map((r) => [r.urn, r.hash]));
      return avaliarImpacto({
        referencias: versao.referencias,
        catalogoAtual,
        lidasNaCriacao,
        tiposRelevantes: new Set<string>(),
        hoje: relogio.agora().toISOString().slice(0, 10),
      });
    } catch {
      return 'indisponivel';
    }
  }

  function catalogoDoSnapshotDado(
    comando: ComandoDeEstrategia,
    clienteId: string,
    snapshot: SnapshotDoBrainLido | 'indisponivel' | undefined,
  ): CatalogoAtual | 'indisponivel' | undefined {
    if (snapshot === undefined) return undefined;
    if (snapshot === 'indisponivel') return 'indisponivel';
    if (snapshot.organizationId !== comando.organizationId || snapshot.clienteId !== clienteId) return 'indisponivel';
    return leitorDoBrain.catalogoDoSnapshot?.(comando.organizationId, clienteId, snapshot) ?? 'indisponivel';
  }

  async function catalogoDoBrain(comando: ComandoDeEstrategia, clienteId: string): Promise<CatalogoAtual | null> {
    const pacote = await leitorDoBrain.lerPacote(comando.organizationId, clienteId);
    return pacote.ok ? catalogoAtualDoPacote(pacote.value) : null;
  }

  async function hashesDasReferencias(
    plano: Plano,
    urns: readonly string[],
    base: VersaoResumo | null,
    comando: ComandoDeEstrategia,
  ): Promise<Result<ReadonlyMap<string, string>, Failure>> {
    const conhecidos = new Map<string, string>();
    if (base) {
      const anterior = await repositorio.lerVersao(comando.organizationId, base.id);
      for (const ref of anterior?.referencias ?? []) conhecidos.set(ref.urn, ref.hash);
    }
    const faltantes = urns.filter((urn) => !conhecidos.has(urn));
    if (faltantes.length === 0) return ok(conhecidos);

    const pacote = await leitorDoBrain.lerPacote(comando.organizationId, plano.clientId);
    if (!pacote.ok) {
      return err(failure('unavailable', 'Não foi possível ler o Brain para conferir as referências do plano.', { codigo: pacote.error.codigo }));
    }
    const doBrain = hashesDoPacote(pacote.value);
    const fora = faltantes.filter((urn) => !doBrain.has(urn));
    if (fora.length > 0) {
      return err(failure('validation', 'O plano cita entradas que não estão no Brain deste cliente.', { referencias: fora.slice(0, 5).join(', ') }));
    }
    for (const urn of faltantes) conhecidos.set(urn, doBrain.get(urn)!);
    return ok(conhecidos);
  }

  async function editarManual(comando: ComandoDeEstrategia, entrada: EntradaDeEditarManual, ator: Ator) {
    const lida = EditarManualSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('editar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);

    const plano = await planoDoCliente(comando, lida.data.planoId);
    if (!plano) return err(PLANO_NAO_ENCONTRADO);

    const conteudo = lerPlano(lida.data.conteudo);
    if (!conteudo.ok) {
      const detalhes = Object.fromEntries(conteudo.error.problemas.slice(0, 10).map((p) => [p.caminho || 'plano', p.mensagem]));
      return err(failure('validation', conteudo.error.mensagem, detalhes));
    }
    const privacidade = planoSemDadoPessoal(conteudo.value);
    if (!privacidade.ok) {
      const detalhes = Object.fromEntries(privacidade.error.slice(0, 10).map((a) => [a.caminho, `Dado pessoal (${a.padroes.join(', ')}) na seção ${a.secao}.`]));
      const secoes = [...new Set(privacidade.error.map((a) => a.secao))].join(', ');
      return err(failure('validation', `O plano não pode conter dado pessoal. Remova da(s) seção(ões): ${secoes}.`, detalhes));
    }
    const referencias = referenciasDoPlano(conteudo.value, { organizacaoId: comando.organizationId, clienteId: plano.clientId });
    if (!referencias.ok) {
      const detalhes = Object.fromEntries(referencias.error.slice(0, 10).map((e) => [e.urn, e.mensagem]));
      return err(failure('validation', 'O plano cita referências inválidas.', detalhes));
    }

    if (await repositorio.execucaoAtiva(comando.organizationId, plano.id)) return err(EXECUCAO_EM_ANDAMENTO);

    const estado = await estadoDoPlano(plano);
    const base = estado?.aberta ?? estado?.vigente ?? estado?.maisRecente ?? null;
    const hashes = await hashesDasReferencias(plano, [...new Set(referencias.value.map((r) => r.urn))], base, comando);
    if (!hashes.ok) return hashes;
    const citadas: ReferenciaDaVersao[] = referencias.value.map((ref) => ({ urn: ref.urn, papel: ref.papel, hash: hashes.value.get(ref.urn)! }));
    const baseCompleta = base ? await repositorio.lerVersao(comando.organizationId, base.id) : null;
    const herdadas = (baseCompleta?.referencias ?? []).filter((ref) => {
      const tipo = lerUrn(ref.urn)?.tipo;
      return tipo !== undefined && TIPOS_DE_REGRA_NO_PACOTE.includes(tipo);
    });
    const comHash: ReferenciaDaVersao[] = combinarReferencias(citadas, herdadas);

    const gravada = await repositorio.criarVersaoManualComRevisao(
      comando.organizationId,
      plano.clientId,
      {
        planoId: plano.id,
        conteudo: conteudo.value,
        schemaVersion: SCHEMA_VERSION,
        supersedesId: estado?.vigente?.id ?? null,
        autoria: { tipo: 'pessoa', userId: ator.userId },
        referencias: comHash,
        requestId: ator.requestId,
      },
      {
        planoId: plano.id,
        pedido: { tipo: 'revisar', motivo: 'edicao_manual' },
        agentRunId: novoIdDeExecucao(),
        solicitadoPor: ator.userId,
        requestId: ator.requestId,
      },
    );
    if (!gravada.ok) return err(falhaDeEstrategia(gravada.error));
    const { versao, execucao } = gravada.value;

    await auditar(comando, ator, 'strategy.version.created', 'strategy_plan_version', versao.id, {
      clientId: plano.clientId,
      planoId: plano.id,
      origem: 'edicao_manual',
      execucaoId: execucao.id,
      referencias: comHash.length,
    });
    return ok({ versao, execucao });
  }

  async function agirNaVersao(
    chave: keyof typeof PADROES_DE_AUDITORIA,
    comando: ComandoDeEstrategia,
    entrada: EntradaDeVersaoAlvo,
    ator: Ator,
  ): Promise<Result<EventoDaVersao, Failure>> {
    const padrao = PADROES_DE_AUDITORIA[chave];
    const lida = VersaoAlvoSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode(padrao.acao, comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);

    const versao = await repositorio.lerVersao(comando.organizationId, lida.data.versaoId);
    if (!versao) return err(VERSAO_NAO_ENCONTRADA);

    const efeito = statusAposEvento(versao.status, padrao.evento);
    if (!efeito.ok) {
      return err(failure('conflict', `A versão está ${ROTULO_DO_STATUS[versao.status].toLowerCase()} e não aceita esta ação.`, { codigo: 'transicao_invalida' }));
    }

    if (chave === 'aplicar') {
      const eventos = await repositorio.eventosDaVersao(comando.organizationId, versao.id);
      const faltas = podeAplicar(await entradaDeAplicacao(comando, versao.id, eventos));
      if (!faltas.ok) return err(failure('validation', 'O plano ainda não pode ser aplicado.', detalhesDasFaltas(faltas.error)));
    }

    const evento = await repositorio.registrarEvento(comando.organizationId, {
      versaoId: versao.id,
      tipo: padrao.evento,
      payload: {},
      autoria: { tipo: 'pessoa', userId: ator.userId },
      requestId: ator.requestId,
    });
    if (!evento.ok) return err(falhaDeEstrategia(evento.error));

    await auditar(comando, ator, padrao.auditoria, 'strategy_plan_version', versao.id, {
      clientId: versao.clientId,
      planoId: versao.planoId,
      statusAnterior: versao.status,
    });
    return ok(evento.value);
  }

  async function entradaDeAplicacao(comando: ComandoDeEstrategia, versaoId: string, eventos: readonly EventoDaVersao[]) {
    const eventosDaVersao = eventosParaAplicar(eventos);
    const cadeia = await carregarCadeia(repositorio, comando.organizationId, versaoId, eventos);
    const doVersao = cadeia.get(versaoId) ?? [];
    const respondida = respostaDoAjuste(doVersao);
    const execucaoDoAjuste = doVersao.find((e) => e.tipo === 'ajuste')?.agentRunId ?? null;
    const respondidaPassouPeloComite =
      respondida !== null &&
      execucaoDoAjuste !== null &&
      substituidaPor(respondida, versaoId, cadeia) &&
      passouPeloComite(respondida, cadeia, execucaoDoAjuste);
    return { eventosDaVersao, respondidaPassouPeloComite };
  }

  async function cancelarExecucao(comando: ComandoDeEstrategia, entrada: EntradaDeExecucaoAlvo, ator: Ator) {
    const lida = ExecucaoAlvoSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('cancelar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);

    const execucao = await repositorio.lerExecucao(comando.organizationId, lida.data.execucaoId);
    if (!execucao) return err(EXECUCAO_NAO_ENCONTRADA);
    if (execucao.status !== 'pendente' && execucao.status !== 'rodando') {
      return err(failure('conflict', 'A execução já terminou e não pode ser cancelada.', { codigo: 'transicao_invalida' }));
    }
    const cancelada = await repositorio.cancelarExecucao(comando.organizationId, execucao.id, ator.requestId);
    if (!cancelada.ok) return err(falhaDeEstrategia(cancelada.error));

    await auditar(comando, ator, 'strategy.run.cancelled', 'strategy_plan_run', execucao.id, {
      clientId: execucao.clientId,
      planoId: execucao.planoId,
      kind: execucao.tipo,
      etapa: execucao.etapa,
      statusAnterior: execucao.status,
    });
    return ok(cancelada.value);
  }

  async function painelDoPlano(comando: ComandoDeEstrategia, entrada: EntradaDoPainel, opcoes: OpcoesDoPainel = {}): Promise<Result<PainelDoCliente, Failure>> {
    const lida = PainelSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('ler', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!(await repositorio.clienteVisivel(comando.organizationId, lida.data.clienteId))) return err(CLIENTE_NAO_ENCONTRADO);

    const planos = await repositorio.listarPlanosDoCliente({ organizationId: comando.organizationId, clientId: lida.data.clienteId });
    const { planoId, tipo } = lida.data;
    const detalhados = planoId || tipo ? planos.filter((estado) => (!planoId || estado.plano.id === planoId) && (!tipo || estado.plano.tipo === tipo)) : planos;
    const catalogoDado = catalogoDoSnapshotDado(comando, lida.data.clienteId, opcoes.snapshotDoBrain);
    const paineis = await Promise.all(detalhados.map((estado) => painelDe(comando, estado, catalogoDado)));
    const resumos = planos.map((estado): ResumoDoPlano => {
      const exibida = estado.aberta ?? estado.vigente;
      return { planoId: estado.plano.id, tipo: estado.plano.tipo, status: exibida?.status ?? null, rotulo: exibida ? ROTULO_DO_STATUS[exibida.status] : null };
    });
    return ok({ geradoEm: relogio.agora(), planos: paineis, resumos });
  }

  async function posse(comando: ComandoDeEstrategia, tipo: TipoDeRecurso, id: string): Promise<string | null> {
    if (!pode('ler', comando.papelDeQuemAge)) return null;
    if (!IDENTIFICADOR.safeParse(id).success) return null;
    return repositorio.clienteDoRecurso(comando.organizationId, tipo, id);
  }

  async function versaoVistaDoPlano(
    comando: ComandoDeEstrategia,
    escopo: { readonly clienteId: string; readonly planoId: string; readonly comConteudo?: boolean },
  ): Promise<VersaoVistaDoPlano | null> {
    if (!pode('ler', comando.papelDeQuemAge)) return null;
    const estado = (await repositorio.listarPlanosDoCliente({ organizationId: comando.organizationId, clientId: escopo.clienteId })).find(
      (candidato) => candidato.plano.id === escopo.planoId,
    );
    const vista = estado ? (estado.aberta ?? estado.vigente) : null;
    if (!vista) return null;
    if (!escopo.comConteudo) return { id: vista.id, conteudo: null };
    const versao = await repositorio.lerVersao(comando.organizationId, vista.id);
    return versao && versao.clientId === escopo.clienteId ? { id: versao.id, conteudo: versao.conteudo } : null;
  }

  async function painelDe(
    comando: ComandoDeEstrategia,
    estado: { readonly plano: Plano; readonly maisRecente: VersaoResumo | null; readonly vigente: VersaoResumo | null; readonly aberta: VersaoResumo | null },
    catalogoDado?: CatalogoAtual | 'indisponivel',
  ): Promise<PainelDoPlano> {
    const exibida = estado.aberta ?? estado.vigente;
    const [versaoExibida, versoes, execucaoAtiva, ultimaExecucao] = await Promise.all([
      exibida ? repositorio.lerVersao(comando.organizationId, exibida.id) : Promise.resolve(null),
      repositorio.listarVersoes(comando.organizationId, estado.plano.id, LIMITE_DE_VERSOES_NO_HISTORICO),
      repositorio.execucaoAtiva(comando.organizationId, estado.plano.id),
      repositorio.ultimaExecucao(comando.organizationId, estado.plano.id),
    ]);
    const eventosPorVersao = await Promise.all(
      versoes.map(async (versao) => ({ versao, eventos: await repositorio.eventosDaVersao(comando.organizationId, versao.id) })),
    );
    const eventosDaExibida = eventosPorVersao.find((item) => item.versao.id === exibida?.id)?.eventos ?? [];

    const pareceres = eventosDaExibida
      .filter((evento) => evento.tipo === 'parecer')
      .map((evento): ParecerNoPainel => ({
        persona: String(evento.payload.persona ?? ''),
        veredito: String(evento.payload.veredito ?? ''),
        criadoEm: evento.criadoEm,
        payload: evento.payload,
      }));
    const ajuste = eventosDaExibida.find((evento) => evento.tipo === 'ajuste') ?? null;
    const ultimoGate = [...eventosDaExibida].reverse().find((evento) => evento.tipo === 'gate');
    const gate: GateNoPainel | null = ultimoGate
      ? {
          resultado: ultimoGate.payload.resultado === 'aprovado' ? 'aprovado' : 'reprovado',
          checagens: Array.isArray(ultimoGate.payload.checagens) ? ultimoGate.payload.checagens : [],
          criadoEm: ultimoGate.criadoEm,
        }
      : null;

    let faltaParaAplicar: readonly FaltaParaAplicar[] | null = null;
    if (versaoExibida?.status === 'rascunho') {
      const resultado = podeAplicar(await entradaDeAplicacao(comando, versaoExibida.id, eventosDaExibida));
      faltaParaAplicar = resultado.ok ? [] : resultado.error;
    }

    const desatualizado = estado.vigente ? await impactoDoBrain(comando, estado.plano, estado.vigente, catalogoDado) : null;

    return {
      plano: estado.plano,
      versaoExibida,
      status: versaoExibida?.status ?? null,
      rotulo: versaoExibida ? ROTULO_DO_STATUS[versaoExibida.status] : null,
      pareceres,
      ajuste,
      gate,
      faltaParaAplicar,
      execucaoAtiva,
      ultimaExecucao,
      desatualizado,
      historico: { versoes, eventos: eventosPorVersao.flatMap((item) => item.eventos) },
    };
  }

  return {
    pedirPlano,
    pedirRevisao,
    pedirMudanca,
    editarManual,
    aplicar: (comando, entrada, ator) => agirNaVersao('aplicar', comando, entrada, ator),
    autorizar: (comando, entrada, ator) => agirNaVersao('autorizar', comando, entrada, ator),
    rejeitar: (comando, entrada, ator) => agirNaVersao('rejeitar', comando, entrada, ator),
    revogar: (comando, entrada, ator) => agirNaVersao('revogar', comando, entrada, ator),
    cancelarVersao: (comando, entrada, ator) => agirNaVersao('cancelarVersao', comando, entrada, ator),
    cancelarExecucao,
    painelDoPlano,
    clienteDoPlano: (comando, planoId) => posse(comando, 'plano', planoId),
    clienteDaVersao: (comando, versaoId) => posse(comando, 'versao', versaoId),
    clienteDaExecucao: (comando, execucaoId) => posse(comando, 'execucao', execucaoId),
    versaoVistaDoPlano,
  };
}
