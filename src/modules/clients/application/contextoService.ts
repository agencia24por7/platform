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
  MOTIVO_DO_ARQUIVO,
  assinaturaConfere,
  avaliarArquivo,
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
import type { ArmazenamentoDeContexto } from '@/modules/clients/application/armazenamentoDeContexto';
import { bytesDeTexto } from '@/modules/clients/application/armazenamentoDeContexto';
import type {
  ContextoRepository,
  EscopoDoLink,
  EstadoDoBrainRegistrado,
  Gravado,
  LinkDeContexto,
  ResultadoPeloLink,
  RevisaoRegistrada,
} from '@/modules/clients/infrastructure/contextoRepository';

export type EstadoDoBrain = {
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

export type NovoAnexo = {
  readonly fieldKey: string;
  readonly listKey?: string | null;
  readonly itemId?: string | null;
  readonly nome: string;
  readonly mime: string;
  readonly conteudo: Uint8Array;
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
  anexarArquivo(comando: Comando & NovoAnexo, ator: Ator): Promise<Result<ArquivoDeContexto, Failure>>;
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
  anexarArquivoPeloLink(acesso: AcessoPublico, anexo: NovoAnexo): Promise<Result<{ readonly id: string }, Failure>>;
  concluirPeloLink(acesso: AcessoPublico): Promise<Result<{ readonly concluidoEm: Date }, Failure>>;
  publicarBrain(escopo: Escopo): Promise<Result<{ readonly situacao: SituacaoDoBrain; readonly contentHash: string | null }, Failure>>;
  publicarPendentes(limite?: number): Promise<{ readonly publicados: number; readonly falhas: number }>;
  expurgarArmazenamento(escopo: Escopo): Promise<Result<{ readonly apagados: number }, Failure>>;
};

export type AgendadorDoBrain = { agendar(escopo: Escopo): void };

export type DependenciasDoContexto = {
  readonly repositorio: ContextoRepository;
  readonly audit: AuditRecorder;
  readonly armazenamento: ArmazenamentoDeContexto;
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
          publicar(escopo).catch(() => undefined);
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
    return {
      armazenamentoConfigurado: armazenamento.configurado,
      pendente: Boolean(estado && (!estado.ultimaTentativaEm || estado.solicitadoEm > estado.ultimaTentativaEm || estado.ultimoErro)),
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
      const resultado = await armazenamento.put(caminho, conteudo, { contentType, tamanhoBytes: conteudo.byteLength });
      if (resultado.ok) return ok(undefined);
      ultimo = resultado.error;
      if (tentativa < TENTATIVAS_DE_GRAVACAO) await esperar(200 * 4 ** (tentativa - 1));
    }
    return err(ultimo);
  }

  async function publicarBrain(escopo: Escopo): Promise<Result<{ situacao: SituacaoDoBrain; contentHash: string | null }, Failure>> {
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
    if (anterior?.hashExportado === brain.contentHash && anterior.versaoDoEsquema === VERSAO_DO_BRAIN) {
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
      const gravado = await gravarComRetentativa(arquivo.caminho, bytesDeTexto(arquivo.conteudo), arquivo.contentType);
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

  async function guardarAnexo(
    escopo: Escopo,
    anexo: NovoAnexo,
    usoAtual: number,
  ): Promise<Result<{ id: string; caminho: string; sha256: string; secao: Secao['key']; mime: string }, Failure>> {
    if (!armazenamento.configurado) return err(failure('unavailable', 'O envio de arquivos ainda não está disponível.'));

    const definicao = definicaoDeArquivo(anexo);
    if (!definicao) return err(failure('validation', 'Este campo não recebe arquivos.'));
    if (Boolean(anexo.listKey) !== Boolean(anexo.itemId)) {
      return err(failure('validation', 'Arquivo de item precisa da lista e do item.'));
    }
    const secao = definicao.secao;

    const avaliado = avaliarArquivo({
      nome: anexo.nome,
      mime: anexo.mime,
      tamanhoBytes: anexo.conteudo.byteLength,
      categoriasAceitas: definicao.campo.categorias,
      usoAtualDoClienteBytes: usoAtual,
    });
    if (!avaliado.ok) return err(failure('validation', MOTIVO_DO_ARQUIVO[avaliado.motivo], { motivo: avaliado.motivo }));
    if (!assinaturaConfere(avaliado.tipo, anexo.conteudo.subarray(0, 64))) {
      return err(failure('validation', MOTIVO_DO_ARQUIVO.assinatura_divergente, { motivo: 'assinatura_divergente' }));
    }

    const id = randomUUID();
    const caminho = caminhoDoArquivo(escopo.organizationId, escopo.clientId, id, anexo.nome);
    const sha256 = createHash('sha256').update(anexo.conteudo).digest('hex');
    const gravado = await armazenamento.put(caminho, anexo.conteudo, {
      contentType: avaliado.tipo.mime,
      tamanhoBytes: anexo.conteudo.byteLength,
      sha256,
    });
    if (!gravado.ok) return err(failure('unavailable', 'Não foi possível guardar o arquivo agora. Tente de novo.'));
    return ok({ id, caminho, sha256, secao, mime: avaliado.tipo.mime });
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

  function falhaPeloLink(resultado: ResultadoPeloLink, versao: number | null): Failure {
    switch (resultado) {
      case 'conflito':
        return conflito(versao);
      case 'recusado':
        return LINK_INVALIDO;
      case 'limite':
        return failure('validation', 'Esta lista chegou ao limite de itens.');
      case 'cota_excedida':
        return failure('validation', MOTIVO_DO_ARQUIVO.cota_excedida, { motivo: 'cota_excedida' });
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
      });
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
        await repositorio.inserirItem(comando.organizationId, {
          clientId: comando.clientId,
          secao: achado.secao.key,
          listKey: sugestao.listKey,
          dados: validado.dados,
          marcacao,
          autorId: ator.userId,
        });
        aplicadas += 1;
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

    async anexarArquivo(comando, ator) {
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      if (comando.itemId && !(await repositorio.lerItem(comando.organizationId, comando.clientId, comando.itemId))) {
        return err(failure('not_found', 'Item não encontrado.'));
      }
      const uso = await repositorio.usoDeArquivos(comando.organizationId, comando.clientId);
      const guardado = await guardarAnexo(comando, comando, uso);
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
          tamanhoBytes: comando.conteudo.byteLength,
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
        await armazenamento.delete(guardado.value.caminho);
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
      if (!canOperate(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const instante = agora();
      const pedido = validarPedidoDeLink(comando, instante);
      if (!pedido.ok) return err(failure('validation', MOTIVO_DO_LINK[pedido.motivo], { motivo: pedido.motivo }));

      const conviteId = comando.conviteDeIntegracaoId ?? null;
      if (conviteId) {
        const convite = await repositorio.conviteDoCliente(comando.organizationId, comando.clientId, conviteId);
        if (!convite) return err(failure('not_found', 'Convite de integração não encontrado para este cliente.'));
        if (convite.status === 'revoked' || convite.status === 'expired') {
          return err(failure('validation', 'O convite de integração não vale mais. Crie um novo convite.'));
        }
      }

      const token = gerarTokenDeContexto();
      const link = await repositorio.criarLink(comando.organizationId, {
        clientId: comando.clientId,
        tokenHash: hashDoToken(token),
        secoes: pedido.secoes,
        expiraEm: pedido.expiraEm,
        nota: pedido.nota,
        criadoPor: ator.userId,
        conviteDeIntegracaoId: conviteId,
      });
      await registrar(comando, ator, 'client.context.link_created', {
        secoes: link.secoes,
        expiraEm: link.expiraEm.toISOString(),
        comConvite: conviteId !== null,
      }, { tipo: 'client_context_link', id: link.id });
      return ok({ link: resumir(link, instante), token });
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
      if (!anterior.revogadoEm) await repositorio.revogarLink(comando.organizationId, comando.clientId, comando.linkId);

      const prazoOriginal = Math.round((anterior.expiraEm.getTime() - anterior.criadoEm.getTime()) / 86_400_000);
      const novo = await servico.criarLink(
        {
          ...comando,
          secoes: anterior.secoes,
          expiraEmDias: Math.min(Math.max(prazoOriginal, 1), 90),
          nota: anterior.nota,
          conviteDeIntegracaoId: anterior.conviteDeIntegracaoId,
        },
        ator,
      );
      if (!novo.ok) return novo;
      await registrar(comando, ator, 'client.context.link_regenerated', { anterior: anterior.id }, { tipo: 'client_context_link', id: novo.value.link.id });
      return novo;
    },

    async carregarPeloLink(acesso) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const { hash, escopo } = aberto.value;

      const visto = await repositorio.lerPeloLink(hash, chavesLegiveis(escopo.secoes));
      if (!visto) return err(LINK_INVALIDO);

      await registrarPublico(escopo, acesso, 'client.context.link_opened', { secoes: escopo.secoes });

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

    async anexarArquivoPeloLink(acesso, anexo) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const { hash, escopo } = aberto.value;

      const definicao = definicaoDeArquivo(anexo);
      if (!definicao || !chavesVisiveis(escopo.secoes).includes(definicao.chaveDoCatalogo)) {
        return err(failure('forbidden', 'Esta informação não faz parte do que foi pedido neste link.'));
      }

      const guardado = await guardarAnexo(escopo, anexo, escopo.usoDeArquivosBytes);
      if (!guardado.ok) return guardado;

      const resultado = await repositorio.registrarArquivoPeloLink(hash, {
        id: guardado.value.id,
        clientId: escopo.clientId,
        secao: guardado.value.secao,
        fieldKey: anexo.fieldKey,
        itemId: anexo.itemId ?? null,
        caminho: guardado.value.caminho,
        nome: anexo.nome.slice(0, 255),
        mime: guardado.value.mime,
        tamanhoBytes: anexo.conteudo.byteLength,
        sha256: guardado.value.sha256,
        cotaBytes: COTA_POR_CLIENTE,
      });
      await registrarPublico(escopo, acesso, 'client.context.link_file_attached', {
        secao: guardado.value.secao,
        chave: anexo.fieldKey,
        mime: guardado.value.mime,
        tamanhoBytes: anexo.conteudo.byteLength,
        resultado,
      });
      if (resultado !== 'ok') {
        await armazenamento.delete(guardado.value.caminho);
        return err(falhaPeloLink(resultado, null));
      }
      mudou(escopo);
      return ok({ id: guardado.value.id });
    },

    async concluirPeloLink(acesso) {
      const aberto = await abrirPublico(acesso);
      if (!aberto.ok) return aberto;
      const concluidoEm = await repositorio.concluirPeloLink(aberto.value.hash);
      if (!concluidoEm) return err(LINK_INVALIDO);
      await registrarPublico(aberto.value.escopo, acesso, 'client.context.link_submitted', {});
      return ok({ concluidoEm });
    },

    publicarBrain,

    async publicarPendentes(limite = 20) {
      if (!armazenamento.configurado) return { publicados: 0, falhas: 0 };
      const pendentes = await repositorio.brainsPendentes(limite, ESPERA_DA_VARREDURA_S);
      let publicados = 0;
      let falhas = 0;
      for (const escopo of pendentes) {
        const resultado = await publicarBrain(escopo).catch((erro) => err(failure('unavailable', mensagemDeErro(erro))));
        if (resultado.ok) publicados += 1;
        else falhas += 1;
      }
      return { publicados, falhas };
    },

    async expurgarArmazenamento(escopo) {
      const resultado = await armazenamento.deletePrefix(prefixoDoCliente(escopo.organizationId, escopo.clientId));
      if (!resultado.ok) return resultado;
      await audit.record({
        organizationId: escopo.organizationId,
        actorType: 'system',
        actorId: null,
        action: 'client.context.storage_purged',
        targetType: 'client',
        targetId: escopo.clientId,
        metadata: { apagados: resultado.value.apagados },
      });
      return ok(resultado.value);
    },
  };
  return servico;
}
