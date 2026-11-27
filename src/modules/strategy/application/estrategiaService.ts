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
  esquemaIntencao,
  gerarUtmPorPlataforma,
  plataformasComCatalogo,
  CATALOGOS_DISPONIVEIS,
  ROTULO_DO_TIPO_DE_PLANO,
  TIPOS_DE_PLANO,
  type CatalogoDeCampos,
  type Plataforma,
  type TipoDePlano,
  combinarReferencias,
  type AvaliacaoDeImpacto,
  hashesDoPacote,
  correcoesNaLinhagem,
  lerPlano,
  regraDaLacunaCasa,
  checarSugestoesDeLacunas,
  podeAprovarSugestoes,
  podeCorrigirMais,
  valoresDeSugestaoIguais,
  MAXIMO_DE_CORRECOES_POR_VERSAO_RAIZ,
  type Lacuna,
  type RegraVigenteParaLacuna,
  type ValorDaSugestao,
  fixarIntencao,
  type IntencaoDoPlano,
  type Plano as PlanoLido,
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
  AprovarSugestoesSchema,
  CorrigirFalhaDoGateSchema,
  EditarManualSchema,
  EscopoDoClienteSchema,
  ExecucaoAlvoSchema,
  PreviaDeUtmSchema,
  PainelSchema,
  PedirMudancaSchema,
  PedirPlanoSchema,
  PedirRevisaoSchema,
  VersaoAlvoSchema,
  detalhesDoZod,
  type EntradaDaPreviaDeUtm,
  type EntradaDeAprovarSugestoes,
  type EntradaDeCorrigirFalhaDoGate,
  type EntradaDeEditarManual,
  type EntradaDeExecucaoAlvo,
  type EntradaDoEscopoDoCliente,
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
import type { DestinoService } from '@/modules/clients/application/destinoService';
import type { RegrasService } from '@/modules/clients/application/regrasService';
import type { EntradaDeRegistro } from '@/modules/clients/application/regrasEntradas';
import { valoresIguais, type Valor } from '@/modules/clients/domain/regras/valor';
import type { LandingPage } from '@/modules/clients/domain/destino/tipos';
import { cardDoPlano, type CardDoPlano } from '@/modules/strategy/interface/cardsDePlano';
import { falhaDoGate, type FalhaDoGate } from '@/modules/strategy/interface/falhaDoGate';
import { lacunasDoPlano, type LacunaDoPlano } from '@/modules/strategy/interface/lacunasDoPlano';
import { ROTULO_DA_PLATAFORMA_DO_PLANO } from '@/modules/strategy/interface/rotulosDoPlano';
import { aplicarUtm, ErroUtm } from '@/shared/utm/utm';
import { catalogoAtualDoPacote, type CatalogoAtual } from '@/modules/strategy/application/catalogoAtual';
import { carregarCadeia } from '@/modules/strategy/application/cadeiaDoComite';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type ComandoDeEstrategia = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

export type DependenciasDeEstrategia = {
  readonly repositorio: RepositorioDeEstrategia;
  readonly audit: AuditRecorder;
  readonly leitorDoBrain: LeitorDoBrain;
  readonly destino: DestinoParaEstrategia;
  readonly regras?: RegrasParaEstrategia;
  readonly catalogos?: readonly CatalogoDeCampos[];
  readonly relogio?: Relogio;
  readonly gerador?: GeradorDeId;
};

export type DestinoParaEstrategia = Pick<DestinoService, 'listarLandingPages' | 'lerWhatsapp'>;
export type RegrasParaEstrategia = Pick<RegrasService, 'registrar' | 'listarVigentes' | 'listarDefinicoes'>;

export type ModeloDeCriacao = {
  readonly tipos: readonly { readonly tipo: TipoDePlano; readonly rotulo: string }[];
  readonly plataformas: readonly { readonly plataforma: Plataforma; readonly rotulo: string }[];
  readonly landingPages: readonly { readonly id: string; readonly rotulo: string; readonly url: string }[];
  readonly whatsapp: string | null;
  readonly whatsappAusente: boolean;
  readonly podeCriar: boolean;
  readonly chaveDeIdempotencia: string;
};

export type ItemDaPreviaDeUtm = {
  readonly plataforma: Plataforma;
  readonly rotulo: string;
  readonly utm: { readonly utm_source: string; readonly utm_medium: string; readonly utm_campaign: string };
  readonly url: string;
};

export type PreviaDeUtmDoPedido = { readonly itens: readonly ItemDaPreviaDeUtm[] };

export type PlanosDoCliente = { readonly geradoEm: Date; readonly cards: readonly CardDoPlano[] };

export type EstadoDoItemDeSugestao = 'aprovada' | 'ja_aprovada' | 'falhou';

export type ResultadoDoItemDeSugestao = {
  readonly lacunaId: string;
  readonly estado: EstadoDoItemDeSugestao;
  readonly decisaoId?: string;
  readonly numero?: number;
  readonly erro?: { readonly codigo: string; readonly mensagem: string };
};

export type ResultadoDasSugestoes = {
  readonly itens: readonly ResultadoDoItemDeSugestao[];
  readonly aprovadas: number;
  readonly falhas: number;
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
  readonly lacunas?: readonly LacunaDoPlano[];
  readonly falhaDoGate?: FalhaDoGate | null;
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

export const CODIGO_WHATSAPP_AUSENTE = 'whatsapp_do_cliente_ausente';

export type PainelDoCliente = {
  readonly geradoEm: Date;
  readonly planos: readonly PainelDoPlano[];
  readonly resumos: readonly ResumoDoPlano[];
};

export type OpcoesDoPainel = { readonly snapshotDoBrain?: SnapshotDoBrainLido | 'indisponivel' };

export type VersaoVistaDoPlano = { readonly id: string; readonly conteudo: unknown };

export type EstrategiaService = {
  pedirPlano(comando: ComandoDeEstrategia, entrada: EntradaDePedirPlano, ator: Ator): Promise<Result<PedidoDePlano, Failure>>;
  modeloDeCriacao(comando: ComandoDeEstrategia, entrada: EntradaDoEscopoDoCliente): Promise<Result<ModeloDeCriacao, Failure>>;
  previaDeUtm(comando: ComandoDeEstrategia, entrada: EntradaDaPreviaDeUtm): Promise<Result<PreviaDeUtmDoPedido, Failure>>;
  listarPlanos(comando: ComandoDeEstrategia, entrada: EntradaDoEscopoDoCliente): Promise<Result<PlanosDoCliente, Failure>>;
  pedirRevisao(comando: ComandoDeEstrategia, entrada: EntradaDePedirRevisao, ator: Ator): Promise<Result<Execucao, Failure>>;
  pedirMudanca(comando: ComandoDeEstrategia, entrada: EntradaDePedirMudanca, ator: Ator): Promise<Result<Execucao, Failure>>;
  corrigirFalhaDoGate(comando: ComandoDeEstrategia, entrada: EntradaDeCorrigirFalhaDoGate, ator: Ator): Promise<Result<{ readonly execucao: Execucao }, Failure>>;
  aprovarSugestoesDeLacunas(comando: ComandoDeEstrategia, entrada: EntradaDeAprovarSugestoes, ator: Ator): Promise<Result<ResultadoDasSugestoes, Failure>>;
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
const PLANO_SEM_DESTINO = failure(
  'conflict',
  'Este plano foi criado antes da página única de planos e não tem plataformas, landing page nem WhatsApp. Crie um plano novo.',
  { codigo: 'plano_sem_destino' },
);
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

function comDestinoDaBase(editado: PlanoLido, base: PlanoLido | null): PlanoLido {
  if (base === null) return editado;
  const { plataformas, whatsapp, destino, utm } = base.intencao;
  const { plataformas: _p, whatsapp: _w, destino: _d, utm: _u, ...livres } = editado.intencao;
  const confiavel: IntencaoDoPlano = {
    ...livres,
    ...(plataformas === undefined ? {} : { plataformas }),
    ...(whatsapp === undefined ? {} : { whatsapp }),
    ...(destino === undefined ? {} : { destino }),
    ...(utm === undefined ? {} : { utm }),
  };
  return fixarIntencao(editado, confiavel as never).plano;
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
  const { repositorio, audit, leitorDoBrain, destino, regras } = deps;
  const catalogos = deps.catalogos ?? CATALOGOS_DISPONIVEIS;
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
    return repositorio.estadoDoPlano(plano.organizationId, plano.id);
  }

  function plataformasSemCatalogo(plataformas: readonly Plataforma[]): Failure | null {
    const disponiveis = new Set(plataformasComCatalogo(catalogos));
    const fora = plataformas.filter((plataforma) => !disponiveis.has(plataforma));
    if (fora.length === 0) return null;
    return failure(
      'validation',
      'Há plataforma sem catálogo de campos disponível. Escolha só plataformas já suportadas.',
      Object.fromEntries(fora.map((plataforma) => [`plataformas.${plataforma}`, 'Plataforma ainda sem catálogo de campos.'])),
    );
  }

  async function landingPageDoCliente(comando: ComandoDeEstrategia, clienteId: string, landingPageId: string): Promise<Result<LandingPage, Failure>> {
    const paginas = await destino.listarLandingPages({ organizationId: comando.organizationId, clientId: clienteId }, { incluirArquivadas: true });
    if (!paginas.ok) return paginas;
    const pagina = paginas.value.find((candidata) => candidata.id === landingPageId);
    if (!pagina || pagina.organizationId !== comando.organizationId || pagina.clientId !== clienteId) {
      return err(failure('validation', 'Escolha uma landing page deste cliente.', { landingPageId: 'Landing page não encontrada neste cliente.' }));
    }
    if (pagina.arquivadaEm !== null) {
      return err(failure('validation', 'Esta landing page foi arquivada. Escolha outra.', { landingPageId: 'Landing page arquivada.' }));
    }
    return ok(pagina);
  }

  async function whatsappDoCliente(comando: ComandoDeEstrategia, clienteId: string): Promise<Result<string, Failure>> {
    const lido = await destino.lerWhatsapp({ organizationId: comando.organizationId, clientId: clienteId });
    if (!lido.ok) return lido;
    if (lido.value === null) {
      return err(failure('validation', 'O cliente não tem WhatsApp cadastrado. Preencha o WhatsApp no cadastro do cliente e tente de novo.', { codigo: CODIGO_WHATSAPP_AUSENTE }));
    }
    return ok(lido.value);
  }

  function utmDoPedido(tipoDePlano: TipoDePlano, plataformas: readonly Plataforma[], nomeDaCampanha: string, inicio: string) {
    return gerarUtmPorPlataforma(plataformas, { tipoDePlano, nomeDaCampanha, periodo: inicio.slice(0, 7) });
  }

  async function modeloDeCriacao(comando: ComandoDeEstrategia, entrada: EntradaDoEscopoDoCliente): Promise<Result<ModeloDeCriacao, Failure>> {
    const lida = EscopoDoClienteSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('criar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const { clienteId } = lida.data;
    if (!(await repositorio.clienteVisivel(comando.organizationId, clienteId))) return err(CLIENTE_NAO_ENCONTRADO);
    const escopo = { organizationId: comando.organizationId, clientId: clienteId };
    const [paginas, whatsapp] = await Promise.all([destino.listarLandingPages(escopo), destino.lerWhatsapp(escopo)]);
    if (!paginas.ok) return paginas;
    if (!whatsapp.ok) return whatsapp;
    const landingPages = paginas.value.map((pagina) => ({ id: pagina.id, rotulo: pagina.rotulo, url: pagina.url }));
    return ok({
      tipos: TIPOS_DE_PLANO.map((tipo) => ({ tipo, rotulo: ROTULO_DO_TIPO_DE_PLANO[tipo] })),
      plataformas: plataformasComCatalogo(catalogos).map((plataforma) => ({ plataforma, rotulo: ROTULO_DA_PLATAFORMA_DO_PLANO[plataforma] ?? plataforma })),
      landingPages,
      whatsapp: whatsapp.value,
      whatsappAusente: whatsapp.value === null,
      podeCriar: landingPages.length > 0 && whatsapp.value !== null,
      chaveDeIdempotencia: randomUUID(),
    });
  }

  async function previaDeUtm(comando: ComandoDeEstrategia, entrada: EntradaDaPreviaDeUtm): Promise<Result<PreviaDeUtmDoPedido, Failure>> {
    const lida = PreviaDeUtmSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('criar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const { clienteId, tipoDePlano, plataformas, landingPageId, nomeDaCampanha, inicio } = lida.data;
    const semCatalogo = plataformasSemCatalogo(plataformas);
    if (semCatalogo) return err(semCatalogo);
    if (!(await repositorio.clienteVisivel(comando.organizationId, clienteId))) return err(CLIENTE_NAO_ENCONTRADO);
    const pagina = await landingPageDoCliente(comando, clienteId, landingPageId);
    if (!pagina.ok) return pagina;
    try {
      const utm = utmDoPedido(tipoDePlano, plataformas, textoSeguro(nomeDaCampanha), inicio);
      const itens = plataformas.map((plataforma): ItemDaPreviaDeUtm => {
        const valor = utm[plataforma]!;
        return { plataforma, rotulo: ROTULO_DA_PLATAFORMA_DO_PLANO[plataforma] ?? plataforma, utm: valor, url: aplicarUtm(pagina.value.url, valor) };
      });
      return ok({ itens });
    } catch (erro) {
      if (erro instanceof ErroUtm) return err(failure('validation', 'Não foi possível montar a UTM com esses dados.', { utm: erro.codigo }));
      throw erro;
    }
  }

  async function listarPlanos(comando: ComandoDeEstrategia, entrada: EntradaDoEscopoDoCliente): Promise<Result<PlanosDoCliente, Failure>> {
    const lida = EscopoDoClienteSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('ler', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!(await repositorio.clienteVisivel(comando.organizationId, lida.data.clienteId))) return err(CLIENTE_NAO_ENCONTRADO);
    const estados = await repositorio.listarPlanosDoCliente({ organizationId: comando.organizationId, clientId: lida.data.clienteId });
    return ok({ geradoEm: relogio.agora(), cards: estados.map(cardDoPlano) });
  }

  async function pedirPlano(comando: ComandoDeEstrategia, entrada: EntradaDePedirPlano, ator: Ator) {
    const lida = PedirPlanoSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('criar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);
    const { clienteId, tipoDePlano, plataformas, landingPageId } = lida.data;
    const semCatalogo = plataformasSemCatalogo(plataformas);
    if (semCatalogo) return err(semCatalogo);
    const intencaoLimpa = sanitizarIntencao(lida.data.intencao);
    if (!intencaoLimpa.ok) {
      const detalhes = Object.fromEntries(intencaoLimpa.error.map((erro) => [erro.campo, 'Contém dado pessoal ou ficou vazio.']));
      return err(failure('validation', 'A intenção contém dado pessoal ou ficou vazia. Reescreva sem dados pessoais.', detalhes));
    }
    const base = intencaoLimpa.value;
    const escopo = { organizationId: comando.organizationId, clientId: clienteId };
    if (!(await repositorio.clienteVisivel(comando.organizationId, clienteId))) return err(CLIENTE_NAO_ENCONTRADO);

    const pagina = await landingPageDoCliente(comando, clienteId, landingPageId);
    if (!pagina.ok) return pagina;
    const whatsapp = await whatsappDoCliente(comando, clienteId);
    if (!whatsapp.ok) return whatsapp;

    const montada = esquemaIntencao.safeParse({
      ...base,
      plataformas,
      whatsapp: whatsapp.value,
      destino: { landingPageId: pagina.value.id, url: pagina.value.url },
      utm: utmDoPedido(tipoDePlano, plataformas, base.objetivo, base.horizonte.inicio),
    });
    if (!montada.success) return err(failure('validation', 'A intenção do plano ficou inválida.', detalhesDoZod(montada.error)));

    const criado = await repositorio.criarPlanoComExecucao(
      escopo,
      {
        tipo: tipoDePlano,
        plataformas,
        whatsapp: whatsapp.value,
        landingPageId: pagina.value.id,
        ...(lida.data.chaveDeIdempotencia === undefined ? {} : { chaveDeIdempotencia: lida.data.chaveDeIdempotencia.toLowerCase() }),
      },
      {
        pedido: { tipo: 'criar', intencao: montada.data },
        versaoBaseId: null,
        agentRunId: novoIdDeExecucao(),
        solicitadoPor: ator.userId,
        requestId: ator.requestId,
      },
    );
    if (!criado.ok) return err(falhaDeEstrategia(criado.error));
    const { plano, execucao } = criado.value;
    if (criado.value.reaproveitado) return ok({ plano, execucao });

    await auditar(comando, ator, 'strategy.plan.requested', 'strategy_plan', plano.id, {
      clientId: clienteId,
      tipoDePlano,
      plataformas,
      landingPageId: pagina.value.id,
      execucaoId: execucao.id,
      kind: 'criar',
    });
    return ok({ plano, execucao });
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
    if (plano.plataformas === null) return err(PLANO_SEM_DESTINO);
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


  async function correcoesDaLinhagem(comando: ComandoDeEstrategia, planoId: string, versaoBaseId: string): Promise<number> {
    const [execucoes, versoes] = await Promise.all([
      repositorio.execucoesDoPlano(comando.organizationId, planoId, 100),
      repositorio.listarVersoes(comando.organizationId, planoId, 100),
    ]);
    const execucaoDaVersao = new Map(versoes.map((versao) => [versao.id, versao.agentRunId]));
    return correcoesNaLinhagem({ versaoBaseId, execucoes, agentRunIdDaVersao: (id) => execucaoDaVersao.get(id) ?? null });
  }

  async function corrigirFalhaDoGate(comando: ComandoDeEstrategia, entrada: EntradaDeCorrigirFalhaDoGate, ator: Ator) {
    const lida = CorrigirFalhaDoGateSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('editar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);

    const plano = await planoDoCliente(comando, lida.data.planoId);
    if (!plano || plano.clientId !== lida.data.clienteId) return err(PLANO_NAO_ENCONTRADO);
    if (plano.plataformas === null) return err(PLANO_SEM_DESTINO);
    const estado = await estadoDoPlano(plano);
    const aberta = estado?.aberta ?? null;
    if (!aberta || aberta.status !== 'rascunho') {
      return err(failure('conflict', 'Só um rascunho que não passou na conferência pode ser corrigido.', { codigo: 'sem_rascunho_reprovado' }));
    }
    const eventos = await repositorio.eventosDaVersao(comando.organizationId, aberta.id);
    const ultimoGate = [...eventos].reverse().find((evento) => evento.tipo === 'gate');
    if (ultimoGate?.payload.resultado !== 'reprovado') {
      return err(failure('conflict', 'A conferência mais recente deste rascunho não reprovou: não há o que corrigir.', { codigo: 'gate_nao_reprovou' }));
    }
    if (await repositorio.execucaoAtiva(comando.organizationId, plano.id)) return err(EXECUCAO_EM_ANDAMENTO);
    const feitas = await correcoesDaLinhagem(comando, plano.id, aberta.id);
    if (!podeCorrigirMais(feitas)) {
      return err(
        failure('conflict', `O limite de ${MAXIMO_DE_CORRECOES_POR_VERSAO_RAIZ} correções automáticas foi atingido. Ajuste o plano à mão.`, { codigo: 'limite_de_correcoes' }),
      );
    }

    const execucao = await repositorio.criarExecucao(comando.organizationId, plano.clientId, {
      planoId: plano.id,
      pedido: { tipo: 'corrigir_gate' },
      versaoBaseId: aberta.id,
      agentRunId: novoIdDeExecucao(),
      solicitadoPor: ator.userId,
      requestId: ator.requestId,
    });
    if (!execucao.ok) return err(falhaDeEstrategia(execucao.error));

    await auditar(comando, ator, 'strategy.plan.requested', 'strategy_plan', plano.id, {
      clientId: plano.clientId,
      tipoDePlano: plano.tipo,
      execucaoId: execucao.value.id,
      kind: 'corrigir_gate',
      baseVersionId: aberta.id,
      correcoesFeitas: feitas,
    });
    return ok({ execucao: execucao.value });
  }

  type RegraVigenteComValor = RegraVigenteParaLacuna & { readonly valor: Valor | string | null };
  type Definicoes = Extract<Awaited<ReturnType<RegrasParaEstrategia['listarDefinicoes']>>, { ok: true }>['value'];
  type RegrasDoCliente = { readonly vigentes: readonly RegraVigenteComValor[]; readonly definicoes: Definicoes };

  async function regrasDoCliente(comando: ComandoDeEstrategia, clienteId: string): Promise<Result<RegrasDoCliente, Failure>> {
    if (!regras) return err(failure('unavailable', 'O cadastro de regras do cliente não está disponível.'));
    const escopo = { organizationId: comando.organizationId, clientId: clienteId };
    const [vigentes, definicoes] = await Promise.all([regras.listarVigentes(escopo), regras.listarDefinicoes({ organizationId: comando.organizationId })]);
    if (!vigentes.ok) return vigentes;
    if (!definicoes.ok) return definicoes;
    const medidaDe = new Map(definicoes.value.map((definicao) => [definicao.key, definicao.medida]));
    return ok({
      vigentes: vigentes.value.decisoes.map((d) => ({
        natureza: d.natureza,
        chave: d.chave,
        escopo: d.escopo,
        medida: d.definicaoChave === null ? null : (medidaDe.get(d.definicaoChave) ?? null),
        valor: d.valor ?? d.texto,
      })),
      definicoes: definicoes.value,
    });
  }

  function entradaDeRegistroDaLacuna(
    lacuna: Lacuna,
    valor: ValorDaSugestao,
    planoId: string,
    definicoes: Definicoes,
  ): Result<EntradaDeRegistro, { readonly codigo: string; readonly mensagem: string }> {
    const regra = lacuna.regra;
    if (regra === undefined) return err({ codigo: 'sem_regra_estruturada', mensagem: 'Esta lacuna não traz a regra pronta para cadastrar.' });
    const sugestao = lacuna.sugestao;
    const doBrain = sugestao !== undefined && valoresDeSugestaoIguais(sugestao.valor, valor) && sugestao.origem === 'evidencia';
    const origem = doBrain ? 'evidência do Brain' : 'valor informado pela pessoa';
    const contexto = `Cadastrada a partir da lacuna "${lacuna.id}" do plano ${planoId}. Origem: ${origem}.`.slice(0, 2000);
    const evidencia = doBrain ? juntarEvidencias(sugestao!.evidencias.filter((e) => e.papel !== 'contra').map((e) => e.urn)) : null;
    if (regra.natureza === 'regra') {
      if (!('texto' in valor)) return err({ codigo: 'valor_invalido', mensagem: 'Esta regra pede um texto.' });
      return ok({
        categoria: regra.categoria!,
        natureza: 'regra',
        chave: regra.chave!,
        escopo: regra.escopo,
        titulo: `Lacuna: ${lacuna.descricao}`.slice(0, 120),
        texto: valor.texto,
        contexto,
        evidencia,
      });
    }
    if ('texto' in valor) return err({ codigo: 'valor_invalido', mensagem: 'Este limite pede um valor numérico.' });
    const tipo = regra.escopo === 'cliente' ? 'cliente' : 'plataforma';
    const candidatas = definicoes.filter(
      (d) => d.ativo && d.tiposDeEscopo.includes(tipo) && (regra.chave !== undefined ? d.key === regra.chave : d.medida === lacuna.medida),
    );
    if (candidatas.length === 0) return err({ codigo: 'sem_definicao_de_limite', mensagem: 'Não há tipo de limite ativo que atenda esta lacuna.' });
    if (candidatas.length > 1) return err({ codigo: 'definicao_ambigua', mensagem: 'Mais de um tipo de limite atende esta lacuna; cadastre em Regras do cliente.' });
    const definicao = candidatas[0]!;
    return ok({ categoria: definicao.categoria, natureza: 'limite', chave: definicao.key, escopo: regra.escopo, valor, contexto, evidencia });
  }

  function juntarEvidencias(urns: readonly string[]): string | null {
    const mantidas: string[] = [];
    for (const urn of urns) {
      if ([...mantidas, urn].join(' ').length > 500) break;
      mantidas.push(urn);
    }
    return mantidas.length === 0 ? null : mantidas.join(' ');
  }

  function statusLiberaSugestoes(status: StatusDaVersao, resultadoDoGate: unknown, execucaoAtiva: boolean): boolean {
    if (status === 'vigente' || status === 'proposto') return true;
    return status === 'rascunho' && resultadoDoGate === 'aprovado' && !execucaoAtiva;
  }

  async function versaoLiberaSugestoes(comando: ComandoDeEstrategia, planoId: string, versaoId: string, status: StatusDaVersao): Promise<boolean> {
    if (status === 'vigente' || status === 'proposto') return true;
    if (status !== 'rascunho') return false;
    const [eventos, ativa] = await Promise.all([repositorio.eventosDaVersao(comando.organizationId, versaoId), repositorio.execucaoAtiva(comando.organizationId, planoId)]);
    const ultimoGate = [...eventos].reverse().find((evento) => evento.tipo === 'gate');
    return statusLiberaSugestoes(status, ultimoGate?.payload.resultado, ativa !== null);
  }

  async function sugestoesReprovadasNoPacote(comando: ComandoDeEstrategia, clienteId: string, plano: PlanoLido): Promise<Result<ReadonlySet<string>, Failure>> {
    const comValor = plano.lacunas.itens.filter((lacuna) => lacuna.sugestao?.valor != null);
    if (comValor.length === 0) return ok(new Set<string>());
    const pacote = await leitorDoBrain.lerPacote(comando.organizationId, clienteId);
    if (!pacote.ok) return err(failure('unavailable', 'Não foi possível conferir as evidências no Brain agora. Tente de novo em instantes.'));
    const reprovadas = new Set<string>();
    for (const lacuna of comValor) {
      const resultado = checarSugestoesDeLacunas({
        plano: { ...plano, lacunas: { ...plano.lacunas, itens: [lacuna] } },
        pacote: pacote.value,
        hoje: relogio.agora().toISOString().slice(0, 10),
        medidasComLimite: [],
        avaliarLimite: () => 'ok',
      });
      if (resultado.resultado !== 'aprovado') reprovadas.add(lacuna.id);
    }
    return ok(reprovadas);
  }

  async function aprovarSugestoesDeLacunas(comando: ComandoDeEstrategia, entrada: EntradaDeAprovarSugestoes, ator: Ator): Promise<Result<ResultadoDasSugestoes, Failure>> {
    const lida = AprovarSugestoesSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!podeAprovarSugestoes(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);

    const plano = await planoDoCliente(comando, lida.data.planoId);
    if (!plano || plano.clientId !== lida.data.clienteId) return err(PLANO_NAO_ENCONTRADO);
    const estado = await estadoDoPlano(plano);
    const exibida = estado?.aberta ?? estado?.vigente ?? null;
    const versao = exibida ? await repositorio.lerVersao(comando.organizationId, exibida.id) : null;
    const conteudo = versao ? lerPlano(versao.conteudo) : null;
    if (!versao || !conteudo?.ok) return err(failure('conflict', 'O plano ainda não tem versão para aprovar sugestões.', { codigo: 'sem_versao' }));
    if (!(await versaoLiberaSugestoes(comando, plano.id, versao.id, versao.status))) {
      return err(failure('conflict', 'Esta versão ainda não passou na conferência ou há trabalho em andamento. Aguarde ou corrija o plano antes de aprovar sugestões.', { codigo: 'versao_nao_liberada' }));
    }
    const reprovadas = await sugestoesReprovadasNoPacote(comando, plano.clientId, conteudo.value);
    if (!reprovadas.ok) return reprovadas;

    const cliente = await regrasDoCliente(comando, plano.clientId);
    if (!cliente.ok) return cliente;
    const comandoDeRegras = { organizationId: comando.organizationId, clientId: plano.clientId, papelDeQuemAge: comando.papelDeQuemAge };
    const vigentes: RegraVigenteComValor[] = [...cliente.value.vigentes];

    const resultados: ResultadoDoItemDeSugestao[] = [];
    const vistos = new Set<string>();
    for (const item of lida.data.itens) {
      if (vistos.has(item.lacunaId)) continue;
      vistos.add(item.lacunaId);
      const falhou = (codigo: string, mensagem: string): ResultadoDoItemDeSugestao => ({ lacunaId: item.lacunaId, estado: 'falhou', erro: { codigo, mensagem } });
      const lacuna = conteudo.value.lacunas.itens.find((candidata) => candidata.id === item.lacunaId);
      if (!lacuna) {
        resultados.push(falhou('lacuna_inexistente', 'Esta lacuna não existe no plano.'));
        continue;
      }
      if (lacuna.regra === undefined) {
        resultados.push(falhou('sem_regra_estruturada', 'Esta lacuna não traz a regra pronta para cadastrar.'));
        continue;
      }
      const valor = item.valor ?? lacuna.sugestao?.valor ?? null;
      if (reprovadas.value.has(lacuna.id) && (valor === null || valoresDeSugestaoIguais(lacuna.sugestao?.valor, valor))) {
        resultados.push(falhou('sugestao_sem_origem_confiavel', 'A sugestão desta lacuna não tem origem confiável no Brain. Informe o valor à mão ou cadastre em Regras do cliente.'));
        continue;
      }
      if (valor === null) {
        resultados.push(falhou('sem_valor', 'Informe o valor: o plano não tem sugestão com evidência para esta lacuna.'));
        continue;
      }
      const existente = vigentes.find((regra) => regraDaLacunaCasa(lacuna, regra));
      if (existente !== undefined) {
        const igual =
          existente.valor !== null &&
          (typeof existente.valor === 'string' ? 'texto' in valor && existente.valor.trim() === valor.texto.trim() : !('texto' in valor) && valoresIguais(existente.valor, valor));
        resultados.push(igual ? { lacunaId: item.lacunaId, estado: 'ja_aprovada' } : falhou('regra_ja_existe', 'Já existe regra vigente para esta lacuna com outro valor. Altere em Regras do cliente.'));
        continue;
      }
      const montada = entradaDeRegistroDaLacuna(lacuna, valor, plano.id, cliente.value.definicoes);
      if (!montada.ok) {
        resultados.push(falhou(montada.error.codigo, montada.error.mensagem));
        continue;
      }
      const registrada = await regras!.registrar(comandoDeRegras, montada.value, ator);
      if (!registrada.ok) {
        const detalhe = registrada.error.details as Record<string, string> | undefined;
        resultados.push(falhou(detalhe?.codigo ?? registrada.error.code, registrada.error.message));
        continue;
      }
      const decisao = registrada.value;
      vigentes.push({ natureza: decisao.natureza, chave: decisao.chave, escopo: decisao.escopo, medida: lacuna.medida ?? null, valor: decisao.valor ?? decisao.texto });
      resultados.push({ lacunaId: item.lacunaId, estado: 'aprovada', decisaoId: decisao.id, numero: decisao.numero });
      await auditar(comando, ator, 'strategy.lacuna.approved', 'strategy_plan', plano.id, {
        clientId: plano.clientId,
        lacunaId: lacuna.id,
        decisaoId: decisao.id,
        numero: decisao.numero,
        natureza: decisao.natureza,
        valorDaSugestao: valoresDeSugestaoIguais(lacuna.sugestao?.valor, valor),
      });
    }
    return ok({ itens: resultados, aprovadas: resultados.filter((r) => r.estado === 'aprovada').length, falhas: resultados.filter((r) => r.estado === 'falhou').length });
  }

  async function lacunasDoPainel(comando: ComandoDeEstrategia, plano: Plano, conteudo: unknown, liberada: boolean): Promise<readonly LacunaDoPlano[]> {
    const lido = conteudo === null ? null : lerPlano(conteudo);
    if (!lido?.ok) return [];
    const comRegra = lido.value.lacunas.itens.some((lacuna) => lacuna.regra !== undefined);
    const cliente = comRegra && regras ? await regrasDoCliente(comando, plano.clientId) : null;
    const reprovadas = liberada && cliente?.ok ? await sugestoesReprovadasNoPacote(comando, plano.clientId, lido.value) : null;
    const definicoes = cliente?.ok ? cliente.value.definicoes : null;
    return lacunasDoPlano({
      plano: lido.value,
      regrasVigentes: cliente?.ok ? cliente.value.vigentes : [],
      papel: comando.papelDeQuemAge,
      podeGravarRegras: cliente?.ok === true && liberada && reprovadas?.ok === true,
      sugestoesReprovadas: reprovadas?.ok ? reprovadas.value : new Set(lido.value.lacunas.itens.map((lacuna) => lacuna.id)),
      regraAGravar: (lacuna, valor) => {
        if (definicoes === null) return null;
        const montada = entradaDeRegistroDaLacuna(lacuna, valor, plano.id, definicoes);
        if (!montada.ok) return null;
        const { categoria, chave, escopo } = montada.value;
        return { categoria, chave: chave ?? null, escopo: escopo ?? null, natureza: montada.value.natureza };
      },
    });
  }

  async function pedirRevisao(comando: ComandoDeEstrategia, entrada: EntradaDePedirRevisao, ator: Ator) {
    const lida = PedirRevisaoSchema.safeParse(entrada);
    if (!lida.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(lida.error)));
    if (!pode('editar', comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!ator.userId) return err(SEM_USUARIO);
    const plano = await planoDoCliente(comando, lida.data.planoId);
    if (!plano) return err(PLANO_NAO_ENCONTRADO);
    if (plano.plataformas === null) return err(PLANO_SEM_DESTINO);
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
    if (plano.plataformas === null) return err(PLANO_SEM_DESTINO);

    const conteudo = lerPlano(lida.data.conteudo);
    if (!conteudo.ok) {
      const detalhes = Object.fromEntries(conteudo.error.problemas.slice(0, 10).map((p) => [p.caminho || 'plano', p.mensagem]));
      return err(failure('validation', conteudo.error.mensagem, detalhes));
    }
    const privacidade = planoSemDadoPessoal(conteudo.value, catalogos);
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
    const baseLida = baseCompleta ? lerPlano(baseCompleta.conteudo) : null;
    const planoDaBase = baseLida?.ok ? baseLida.value : null;
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
        conteudo: comDestinoDaBase(conteudo.value, planoDaBase),
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
    const { planoId } = lida.data;
    const detalhados = planoId ? planos.filter((estado) => estado.plano.id === planoId) : planos;
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
    const estado = await repositorio.estadoDoPlano(comando.organizationId, escopo.planoId);
    if (estado && estado.plano.clientId !== escopo.clienteId) return null;
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
    const liberada = versaoExibida !== null && statusLiberaSugestoes(versaoExibida.status, ultimoGate?.payload.resultado, execucaoAtiva !== null);
    const lacunas = await lacunasDoPainel(comando, estado.plano, versaoExibida?.conteudo ?? null, liberada);
    const reprovouNoGate = versaoExibida?.status === 'rascunho' && ultimoGate?.payload.resultado === 'reprovado';
    const falhaVisivel = reprovouNoGate
      ? falhaDoGate({
          status: versaoExibida.status,
          resultadoDoGate: ultimoGate.payload,
          execucaoAtiva: execucaoAtiva !== null,
          ultimaExecucao: ultimaExecucao ? { tipo: ultimaExecucao.tipo, status: ultimaExecucao.status, erroCodigo: ultimaExecucao.erroCodigo } : null,
          correcoesFeitas: await correcoesDaLinhagem(comando, estado.plano.id, versaoExibida.id),
          papel: comando.papelDeQuemAge,
        })
      : null;

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
      lacunas,
      falhaDoGate: falhaVisivel,
      historico: { versoes, eventos: eventosPorVersao.flatMap((item) => item.eventos) },
    };
  }

  return {
    pedirPlano,
    modeloDeCriacao,
    previaDeUtm,
    listarPlanos,
    pedirRevisao,
    pedirMudanca,
    corrigirFalhaDoGate,
    aprovarSugestoesDeLacunas,
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
