import { createHash, randomUUID } from 'node:crypto';
import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import { canOperate, type MemberRole } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import { consumeAll, type RateLimitPedido, type RateLimitVerdict } from '@/shared/security/rateLimit';
import {
  CATALOGO,
  EPISTEMICOS,
  FONTES,
  REVISOES,
  VERSAO_DO_CATALOGO,
  campoLista,
  campoSimples,
  catalogoParaCliente,
  camposVisiveisAoCliente,
  type Epistemico,
  type Fonte,
  type Revisao,
  type CampoSimples,
  type Secao,
  type SecaoKey,
} from '@/modules/clients/domain/contexto/catalogo';
import {
  COTA_POR_CLIENTE,
  avaliarAnexo,
  caminhoDoArquivo,
  prefixoDoCliente,
} from '@/modules/clients/domain/contexto/arquivos';
import { VERSAO_DO_BRAIN, construirBrain } from '@/modules/clients/domain/contexto/brain';
import { calcularCompletude, proximosCampos, type CampoFaltando, type Completude } from '@/modules/clients/domain/contexto/completude';
import { diferencasDeDados, type DiferencaDeChave } from '@/modules/clients/domain/contexto/diff';
import {
  MOTIVO_DO_LINK,
  estadoDoLink,
  gerarTokenDeContexto,
  hashDoToken,
  tokenBemFormado,
  validarPedidoDeLink,
  type EstadoDoLink,
} from '@/modules/clients/domain/contexto/link';
import type {
  ArquivoDeContexto,
  ContextoBruto,
  DadosDoItem,
  EntradaDeCampo,
  ItemDeLista,
  Marcacao,
} from '@/modules/clients/domain/contexto/tipos';
import { validarItem, validarValor } from '@/modules/clients/domain/contexto/valores';
import type { PortaDoArmazenamento } from '@/modules/clients/application/portaDoArmazenamento';
import {
  ENVIOS_DO_LINK_POR_HORA,
  ORCAMENTO_DO_LINK_BYTES_POR_HORA,
  type PedidoDeEnvio,
} from '@/modules/clients/domain/contexto/envio';
import { prefixoDoExportDoContexto } from '@/modules/brain/domain/contexto';
import { prefixoDoCatalogo } from '@/modules/brain/application/publicacao';
import type { AlvoDoArmazenamento, ResultadoDaReserva } from '@/modules/clients/infrastructure/contextoRepository';
import type {
  ContextoRepository,
  EscopoDoLink,
  EstadoDoBrainRegistrado,
  Gravado,
  LinkDeContexto,
  ResultadoPeloLink,
  RevisaoRegistrada,
} from '@/modules/clients/infrastructure/contextoRepository';
import { comoPublico, foraDoContextoDeChamada } from '@/shared/db/client';
import { logger } from '@/shared/logging/logger';

export type SituacaoDoEstadoDoBrain = 'desativado' | 'nunca_publicado' | 'em_dia' | 'pendente' | 'com_erro';

export type EstadoDoBrain = {
  readonly situacao: SituacaoDoEstadoDoBrain;
  readonly armazenamentoConfigurado: boolean;
  readonly pendente: boolean;
  readonly solicitadoEm: Date | null;
  readonly exportadoEm: Date | null;
  readonly hash: string | null;
  readonly ultimaTentativaEm: Date | null;
  readonly ultimoErro: string | null;
  readonly tentativas: number;
};

export type ContextoCompleto = {
  readonly cliente: { readonly id: string; readonly nome: string };
  readonly catalogoVersao: number;
  readonly catalogo: readonly Secao[];
  readonly campos: Readonly<Record<string, EntradaDeCampo>>;
  readonly listas: Readonly<Record<string, readonly ItemDeLista[]>>;
  readonly arquivos: readonly ArquivoDeContexto[];
  readonly usoDeArquivosBytes: number;
  readonly cotaDeArquivosBytes: number;
  readonly completude: Completude;
  readonly proximos: readonly CampoFaltando[];
  readonly brain: EstadoDoBrain;
};

export type LinkResumido = LinkDeContexto & { readonly estado: EstadoDoLink };

export type LinkCriado = { readonly link: LinkResumido; readonly token: string };

export type RevisaoDeContexto = RevisaoRegistrada & {
  readonly viaLink: boolean;
  readonly diferencas: readonly DiferencaDeChave[];
};

export type AlvoDeMarcacao =
  | { readonly tipo: 'campo'; readonly fieldKey: string }
  | { readonly tipo: 'item'; readonly itemId: string };

export type MarcacaoParcial = {
  readonly epistemico?: Epistemico;
  readonly fonte?: Fonte;
  readonly revisao?: Revisao;
  readonly compartilhavel?: boolean;
};

export type Escopo = {
  readonly organizationId: string;
  readonly clientId: string;
};

export type Comando = Escopo & { readonly papelDeQuemAge: MemberRole };

export type NovoAnexo = PedidoDeEnvio;

export type LerConteudo = (tamanhoEsperado: number) => Promise<Result<Uint8Array, Failure>>;

export type ArquivoEnviadoPeloLink = { readonly id: string; readonly mime: string };

export type ModoDoExpurgoDoArmazenamento = 'tudo' | 'derivados';

export type ResumoDoExpurgoDoArmazenamento = {
  readonly apagados: number;
  readonly modo: ModoDoExpurgoDoArmazenamento;
  readonly alvo: AlvoDoArmazenamento;
  readonly desativado: boolean;
};

export type ResumoDaVarredura = {
  readonly reservasVarridas: number;
  readonly orfaosApagados: number;
  readonly clientesListados: number;
  readonly brainsDespublicados: number;
  readonly falhas: number;
  readonly desativado: boolean;
};

export type SugestaoDeContexto =
  | { readonly tipo: 'campo'; readonly fieldKey: string; readonly valor: unknown; readonly fonte: 'ia' | 'pesquisa' }
  | { readonly tipo: 'item'; readonly listKey: string; readonly dados: DadosDoItem; readonly fonte: 'ia' | 'pesquisa' };

export type SugestorDeContexto = {
  sugerir(entrada: {
    readonly site: string | null;
    readonly instagram: string | null;
    readonly contexto: ContextoBruto;
  }): Promise<readonly SugestaoDeContexto[]>;
};

export type CredencialPublica = { readonly tipo: 'link'; readonly token: string } | { readonly tipo: 'convite'; readonly token: string };

export type AcessoPublico = { readonly credencial: CredencialPublica; readonly ip: string | null; readonly requestId: string };

export type FormularioPublico = {
  readonly organizacao: string;
  readonly cliente: string;
  readonly nota: string | null;
  readonly expiraEm: Date;
  readonly concluidoEm: Date | null;
  readonly catalogoVersao: number;
  readonly secoes: readonly Secao[];
  readonly campos: Readonly<
    Record<string, { readonly valor: unknown; readonly versao: number; readonly epistemico: Epistemico; readonly fonte: Fonte }>
  >;
  readonly listas: Readonly<
    Record<
      string,
      readonly {
        readonly id: string;
        readonly dados: DadosDoItem;
        readonly versao: number;
        readonly epistemico: Epistemico;
        readonly editavelPeloCliente: boolean;
        readonly removivelPeloCliente: boolean;
      }[]
    >
  >;
  readonly arquivos: readonly {
    readonly id: string;
    readonly fieldKey: string;
    readonly itemId: string | null;
    readonly nome: string;
    readonly mime: string;
    readonly tamanhoBytes: number;
  }[];
  readonly completude: Completude;
  readonly armazenamentoConfigurado: boolean;
};

export type AlteracaoPeloLink =
  | {
      readonly tipo: 'campo';
      readonly fieldKey: string;
      readonly valor: unknown;
      readonly versaoEsperada: number;
      readonly epistemico?: Epistemico;
    }
  | {
      readonly tipo: 'item';
      readonly listKey: string;
      readonly itemId: string | null;
      readonly dados: unknown;
      readonly versaoEsperada: number;
      readonly epistemico?: Epistemico;
    }
  | { readonly tipo: 'remover_item'; readonly itemId: string; readonly versaoEsperada: number };

export type SalvoPeloLink = { readonly versao: number; readonly itemId: string | null };

export type SituacaoDoBrain = 'publicado' | 'inalterado' | 'sem_armazenamento';

export type ContextoService = {
  carregar(escopo: Escopo): Promise<Result<ContextoCompleto, Failure>>;
  salvarCampo(
    comando: Comando & {
      readonly fieldKey: string;
      readonly valor: unknown;
      readonly versaoEsperada: number;
      readonly marcacao?: MarcacaoParcial;
    },
    ator: Ator,
  ): Promise<Result<EntradaDeCampo | null, Failure>>;
  adicionarItem(
    comando: Comando & { readonly listKey: string; readonly dados: unknown; readonly marcacao?: MarcacaoParcial },
    ator: Ator,
  ): Promise<Result<ItemDeLista, Failure>>;
  alterarItem(
    comando: Comando & {
      readonly itemId: string;
      readonly dados: unknown;
      readonly versaoEsperada: number;
      readonly marcacao?: MarcacaoParcial;
    },
    ator: Ator,
  ): Promise<Result<ItemDeLista, Failure>>;
  removerItem(comando: Comando & { readonly itemId: string; readonly versaoEsperada: number }, ator: Ator): Promise<Result<null, Failure>>;
  reordenarItens(
    comando: Comando & { readonly listKey: string; readonly ordem: readonly string[] },
    ator: Ator,
  ): Promise<Result<readonly ItemDeLista[], Failure>>;
  marcar(
    comando: Comando & { readonly alvo: AlvoDeMarcacao; readonly versaoEsperada: number; readonly marcacao: MarcacaoParcial },
    ator: Ator,
  ): Promise<Result<EntradaDeCampo | ItemDeLista, Failure>>;
  confirmarSugestao(
    comando: Comando & { readonly alvo: AlvoDeMarcacao; readonly versaoEsperada: number },
    ator: Ator,
  ): Promise<Result<EntradaDeCampo | ItemDeLista, Failure>>;
  aplicarSugestoes(
    comando: Comando & { readonly sugestoes: readonly SugestaoDeContexto[] },
    ator: Ator,
  ): Promise<Result<{ readonly aplicadas: number; readonly ignoradas: number }, Failure>>;
  listarRevisoes(
    escopo: Escopo & { readonly limite?: number; readonly chave?: string | null },
  ): Promise<Result<readonly RevisaoDeContexto[], Failure>>;
  anexarArquivo(comando: Comando & NovoAnexo, ler: LerConteudo, ator: Ator): Promise<Result<ArquivoDeContexto, Failure>>;
  removerArquivo(comando: Comando & { readonly fileId: string }, ator: Ator): Promise<Result<null, Failure>>;
  criarLink(
    comando: Comando & {
      readonly secoes: readonly string[];
      readonly expiraEmDias?: number | null;
      readonly nota?: string | null;
      readonly conviteDeIntegracaoId?: string | null;
    },
    ator: Ator,
  ): Promise<Result<LinkCriado, Failure>>;
  listarLinks(escopo: Escopo): Promise<Result<readonly LinkResumido[], Failure>>;
  revogarLink(comando: Comando & { readonly linkId: string }, ator: Ator): Promise<Result<LinkResumido, Failure>>;
  regenerarLink(comando: Comando & { readonly linkId: string }, ator: Ator): Promise<Result<LinkCriado, Failure>>;
  carregarPeloLink(acesso: AcessoPublico): Promise<Result<FormularioPublico, Failure>>;
  salvarPeloLink(acesso: AcessoPublico, alteracao: AlteracaoPeloLink): Promise<Result<SalvoPeloLink, Failure>>;
  anexarArquivoPeloLink(acesso: AcessoPublico, anexo: NovoAnexo, ler: LerConteudo): Promise<Result<ArquivoEnviadoPeloLink, Failure>>;
  concluirPeloLink(acesso: AcessoPublico): Promise<Result<{ readonly concluidoEm: Date }, Failure>>;
  publicarBrain(
    escopo: Escopo,
    opcoes?: { readonly forcar?: boolean },
  ): Promise<Result<{ readonly situacao: SituacaoDoBrain; readonly contentHash: string | null }, Failure>>;
  publicarPendentes(limite?: number): Promise<ResumoDePublicacao>;
  reconstruirBrains(alvo: AlvoDaReconstrucao): Promise<Result<ResumoDePublicacao, Failure>>;
  expurgarArmazenamento(
    escopo: Escopo,
    modo: ModoDoExpurgoDoArmazenamento,
    executor?: { readonly requestId?: string; readonly callerFingerprint?: string },
  ): Promise<Result<ResumoDoExpurgoDoArmazenamento, Failure>>;
  varrerArquivos(opcoes?: { readonly limite?: number; readonly completa?: boolean }): Promise<ResumoDaVarredura>;
};

export type AgendadorDoBrain = { agendar(escopo: Escopo): void };

export type ResumoDePublicacao = {
  readonly publicados: number;
  readonly inalterados: number;
  readonly falhas: number;
  readonly desativado: boolean;
};

export type AlvoDaReconstrucao =
  | { readonly tipo: 'cliente'; readonly organizationId: string; readonly clientId: string }
  | { readonly tipo: 'organizacao'; readonly organizationId: string }
  | { readonly tipo: 'todos' };

export type DependenciasDoContexto = {
  readonly repositorio: ContextoRepository;
  readonly audit: AuditRecorder;
  readonly armazenamento: PortaDoArmazenamento;
  readonly agora?: () => Date;
  readonly limitar?: (pedidos: readonly RateLimitPedido[], janelaMs: number) => RateLimitVerdict;
  readonly agendador?: (publicar: (escopo: Escopo) => Promise<unknown>) => AgendadorDoBrain;
  readonly esperarMs?: (ms: number) => Promise<void>;
};

const LIMITE_POR_LINK = 120;
const LIMITE_POR_IP = 300;
const JANELA_MS = 60_000;
const TENTATIVAS_DE_GRAVACAO = 3;
const ESPERA_DO_AGENDADOR_MS = 5_000;
const ESPERA_DA_VARREDURA_S = 30;
const MAX_REVISOES = 200;

const LIMITE_DA_VARREDURA = 200;
const IDADE_DO_ORFAO_MS = 60 * 60 * 1000;
const PREFIXO_DOS_ARQUIVOS = 'arquivos/';
const CONVITE_COM_LINK_VIVO = 'convite_com_link_vivo';
const CONVITE_JA_TEM_LINK = failure('conflict', 'Este convite já tem um link de contexto válido. Revogue-o antes de criar outro.');

const SEM_PERMISSAO = failure('forbidden', 'Seu papel não permite alterar o contexto do cliente.');
const CLIENTE_NAO_ENCONTRADO = failure('not_found', 'Cliente não encontrado.');
const LINK_INVALIDO = failure('not_found', 'Este link não vale mais. Peça um novo à equipe.');

function conflito(versaoAtual: number | null): Failure {
  return failure('conflict', 'Outra pessoa alterou esta informação. Recarregue para ver a versão atual.', {
    versaoAtual: String(versaoAtual ?? 0),
  });
}

function emLote<T>(lista: readonly T[], chave: (t: T) => string): Record<string, T[]> {
  const mapa: Record<string, T[]> = {};
  for (const item of lista) (mapa[chave(item)] ??= []).push(item);
  return mapa;
}

function resumir(link: LinkDeContexto, agora: Date): LinkResumido {
  return { ...link, estado: estadoDoLink(link, agora) };
}

function marcacaoValida(parcial: MarcacaoParcial | undefined): boolean {
  if (!parcial) return true;
  if (parcial.epistemico && !EPISTEMICOS.includes(parcial.epistemico)) return false;
  if (parcial.fonte && !FONTES.includes(parcial.fonte)) return false;
  if (parcial.revisao && !REVISOES.includes(parcial.revisao)) return false;
  return true;
}

function mesclar(base: Marcacao, parcial: MarcacaoParcial | undefined): Marcacao {
  return {
    epistemico: parcial?.epistemico ?? base.epistemico,
    fonte: parcial?.fonte ?? base.fonte,
    revisao: parcial?.revisao ?? base.revisao,
    compartilhavel: parcial?.compartilhavel ?? base.compartilhavel,
  };
}

function planificar(retrato: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!retrato) return null;
  const { value, data, ...resto } = retrato as { value?: unknown; data?: Record<string, unknown> };
  if (data && typeof data === 'object') return { ...data, ...resto };
  return value === undefined ? resto : { valor: value, ...resto };
}

type DefinicaoDeArquivo = {
  readonly secao: SecaoKey;
  readonly chaveDoCatalogo: string;
  readonly campo: Extract<CampoSimples, { readonly tipo: 'arquivo' }>;
};

function definicaoDeArquivo(anexo: Pick<NovoAnexo, 'fieldKey' | 'listKey'>): DefinicaoDeArquivo | null {
  if (anexo.listKey) {
    const lista = campoLista(anexo.listKey);
    const sub = lista?.campo.item.find((i) => i.key === anexo.fieldKey);
    return lista && sub?.tipo === 'arquivo' ? { secao: lista.secao.key, chaveDoCatalogo: lista.campo.key, campo: sub } : null;
  }
  const simples = campoSimples(anexo.fieldKey);
  return simples && simples.campo.tipo === 'arquivo'
    ? { secao: simples.secao.key, chaveDoCatalogo: simples.campo.key, campo: simples.campo }
    : null;
}

function chavesVisiveis(secoes: readonly string[]): string[] {
  return camposVisiveisAoCliente(secoes).map((c) => c.key);
}

function chavesLegiveis(secoes: readonly string[]): string[] {
  return camposVisiveisAoCliente(secoes).flatMap((c) =>
    c.tipo === 'lista' ? [c.key, ...c.item.filter((i) => i.tipo === 'arquivo').map((i) => i.key)] : [c.key],
  );
}

function mensagemDeErro(erro: unknown): string {
  if (erro && typeof erro === 'object' && 'message' in erro) return String((erro as { message: unknown }).message).slice(0, 300);
  return 'falha desconhecida';
}

export function criarAgendadorEmMemoria(esperaMs = ESPERA_DO_AGENDADOR_MS) {
  return (publicar: (escopo: Escopo) => Promise<unknown>): AgendadorDoBrain => {
    const pendentes = new Map<string, ReturnType<typeof setTimeout>>();
    return {
      agendar(escopo) {
        const anterior = pendentes.get(escopo.clientId);
        if (anterior) clearTimeout(anterior);
        const timer = setTimeout(() => {
          pendentes.delete(escopo.clientId);
          foraDoContextoDeChamada(() => comoPublico(() => publicar(escopo))).catch((erro: unknown) => {
            logger.warn('contexto.brain.publicacao_adiada_falhou', { clientId: escopo.clientId, erro: mensagemDeErro(erro) });
          });
        }, esperaMs);
        timer.unref?.();
        pendentes.set(escopo.clientId, timer);
      },
    };
  };
}

export function createContextoService(deps: DependenciasDoContexto): ContextoService {
  const { repositorio, audit, armazenamento } = deps;
  const agora = deps.agora ?? (() => new Date());
  const limitar = deps.limitar ?? consumeAll;
  const esperar = deps.esperarMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let agendador: AgendadorDoBrain = { agendar: () => undefined };

  const registrar = (escopo: Escopo, ator: Ator, action: string, metadata: Record<string, unknown>, alvo?: { tipo: string; id: string }) =>
    audit.record({
      organizationId: escopo.organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action,
      targetType: alvo?.tipo ?? 'client',
      targetId: alvo?.id ?? escopo.clientId,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata,
    });

  const registrarPublico = (escopo: EscopoDoLink, acesso: AcessoPublico, action: string, metadata: Record<string, unknown>) =>
    audit.record({
      organizationId: escopo.organizationId,
      actorType: 'invite',
      actorId: null,
      action,
      targetType: 'client_context_link',
      targetId: escopo.linkId,
      requestId: acesso.requestId,
      sourceIp: null,
      metadata: { clientId: escopo.clientId, ...metadata },
    } satisfies AuditEvent);

  const mudou = (escopo: Escopo) => {
    if (armazenamento.configurado) agendador.agendar(escopo);
  };

  async function estadoDoBrain(escopo: Escopo): Promise<EstadoDoBrain> {
    const estado: EstadoDoBrainRegistrado | null = await repositorio.estadoDoBrain(escopo.organizationId, escopo.clientId);
    const pendente = Boolean(
      estado && (!estado.ultimaTentativaEm || estado.solicitadoEm > estado.ultimaTentativaEm || estado.ultimoErro),
    );
    const situacao: SituacaoDoEstadoDoBrain = !armazenamento.configurado
      ? 'desativado'
      : estado?.ultimoErro
        ? 'com_erro'
        : pendente
          ? 'pendente'
          : estado?.hashExportado
            ? 'em_dia'
            : 'nunca_publicado';
    return {
      situacao,
      armazenamentoConfigurado: armazenamento.configurado,
      pendente,
      solicitadoEm: estado?.solicitadoEm ?? null,
      exportadoEm: estado?.exportadoEm ?? null,
      hash: estado?.hashExportado ?? null,
      ultimaTentativaEm: estado?.ultimaTentativaEm ?? null,
      ultimoErro: estado?.ultimoErro ?? null,
      tentativas: estado?.tentativas ?? 0,
    };
  }

  async function gravarComRetentativa(caminho: string, conteudo: Uint8Array, contentType: string): Promise<Result<void, Failure>> {
    let ultimo: Failure = failure('unavailable', 'Falha ao gravar no armazenamento.');
    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_GRAVACAO; tentativa++) {
      const resultado = await armazenamento.put(caminho, conteudo, { contentType });
      if (resultado.ok) return ok(undefined);
      ultimo = resultado.error;
      if (tentativa < TENTATIVAS_DE_GRAVACAO) await esperar(200 * 4 ** (tentativa - 1));
    }
    return err(ultimo);
  }

  async function publicarBrain(
    escopo: Escopo,
    opcoes: { readonly forcar?: boolean } = {},
  ): Promise<Result<{ situacao: SituacaoDoBrain; contentHash: string | null }, Failure>> {
    if (!armazenamento.configurado) return ok({ situacao: 'sem_armazenamento', contentHash: null });

    const carregado = await repositorio.carregar(escopo.organizationId, escopo.clientId);
    if (!carregado) return err(CLIENTE_NAO_ENCONTRADO);

    const brain = construirBrain({
      organizationId: escopo.organizationId,
      clientId: escopo.clientId,
      nomeDoCliente: carregado.nome,
      contexto: carregado.contexto,
      geradoEm: agora(),
    });

    const anterior = await repositorio.estadoDoBrain(escopo.organizationId, escopo.clientId);
    if (!opcoes.forcar && anterior?.hashExportado === brain.contentHash && anterior.versaoDoEsquema === VERSAO_DO_BRAIN) {
      await repositorio.registrarTentativaDoBrain(escopo.organizationId, escopo.clientId, {
        ok: true,
        hash: brain.contentHash,
        versaoDoEsquema: VERSAO_DO_BRAIN,
        gravado: false,
      });
      return ok({ situacao: 'inalterado', contentHash: brain.contentHash });
    }

    const manifesto = brain.arquivos.find((a) => a.nome === 'manifest.json')!;
    const ordem = [...brain.arquivos.filter((a) => a !== manifesto), manifesto];
    for (const arquivo of ordem) {
      const gravado = await gravarComRetentativa(arquivo.caminho, new TextEncoder().encode(arquivo.conteudo), arquivo.contentType);
      if (!gravado.ok) {
        const erro = `${arquivo.nome}: ${gravado.error.message}`;
        await repositorio.registrarTentativaDoBrain(escopo.organizationId, escopo.clientId, { ok: false, erro });
        await audit.record({
          organizationId: escopo.organizationId,
          actorType: 'system',
          actorId: null,
          action: 'client.context.brain_failed',
          targetType: 'client',
          targetId: escopo.clientId,
          metadata: { arquivo: arquivo.nome, codigo: gravado.error.code },
        });
        return err(failure('unavailable', 'Não foi possível publicar o brain agora; uma nova tentativa vai acontecer.'));
      }
    }

    await repositorio.registrarTentativaDoBrain(escopo.organizationId, escopo.clientId, {
      ok: true,
      hash: brain.contentHash,
      versaoDoEsquema: VERSAO_DO_BRAIN,
      gravado: true,
    });
    await audit.record({
      organizationId: escopo.organizationId,
      actorType: 'system',
      actorId: null,
      action: 'client.context.brain_published',
      targetType: 'client',
      targetId: escopo.clientId,
      metadata: { hash: brain.contentHash.slice(0, 12), arquivos: brain.arquivos.length },
    });
    return ok({ situacao: 'publicado', contentHash: brain.contentHash });
  }

  agendador = (deps.agendador ?? criarAgendadorEmMemoria())((escopo) =>
    publicarBrain(escopo).catch(async (erro) => {
      await repositorio
        .registrarTentativaDoBrain(escopo.organizationId, escopo.clientId, { ok: false, erro: mensagemDeErro(erro) })
        .catch(() => undefined);
    }),
  );

  async function publicarVarios(alvos: readonly Escopo[], forcar: boolean): Promise<ResumoDePublicacao> {
    let publicados = 0;
    let inalterados = 0;
    let falhas = 0;
    for (const escopo of alvos) {
      const resultado = await publicarBrain(escopo, { forcar }).catch((erro) => err(failure('unavailable', mensagemDeErro(erro))));
      if (!resultado.ok) falhas += 1;
      else if (resultado.value.situacao === 'inalterado') inalterados += 1;
      else publicados += 1;
    }
    return { publicados, inalterados, falhas, desativado: false };
  }

  async function lerAlvo(escopo: Escopo, alvo: AlvoDeMarcacao) {
    return alvo.tipo === 'campo'
      ? repositorio.lerEntrada(escopo.organizationId, escopo.clientId, alvo.fieldKey)
      : repositorio.lerItem(escopo.organizationId, escopo.clientId, alvo.itemId);
  }

  async function marcar(
    comando: Comando & { alvo: AlvoDeMarcacao; versaoEsperada: number; marcacao: MarcacaoParcial },
    ator: Ator,
    acao: string,
  ): Promise<Result<EntradaDeCampo | ItemDeLista, Failure>> {
    if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    if (!marcacaoValida(comando.marcacao)) return err(failure('validation', 'Marcação inválida.'));

    const atual = await lerAlvo(comando, comando.alvo);
    if (!atual) return err(failure('not_found', 'Informação não encontrada.'));
    const marcacao = mesclar(atual, comando.marcacao);

    let gravado: Gravado<EntradaDeCampo | ItemDeLista>;
    if (comando.alvo.tipo === 'campo') {
      const entrada = atual as EntradaDeCampo;
      gravado = await repositorio.gravarEntrada(comando.organizationId, {
        clientId: comando.clientId,
        secao: entrada.secao,
        fieldKey: entrada.fieldKey,
        valor: entrada.valor,
        marcacao,
        versaoEsperada: comando.versaoEsperada,
        autorId: ator.userId,
      });
    } else {
      const item = atual as ItemDeLista;
      gravado = await repositorio.alterarItem(comando.organizationId, {
        clientId: comando.clientId,
        itemId: item.id,
        dados: item.dados,
        marcacao,
        versaoEsperada: comando.versaoEsperada,
        autorId: ator.userId,
      });
    }
    if (!gravado.ok) return err(conflito(gravado.versaoAtual));

    const chave = comando.alvo.tipo === 'campo' ? comando.alvo.fieldKey : (atual as ItemDeLista).listKey;
    await registrar(comando, ator, acao, { alvo: comando.alvo.tipo, chave, secao: atual.secao, ...marcacao });
    mudou(comando);
    return ok(gravado.valor);
  }

  function validarAnexo(
    anexo: NovoAnexo,
  ): Result<{ readonly definicao: DefinicaoDeArquivo }, Failure> {
    if (!armazenamento.configurado) return err(failure('unavailable', 'O envio de arquivos ainda não está disponível.'));
    const definicao = definicaoDeArquivo(anexo);
    if (!definicao) return err(failure('validation', 'Este campo não recebe arquivos.'));
    if (Boolean(anexo.listKey) !== Boolean(anexo.itemId)) {
      return err(failure('validation', 'Arquivo de item precisa da lista e do item.'));
    }
    return ok({ definicao });
  }

  type EtapasDoEnvio = {
    readonly escopo: Escopo;
    readonly anexo: NovoAnexo;
    readonly definicao: DefinicaoDeArquivo;
    readonly usoAtual: number;
    readonly ler: LerConteudo;
    readonly reservar: (reserva: { readonly id: string; readonly caminho: string }) => Promise<ResultadoDaReserva>;
    readonly liberar: (id: string) => Promise<void>;
  };

  type Guardado = {
    readonly id: string;
    readonly caminho: string;
    readonly sha256: string;
    readonly secao: Secao['key'];
    readonly mime: string;
    readonly tamanhoBytes: number;
  };

  async function guardarAnexo(etapas: EtapasDoEnvio): Promise<Result<Guardado, Failure>> {
    const { escopo, anexo, definicao } = etapas;
    const id = randomUUID();
    const caminho = caminhoDoArquivo(escopo.organizationId, escopo.clientId, id, anexo.nome);

    const reservado = await etapas.reservar({ id, caminho });
    if (reservado !== 'ok') return err(falhaDaReserva(reservado));

    let gravado = false;
    try {
      const lido = await etapas.ler(anexo.tamanhoDeclarado);
      if (!lido.ok) {
        await etapas.liberar(id);
        return lido;
      }
      const conteudo = lido.value;
      const avaliado = avaliarAnexo({
        nome: anexo.nome,
        mime: anexo.mime,
        conteudo,
        categoriasAceitas: definicao.campo.categorias,
        usoAtualDoClienteBytes: etapas.usoAtual,
      });
      if (!avaliado.ok) {
        await etapas.liberar(id);
        return err(failure('validation', avaliado.mensagem, { motivo: avaliado.motivo }));
      }

      const sha256 = createHash('sha256').update(conteudo).digest('hex');
      const posto = await armazenamento.put(caminho, conteudo, { contentType: avaliado.contentType, sha256 });
      if (!posto.ok) {
        await armazenamento.delete(caminho, { todasAsVersoes: true });
        await etapas.liberar(id);
        return err(failure('unavailable', 'Não foi possível guardar o arquivo agora. Tente de novo.'));
      }
      gravado = true;
      return ok({ id, caminho, sha256, secao: definicao.secao, mime: avaliado.contentType, tamanhoBytes: conteudo.byteLength });
    } catch (erro) {
      if (gravado) await armazenamento.delete(caminho, { todasAsVersoes: true }).catch(() => undefined);
      await etapas.liberar(id).catch(() => undefined);
      throw erro;
    }
  }

  async function desfazerEnvio(caminho: string, liberar: () => Promise<void>): Promise<void> {
    await armazenamento.delete(caminho, { todasAsVersoes: true }).catch(() => undefined);
    await liberar().catch(() => undefined);
  }

  async function prepararLink(
    comando: Comando & {
      readonly secoes: readonly string[];
      readonly expiraEmDias?: number | null;
      readonly nota?: string | null;
      readonly conviteDeIntegracaoId?: string | null;
    },
  ): Promise<
    Result<
      {
        readonly token: string;
        readonly pedido: { readonly secoes: readonly SecaoKey[]; readonly expiraEm: Date; readonly nota: string | null };
        readonly conviteId: string | null;
      },
      Failure
    >
  > {
    if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const instante = agora();
    const pedido = validarPedidoDeLink(comando, instante);
    if (!pedido.ok) return err(failure('validation', MOTIVO_DO_LINK[pedido.motivo], { motivo: pedido.motivo }));

    const conviteId = comando.conviteDeIntegracaoId ?? null;
    if (conviteId) {
      const convite = await repositorio.conviteDoCliente(comando.organizationId, comando.clientId, conviteId);
      if (!convite) return err(failure('not_found', 'Convite de integração não encontrado para este cliente.'));
      if (
        convite.status === 'revoked' ||
        convite.status === 'expired' ||
        (convite.expiraEm !== null && convite.expiraEm.getTime() <= instante.getTime())
      ) {
        return err(failure('validation', 'O convite de integração não vale mais. Crie um novo convite.'));
      }
    }
    return ok({ token: gerarTokenDeContexto(), pedido, conviteId });
  }

  async function resolverHash(credencial: CredencialPublica): Promise<string | null> {
    if (credencial.tipo === 'link') return tokenBemFormado(credencial.token) ? hashDoToken(credencial.token) : null;
    if (credencial.token.length < 16 || credencial.token.length > 64) return null;
    return repositorio.hashPeloConvite(credencial.token);
  }

  async function abrirPublico(acesso: AcessoPublico): Promise<Result<{ hash: string; escopo: EscopoDoLink }, Failure>> {
    const pedidos: RateLimitPedido[] = [
      { key: `contexto:credencial:${createHash('sha256').update(acesso.credencial.token).digest('hex').slice(0, 24)}`, limit: LIMITE_POR_LINK },
    ];
    if (acesso.ip) pedidos.push({ key: `contexto:ip:${acesso.ip}`, limit: LIMITE_POR_IP });
    const veredito = limitar(pedidos, JANELA_MS);
    if (!veredito.allowed) {
      return err(failure('rate_limited', 'Muitas tentativas. Aguarde um pouco.', { retryAfterSeconds: String(veredito.retryAfterSeconds) }));
    }

    const hash = await resolverHash(acesso.credencial);
    if (!hash) return err(LINK_INVALIDO);
    const escopo = await repositorio.abrirLink(hash);
    if (!escopo) return err(LINK_INVALIDO);
    return ok({ hash, escopo });
  }

  function falhaDaReserva(resultado: ResultadoDaReserva): Failure {
    return resultado === 'recusado' ? failure('not_found', 'Cliente não encontrado.') : falhaPeloLink(resultado, null);
  }

  async function apagarArquivosOrfaosDoCliente(cliente: Escopo, instante: number): Promise<{ apagados: number; falhas: number }> {
    const prefixo = `${prefixoDoCliente(cliente.organizationId, cliente.clientId)}${PREFIXO_DOS_ARQUIVOS}`;
    const listados = await armazenamento.list(prefixo);
    if (!listados.ok) return { apagados: 0, falhas: 1 };
    const conhecidos = await repositorio.caminhosConhecidos(cliente.clientId);
    let apagados = 0;
    let falhas = 0;
    for (const objeto of listados.value) {
      if (conhecidos.has(objeto.caminho)) continue;
      if (!objeto.atualizadoEm || instante - objeto.atualizadoEm.getTime() < IDADE_DO_ORFAO_MS) continue;
      const apagado = await armazenamento.delete(objeto.caminho, { todasAsVersoes: true });
      if (apagado.ok) apagados += 1;
      else falhas += 1;
    }
    return { apagados, falhas };
  }

  async function despublicarBrainsDeExcluidos(limite: number): Promise<{ despublicados: number; falhas: number }> {
    let despublicados = 0;
    let falhas = 0;
    for (const cliente of await repositorio.brainsDeExcluidos(limite)) {
      const apagado = await armazenamento.deletePrefix(prefixoDoExportDoContexto(cliente.organizationId, cliente.clientId));
      if (!apagado.ok) {
        falhas += 1;
        continue;
      }
      await repositorio.marcarBrainDespublicado(cliente.clientId);
      despublicados += 1;
    }
    return { despublicados, falhas };
  }

  function falhaPeloLink(resultado: ResultadoPeloLink, versao: number | null): Failure {
    switch (resultado) {
      case 'conflito':
        return conflito(versao);
      case 'recusado':
        return LINK_INVALIDO;
      case 'limite':
        return failure('validation', 'Esta lista chegou ao limite de itens.');
      case 'cota_excedida':
        return failure('validation', 'O cliente atingiu o limite de 500 MB de arquivos.', { motivo: 'cota_excedida' });
      case 'orcamento_excedido':
        return failure('rate_limited', 'Muitos envios por este link na última hora. Tente mais tarde.', { retryAfterSeconds: '600' });
      case 'tamanho_invalido':
        return failure('validation', 'Tamanho de arquivo inválido.');
      case 'reserva_invalida':
        return failure('unavailable', 'O envio demorou demais. Tente de novo.');
      case 'nao_encontrado':
        return failure('not_found', 'Item não encontrado.');
      default:
        return failure('forbidden', 'Esta informação não faz parte do que foi pedido neste link.');
    }
  }

  const servico: ContextoService = {
    async carregar(escopo) {
      const carregado = await repositorio.carregar(escopo.organizationId, escopo.clientId);
      if (!carregado) return err(CLIENTE_NAO_ENCONTRADO);
      const { contexto } = carregado;
      return ok({
        cliente: { id: escopo.clientId, nome: carregado.nome },
        catalogoVersao: VERSAO_DO_CATALOGO,
        catalogo: CATALOGO,
        campos: Object.fromEntries(contexto.campos.map((e) => [e.fieldKey, e])),
        listas: emLote(contexto.itens, (i) => i.listKey),
        arquivos: contexto.arquivos,
        usoDeArquivosBytes: contexto.arquivos.reduce((soma, a) => soma + a.tamanhoBytes, 0),
        cotaDeArquivosBytes: COTA_POR_CLIENTE,
        completude: calcularCompletude(contexto),
        proximos: proximosCampos(contexto, 5),
        brain: await estadoDoBrain(escopo),
      });
    },

    async salvarCampo(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const achado = campoSimples(comando.fieldKey);
      if (!achado) return err(failure('validation', 'Campo desconhecido.'));
      if (!marcacaoValida(comando.marcacao)) return err(failure('validation', 'Marcação inválida.'));

      const validado = validarValor(achado.campo, comando.valor);
      if (!validado.ok) return err(failure('validation', validado.erro, { campo: comando.fieldKey }));

      if (validado.valor === null) {
        const apagado = await repositorio.apagarEntrada(comando.organizationId, {
          clientId: comando.clientId,
          fieldKey: comando.fieldKey,
          versaoEsperada: comando.versaoEsperada,
        });
        if (!apagado.ok && apagado.versaoAtual !== 0) return err(conflito(apagado.versaoAtual));
        await registrar(comando, ator, 'client.context.field_cleared', { secao: achado.secao.key, chave: comando.fieldKey });
        mudou(comando);
        return ok(null);
      }

      const atual = comando.versaoEsperada > 0
        ? await repositorio.lerEntrada(comando.organizationId, comando.clientId, comando.fieldKey)
        : null;
      const base: Marcacao = atual
        ? { ...atual, fonte: 'equipe', revisao: 'confirmado' }
        : { epistemico: achado.campo.epistemicoPadrao, fonte: 'equipe', revisao: 'confirmado', compartilhavel: false };

      const gravado = await repositorio.gravarEntrada(comando.organizationId, {
        clientId: comando.clientId,
        secao: achado.secao.key,
        fieldKey: comando.fieldKey,
        valor: validado.valor,
        marcacao: mesclar(base, comando.marcacao),
        versaoEsperada: comando.versaoEsperada,
        autorId: ator.userId,
      });
      if (!gravado.ok) return err(conflito(gravado.versaoAtual));

      await registrar(comando, ator, 'client.context.field_saved', {
        secao: achado.secao.key,
        chave: comando.fieldKey,
        versao: gravado.valor.versao,
        epistemico: gravado.valor.epistemico,
        fonte: gravado.valor.fonte,
      });
      mudou(comando);
      return ok(gravado.valor);
    },

    async adicionarItem(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const achado = campoLista(comando.listKey);
      if (!achado) return err(failure('validation', 'Lista desconhecida.'));
      if (!marcacaoValida(comando.marcacao)) return err(failure('validation', 'Marcação inválida.'));

      const validado = validarItem(achado.campo, comando.dados);
      if (!validado.ok) return err(failure('validation', 'Revise os campos do item.', validado.erros));

      const total = await repositorio.contarItens(comando.organizationId, comando.clientId, comando.listKey);
      if (total >= achado.campo.maximo) {
        return err(failure('validation', `A lista aceita no máximo ${achado.campo.maximo} itens.`));
      }

      const item = await repositorio.inserirItem(comando.organizationId, {
        clientId: comando.clientId,
        secao: achado.secao.key,
        listKey: comando.listKey,
        dados: validado.dados,
        marcacao: mesclar(
          { epistemico: achado.campo.epistemicoPadrao, fonte: 'equipe', revisao: 'confirmado', compartilhavel: false },
          comando.marcacao,
        ),
        autorId: ator.userId,
        maximo: achado.campo.maximo,
      });
      if (!item) return err(failure('validation', `A lista aceita no máximo ${achado.campo.maximo} itens.`));
      await registrar(comando, ator, 'client.context.item_added', { secao: item.secao, lista: item.listKey }, { tipo: 'client_context_item', id: item.id });
      mudou(comando);
      return ok(item);
    },

    async alterarItem(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      if (!marcacaoValida(comando.marcacao)) return err(failure('validation', 'Marcação inválida.'));
      const atual = await repositorio.lerItem(comando.organizationId, comando.clientId, comando.itemId);
      if (!atual) return err(failure('not_found', 'Item não encontrado.'));
      const achado = campoLista(atual.listKey);
      if (!achado) return err(failure('validation', 'Lista desconhecida.'));

      const validado = validarItem(achado.campo, comando.dados);
      if (!validado.ok) return err(failure('validation', 'Revise os campos do item.', validado.erros));

      const gravado = await repositorio.alterarItem(comando.organizationId, {
        clientId: comando.clientId,
        itemId: comando.itemId,
        dados: validado.dados,
        marcacao: mesclar({ ...atual, fonte: 'equipe', revisao: 'confirmado' }, comando.marcacao),
        versaoEsperada: comando.versaoEsperada,
        autorId: ator.userId,
      });
      if (!gravado.ok) return err(conflito(gravado.versaoAtual));

      await registrar(comando, ator, 'client.context.item_updated', { secao: atual.secao, lista: atual.listKey, versao: gravado.valor.versao }, { tipo: 'client_context_item', id: atual.id });
      mudou(comando);
      return ok(gravado.valor);
    },

    async removerItem(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const atual = await repositorio.lerItem(comando.organizationId, comando.clientId, comando.itemId);
      if (!atual) return err(failure('not_found', 'Item não encontrado.'));
      const removido = await repositorio.removerItem(comando.organizationId, {
        clientId: comando.clientId,
        itemId: comando.itemId,
        versaoEsperada: comando.versaoEsperada,
      });
      if (!removido.ok) return err(conflito(removido.versaoAtual));
      await registrar(comando, ator, 'client.context.item_removed', { secao: atual.secao, lista: atual.listKey }, { tipo: 'client_context_item', id: atual.id });
      mudou(comando);
      return ok(null);
    },

    async reordenarItens(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const achado = campoLista(comando.listKey);
      if (!achado) return err(failure('validation', 'Lista desconhecida.'));

      const carregado = await repositorio.carregar(comando.organizationId, comando.clientId);
      if (!carregado) return err(CLIENTE_NAO_ENCONTRADO);
      const atuais = carregado.contexto.itens.filter((i) => i.listKey === comando.listKey).map((i) => i.id);
      const mesmaLista =
        atuais.length === comando.ordem.length &&
        new Set(comando.ordem).size === comando.ordem.length &&
        comando.ordem.every((id) => atuais.includes(id));
      if (!mesmaLista) return err(conflito(null));

      await repositorio.reordenar(comando.organizationId, {
        clientId: comando.clientId,
        listKey: comando.listKey,
        ordem: comando.ordem,
        autorId: ator.userId,
      });
      await registrar(comando, ator, 'client.context.items_reordered', { secao: achado.secao.key, lista: comando.listKey, itens: atuais.length });
      mudou(comando);

      const posicao = new Map(comando.ordem.map((id, i) => [id, i]));
      return ok(
        carregado.contexto.itens
          .filter((i) => i.listKey === comando.listKey)
          .map((i) => ({ ...i, posicao: posicao.get(i.id) ?? i.posicao }))
          .sort((a, b) => a.posicao - b.posicao),
      );
    },

    marcar: (comando, ator) => marcar(comando, ator, 'client.context.marked'),

    confirmarSugestao: (comando, ator) =>
      marcar({ ...comando, marcacao: { revisao: 'confirmado' } }, ator, 'client.context.suggestion_confirmed'),

    async aplicarSugestoes(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      let aplicadas = 0;
      let ignoradas = 0;

      for (const sugestao of comando.sugestoes) {
        const marcacao: Marcacao = { epistemico: 'hipotese', fonte: sugestao.fonte, revisao: 'sugerido', compartilhavel: false };
        if (sugestao.tipo === 'campo') {
          const achado = campoSimples(sugestao.fieldKey);
          const validado = achado ? validarValor(achado.campo, sugestao.valor) : null;
          if (!achado || !validado?.ok || validado.valor === null) {
            ignoradas += 1;
            continue;
          }
          const gravado = await repositorio.gravarEntrada(comando.organizationId, {
            clientId: comando.clientId,
            secao: achado.secao.key,
            fieldKey: sugestao.fieldKey,
            valor: validado.valor,
            marcacao,
            versaoEsperada: 0,
            autorId: ator.userId,
          });
          if (gravado.ok) aplicadas += 1;
          else ignoradas += 1;
          continue;
        }

        const achado = campoLista(sugestao.listKey);
        const validado = achado ? validarItem(achado.campo, sugestao.dados) : null;
        if (!achado || !validado?.ok) {
          ignoradas += 1;
          continue;
        }
        const inserido = await repositorio.inserirItem(comando.organizationId, {
          clientId: comando.clientId,
          secao: achado.secao.key,
          listKey: sugestao.listKey,
          dados: validado.dados,
          marcacao,
          autorId: ator.userId,
          maximo: achado.campo.maximo,
        });
        if (inserido) aplicadas += 1;
        else ignoradas += 1;
      }

      await registrar(comando, ator, 'client.context.suggestions_applied', { aplicadas, ignoradas });
      if (aplicadas > 0) mudou(comando);
      return ok({ aplicadas, ignoradas });
    },

    async listarRevisoes(escopo) {
      const limite = Math.min(Math.max(escopo.limite ?? 50, 1), MAX_REVISOES);
      const revisoes = await repositorio.listarRevisoes(escopo.organizationId, escopo.clientId, {
        limite,
        chave: escopo.chave ?? null,
      });
      return ok(
        revisoes.map((r) => ({
          ...r,
          viaLink: r.linkId !== null,
          diferencas: diferencasDeDados(planificar(r.antes), planificar(r.depois)),
        })),
      );
    },

    async anexarArquivo(comando, ler, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const validado = validarAnexo(comando);
      if (!validado.ok) return validado;
      if (comando.itemId && !(await repositorio.lerItem(comando.organizationId, comando.clientId, comando.itemId))) {
        return err(failure('not_found', 'Item não encontrado.'));
      }
      const liberar = (id: string) => repositorio.liberarReserva(comando.organizationId, comando.clientId, id);
      const guardado = await guardarAnexo({
        escopo: comando,
        anexo: comando,
        definicao: validado.value.definicao,
        usoAtual: await repositorio.usoDeArquivos(comando.organizationId, comando.clientId),
        ler,
        reservar: ({ id, caminho }) =>
          repositorio.reservarArquivo(comando.organizationId, {
            clientId: comando.clientId,
            id,
            caminho,
            tamanhoBytes: comando.tamanhoDeclarado,
            cotaBytes: COTA_POR_CLIENTE,
          }),
        liberar,
      });
      if (!guardado.ok) return guardado;

      try {
        const arquivo = await repositorio.registrarArquivo(comando.organizationId, {
          id: guardado.value.id,
          clientId: comando.clientId,
          secao: guardado.value.secao,
          fieldKey: comando.fieldKey,
          itemId: comando.itemId ?? null,
          caminho: guardado.value.caminho,
          nome: comando.nome.slice(0, 255),
          mime: guardado.value.mime,
          tamanhoBytes: guardado.value.tamanhoBytes,
          sha256: guardado.value.sha256,
          fonte: 'equipe',
          compartilhavel: false,
          autorId: ator.userId,
        });
        await registrar(comando, ator, 'client.context.file_attached', {
          secao: arquivo.secao,
          chave: arquivo.fieldKey,
          mime: arquivo.mime,
          tamanhoBytes: arquivo.tamanhoBytes,
        }, { tipo: 'client_context_file', id: arquivo.id });
        mudou(comando);
        return ok(arquivo);
      } catch (erro) {
        await desfazerEnvio(guardado.value.caminho, () => liberar(guardado.value.id));
        throw erro;
      }
    },

    async removerArquivo(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const removido = await repositorio.removerArquivo(comando.organizationId, comando.clientId, comando.fileId);
      if (!removido) return err(failure('not_found', 'Arquivo não encontrado.'));
      await armazenamento.delete(removido.caminho);
      await registrar(comando, ator, 'client.context.file_removed', { secao: removido.secao, chave: removido.fieldKey }, { tipo: 'client_context_file', id: removido.id });
      mudou(comando);
      return ok(null);
    },

    async criarLink(comando, ator) {
      const preparado = await prepararLink(comando);
      if (!preparado.ok) return preparado;
      const { token, pedido, conviteId } = preparado.value;
      const link = await repositorio.criarLink(comando.organizationId, {
        clientId: comando.clientId,
        tokenHash: hashDoToken(token),
        secoes: pedido.secoes,
        expiraEm: pedido.expiraEm,
        nota: pedido.nota,
        criadoPor: ator.userId,
        conviteDeIntegracaoId: conviteId,
      });
      if (link === CONVITE_COM_LINK_VIVO) return err(CONVITE_JA_TEM_LINK);
      await registrar(comando, ator, 'client.context.link_created', {
        secoes: link.secoes,
        expiraEm: link.expiraEm.toISOString(),
        comConvite: conviteId !== null,
      }, { tipo: 'client_context_link', id: link.id });
      return ok({ link: resumir(link, agora()), token });
    },

    async listarLinks(escopo) {
      const instante = agora();
      const links = await repositorio.listarLinks(escopo.organizationId, escopo.clientId);
      return ok(links.map((l) => resumir(l, instante)));
    },

    async revogarLink(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const revogado = await repositorio.revogarLink(comando.organizationId, comando.clientId, comando.linkId);
      if (!revogado) return err(failure('not_found', 'Link não encontrado ou já revogado.'));
      await registrar(comando, ator, 'client.context.link_revoked', {}, { tipo: 'client_context_link', id: revogado.id });
      return ok(resumir(revogado, agora()));
    },

    async regenerarLink(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const anterior = await repositorio.lerLink(comando.organizationId, comando.clientId, comando.linkId);
      if (!anterior) return err(failure('not_found', 'Link não encontrado.'));

      const prazoOriginal = Math.round((anterior.expiraEm.getTime() - anterior.criadoEm.getTime()) / 86_400_000);
      const preparado = await prepararLink({
        ...comando,
        secoes: anterior.secoes,
        expiraEmDias: Math.min(Math.max(prazoOriginal, 1), 90),
        nota: anterior.nota,
        conviteDeIntegracaoId: anterior.conviteDeIntegracaoId,
      });
      if (!preparado.ok) return preparado;
      const { token, pedido, conviteId } = preparado.value;

      const novo = await repositorio.regenerarLink(comando.organizationId, {
        clientId: comando.clientId,
        linkAnteriorId: anterior.id,
        tokenHash: hashDoToken(token),
        secoes: pedido.secoes,
        expiraEm: pedido.expiraEm,
        nota: pedido.nota,
        criadoPor: ator.userId,
        conviteDeIntegracaoId: conviteId,
      });
      if (novo === null) return err(failure('not_found', 'Link não encontrado.'));
      if (novo === CONVITE_COM_LINK_VIVO) return err(CONVITE_JA_TEM_LINK);
      if (!anterior.revogadoEm) {
        await registrar(comando, ator, 'client.context.link_revoked', { motivo: 'regenerado' }, { tipo: 'client_context_link', id: anterior.id });
      }
      await registrar(comando, ator, 'client.context.link_created', {
        secoes: novo.secoes,
        expiraEm: novo.expiraEm.toISOString(),
        comConvite: conviteId !== null,
      }, { tipo: 'client_context_link', id: novo.id });
      await registrar(comando, ator, 'client.context.link_regenerated', { anterior: anterior.id }, { tipo: 'client_context_link', id: novo.id });
      return ok({ link: resumir(novo, agora()), token });
    },

    async carregarPeloLink(acesso) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const { hash, escopo } = aberto.value;

      const visto = await repositorio.lerPeloLink(hash, chavesLegiveis(escopo.secoes));
      if (!visto) return err(LINK_INVALIDO);

      if (await repositorio.registrarAberturaPeloLink(hash)) {
        await registrarPublico(escopo, acesso, 'client.context.link_opened', { secoes: escopo.secoes });
      }

      const bruto: ContextoBruto = {
        campos: visto.campos.map((c) => ({
          ...c,
          revisao: 'confirmado',
          compartilhavel: true,
          atualizadoEm: escopo.expiraEm,
          atualizadoPor: null,
          viaLink: c.fonte === 'cliente',
        })),
        itens: visto.itens.map((i) => ({ ...i, revisao: 'confirmado', compartilhavel: true, atualizadoEm: escopo.expiraEm, viaLink: i.fonte === 'cliente' })),
        arquivos: [],
      };
      const completude = calcularCompletude(bruto);

      return ok({
        organizacao: escopo.nomeDaOrganizacao,
        cliente: escopo.nomeDoCliente,
        nota: escopo.nota,
        expiraEm: escopo.expiraEm,
        concluidoEm: escopo.concluidoEm,
        catalogoVersao: VERSAO_DO_CATALOGO,
        secoes: catalogoParaCliente(escopo.secoes),
        campos: Object.fromEntries(
          visto.campos.map((c) => [c.fieldKey, { valor: c.valor, versao: c.versao, epistemico: c.epistemico, fonte: c.fonte }]),
        ),
        listas: Object.fromEntries(
          Object.entries(emLote(visto.itens, (i) => i.listKey)).map(([chave, itens]) => [
            chave,
            itens.map((i) => ({
              id: i.id,
              dados: i.dados,
              versao: i.versao,
              epistemico: i.epistemico,
              editavelPeloCliente: true,
              removivelPeloCliente: i.fonte === 'cliente',
            })),
          ]),
        ),
        arquivos: visto.arquivos.map((a) => ({
          id: a.id,
          fieldKey: a.fieldKey,
          itemId: a.itemId,
          nome: a.nome,
          mime: a.mime,
          tamanhoBytes: a.tamanhoBytes,
        })),
        completude: {
          ...completude,
          secoes: completude.secoes.filter((s) => escopo.secoes.includes(s.secao)),
        },
        armazenamentoConfigurado: armazenamento.configurado,
      });
    },

    async salvarPeloLink(acesso, alteracao) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const { hash, escopo } = aberto.value;
      const permitido = new Set(chavesVisiveis(escopo.secoes));
      const negar = () => err(failure('forbidden', 'Esta informação não faz parte do que foi pedido neste link.'));

      const epistemico = alteracao.tipo === 'remover_item' ? undefined : alteracao.epistemico;
      if (epistemico !== undefined && !EPISTEMICOS.includes(epistemico)) {
        return err(failure('validation', 'Marcação inválida.'));
      }

      if (alteracao.tipo === 'campo') {
        const achado = campoSimples(alteracao.fieldKey);
        if (!achado || !permitido.has(alteracao.fieldKey)) return negar();
        const validado = validarValor(achado.campo, alteracao.valor);
        if (!validado.ok) return err(failure('validation', validado.erro, { campo: alteracao.fieldKey }));

        const salvo = await repositorio.salvarCampoPeloLink(hash, {
          secao: achado.secao.key,
          fieldKey: alteracao.fieldKey,
          valor: validado.valor,
          epistemico: alteracao.epistemico ?? achado.campo.epistemicoPadrao,
          versaoEsperada: alteracao.versaoEsperada,
        });
        await registrarPublico(escopo, acesso, 'client.context.link_saved', {
          alvo: 'campo',
          secao: achado.secao.key,
          chave: alteracao.fieldKey,
          resultado: salvo.resultado,
        });
        if (salvo.resultado !== 'ok') return err(falhaPeloLink(salvo.resultado, salvo.versao));
        mudou(escopo);
        return ok({ versao: salvo.versao ?? 0, itemId: null });
      }

      if (alteracao.tipo === 'item') {
        const achado = campoLista(alteracao.listKey);
        if (!achado || !permitido.has(alteracao.listKey)) return negar();
        const validado = validarItem(achado.campo, alteracao.dados);
        if (!validado.ok) return err(failure('validation', 'Revise os campos do item.', validado.erros));

        const salvo = await repositorio.salvarItemPeloLink(hash, {
          secao: achado.secao.key,
          listKey: alteracao.listKey,
          itemId: alteracao.itemId,
          dados: validado.dados,
          epistemico: alteracao.epistemico ?? achado.campo.epistemicoPadrao,
          versaoEsperada: alteracao.versaoEsperada,
          maximo: achado.campo.maximo,
        });
        await registrarPublico(escopo, acesso, 'client.context.link_saved', {
          alvo: 'item',
          secao: achado.secao.key,
          chave: alteracao.listKey,
          novo: alteracao.itemId === null,
          resultado: salvo.resultado,
        });
        if (salvo.resultado !== 'ok') return err(falhaPeloLink(salvo.resultado, salvo.versao));
        mudou(escopo);
        return ok({ versao: salvo.versao ?? 1, itemId: salvo.itemId });
      }

      const resultado = await repositorio.removerItemPeloLink(hash, alteracao.itemId, alteracao.versaoEsperada);
      await registrarPublico(escopo, acesso, 'client.context.link_saved', { alvo: 'remover_item', resultado });
      if (resultado !== 'ok') return err(falhaPeloLink(resultado, null));
      mudou(escopo);
      return ok({ versao: 0, itemId: alteracao.itemId });
    },

    async anexarArquivoPeloLink(acesso, anexo, ler) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const { hash, escopo } = aberto.value;

      const definicao = definicaoDeArquivo(anexo);
      if (!definicao || !chavesVisiveis(escopo.secoes).includes(definicao.chaveDoCatalogo)) {
        return err(failure('forbidden', 'Esta informação não faz parte do que foi pedido neste link.'));
      }
      const validado = validarAnexo(anexo);
      if (!validado.ok) return validado;

      const liberar = (id: string) => repositorio.liberarReservaPeloLink(hash, id);
      const guardado = await guardarAnexo({
        escopo,
        anexo,
        definicao,
        usoAtual: escopo.usoDeArquivosBytes,
        ler,
        reservar: ({ id, caminho }) =>
          repositorio.reservarArquivoPeloLink(hash, {
            id,
            secao: definicao.secao,
            itemId: anexo.itemId ?? null,
            caminho,
            tamanhoBytes: anexo.tamanhoDeclarado,
            cotaBytes: COTA_POR_CLIENTE,
            orcamentoBytesPorHora: ORCAMENTO_DO_LINK_BYTES_POR_HORA,
            enviosPorHora: ENVIOS_DO_LINK_POR_HORA,
          }),
        liberar,
      });
      if (!guardado.ok) {
        await registrarPublico(escopo, acesso, 'client.context.link_file_attached', {
          secao: definicao.secao,
          chave: anexo.fieldKey,
          resultado: guardado.error.details?.['motivo'] ?? guardado.error.code,
        });
        return guardado;
      }

      let resultado: ResultadoPeloLink;
      try {
        resultado = await repositorio.confirmarArquivoPeloLink(hash, {
          id: guardado.value.id,
          secao: guardado.value.secao,
          fieldKey: anexo.fieldKey,
          itemId: anexo.itemId ?? null,
          nome: anexo.nome.slice(0, 255),
          mime: guardado.value.mime,
          tamanhoBytes: guardado.value.tamanhoBytes,
          sha256: guardado.value.sha256,
        });
      } catch (erro) {
        await desfazerEnvio(guardado.value.caminho, () => liberar(guardado.value.id));
        throw erro;
      }
      await registrarPublico(escopo, acesso, 'client.context.link_file_attached', {
        secao: guardado.value.secao,
        chave: anexo.fieldKey,
        mime: guardado.value.mime,
        tamanhoBytes: guardado.value.tamanhoBytes,
        resultado,
      });
      if (resultado !== 'ok') {
        await desfazerEnvio(guardado.value.caminho, () => liberar(guardado.value.id));
        return err(falhaPeloLink(resultado, null));
      }
      mudou(escopo);
      return ok({ id: guardado.value.id, mime: guardado.value.mime });
    },

    async concluirPeloLink(acesso) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const concluidoEm = await repositorio.concluirPeloLink(aberto.value.hash);
      if (!concluidoEm) return err(LINK_INVALIDO);
      await registrarPublico(aberto.value.escopo, acesso, 'client.context.link_submitted', {});
      return ok({ concluidoEm });
    },

    publicarBrain: (escopo, opcoes) => publicarBrain(escopo, opcoes),

    async publicarPendentes(limite = 20) {
      if (!armazenamento.configurado) return { publicados: 0, inalterados: 0, falhas: 0, desativado: true };
      return publicarVarios(await repositorio.brainsPendentes(limite, ESPERA_DA_VARREDURA_S), false);
    },

    async reconstruirBrains(alvo) {
      if (!armazenamento.configurado) return ok({ publicados: 0, inalterados: 0, falhas: 0, desativado: true });
      if (alvo.tipo === 'cliente') return ok(await publicarVarios([alvo], true));
      const clientes = await repositorio.clientesParaReconstruir(alvo.tipo === 'organizacao' ? alvo.organizationId : null);
      return ok(await publicarVarios(clientes, true));
    },

    async expurgarArmazenamento(escopo, modo, executor = {}) {
      const alvo = await repositorio.alvoDoArmazenamento(escopo.organizationId, escopo.clientId);
      if (alvo !== 'excluido' && alvo !== 'expurgado') {
        return err(failure('conflict', 'Só cliente excluído logicamente ou já expurgado tem o armazenamento apagado.', { alvo }));
      }
      if (!armazenamento.configurado) return ok({ apagados: 0, modo, alvo, desativado: true });

      const prefixo = prefixoDoCliente(escopo.organizationId, escopo.clientId);
      const prefixos =
        modo === 'tudo'
          ? [prefixo]
          : [prefixoDoExportDoContexto(escopo.organizationId, escopo.clientId), prefixoDoCatalogo(escopo.organizationId, escopo.clientId)];
      let apagados = 0;
      for (const alvoDoPrefixo of prefixos) {
        const resultado = await armazenamento.deletePrefix(alvoDoPrefixo);
        if (!resultado.ok) return resultado;
        apagados += resultado.value.apagados;
      }
      if (alvo === 'excluido') await repositorio.marcarBrainDespublicado(escopo.clientId);

      await audit.record({
        organizationId: escopo.organizationId,
        actorType: 'worker',
        actorId: executor.callerFingerprint ?? null,
        action: 'client.context.storage_purged',
        targetType: 'client',
        targetId: escopo.clientId,
        ...(executor.requestId ? { requestId: executor.requestId } : {}),
        metadata: { modo, apagados, alvo },
      });
      return ok({ apagados, modo, alvo, desativado: false });
    },

    async varrerArquivos(opcoes = {}) {
      const vazio = { reservasVarridas: 0, orfaosApagados: 0, clientesListados: 0, brainsDespublicados: 0, falhas: 0 };
      if (!armazenamento.configurado) return { ...vazio, desativado: true };
      const limite = Math.min(Math.max(opcoes.limite ?? LIMITE_DA_VARREDURA, 1), 1000);
      let { reservasVarridas, orfaosApagados, falhas } = vazio;

      for (const reserva of await repositorio.reservasAVarrer(limite)) {
        const apagado = await armazenamento.delete(reserva.caminho, { todasAsVersoes: true });
        if (!apagado.ok) {
          falhas += 1;
          continue;
        }
        await repositorio.marcarReservaVarrida(reserva.id);
        reservasVarridas += 1;
      }

      const instante = agora().getTime();
      const clientes = await repositorio.clientesParaVarrerArquivos(limite, opcoes.completa ?? false);
      for (const cliente of clientes) {
        const resultado = await apagarArquivosOrfaosDoCliente(cliente, instante);
        orfaosApagados += resultado.apagados;
        falhas += resultado.falhas;
      }

      const brains = await despublicarBrainsDeExcluidos(limite);
      return {
        reservasVarridas,
        orfaosApagados,
        clientesListados: clientes.length,
        brainsDespublicados: brains.despublicados,
        falhas: falhas + brains.falhas,
        desativado: false,
      };
    },
  };
  return servico;
}
