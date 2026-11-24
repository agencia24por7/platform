import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { MemberRole } from '@/modules/identity/domain/user';
import {
  DecisaoSchema,
  autorizar,
  compararValores,
  dataLocal,
  derivarVigentes,
  hashDoConjunto,
  statusAoRegistrar,
  superar,
  transitar,
  validarLimiteContraDefinicao,
  type Ator as AtorDeRegras,
  type Decisao,
  type DefinicaoDeLimite,
  type Papel,
  type Sentido,
  type Valor,
} from '@/modules/clients/domain/regras/index';
import type {
  ContagemDeProntidao,
  DefinicaoDoBanco,
  Gravacao,
  HistoricoDaChave,
  NovaDecisao,
  PaginaDaLinhaDoTempo,
  RegrasRepository,
  TetoDoAgente,
} from '@/modules/clients/infrastructure/regrasRepository';
import {
  EntradaDaChaveSchema,
  EntradaDeProposta,
  EntradaDeRegistroSchema,
  EntradaDeRevogacaoSchema,
  EntradaDeSuperacaoSchema,
  EntradaDoAgenteSchema,
  FiltrosDaLinhaDoTempoSchema,
  detalhesDoZod,
  type EntradaDaChave,
  type EntradaDeDecisaoDeProposta,
  type EntradaDeRegistro,
  type EntradaDeRevogacao,
  type EntradaDeSuperacao,
  type EntradaDoAgente,
  type FiltrosDaLinhaDoTempoEntrada,
} from '@/modules/clients/application/regrasEntradas';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type EscopoDoCliente = {
  readonly organizationId: string;
  readonly clientId: string;
};

export type ComandoDeRegras = EscopoDoCliente & { readonly papelDeQuemAge: MemberRole };

export type ConjuntoParaAgente = {
  readonly decisoes: readonly Decisao[];
  readonly conflitos: readonly Decisao[];
  readonly definicoes: readonly DefinicaoDoBanco[];
  readonly hash: string;
  readonly geradoEm: Date;
};

export type VigentesDoCliente = {
  readonly decisoes: readonly Decisao[];
  readonly conflitos: readonly Decisao[];
  readonly hash: string;
};

export type DecisaoDoAgente = {
  readonly decisao: Decisao;
  readonly repetida: boolean;
};

export type OrigemDoAgente = { readonly requestId?: string };

export type RegrasService = {
  registrar(comando: ComandoDeRegras, entrada: EntradaDeRegistro, ator: Ator): Promise<Result<Decisao, Failure>>;
  superar(comando: ComandoDeRegras, entrada: EntradaDeSuperacao, ator: Ator): Promise<Result<Decisao, Failure>>;
  revogar(comando: ComandoDeRegras, entrada: EntradaDeRevogacao, ator: Ator): Promise<Result<Decisao, Failure>>;
  efetivarProposta(
    comando: ComandoDeRegras,
    entrada: EntradaDeDecisaoDeProposta,
    ator: Ator,
  ): Promise<Result<Decisao, Failure>>;
  rejeitarProposta(
    comando: ComandoDeRegras,
    entrada: EntradaDeDecisaoDeProposta,
    ator: Ator,
  ): Promise<Result<Decisao, Failure>>;
  registrarPorAgente(
    escopo: EscopoDoCliente,
    entrada: EntradaDoAgente,
    origem?: OrigemDoAgente,
  ): Promise<Result<DecisaoDoAgente, Failure>>;
  listarVigentes(escopo: EscopoDoCliente): Promise<Result<VigentesDoCliente, Failure>>;
  linhaDoTempo(
    escopo: EscopoDoCliente,
    filtros?: FiltrosDaLinhaDoTempoEntrada,
  ): Promise<Result<PaginaDaLinhaDoTempo, Failure>>;
  historicoDaChave(escopo: EscopoDoCliente, entrada: EntradaDaChave): Promise<Result<readonly HistoricoDaChave[], Failure>>;
  listarPropostas(escopo: EscopoDoCliente): Promise<Result<readonly Decisao[], Failure>>;
  filaDeRevisao(escopo: EscopoDoCliente): Promise<Result<readonly Decisao[], Failure>>;
  listarDefinicoes(escopo: Pick<EscopoDoCliente, 'organizationId'>): Promise<Result<readonly DefinicaoDoBanco[], Failure>>;
  detalhe(
    escopo: EscopoDoCliente,
    alvo: { readonly id: string } | { readonly numero: number },
  ): Promise<Result<Decisao, Failure>>;
  prontidao(escopo: EscopoDoCliente): Promise<Result<ContagemDeProntidao, Failure>>;
  conjuntoParaAgente(escopo: EscopoDoCliente): Promise<Result<ConjuntoParaAgente, Failure>>;
};

export type DependenciasDeRegras = {
  readonly repositorio: RegrasRepository;
  readonly audit: AuditRecorder;
  readonly agora?: () => Date;
  readonly agendarBrain?: (escopo: EscopoDoCliente) => void;
  readonly tetoPorExecucao?: number;
  readonly tetoPorClientePorDia?: number;
};

export const TETO_PADRAO_POR_EXECUCAO = 50;
export const TETO_PADRAO_POR_CLIENTE_POR_DIA = 200;

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const RESTRICAO_DA_IDEMPOTENCIA = 'client_decisions_idempotencia';

const CLIENTE_NAO_ENCONTRADO = failure('not_found', 'Cliente não encontrado.');
const DECISAO_NAO_ENCONTRADA = failure('not_found', 'Decisão não encontrada.');
const SEM_PERMISSAO = failure('forbidden', 'Seu papel não permite esta ação sobre regras do cliente.');
const ALGUEM_ALTEROU = failure('conflict', 'Alguém alterou antes. Recarregue para ver a versão atual.');

type CodigoDeErroDeDominio = string;

function papelDeRegras(papel: MemberRole): Papel {
  return papel === 'owner' ? 'admin' : papel;
}

function falhaDeDominio(codigo: CodigoDeErroDeDominio, mensagem: string): Failure {
  if (codigo === 'sem_permissao' || codigo === 'agente_nao_declara_esta_decisao') {
    return failure('forbidden', mensagem, { codigo });
  }
  if (codigo === 'transicao_invalida' || codigo === 'anterior_nao_vigente') {
    return failure('conflict', mensagem, { codigo });
  }
  return failure('validation', mensagem, { codigo });
}

function fimExclusivo(dataInclusiva: string): Date {
  return new Date(Date.parse(`${dataInclusiva}T00:00:00.000Z`) + UM_DIA_MS);
}

function paraDefinicaoDeDominio(definicao: DefinicaoDoBanco, escopo: string): DefinicaoDeLimite {
  const tipo = escopo === 'cliente' ? 'cliente' : 'plataforma';
  return { ...definicao, escoposAceitos: definicao.tiposDeEscopo.includes(tipo) ? [escopo] : [] };
}

function flexibilizou(anterior: Valor, nova: Valor, sentido: Sentido): boolean {
  const comparacao = compararValores(nova, anterior);
  if (!comparacao.ok) return true;
  return sentido === 'teto' ? comparacao.value > 0 : comparacao.value < 0;
}

function diaDe(instante: Date): string {
  return instante.toISOString().slice(0, 10);
}

const ALTERACAO_FUTURA = failure(
  'validation',
  'A alteração passa a valer hoje: a anterior deixa de valer no mesmo instante. Para uma mudança futura, registre-a na data.',
  { vigenciaInicio: 'Alteração não pode começar no futuro.' },
);

function erroDeSemPermissaoDoBanco(erro: unknown): boolean {
  return (erro as { code?: unknown } | null)?.code === '42501';
}

type Conteudo = {
  readonly categoria: Decisao['categoria'];
  readonly natureza: Decisao['natureza'];
  readonly origem: Decisao['origem'];
  readonly forca: Decisao['forca'];
  readonly chave: string | null;
  readonly escopo: string;
  readonly titulo: string | null;
  readonly contexto: string | null;
  readonly texto: string | null;
  readonly valor: Valor | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly status: 'proposta' | 'vigente';
  readonly supersedesId: string | null;
  readonly decididoPor: string | null;
  readonly emNomeDe: string | null;
  readonly evidencia: string | null;
  readonly semConfirmacaoDoAnunciante: boolean;
  readonly agentId: string | null;
  readonly agentRunId: string | null;
  readonly agentSetHash: string | null;
  readonly chaveDeIdempotencia: string | null;
};

export function createRegrasService(deps: DependenciasDeRegras): RegrasService {
  const { repositorio, audit } = deps;
  const agora = deps.agora ?? (() => new Date());
  const tetoPorExecucao = deps.tetoPorExecucao ?? TETO_PADRAO_POR_EXECUCAO;
  const tetoPorClientePorDia = deps.tetoPorClientePorDia ?? TETO_PADRAO_POR_CLIENTE_POR_DIA;

  const aposMudanca = (escopo: EscopoDoCliente) => {
    try {
      deps.agendarBrain?.(escopo);
    } catch {
      return;
    }
  };

  const auditarPessoa = (
    escopo: EscopoDoCliente,
    ator: Ator,
    action: string,
    decisao: Decisao,
    extra: Record<string, unknown> = {},
  ) =>
    registrarSemFalhar(audit, {
      organizationId: escopo.organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action,
      targetType: 'client_decision',
      targetId: decisao.id,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata: metadadosSemConteudo(escopo, decisao, extra),
    } satisfies AuditEvent);

  const auditarAgente = (
    escopo: EscopoDoCliente,
    agenteId: string,
    requestId: string,
    decisao: Decisao,
  ) =>
    registrarSemFalhar(audit, {
      organizationId: escopo.organizationId,
      actorType: 'agent',
      actorId: agenteId,
      action: 'client.rule.registered',
      targetType: 'client_decision',
      targetId: decisao.id,
      requestId,
      sourceIp: null,
      metadata: metadadosSemConteudo(escopo, decisao, { execucaoId: decisao.agentRunId }),
    } satisfies AuditEvent);

  function metadadosSemConteudo(escopo: EscopoDoCliente, decisao: Decisao, extra: Record<string, unknown>) {
    return {
      clientId: escopo.clientId,
      numero: decisao.numero,
      chave: decisao.chave,
      escopo: decisao.escopo,
      natureza: decisao.natureza,
      categoria: decisao.categoria,
      origem: decisao.origem,
      status: decisao.status,
      ...extra,
    };
  }

  async function clienteVisivel(escopo: EscopoDoCliente): Promise<Result<true, Failure>> {
    return (await repositorio.clienteVisivel(escopo.organizationId, escopo.clientId)) ? ok(true) : err(CLIENTE_NAO_ENCONTRADO);
  }

  async function protegido<T>(trabalho: () => Promise<Result<T, Failure>>): Promise<Result<T, Failure>> {
    try {
      return await trabalho();
    } catch (erro) {
      if (erroDeSemPermissaoDoBanco(erro)) return err(SEM_PERMISSAO);
      throw erro;
    }
  }

  function falhaDeTeto(teto: TetoDoAgente): Failure {
    return teto === 'execucao'
      ? failure('rate_limited', 'Teto de decisões desta execução atingido.', { teto: String(tetoPorExecucao) })
      : failure('rate_limited', 'Teto diário de decisões de agentes para este cliente atingido.', {
          teto: String(tetoPorClientePorDia),
        });
  }

  function gravada(resultado: Gravacao<Decisao>): Result<Decisao, Failure> {
    if (resultado.ok) return ok(resultado.valor);
    return err(resultado.motivo === 'teto' ? falhaDeTeto(resultado.teto) : ALGUEM_ALTEROU);
  }

  const hoje = () => dataLocal(agora());

  async function conferirEfetivacao(
    comando: ComandoDeRegras,
    proposta: Decisao,
    motivo: string | null,
  ): Promise<Result<{ readonly flexibilizaSemEvidencia: boolean }, Failure>> {
    if (proposta.vigenciaFim !== null && proposta.vigenciaFim.getTime() <= agora().getTime()) {
      return err(failure('validation', 'A vigência desta proposta já terminou: ela não pode ser efetivada.', { vigenciaFim: 'vencida' }));
    }
    if (proposta.supersedesId !== null && diaDe(proposta.vigenciaInicio) > hoje()) return err(ALTERACAO_FUTURA);
    if (proposta.natureza !== 'limite') return ok({ flexibilizaSemEvidencia: false });

    const definicoes = await repositorio.listarDefinicoes(comando.organizationId, { todasAsVersoes: true });
    const definicao = definicoes.find(
      (d) => d.key === proposta.definicaoChave && d.version === proposta.definicaoVersao,
    );
    if (!definicao || !definicao.ativo || proposta.chave === null || proposta.valor === null) {
      return err(
        failure('validation', 'O tipo deste limite foi desativado: a proposta não pode ser efetivada.', {
          chave: 'definição desativada',
        }),
      );
    }
    const conferido = validarLimiteContraDefinicao(paraDefinicaoDeDominio(definicao, proposta.escopo), {
      categoria: proposta.categoria,
      escopo: proposta.escopo,
      valor: proposta.valor,
    });
    if (!conferido.ok) return err(failure('validation', conferido.error.mensagem, { valor: conferido.error.codigo }));

    const anterior = proposta.supersedesId
      ? await repositorio.buscarPorId(comando.organizationId, comando.clientId, proposta.supersedesId)
      : await repositorio.vigenteDaChave(comando.organizationId, comando.clientId, 'limite', proposta.chave, proposta.escopo);
    const relaxa =
      anterior !== null && anterior.status === 'vigente' && anterior.valor !== null
        ? flexibilizou(anterior.valor, proposta.valor, definicao.sentido)
        : false;
    const flexibilizaSemEvidencia = relaxa && proposta.evidencia === null;
    if (flexibilizaSemEvidencia && (motivo === null || motivo.trim().length < 3)) {
      return err(
        failure('validation', 'Esta proposta afrouxa o limite vigente sem evidência: informe o motivo da efetivação.', {
          motivo: 'obrigatório (mínimo 3 caracteres)',
        }),
      );
    }
    return ok({ flexibilizaSemEvidencia });
  }

  async function conferirLimite(
    organizationId: string,
    conteudo: Pick<Conteudo, 'natureza' | 'categoria' | 'chave' | 'escopo' | 'valor'>,
  ): Promise<Result<DefinicaoDoBanco | null, Failure>> {
    if (conteudo.natureza !== 'limite') return ok(null);
    if (conteudo.chave === null || conteudo.valor === null) {
      return err(failure('validation', 'Limite exige chave e valor.', { chave: 'obrigatória' }));
    }
    const definicao = await repositorio.definicaoAtiva(organizationId, conteudo.chave);
    if (!definicao) {
      return err(failure('validation', 'Tipo de limite desconhecido ou desativado.', { chave: 'definição inexistente' }));
    }
    const conferido = validarLimiteContraDefinicao(paraDefinicaoDeDominio(definicao, conteudo.escopo), {
      categoria: conteudo.categoria,
      escopo: conteudo.escopo,
      valor: conteudo.valor,
    });
    if (!conferido.ok) {
      return err(failure('validation', conferido.error.mensagem, { valor: conferido.error.codigo }));
    }
    return ok(definicao);
  }

  function montarDecisao(
    escopo: EscopoDoCliente,
    conteudo: Conteudo,
    definicao: DefinicaoDoBanco | null,
  ): Result<{ readonly decisao: Decisao; readonly nova: NovaDecisao }, Failure> {
    const titulo = conteudo.titulo ?? definicao?.nome ?? null;
    const agoraDaChamada = agora();
    const rascunho = {
      id: 'novo',
      clienteId: escopo.clientId,
      numero: 1,
      categoria: conteudo.categoria,
      natureza: conteudo.natureza,
      origem: conteudo.origem,
      forca: conteudo.forca,
      chave: conteudo.chave,
      escopo: conteudo.escopo,
      titulo,
      contexto: conteudo.contexto,
      texto: conteudo.texto,
      valor: conteudo.valor,
      vigenciaInicio: conteudo.vigenciaInicio ? new Date(`${conteudo.vigenciaInicio}T00:00:00.000Z`) : agoraDaChamada,
      vigenciaFim: conteudo.vigenciaFim ? fimExclusivo(conteudo.vigenciaFim) : null,
      status: conteudo.status,
      supersedesId: conteudo.supersedesId,
      decididoPor: conteudo.decididoPor,
      emNomeDe: conteudo.emNomeDe,
      evidencia: conteudo.evidencia,
      semConfirmacaoDoAnunciante: conteudo.semConfirmacaoDoAnunciante,
      viaLinkId: null,
      agentId: conteudo.agentId,
      agentRunId: conteudo.agentRunId,
      agentSetHash: conteudo.agentSetHash,
      chaveDeIdempotencia: conteudo.chaveDeIdempotencia,
      definicaoChave: definicao?.key ?? null,
      definicaoVersao: definicao?.version ?? null,
      revisarEConverterEmLimite: false,
      motivoDaRevogacao: null,
      criadoEm: agoraDaChamada,
    };
    const parse = DecisaoSchema.safeParse(rascunho);
    if (!parse.success) {
      return err(failure('validation', 'Dados inválidos.', detalhesDoZod(parse.error)));
    }
    const decisao = parse.data;
    return ok({
      decisao,
      nova: {
        clienteId: escopo.clientId,
        categoria: decisao.categoria,
        natureza: decisao.natureza,
        origem: decisao.origem,
        forca: decisao.forca,
        chave: decisao.chave,
        escopo: decisao.escopo,
        titulo: decisao.titulo,
        contexto: decisao.contexto,
        texto: decisao.texto,
        valor: decisao.valor,
        vigenciaInicio: conteudo.vigenciaInicio,
        vigenciaFimInclusivo: conteudo.vigenciaFim,
        status: conteudo.status,
        supersedesId: decisao.supersedesId,
        decididoPor: decisao.decididoPor,
        emNomeDe: decisao.emNomeDe,
        evidencia: decisao.evidencia,
        semConfirmacaoDoAnunciante: decisao.semConfirmacaoDoAnunciante,
        agentId: decisao.agentId,
        agentRunId: decisao.agentRunId,
        agentSetHash: decisao.agentSetHash,
        chaveDeIdempotencia: decisao.chaveDeIdempotencia,
        definicaoChave: decisao.definicaoChave,
        definicaoVersao: decisao.definicaoVersao,
      },
    });
  }

  function atorDaAgencia(papel: MemberRole): AtorDeRegras {
    return { origem: 'agencia', papel: papelDeRegras(papel) };
  }

  function recusaPorPapel(papel: MemberRole): boolean {
    return papelDeRegras(papel) === 'viewer';
  }

  const conteudoVazio = {
    contexto: null,
    emNomeDe: null,
    agentId: null,
    agentRunId: null,
    agentSetHash: null,
    chaveDeIdempotencia: null,
    supersedesId: null,
  } as const;

  async function registrar(
    comando: ComandoDeRegras,
    entrada: EntradaDeRegistro,
    ator: Ator,
  ): Promise<Result<Decisao, Failure>> {
    if (recusaPorPapel(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const parse = EntradaDeRegistroSchema.safeParse(entrada);
    if (!parse.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(parse.error)));
    const dados = parse.data;

    const status = statusAoRegistrar(atorDaAgencia(comando.papelDeQuemAge), {
      natureza: dados.natureza,
      categoria: dados.categoria,
    });
    if (!status.ok) return err(falhaDeDominio(status.error.codigo, status.error.mensagem));

    return protegido(async () => {
      const visivel = await clienteVisivel(comando);
      if (!visivel.ok) return visivel;

      const definicao = await conferirLimite(comando.organizationId, { ...dados });
      if (!definicao.ok) return definicao;

      if (dados.chave !== null && dados.natureza !== 'decisao') {
        const existente = await repositorio.vigenteDaChave(
          comando.organizationId,
          comando.clientId,
          dados.natureza,
          dados.chave,
          dados.escopo,
        );
        if (existente) {
          return err(
            failure('conflict', 'Já existe uma decisão vigente com esta chave e escopo. Use Alterar.', {
              vigenteId: existente.id,
              vigenteNumero: String(existente.numero),
            }),
          );
        }
      }

      const montada = montarDecisao(
        comando,
        {
          ...conteudoVazio,
          ...dados,
          forca: dados.forca ?? 'dura',
          origem: 'agencia',
          status: status.value,
          decididoPor: ator.userId,
          semConfirmacaoDoAnunciante: dados.natureza === 'limite' && dados.evidencia === null,
        },
        definicao.value,
      );
      if (!montada.ok) return montada;

      const gravacao = await repositorio.inserirDecisao(comando.organizationId, montada.value.nova, ator.requestId);
      const resultado = gravada(gravacao);
      if (!resultado.ok) return resultado;

      await auditarPessoa(comando, ator, 'client.rule.registered', resultado.value);
      aposMudanca(comando);
      return resultado;
    });
  }

  async function superarDecisao(
    comando: ComandoDeRegras,
    entrada: EntradaDeSuperacao,
    ator: Ator,
  ): Promise<Result<Decisao, Failure>> {
    if (recusaPorPapel(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const parse = EntradaDeSuperacaoSchema.safeParse(entrada);
    if (!parse.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(parse.error)));
    const dados = parse.data;

    return protegido(async () => {
      const anterior = await repositorio.buscarPorId(comando.organizationId, comando.clientId, dados.decisaoId);
      if (!anterior) return err(DECISAO_NAO_ENCONTRADA);

      const ator0 = atorDaAgencia(comando.papelDeQuemAge);
      const permitido = autorizar(ator0, 'superar', anterior.natureza);
      if (!permitido.ok) return err(falhaDeDominio(permitido.error.codigo, permitido.error.mensagem));

      if (anterior.natureza === 'limite' && dados.motivo === null) {
        return err(failure('validation', 'Informe o motivo da mudança do limite.', { motivo: 'obrigatório' }));
      }
      if (dados.vigenciaInicio !== null && dados.vigenciaInicio > hoje()) return err(ALTERACAO_FUTURA);

      const valor = dados.valor ?? anterior.valor;
      const definicao = await conferirLimite(comando.organizationId, {
        natureza: anterior.natureza,
        categoria: anterior.categoria,
        chave: anterior.chave,
        escopo: anterior.escopo,
        valor,
      });
      if (!definicao.ok) return definicao;

      const evidencia = dados.evidencia;
      const relaxou =
        definicao.value !== null && anterior.valor !== null && valor !== null
          ? flexibilizou(anterior.valor, valor, definicao.value.sentido)
          : false;

      const montada = montarDecisao(
        comando,
        {
          ...conteudoVazio,
          categoria: anterior.categoria,
          natureza: anterior.natureza,
          origem: 'agencia',
          forca: dados.forca ?? anterior.forca,
          chave: anterior.chave,
          escopo: anterior.escopo,
          titulo: dados.titulo ?? anterior.titulo,
          contexto: dados.motivo ?? anterior.contexto,
          texto: dados.texto ?? anterior.texto,
          valor,
          vigenciaInicio: dados.vigenciaInicio,
          vigenciaFim: dados.vigenciaFim,
          status: 'vigente',
          decididoPor: ator.userId,
          emNomeDe: dados.emNomeDe,
          evidencia,
          semConfirmacaoDoAnunciante: anterior.natureza === 'limite' && relaxou && evidencia === null,
        },
        definicao.value,
      );
      if (!montada.ok) return montada;

      const troca = superar(ator0, anterior, montada.value.decisao);
      if (!troca.ok) return err(falhaDeDominio(troca.error.codigo, troca.error.mensagem));

      const gravacao = await repositorio.inserirDecisao(
        comando.organizationId,
        { ...montada.value.nova, supersedesId: anterior.id },
        ator.requestId,
      );
      const resultado = gravada(gravacao);
      if (!resultado.ok) return resultado;

      await auditarPessoa(comando, ator, 'client.rule.superseded', resultado.value, {
        anteriorId: anterior.id,
        anteriorNumero: anterior.numero,
      });
      aposMudanca(comando);
      return resultado;
    });
  }

  async function transitarDecisao(
    comando: ComandoDeRegras,
    entrada: { readonly decisaoId: string; readonly motivo: string | null },
    ator: Ator,
    acao: 'revogar' | 'efetivar' | 'rejeitar',
  ): Promise<Result<Decisao, Failure>> {
    if (recusaPorPapel(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);

    return protegido(async () => {
      const atual = await repositorio.buscarPorId(comando.organizationId, comando.clientId, entrada.decisaoId);
      if (!atual) return err(DECISAO_NAO_ENCONTRADA);

      const destino = transitar(atorDaAgencia(comando.papelDeQuemAge), atual.status, acao, atual.natureza);
      if (!destino.ok) return err(falhaDeDominio(destino.error.codigo, destino.error.mensagem));

      let flexibilizaSemEvidencia = false;
      if (acao === 'efetivar') {
        const conferida = await conferirEfetivacao(comando, atual, entrada.motivo);
        if (!conferida.ok) return conferida;
        flexibilizaSemEvidencia = conferida.value.flexibilizaSemEvidencia;
      }

      const tipo = acao === 'revogar' ? 'revogada' : acao === 'efetivar' ? 'efetivada' : 'rejeitada';
      const gravacao = await repositorio.inserirEvento(
        comando.organizationId,
        {
          clienteId: comando.clientId,
          decisaoId: atual.id,
          tipo,
          atorTipo: 'usuario',
          atorUsuarioId: ator.userId,
          motivo: entrada.motivo,
        },
        ator.requestId,
      );
      const resultado = gravada(gravacao);
      if (!resultado.ok) return resultado;

      const action =
        acao === 'revogar'
          ? 'client.rule.revoked'
          : acao === 'efetivar'
            ? 'client.rule.proposal_accepted'
            : 'client.rule.proposal_rejected';
      await auditarPessoa(comando, ator, action, resultado.value, {
        motivoInformado: entrada.motivo !== null,
        ...(acao === 'efetivar' ? { flexibilizaSemEvidencia } : {}),
      });
      if (acao !== 'rejeitar') aposMudanca(comando);
      return resultado;
    });
  }

  async function revogar(
    comando: ComandoDeRegras,
    entrada: EntradaDeRevogacao,
    ator: Ator,
  ): Promise<Result<Decisao, Failure>> {
    if (recusaPorPapel(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const parse = EntradaDeRevogacaoSchema.safeParse(entrada);
    if (!parse.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(parse.error)));
    return transitarDecisao(comando, parse.data, ator, 'revogar');
  }

  async function decidirProposta(
    comando: ComandoDeRegras,
    entrada: EntradaDeDecisaoDeProposta,
    ator: Ator,
    acao: 'efetivar' | 'rejeitar',
  ): Promise<Result<Decisao, Failure>> {
    if (recusaPorPapel(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
    const parse = EntradaDeProposta.safeParse(entrada);
    if (!parse.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(parse.error)));
    return transitarDecisao(comando, parse.data, ator, acao);
  }

  async function registrarPorAgente(
    escopo: EscopoDoCliente,
    entrada: EntradaDoAgente,
    origem: OrigemDoAgente = {},
  ): Promise<Result<DecisaoDoAgente, Failure>> {
    const parse = EntradaDoAgenteSchema.safeParse(entrada);
    if (!parse.success) return err(failure('validation', 'Dados inválidos.', detalhesDoZod(parse.error)));
    const dados = parse.data;
    const requestId = origem.requestId ?? `agente:${dados.execucaoId}`;

    const status = statusAoRegistrar({ origem: 'agente' }, { natureza: dados.natureza, categoria: dados.categoria });
    if (!status.ok) return err(falhaDeDominio(status.error.codigo, status.error.mensagem));

    return protegido<DecisaoDoAgente>(async () => {
      const visivel = await clienteVisivel(escopo);
      if (!visivel.ok) return visivel;

      const existente = await repositorio.buscarPorIdempotencia(
        escopo.organizationId,
        escopo.clientId,
        dados.agenteId,
        dados.idempotencyKey,
      );
      if (existente) return ok<DecisaoDoAgente>({ decisao: existente, repetida: true });

      const contagem = await repositorio.contarDoAgente(
        escopo.organizationId,
        escopo.clientId,
        dados.execucaoId,
        new Date(agora().getTime() - UM_DIA_MS),
      );
      if (contagem.naExecucao >= tetoPorExecucao) {
        return err(failure('rate_limited', 'Teto de decisões desta execução atingido.', { teto: String(tetoPorExecucao) }));
      }
      if (contagem.noPeriodo >= tetoPorClientePorDia) {
        return err(
          failure('rate_limited', 'Teto diário de decisões de agentes para este cliente atingido.', {
            teto: String(tetoPorClientePorDia),
          }),
        );
      }

      const definicao = await conferirLimite(escopo.organizationId, { ...dados });
      if (!definicao.ok) return definicao;

      let supersedesId: string | null = null;
      if (dados.chave !== null && dados.natureza !== 'decisao') {
        const vigente = await repositorio.vigenteDaChave(
          escopo.organizationId,
          escopo.clientId,
          dados.natureza,
          dados.chave,
          dados.escopo,
        );
        supersedesId = vigente?.id ?? null;
      }
      if (supersedesId !== null && dados.vigenciaInicio !== null && dados.vigenciaInicio > hoje()) return err(ALTERACAO_FUTURA);

      const montada = montarDecisao(
        escopo,
        {
          ...conteudoVazio,
          ...dados,
          forca: dados.forca ?? 'dura',
          origem: 'agente',
          status: status.value,
          supersedesId,
          decididoPor: null,
          emNomeDe: null,
          semConfirmacaoDoAnunciante: false,
          agentId: dados.agenteId,
          agentRunId: dados.execucaoId,
          agentSetHash: dados.hashDoConjuntoLido,
          chaveDeIdempotencia: dados.idempotencyKey,
        },
        definicao.value,
      );
      if (!montada.ok) return montada;

      const gravacao = await repositorio.inserirDecisao(escopo.organizationId, montada.value.nova, requestId, {
        porExecucao: tetoPorExecucao,
        porDia: tetoPorClientePorDia,
      });
      if (!gravacao.ok) {
        if (gravacao.motivo === 'teto') return err(falhaDeTeto(gravacao.teto));
        if (gravacao.restricao === RESTRICAO_DA_IDEMPOTENCIA) {
          const concorrente = await repositorio.buscarPorIdempotencia(
            escopo.organizationId,
            escopo.clientId,
            dados.agenteId,
            dados.idempotencyKey,
          );
          if (concorrente) return ok<DecisaoDoAgente>({ decisao: concorrente, repetida: true });
        }
        return err(ALGUEM_ALTEROU);
      }

      await auditarAgente(escopo, dados.agenteId, requestId, gravacao.valor);
      if (gravacao.valor.status === 'vigente') aposMudanca(escopo);
      return ok<DecisaoDoAgente>({ decisao: gravacao.valor, repetida: false });
    });
  }

  async function listarVigentes(escopo: EscopoDoCliente): Promise<Result<VigentesDoCliente, Failure>> {
    const visivel = await clienteVisivel(escopo);
    if (!visivel.ok) return visivel;
    const lista = await repositorio.listarVigentes(escopo.organizationId, escopo.clientId);
    const conjunto = derivarVigentes(lista, agora());
    return ok({ decisoes: conjunto.decisoes, conflitos: conjunto.conflitos, hash: hashDoConjunto(conjunto.decisoes) });
  }

  async function linhaDoTempo(
    escopo: EscopoDoCliente,
    filtros: FiltrosDaLinhaDoTempoEntrada = {},
  ): Promise<Result<PaginaDaLinhaDoTempo, Failure>> {
    const parse = FiltrosDaLinhaDoTempoSchema.safeParse(filtros);
    if (!parse.success) return err(failure('validation', 'Filtro inválido.', detalhesDoZod(parse.error)));
    const visivel = await clienteVisivel(escopo);
    if (!visivel.ok) return visivel;
    return ok(await repositorio.linhaDoTempo(escopo.organizationId, escopo.clientId, parse.data));
  }

  async function historicoDaChave(
    escopo: EscopoDoCliente,
    entrada: EntradaDaChave,
  ): Promise<Result<readonly HistoricoDaChave[], Failure>> {
    const parse = EntradaDaChaveSchema.safeParse(entrada);
    if (!parse.success) return err(failure('validation', 'Chave inválida.', detalhesDoZod(parse.error)));
    const visivel = await clienteVisivel(escopo);
    if (!visivel.ok) return visivel;
    return ok(
      await repositorio.historicoDaChave(escopo.organizationId, escopo.clientId, parse.data.chave, parse.data.escopo),
    );
  }

  async function listarComVisibilidade(
    escopo: EscopoDoCliente,
    ler: () => Promise<readonly Decisao[]>,
  ): Promise<Result<readonly Decisao[], Failure>> {
    const visivel = await clienteVisivel(escopo);
    if (!visivel.ok) return visivel;
    return ok(await ler());
  }

  return {
    registrar,
    superar: superarDecisao,
    revogar,
    efetivarProposta: (comando, entrada, ator) => decidirProposta(comando, entrada, ator, 'efetivar'),
    rejeitarProposta: (comando, entrada, ator) => decidirProposta(comando, entrada, ator, 'rejeitar'),
    registrarPorAgente,
    listarVigentes,
    linhaDoTempo,
    historicoDaChave,
    listarPropostas: (escopo) =>
      listarComVisibilidade(escopo, () => repositorio.listarPropostas(escopo.organizationId, escopo.clientId)),
    filaDeRevisao: (escopo) =>
      listarComVisibilidade(escopo, () => repositorio.filaDeRevisao(escopo.organizationId, escopo.clientId)),
    async listarDefinicoes(escopo) {
      return ok(await repositorio.listarDefinicoes(escopo.organizationId));
    },
    async detalhe(escopo, alvo) {
      const decisao =
        'id' in alvo
          ? await repositorio.buscarPorId(escopo.organizationId, escopo.clientId, alvo.id)
          : await repositorio.buscarPorNumero(escopo.organizationId, escopo.clientId, alvo.numero);
      return decisao ? ok(decisao) : err(DECISAO_NAO_ENCONTRADA);
    },
    async prontidao(escopo) {
      const visivel = await clienteVisivel(escopo);
      if (!visivel.ok) return visivel;
      return ok(await repositorio.contagemParaProntidao(escopo.organizationId, escopo.clientId));
    },
    async conjuntoParaAgente(escopo) {
      const visivel = await clienteVisivel(escopo);
      if (!visivel.ok) return visivel;
      const [lista, definicoes] = await Promise.all([
        repositorio.listarVigentes(escopo.organizationId, escopo.clientId),
        repositorio.listarDefinicoes(escopo.organizationId, { todasAsVersoes: true }),
      ]);
      const geradoEm = agora();
      const conjunto = derivarVigentes(lista, geradoEm);
      return ok({
        decisoes: conjunto.decisoes,
        conflitos: conjunto.conflitos,
        definicoes,
        hash: hashDoConjunto(conjunto.decisoes),
        geradoEm,
      });
    },
  };
}
