import { z } from 'zod';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import { textoSeguro } from '@/modules/brain/domain/privacidade';
import {
  PERSONAS,
  SCHEMA_VERSION,
  combinarReferencias,
  consolidarPareceres,
  esquemaAjuste,
  esquemaDoGrupo,
  esquemaDaMidiaDaPlataforma,
  esquemaIntencao,
  mesclarMidiaDaPlataforma,
  secoesDoGrupo,
  secoesDoPlano,
  planoParaOGateDeModelo,
  problemasDaPlataforma,
  catalogoDaPlataforma,
  CATALOGOS_DISPONIVEIS,
  INDICE_DO_PLANO_DE_MIDIA,
  urnsCitadasNasSecoes,
  urnsDeRegraOuLimite,
  type CatalogoDeCampos,
  type Plataforma,
  esquemaParecer,
  esquemaRespostaDoAjuste,
  gruposDaPendenciaDoGate,
  grupoDoTrecho,
  hashesDoPacote,
  lerPlano,
  montarPlanoDeSecoes,
  pacoteParaEntrada,
  payloadDoGate,
  parecerSemDadoPessoal,
  planoSemDadoPessoal,
  problemasDoGateSemDadoPessoal,
  problemasDoRascunho,
  respostasDoAjusteSemDadoPessoal,
  sanitizarIntencao,
  referenciasDoPlano,
  referenciasImplicitasDoPacote,
  rodarGates,
  validarAjuste,
  GRUPOS_DE_REDACAO,
  CHAVE_NAO_FAREMOS_PRESERVADO,
  argumentosParaAplicar,
  checagensCorrigiveis,
  conferirAjusteContraOJuiz,
  conferirVereditos,
  destinosDosPontos,
  esquemaSaidaDoJuiz,
  falhasDoGate,
  pontosParaJulgar,
  respostasDeRecusaDoJuiz,
  restaurarNaoFaremos,
  vereditosDoEvento,
  INDICE_DO_ULTIMO_GRUPO,
  MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA,
  abreviarUrnsParaCodigos,
  codigosDoPacote,
  esquemaQueAceitaCodigos,
  type CodigosDoPacote,
  MAXIMO_DE_ENTRADAS_NO_PACOTE,
  type Ajuste,
  type ChecagemReprovada,
  type EventoDaCadeia,
  type ProblemaDoModelo,
  type VereditoDoJuiz,
  type Argumento,
  type Intencao,
  type PacoteDeLeitura,
  type Parecer,
  type PendenciaObrigatoria,
  type Persona,
  type Plano,
  type RespostaDoAjuste,
  type SecoesRedigidas,
  type StatusDaVersao,
  type TipoDeEvento,
} from '@/modules/strategy/domain/index';
import { carregarCadeia, pareceresDe, versaoDaRaizDaCadeia } from '@/modules/strategy/application/cadeiaDoComite';
import {
  INSTRUCAO_DO_GATE_POR_MODELO,
  INSTRUCAO_DO_JUIZ,
  TAREFA_PARA_CORRIGIR_O_GATE,
  TAREFA_PARA_AJUSTAR_AO_COMITE,
  TAREFA_PARA_AJUSTAR_PLANO,
  TAREFA_PARA_ATUALIZAR_AO_BRAIN,
  TAREFA_PARA_CRIAR_PLANO,
  instrucaoDaPersona,
  instrucaoDoGrupo,
  instrucaoDoPlanoDeMidia,
} from '@/modules/strategy/application/instrucoes/index';
import { MAXIMO_DE_RESERVAS } from '@/modules/strategy/application/portas';
import type {
  AvaliadorDeLimites,
  CatalogoDeLimites,
  CodigoDeErroDaExecucao,
  CodigoDeErroDeIA,
  ErroDeEstrategia,
  EtapaDaExecucao,
  EventoDaVersao,
  ExecutorDeIA,
  Execucao,
  LeitorDoBrain,
  MudancaDaExecucao,
  PedidoDeIA,
  Relogio,
  RepositorioDeEstrategia,
  TarefaDeIA,
  Versao,
  VersaoResumo,
} from '@/modules/strategy/application/portas';

export const MAXIMO_DE_RODADAS = 2;
export const MAXIMO_DE_TENTATIVAS = 2;
export const PARALELISMO_DO_COMITE = 3;
export { MAXIMO_DE_RESERVAS };
export const LEASE_DA_EXECUCAO_MS = 300_000;
export const LIMITE_DO_PAYLOAD_DO_GATE_BYTES = 15_000;
export const MAXIMO_DE_PROBLEMAS_DO_GATE = 10;
export const MAXIMO_DE_VERSOES_LIDAS = 50;
export const AGENTE_DE_PLANO = 'agente_de_plano';
export const AGENTE_DO_GATE = 'gates';
export const AGENTE_DO_JUIZ = 'juiz';

export const ORCAMENTO_DA_IA: Readonly<Record<TarefaDeIA, { readonly tokensMaximos: number; readonly tempoMaximoMs: number }>> = {
  strategy_plan: { tokensMaximos: 6_500, tempoMaximoMs: 115_000 },
  comite: { tokensMaximos: 5_000, tempoMaximoMs: 90_000 },
  juiz: { tokensMaximos: 4_500, tempoMaximoMs: 60_000 },
  gate: { tokensMaximos: 3_000, tempoMaximoMs: 60_000 },
};

const CODIGO_DA_FALHA_DE_IA: Readonly<Record<CodigoDeErroDeIA, CodigoDeErroDaExecucao>> = {
  nao_configurada: 'ia_nao_configurada',
  limite_atingido: 'ia_limite',
  saida_invalida: 'ia_saida_invalida',
  falha_do_fornecedor: 'ia_falha',
  tempo_esgotado: 'ia_tempo',
};

const ESTADOS_FINAIS = ['concluida', 'falhou', 'cancelada'];

const esquemaDoGateDoModelo = z.strictObject({
  resultado: z.enum(['aprovado', 'reprovado']),
  problemas: z
    .array(z.strictObject({ trecho: z.string().min(1).max(80), problema: z.string().min(1).max(300) }))
    .max(MAXIMO_DE_PROBLEMAS_DO_GATE),
});
type SaidaDoGateDoModelo = z.infer<typeof esquemaDoGateDoModelo>;

const esquemaDoAjusteDoGrupo = (indice: number) =>
  z.strictObject({
    secoes: esquemaDoGrupo(indice),
    respostas: z.array(esquemaRespostaDoAjuste).max(80),
  });

type PontosDoGrupo = {
  readonly argumentos: Argumento[];
  readonly obrigatorias: PendenciaObrigatoria[];
  readonly doGate: string[];
  readonly pendenciasDoGate: PendenciaDoGate[];
};

export type PendenciaDoGate = { readonly texto: string; readonly grupos: readonly number[]; readonly trechos?: readonly string[] };

const esquemaDoAjusteDaMidia = (plataforma: Plataforma) =>
  z.strictObject({
    secoes: esquemaDaMidiaDaPlataforma(plataforma),
    respostas: z.array(esquemaRespostaDoAjuste).max(80),
  });

type PerfilDoPacote = 'completo' | 'regras' | 'citadas';

const SECOES_QUE_O_PLANO_DE_MIDIA_USA = ['publico_alvo', 'posicionamento_e_mensagem', 'campanhas', 'orcamento', 'calendario', 'metas_e_metricas'] as const;

function perfilDoGrupo(indice: number): PerfilDoPacote {
  const grupo: readonly string[] = GRUPOS_DE_REDACAO[indice] ?? [];
  if (grupo.includes('lacunas')) return 'citadas';
  if (grupo.some((secao) => secao === 'plano_de_midia' || secao === 'orcamento' || secao === 'riscos_e_regras')) return 'regras';
  return 'completo';
}

function pacoteDoGrupo(pacote: PacoteDeLeitura, perfil: PerfilDoPacote, jaEscrito: unknown): PacoteDeLeitura {
  const citadas = urnsCitadasNasSecoes(jaEscrito);
  if (perfil === 'completo') return pacoteParaEntrada(pacote, MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.redigir, { primeiras: citadas });
  const regras = urnsDeRegraOuLimite(pacote);
  return pacoteParaEntrada(pacote, MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA[perfil], {
    somenteUrns: new Set([...regras, ...citadas]),
    primeiras: regras,
    comCatalogo: false,
  });
}

function idsReferenciaveis(plano: Record<string, unknown>) {
  const ids = (secao: unknown, colecao: string) => {
    const lista = (secao as Record<string, unknown> | undefined)?.[colecao];
    return Array.isArray(lista) ? lista.map((item) => (item as { id?: unknown }).id).filter((id): id is string => typeof id === 'string') : [];
  };
  return {
    segmentos: ids(plano.publico_alvo, 'segmentos'),
    canais: ids(plano.canais_e_plataformas, 'canais'),
    metas: ids(plano.metas_e_metricas, 'metas'),
  };
}

function plataformaDoTrecho(trecho: string, escolhidas: readonly Plataforma[]): Plataforma | null {
  const [secao, plataforma] = trecho.split('/');
  return secao === 'plano_de_midia' && escolhidas.includes(plataforma as Plataforma) ? (plataforma as Plataforma) : null;
}

export type EstadoDoPasso = 'avancou' | 'adiado' | 'final' | 'nao_reservada' | 'inexistente' | 'perdida';

export type ResultadoDoPasso = { readonly estado: EstadoDoPasso; readonly execucao: Execucao | null };

export type ResumoDoAvanco = { readonly estado: EstadoDoPasso; readonly passos: number; readonly execucao: Execucao | null };

export type OpcoesDoAvanco = { readonly orcamentoMs: number; readonly ficha: number };

export type DependenciasDoMotor = {
  readonly repositorio: RepositorioDeEstrategia;
  readonly executorDeIA: ExecutorDeIA;
  readonly leitorDoBrain: LeitorDoBrain;
  readonly avaliadorDeLimites: AvaliadorDeLimites;
  readonly catalogoDeLimites?: CatalogoDeLimites;
  readonly audit: AuditRecorder;
  readonly relogio?: Relogio;
  readonly personas?: readonly Persona[];
  readonly maximoDeRodadas?: number;
  readonly maximoDeTentativas?: number;
  readonly paralelismoDoComite?: number;
  readonly leaseMs?: number;
  readonly catalogos?: readonly CatalogoDeCampos[];
};

export type MotorDoPlano = {
  passo(organizationId: string, execucaoId: string, ficha: number): Promise<ResultadoDoPasso>;
  avancarExecucao(organizationId: string, execucaoId: string, opcoes: OpcoesDoAvanco): Promise<ResumoDoAvanco>;
};

class FalhaDaEtapa extends Error {
  readonly codigo: CodigoDeErroDaExecucao;
  readonly transitoria: boolean;
  readonly perdida: boolean;
  readonly motivo: string | null;

  constructor(codigo: CodigoDeErroDaExecucao, transitoria: boolean, perdida = false, motivo: string | null = null) {
    super(codigo);
    this.codigo = codigo;
    this.transitoria = transitoria;
    this.perdida = perdida;
    this.motivo = motivo;
  }
}

type Contexto = { pacote?: PacoteDeLeitura; readonly ficha: number };

type Efeito = {
  readonly proximo: Partial<MudancaDaExecucao>;
  readonly contagens?: Readonly<Record<string, number | string>>;
};

function falhaDeIA(codigo: CodigoDeErroDeIA, motivo: string | null = null): FalhaDaEtapa {
  return new FalhaDaEtapa(CODIGO_DA_FALHA_DE_IA[codigo], codigo !== 'nao_configurada' && codigo !== 'limite_atingido', false, motivo);
}

const MAXIMO_DE_PROBLEMAS_DEVOLVIDOS = 10;
const AVISO_DE_CORRECAO_DE_INTEGRIDADE =
  'A entrada traz "problemasDeIntegridade": a versão anterior deste grupo ficou inconsistente com as seções já redigidas ou com ela mesma. Devolva o grupo corrigido, citando só ids que existem em "secoesJaRedigidas" ou neste grupo.';

function motivoDaIntegridade(problemas: readonly { readonly caminho: string; readonly mensagem: string }[]): string {
  const itens = problemas.slice(0, 3).map((problema) => `${problema.caminho.replace(/[^a-z0-9_.]/gi, '').slice(0, 60)}=${problema.mensagem.slice(0, 60)}`);
  return `rascunho_fora_da_integridade:${itens.join(';')}`.slice(0, 220);
}

function motivoDoEsquema(erro: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] }): string {
  const caminhos = [...new Set(erro.issues.slice(0, 3).map((problema) => problema.path.map(String).join('.').replace(/[^a-z0-9_.]/gi, '').slice(0, 60)))];
  return `esquema:${caminhos.join(',')}`.slice(0, 160);
}

function motivoDaFalhaDeIA(erro: { readonly codigo: string; readonly mensagem: string }): string {
  const caminhos = erro.codigo === 'saida_invalida' ? /\[(esquema:[a-z0-9_.,\[\]]*)\]$/i.exec(erro.mensagem)?.[1] : undefined;
  return caminhos ? `ia:${erro.codigo}:${caminhos}` : `ia:${erro.codigo}`;
}

function falhaDoBanco(erro: ErroDeEstrategia): FalhaDaEtapa {
  if (erro.codigo === 'execucao_perdida') return new FalhaDaEtapa('interno', false, true);
  return new FalhaDaEtapa('interno', false);
}

export function truncarPayloadDoGate(
  payload: { readonly resultado: 'aprovado' | 'reprovado'; readonly checagens: readonly { chave: string; resultado: string; motivo: string; onde: string[] }[] },
  modelo: SaidaDoGateDoModelo | null,
  limiteEmBytes = LIMITE_DO_PAYLOAD_DO_GATE_BYTES,
): Record<string, unknown> {
  const tamanho = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor)).length;
  for (const maximoDeLocais of [40, 20, 10, 5, 2, 0]) {
    const montado = {
      resultado: payload.resultado,
      checagens: payload.checagens.map((c) => ({
        chave: c.chave,
        resultado: c.resultado,
        motivo: c.motivo,
        onde: c.onde.slice(0, maximoDeLocais),
      })),
      modelo,
    };
    if (tamanho(montado) <= limiteEmBytes) return montado;
  }
  return { resultado: payload.resultado, checagens: payload.checagens.map((c) => ({ chave: c.chave, resultado: c.resultado, motivo: c.motivo.slice(0, 80), onde: [] })), modelo: null };
}

export function resumoDoPacote(pacote: PacoteDeLeitura) {
  return pacote.entradas.map((e) => ({
    urn: e.urn,
    tipo: e.tipo,
    titulo: e.titulo,
    resumo: e.resumo.slice(0, 160),
    nota: e.evidencia?.nota ?? null,
    validoAte: e.evidencia?.validoAte ?? null,
    somenteMetadados: e.somenteMetadados,
  }));
}

export function distribuirPontos(
  argumentos: readonly Argumento[],
  obrigatorias: readonly PendenciaObrigatoria[],
  doGate: readonly PendenciaDoGate[],
): Map<number, PontosDoGrupo> {
  const porGrupo = new Map<number, PontosDoGrupo>();
  const grupo = (indice: number): PontosDoGrupo => {
    const existente = porGrupo.get(indice);
    if (existente) return existente;
    const novo: PontosDoGrupo = { argumentos: [], obrigatorias: [], doGate: [], pendenciasDoGate: [] };
    porGrupo.set(indice, novo);
    return novo;
  };
  for (const argumento of argumentos) grupo(grupoDoTrecho(argumento.trecho)).argumentos.push(argumento);
  for (const pendencia of obrigatorias) grupo(grupoDoTrecho(pendencia.trecho)).obrigatorias.push(pendencia);
  for (const pendencia of doGate) {
    for (const indice of pendencia.grupos) {
      grupo(indice).doGate.push(pendencia.texto);
      grupo(indice).pendenciasDoGate.push(pendencia);
    }
  }
  if (porGrupo.size === 0) grupo(INDICE_DO_ULTIMO_GRUPO);
  return porGrupo;
}

export function createMotorDoPlano(deps: DependenciasDoMotor): MotorDoPlano {
  const { repositorio, executorDeIA, leitorDoBrain, avaliadorDeLimites, audit } = deps;
  const relogio = deps.relogio ?? { agora: () => new Date() };
  const personas = deps.personas ?? PERSONAS;
  const maximoDeRodadas = deps.maximoDeRodadas ?? MAXIMO_DE_RODADAS;
  const maximoDeTentativas = deps.maximoDeTentativas ?? MAXIMO_DE_TENTATIVAS;
  const paralelismo = deps.paralelismoDoComite ?? PARALELISMO_DO_COMITE;
  const leaseMs = deps.leaseMs ?? LEASE_DA_EXECUCAO_MS;
  const catalogos = deps.catalogos ?? CATALOGOS_DISPONIVEIS;

  const novoLease = () => new Date(relogio.agora().getTime() + leaseMs);

  const EVENTO_DE_DESCARTE: Readonly<Partial<Record<StatusDaVersao, TipoDeEvento>>> = {
  rejeitado: 'rejeitada',
  revogado: 'revogada',
  cancelado: 'cancelada',
};

function autoria(execucao: Execucao, agentId: string, chave: string, contexto: Contexto) {
    return { tipo: 'agente', agentId, agentRunId: execucao.agentRunId, chaveDeIdempotencia: chave, ficha: contexto.ficha } as const;
  }

  function requestIdDe(execucao: Execucao, etapa: string): string {
    return `motor:${execucao.id}:${etapa}`.slice(0, 120);
  }

  async function lerPacote(execucao: Execucao, contexto: Contexto, forcar: boolean): Promise<PacoteDeLeitura> {
    if (contexto.pacote && !forcar) return contexto.pacote;
    const lido = await leitorDoBrain.lerPacote(execucao.organizationId, execucao.clientId);
    if (!lido.ok) throw new FalhaDaEtapa('brain_indisponivel', true);
    contexto.pacote = lido.value;
    return lido.value;
  }

  async function tiposDeLimiteDoGrupo(execucao: Execucao, indice: number): Promise<Record<string, unknown>> {
    const grupo: readonly string[] = GRUPOS_DE_REDACAO[indice] ?? [];
    if (!grupo.includes('lacunas') || deps.catalogoDeLimites === undefined) return {};
    try {
      return { tiposDeLimite: await deps.catalogoDeLimites.listar(execucao.organizationId) };
    } catch {
      throw new FalhaDaEtapa('interno', true);
    }
  }

  async function renovarLease(execucao: Execucao, contexto: Contexto): Promise<void> {
    const renovada = await repositorio.atualizarExecucao(execucao.organizationId, execucao.id, { leaseAte: novoLease() }, contexto.ficha);
    if (renovada.ok) return;
    if (renovada.error.codigo === 'execucao_perdida') throw new FalhaDaEtapa('interno', false, true);
    throw new FalhaDaEtapa('interno', true);
  }

  async function executarIA<T>(
    execucao: Execucao,
    contexto: Contexto,
    tarefa: TarefaDeIA,
    instrucoes: string,
    dados: unknown,
    esquema: z.ZodType<T>,
    chave: string,
    codigos?: CodigosDoPacote,
  ): Promise<T> {
    const esquemaDaChamada = codigos === undefined ? esquema : esquemaQueAceitaCodigos(esquema, codigos);
    await renovarLease(execucao, contexto);
    let resposta;
    try {
      resposta = await executorDeIA.executar<T>({
        tarefa,
        instrucoes,
        dados,
        esquema: esquemaDaChamada,
        orcamento: ORCAMENTO_DA_IA[tarefa],
        organizacaoId: execucao.organizationId,
        clienteId: execucao.clientId,
        execucaoId: execucao.id,
        chaveDeIdempotencia: chave,
      } satisfies PedidoDeIA<T>);
    } catch {
      await renovarLease(execucao, contexto);
      throw new FalhaDaEtapa('ia_falha', true);
    }
    await renovarLease(execucao, contexto);
    if (!resposta.ok) throw falhaDeIA(resposta.error.codigo, motivoDaFalhaDeIA(resposta.error));
    const lida = esquemaDaChamada.safeParse(resposta.value.saida);
    if (!lida.success) throw falhaDeIA('saida_invalida', motivoDoEsquema(lida.error));
    return lida.data;
  }

  async function pacoteComAsCitadas(execucao: Execucao, contexto: Contexto, plano: Plano, pacote: PacoteDeLeitura): Promise<PacoteDeLeitura> {
    const referencias = referenciasDoPlano(plano, { organizacaoId: execucao.organizationId, clienteId: execucao.clientId });
    if (!referencias.ok) throw falhaDeIA('saida_invalida', 'referencias_invalidas');
    const presentes = new Set(pacote.entradas.map((entrada) => entrada.urn));
    const faltantes = [...new Set(referencias.value.map((referencia) => referencia.urn))].filter((urn) => !presentes.has(urn));
    if (faltantes.length === 0 || leitorDoBrain.entradasPorUrn === undefined) return pacote;
    const lidas = await leitorDoBrain.entradasPorUrn(execucao.organizationId, execucao.clientId, faltantes);
    if (!lidas.ok) throw new FalhaDaEtapa('brain_indisponivel', true);
    const ampliado = { ...pacote, entradas: [...pacote.entradas, ...lidas.value].slice(0, MAXIMO_DE_ENTRADAS_NO_PACOTE) };
    contexto.pacote = ampliado;
    return ampliado;
  }

  function referenciasConferidas(plano: Plano, execucao: Execucao, pacote: PacoteDeLeitura) {
    const referencias = referenciasDoPlano(plano, { organizacaoId: execucao.organizationId, clienteId: execucao.clientId });
    if (!referencias.ok) throw falhaDeIA('saida_invalida', 'referencias_invalidas');
    const hashes = hashesDoPacote(pacote);
    const comHash = referencias.value.map((ref) => ({ urn: ref.urn, papel: ref.papel, hash: hashes.get(ref.urn) }));
    if (comHash.some((ref) => ref.hash === undefined)) throw falhaDeIA('saida_invalida', `urn_fora_do_pacote:${comHash.filter((ref) => ref.hash === undefined).length}`);
    const citadas = comHash.map((ref) => ({ urn: ref.urn, papel: ref.papel, hash: ref.hash! }));
    return combinarReferencias(citadas, referenciasImplicitasDoPacote(pacote));
  }

  async function estadoDoPlano(execucao: Execucao) {
    return repositorio.estadoDoPlano(execucao.organizationId, execucao.planoId);
  }

  async function versoesDaExecucao(execucao: Execucao): Promise<VersaoResumo[]> {
    const todas = await repositorio.listarVersoes(execucao.organizationId, execucao.planoId, MAXIMO_DE_VERSOES_LIDAS);
    return todas.filter((v) => v.agentRunId === execucao.agentRunId);
  }

  async function versaoCorrente(execucao: Execucao): Promise<Versao> {
    const [maisRecente] = await versoesDaExecucao(execucao);
    const alvo = maisRecente?.id ?? execucao.versaoBaseId;
    if (!alvo) throw new FalhaDaEtapa('interno', false);
    const versao = await repositorio.lerVersao(execucao.organizationId, alvo);
    if (!versao || versao.status !== 'rascunho') throw new FalhaDaEtapa('interno', false);
    return versao;
  }

  function planoDe(conteudo: unknown): Plano {
    const lido = lerPlano(conteudo);
    if (!lido.ok) throw new FalhaDaEtapa('interno', false);
    return lido.value;
  }

  function aprovadoPeloComite(pareceres: readonly Parecer[]): boolean {
    return pareceres.every((p) => p.veredito === 'aprova');
  }

  function motivoDeRevisao(execucao: Execucao): 'edicao_manual' | 'brain_mudou' | null {
    if (execucao.tipo !== 'revisar') return null;
    return execucao.pedido.motivo === 'brain_mudou' ? 'brain_mudou' : 'edicao_manual';
  }

  async function etapaLerBrain(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    const pacote = await lerPacote(execucao, contexto, true);
    const pulaRedigir = motivoDeRevisao(execucao) === 'edicao_manual';
    return { proximo: { etapa: pulaRedigir ? 'comite' : 'redigir' }, contagens: { entradas: pacote.entradas.length } };
  }

  function intencaoCompleta(candidata: unknown): Intencao {
    const lida = esquemaIntencao.safeParse(candidata);
    if (!lida.success) throw new FalhaDaEtapa('interno', false);
    return lida.data;
  }

  type EntradaDaRedacao = {
    readonly tarefa: string;
    readonly intencaoConfiavel: Intencao;
    readonly planoBase: Plano | null;
    readonly instrucaoDaPessoa: string | null;
  };

  function criarEntradaDaRedacao(execucao: Execucao, base: Versao | null): EntradaDaRedacao {
    if (execucao.tipo === 'criar') {
      const intencao = intencaoCompleta(execucao.pedido);
      const limpa = sanitizarIntencao(intencao);
      if (!limpa.ok) throw new FalhaDaEtapa('interno', false);
      return { tarefa: TAREFA_PARA_CRIAR_PLANO, intencaoConfiavel: limpa.value, planoBase: null, instrucaoDaPessoa: null };
    }
    if (!base) throw new FalhaDaEtapa('interno', false);
    const planoBase = planoDe(base.conteudo);
    const intencaoConfiavel = intencaoCompleta(planoBase.intencao);
    if (execucao.tipo === 'ajustar') {
      const pedida = execucao.pedido.instrucao;
      if (typeof pedida !== 'string') throw new FalhaDaEtapa('interno', false);
      return { tarefa: TAREFA_PARA_AJUSTAR_PLANO, intencaoConfiavel, planoBase, instrucaoDaPessoa: textoSeguro(pedida) };
    }
    return { tarefa: TAREFA_PARA_ATUALIZAR_AO_BRAIN, intencaoConfiavel, planoBase, instrucaoDaPessoa: null };
  }

  function entradaDoGrupo(entrada: EntradaDaRedacao, indice: number) {
    return {
      intencao: entrada.intencaoConfiavel,
      ...(entrada.instrucaoDaPessoa === null ? {} : { instrucaoDaPessoa: entrada.instrucaoDaPessoa }),
      ...(entrada.planoBase === null ? {} : { secoesDoPlanoBase: secoesDoGrupo(entrada.planoBase as unknown as Record<string, unknown>, indice) }),
    };
  }

  function secoesParaOPlanoDeMidia(secoes: SecoesRedigidas, plataforma: Plataforma): Record<string, unknown> {
    const escolhidas: Record<string, unknown> = {};
    for (const chave of SECOES_QUE_O_PLANO_DE_MIDIA_USA) {
      const secao = secoes[chave];
      if (secao === undefined) continue;
      escolhidas[chave] =
        chave === 'campanhas'
          ? { campanhas: ((secao as { campanhas: { plataforma?: string }[] }).campanhas ?? []).filter((c) => c.plataforma === undefined || c.plataforma === plataforma) }
          : secao;
    }
    return escolhidas;
  }

  function problemasDaMidia(saida: { plano_de_midia: { plataformas: readonly unknown[] } }, catalogo: CatalogoDeCampos, intencao: Intencao, secoes: SecoesRedigidas, atual: unknown) {
    const entrada = saida.plano_de_midia.plataformas[0] as Parameters<typeof problemasDaPlataforma>[0];
    const daCobertura = problemasDaPlataforma(entrada, catalogo, intencao).map((mensagem) => ({ caminho: 'plano_de_midia', mensagem }));
    const mesclado = mesclarMidiaDaPlataforma(atual as { plataformas: { plataforma: string }[] } | undefined, saida.plano_de_midia as never, intencao.plataformas);
    return [...daCobertura, ...problemasDoRascunho({ ...secoes, plano_de_midia: mesclado } as SecoesRedigidas)];
  }

  async function redigirMidia(
    execucao: Execucao,
    contexto: Contexto,
    entrada: EntradaDaRedacao,
    secoes: SecoesRedigidas,
    pacote: PacoteDeLeitura,
    codigos: CodigosDoPacote,
  ): Promise<Record<string, unknown>> {
    const { intencaoConfiavel: intencao, tarefa } = entrada;
    const comCatalogo = intencao.plataformas.filter((plataforma) => catalogoDaPlataforma(catalogos, plataforma) !== undefined);
    let midia: ReturnType<typeof mesclarMidiaDaPlataforma> | undefined;
    for (const [posicao, plataforma] of comCatalogo.entries()) {
      const catalogo = catalogoDaPlataforma(catalogos, plataforma)!;
      const baseDaPlataforma = entrada.planoBase?.plano_de_midia.plataformas.find((item) => item.plataforma === plataforma);
      const chamar = (problemasAnteriores: readonly { readonly caminho: string; readonly mensagem: string }[]) => {
        const jaEscrito = secoesParaOPlanoDeMidia(secoes, plataforma);
        return executarIA(
          execucao,
          contexto,
          'strategy_plan',
          instrucaoDoPlanoDeMidia(problemasAnteriores.length === 0 ? tarefa : `${tarefa}\n${AVISO_DE_CORRECAO_DE_INTEGRIDADE}`, plataforma, posicao + 1, comCatalogo.length),
          {
            ...(abreviarUrnsParaCodigos(
              {
                intencao,
                plataforma,
                ...(entrada.instrucaoDaPessoa === null ? {} : { instrucaoDaPessoa: entrada.instrucaoDaPessoa }),
                ...(baseDaPlataforma === undefined ? {} : { planoDeMidiaBase: baseDaPlataforma }),
                secoesJaRedigidas: jaEscrito,
              },
              codigos,
            ) as Record<string, unknown>),
            catalogosDeCampos: [catalogo],
            ...(problemasAnteriores.length === 0 ? {} : { problemasDeIntegridade: problemasAnteriores.slice(0, MAXIMO_DE_PROBLEMAS_DEVOLVIDOS) }),
            pacote: pacoteDoGrupo(pacote, 'regras', { jaEscrito, baseDaPlataforma }),
          },
          esquemaDaMidiaDaPlataforma(plataforma),
          problemasAnteriores.length === 0
            ? `${execucao.id}:redigir:${execucao.rodada}:g${INDICE_DO_PLANO_DE_MIDIA}:${plataforma}`
            : `${execucao.id}:redigir:${execucao.rodada}:corrigir:g${INDICE_DO_PLANO_DE_MIDIA}:${plataforma}`,
          codigos,
        );
      };
      let saida = await chamar([]);
      let problemas = problemasDaMidia(saida, catalogo, intencao, secoes, midia);
      if (problemas.length > 0) {
        saida = await chamar(problemas);
        problemas = problemasDaMidia(saida, catalogo, intencao, secoes, midia);
      }
      if (problemas.length > 0) throw falhaDeIA('saida_invalida', motivoDaIntegridade(problemas));
      midia = mesclarMidiaDaPlataforma(midia, saida.plano_de_midia, intencao.plataformas);
    }
    return { plano_de_midia: midia ?? { plataformas: [] } };
  }

  async function etapaRedigir(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    if (execucao.tipo === 'corrigir_gate') return etapaCorrigir(execucao, contexto);
    if ((await versoesDaExecucao(execucao)).length > 0) return { proximo: { etapa: 'comite' }, contagens: { jaRedigido: 1 } };
    const pacote = await lerPacote(execucao, contexto, false);
    const base = execucao.versaoBaseId ? await repositorio.lerVersao(execucao.organizationId, execucao.versaoBaseId) : null;
    const entrada = criarEntradaDaRedacao(execucao, base);
    const { tarefa, intencaoConfiavel } = entrada;
    const codigos = codigosDoPacote(pacote);
    const secoes: SecoesRedigidas = {};
    for (const [indice, grupo] of GRUPOS_DE_REDACAO.entries()) {
      if (indice === INDICE_DO_PLANO_DE_MIDIA) {
        Object.assign(secoes, await redigirMidia(execucao, contexto, entrada, secoes, pacote, codigos));
        continue;
      }
      const doGrupo = entradaDoGrupo(entrada, indice);
      const tiposDoGrupo = await tiposDeLimiteDoGrupo(execucao, indice);
      const redigirGrupo = (problemasAnteriores: readonly { readonly caminho: string; readonly mensagem: string }[]) =>
        executarIA(
          execucao,
          contexto,
          'strategy_plan',
          instrucaoDoGrupo(problemasAnteriores.length === 0 ? tarefa : `${tarefa}\n${AVISO_DE_CORRECAO_DE_INTEGRIDADE}`, grupo, indice + 1, GRUPOS_DE_REDACAO.length),
          {
            ...(abreviarUrnsParaCodigos({ ...doGrupo, secoesJaRedigidas: { ...secoes } }, codigos) as Record<string, unknown>),
            ...(problemasAnteriores.length === 0 ? {} : { problemasDeIntegridade: problemasAnteriores.slice(0, MAXIMO_DE_PROBLEMAS_DEVOLVIDOS) }),
            ...tiposDoGrupo,
            pacote: pacoteDoGrupo(pacote, perfilDoGrupo(indice), { secoes, base: doGrupo }),
          },
          esquemaDoGrupo(indice),
          problemasAnteriores.length === 0 ? `${execucao.id}:redigir:${execucao.rodada}:g${indice}` : `${execucao.id}:redigir:${execucao.rodada}:corrigir:g${indice}`,
          codigos,
        );
      Object.assign(secoes, await redigirGrupo([]));
      let problemas = problemasDoRascunho(secoes);
      if (problemas.length > 0) {
        Object.assign(secoes, await redigirGrupo(problemas));
        problemas = problemasDoRascunho(secoes);
      }
      if (problemas.length > 0) throw falhaDeIA('saida_invalida', motivoDaIntegridade(problemas));
    }
    const lido = lerPlano(montarPlanoDeSecoes(intencaoConfiavel, secoes));
    if (!lido.ok) throw falhaDeIA('saida_invalida', 'plano_fora_do_esquema');
    const plano = lido.value;
    if (!planoSemDadoPessoal(plano).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_plano');
    const referencias = referenciasConferidas(plano, execucao, await pacoteComAsCitadas(execucao, contexto, plano, pacote));
    const estado = await estadoDoPlano(execucao);
    const chave = `${execucao.id}:redigir:${execucao.rodada}`;
    const criada = await repositorio.criarVersaoRascunho(execucao.organizationId, {
      planoId: execucao.planoId,
      conteudo: plano,
      schemaVersion: SCHEMA_VERSION,
      supersedesId: estado?.vigente?.id ?? null,
      autoria: autoria(execucao, AGENTE_DE_PLANO, chave, contexto),
      referencias,
      requestId: requestIdDe(execucao, 'redigir'),
    });
    if (!criada.ok && criada.error.codigo !== 'ja_feito') throw falhaDoBanco(criada.error);
    return { proximo: { etapa: 'comite' }, contagens: { referencias: referencias.length, chamadas: GRUPOS_DE_REDACAO.length } };
  }

  async function executarPersona(execucao: Execucao, contexto: Contexto, versao: Versao, plano: Plano, pacote: PacoteDeLeitura, persona: Persona) {
    const chave = `${execucao.id}:parecer:${persona.chave}`;
    const codigos = codigosDoPacote(pacote);
    const visaoDaPersona = secoesDoPlano(plano, persona.secoes);
    const dados = {
      plano: abreviarUrnsParaCodigos(visaoDaPersona, codigos),
      pacote: pacoteParaEntrada(pacote, MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.comite, {
        primeiras: new Set([...urnsDeRegraOuLimite(pacote), ...urnsCitadasNasSecoes(visaoDaPersona)]),
        comCatalogo: false,
      }),
      persona: { chave: persona.chave, nome: persona.nome, foco: persona.foco },
    };
    const bruto = await executarIA(execucao, contexto, 'comite', instrucaoDaPersona(persona), dados, esquemaParecer, chave, codigos);
    const urns = new Set(pacote.entradas.map((e) => e.urn));
    let descartadas = 0;
    const parecer: Parecer = {
      ...bruto,
      persona: persona.chave,
      pontos: bruto.pontos.map((ponto) => {
        const fontes = ponto.fontes.filter((urn) => urns.has(urn));
        descartadas += ponto.fontes.length - fontes.length;
        return { ...ponto, fontes };
      }),
    };
    if (!parecerSemDadoPessoal(parecer).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_parecer');
    const gravado = await repositorio.registrarEvento(execucao.organizationId, {
      versaoId: versao.id,
      tipo: 'parecer',
      payload: parecer,
      autoria: autoria(execucao, persona.chave, chave, contexto),
      requestId: requestIdDe(execucao, `parecer:${persona.chave}`),
    });
    if (!gravado.ok && gravado.error.codigo !== 'ja_feito') throw falhaDoBanco(gravado.error);
    return descartadas;
  }

  async function etapaComite(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    const versao = await versaoCorrente(execucao);
    const eventos = await repositorio.eventosDaVersao(execucao.organizationId, versao.id);
    if (eventos.some((e) => e.tipo === 'ajuste')) return { proximo: { etapa: 'gates' }, contagens: { versaoId: versao.id } };

    const jaOpinaram = new Set(eventos.filter((e) => e.tipo === 'parecer').map((e) => String(e.payload.persona)));
    const faltantes = personas.filter((persona) => !jaOpinaram.has(persona.chave));
    let fontesDescartadas = 0;
    if (faltantes.length > 0) {
      const pacote = await lerPacote(execucao, contexto, false);
      const plano = planoDe(versao.conteudo);
      let primeiraFalha: FalhaDaEtapa | null = null;
      for (let inicio = 0; inicio < faltantes.length; inicio += paralelismo) {
        const lote = faltantes.slice(inicio, inicio + paralelismo);
        const resultados = await Promise.allSettled(lote.map((persona) => executarPersona(execucao, contexto, versao, plano, pacote, persona)));
        for (const resultado of resultados) {
          if (resultado.status === 'fulfilled') fontesDescartadas += resultado.value;
          else if (resultado.reason instanceof FalhaDaEtapa && resultado.reason.perdida) primeiraFalha = resultado.reason;
          else primeiraFalha ??= resultado.reason instanceof FalhaDaEtapa ? resultado.reason : new FalhaDaEtapa('interno', true);
        }
        if (primeiraFalha) throw primeiraFalha;
      }
    }
    return { proximo: { etapa: 'ajustar' }, contagens: { versaoId: versao.id, pareceres: faltantes.length, fontesDescartadas } };
  }

  function pendenciasDoGate(eventos: readonly EventoDaVersao[]): PendenciaDoGate[] {
    const ultimo = [...eventos].reverse().find((e) => e.tipo === 'gate');
    if (!ultimo) return [];
    const checagens = Array.isArray(ultimo.payload.checagens)
      ? (ultimo.payload.checagens as { chave?: unknown; resultado?: unknown; motivo?: unknown; onde?: unknown }[])
      : [];
    const doCodigo = checagens
      .filter((c) => c.resultado !== 'aprovado')
      .map((c) => ({
        texto: `${String(c.chave)}: ${String(c.motivo)}`,
        grupos: gruposDaPendenciaDoGate(String(c.chave), Array.isArray(c.onde) ? c.onde.map(String) : []),
        trechos: Array.isArray(c.onde) ? c.onde.map(String) : [],
      }));
    const modelo = ultimo.payload.modelo as { problemas?: { trecho?: unknown; problema?: unknown }[] } | null | undefined;
    const doModelo = (modelo?.problemas ?? []).map((p) => ({
      texto: `${String(p.trecho)}: ${String(p.problema)}`,
      grupos: [grupoDoTrecho(String(p.trecho))],
    }));
    return [...doCodigo, ...doModelo];
  }

  function pendenciasDeFalhas(checagens: readonly ChecagemReprovada[], modelo: readonly ProblemaDoModelo[]): PendenciaDoGate[] {
    const doCodigo = checagens.map((c) => ({
      texto: `${c.chave}: ${c.motivo}`,
      grupos: gruposDaPendenciaDoGate(c.chave, c.onde),
      trechos: [...c.onde],
    }));
    const doModelo = modelo.map((p) => ({ texto: `${p.trecho}: ${p.problema}`, grupos: [grupoDoTrecho(p.trecho)] }));
    return [...doCodigo, ...doModelo];
  }

  type EntradaDoAjusteDeGrupos = {
    readonly execucao: Execucao;
    readonly contexto: Contexto;
    readonly plano: Plano;
    readonly pacote: PacoteDeLeitura;
    readonly codigos: CodigosDoPacote;
    readonly pontosPorGrupo: ReadonlyMap<number, PontosDoGrupo>;
    readonly tarefa: string;
    readonly prefixoDaChave: 'ajustar' | 'corrigir';
  };

  async function ajustarGrupos(entrada: EntradaDoAjusteDeGrupos): Promise<{ corrente: Record<string, unknown>; respostas: RespostaDoAjuste[]; chamadas: number }> {
    const { execucao, contexto, plano, pacote, codigos, pontosPorGrupo, tarefa, prefixoDaChave } = entrada;
    const intencao = intencaoCompleta(plano.intencao);
    let corrente: Record<string, unknown> = { ...plano };
    const respostas: RespostaDoAjuste[] = [];
    let chamadas = 0;

    const validarRespostas = (indice: number, plataforma: Plataforma | null, esperadas: ReadonlySet<string>, dadas: readonly RespostaDoAjuste[]) => {
      const chaves = dadas.map((r) => `${r.persona}/${r.pontoId}`);
      if (new Set(chaves).size !== chaves.length || chaves.length !== esperadas.size || chaves.some((d) => !esperadas.has(d))) {
        throw falhaDeIA('saida_invalida', `respostas_do_grupo:g${indice}${plataforma ? `:${plataforma}` : ''}:esperadas${esperadas.size}:dadas${chaves.length}`);
      }
      if (dadas.some((r) => r.decisao !== 'acatado')) {
        throw falhaDeIA('saida_invalida', `ponto_a_aplicar_nao_acatado:g${indice}${plataforma ? `:${plataforma}` : ''}`);
      }
    };
    const esperadasDe = (argumentos: readonly Argumento[]) => new Set(argumentos.flatMap((argumento) => argumento.pontos.map((p) => `${p.persona}/${p.pontoId}`)));

    for (const [indice, pontos] of [...pontosPorGrupo.entries()].sort(([a], [b]) => a - b)) {
      if (indice === INDICE_DO_PLANO_DE_MIDIA) {
        const comCatalogo = intencao.plataformas.filter((plataforma) => catalogoDaPlataforma(catalogos, plataforma) !== undefined);
        if (comCatalogo.length === 0) throw falhaDeIA('saida_invalida', 'plano_de_midia_sem_catalogo');
        for (const [posicao, plataforma] of comCatalogo.entries()) {
          const daPlataforma = (trecho: string) => (plataformaDoTrecho(trecho, intencao.plataformas) ?? comCatalogo[0]) === plataforma;
          const argumentos = pontos.argumentos.filter((argumento) => daPlataforma(argumento.trecho));
          const obrigatorias = pontos.obrigatorias.filter((pendencia) => daPlataforma(pendencia.trecho));
          const doGate = pontos.pendenciasDoGate
            .filter((pendencia) => {
              const alvos = (pendencia.trechos ?? []).map((trecho) => plataformaDoTrecho(trecho, intencao.plataformas)).filter((alvo): alvo is Plataforma => alvo !== null);
              return alvos.length === 0 || alvos.includes(plataforma);
            })
            .map((pendencia) => pendencia.texto);
          if (argumentos.length === 0 && obrigatorias.length === 0 && doGate.length === 0) continue;
          const catalogo = catalogoDaPlataforma(catalogos, plataforma)!;
          const baseDaPlataforma = (corrente.plano_de_midia as Plano['plano_de_midia'] | undefined)?.plataformas.find((item) => item.plataforma === plataforma);
          const planoAtual = baseDaPlataforma === undefined ? {} : { plano_de_midia: { plataformas: [baseDaPlataforma] } };
          const saida = await executarIA(
            execucao,
            contexto,
            'strategy_plan',
            instrucaoDoPlanoDeMidia(tarefa, plataforma, posicao + 1, comCatalogo.length, true),
            {
              ...(abreviarUrnsParaCodigos({ intencao, planoAtual, pontos: argumentos, pendenciasObrigatorias: obrigatorias, pendenciasDoGate: doGate }, codigos) as Record<string, unknown>),
              catalogosDeCampos: [catalogo],
              pacote: pacoteDoGrupo(pacote, 'regras', { planoAtual, argumentos }),
            },
            esquemaDoAjusteDaMidia(plataforma),
            `${execucao.id}:${prefixoDaChave}:${execucao.rodada}:g${indice}:${plataforma}`,
            codigos,
          );
          chamadas += 1;
          validarRespostas(indice, plataforma, esperadasDe(argumentos), saida.respostas);
          const mesclado = mesclarMidiaDaPlataforma(corrente.plano_de_midia as { plataformas: { plataforma: string }[] } | undefined, saida.secoes.plano_de_midia, intencao.plataformas);
          const problemasDaPlataformaAjustada = problemasDaPlataforma(saida.secoes.plano_de_midia.plataformas[0], catalogo, intencao);
          if (problemasDaPlataformaAjustada.length > 0) throw falhaDeIA('saida_invalida', motivoDaIntegridade(problemasDaPlataformaAjustada.map((mensagem) => ({ caminho: 'plano_de_midia', mensagem }))));
          corrente = { ...corrente, plano_de_midia: mesclado };
          respostas.push(...saida.respostas);
        }
        continue;
      }
      const planoAtual = secoesDoGrupo(corrente, indice);
      const tiposDoGrupo = await tiposDeLimiteDoGrupo(execucao, indice);
      const doGrupo = await executarIA(
        execucao,
        contexto,
        'strategy_plan',
        instrucaoDoGrupo(tarefa, GRUPOS_DE_REDACAO[indice] ?? [], indice + 1, GRUPOS_DE_REDACAO.length, true),
        {
          ...(abreviarUrnsParaCodigos({ intencao, planoAtual, idsDisponiveis: idsReferenciaveis(corrente), pontos: pontos.argumentos, pendenciasObrigatorias: pontos.obrigatorias, pendenciasDoGate: pontos.doGate }, codigos) as Record<string, unknown>),
          ...tiposDoGrupo,
          pacote: pacoteDoGrupo(pacote, perfilDoGrupo(indice), { planoAtual, argumentos: pontos.argumentos }),
        },
        esquemaDoAjusteDoGrupo(indice),
        `${execucao.id}:${prefixoDaChave}:${execucao.rodada}:g${indice}`,
        codigos,
      );
      chamadas += 1;
      validarRespostas(indice, null, esperadasDe(pontos.argumentos), doGrupo.respostas);
      corrente = { ...corrente, ...doGrupo.secoes };
      respostas.push(...doGrupo.respostas);
    }
    return { corrente, respostas, chamadas };
  }

  async function julgarPontos(
    execucao: Execucao,
    contexto: Contexto,
    versao: Versao,
    plano: Plano,
    pareceres: readonly Parecer[],
    pacote: PacoteDeLeitura,
    codigos: CodigosDoPacote,
  ): Promise<readonly VereditoDoJuiz[]> {
    const pontos = pontosParaJulgar(pareceres, personas);
    const citadas = new Set(pontos.flatMap((ponto) => ponto.fontes));
    const doJuiz = pacoteParaEntrada(pacote, MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.comite, { somenteUrns: citadas, primeiras: citadas, comCatalogo: false });
    const { utm: _utm, whatsapp: _whatsapp, destino: _destino, plataformas: _plataformas, ...intencaoEssencial } = plano.intencao;
    const chave = `${execucao.id}:juiz`;
    const saida = await executarIA(
      execucao,
      contexto,
      'juiz',
      INSTRUCAO_DO_JUIZ,
      abreviarUrnsParaCodigos({ intencao: intencaoEssencial, resumo: plano.resumo_executivo, pontos, pacote: resumoDoPacote(doJuiz) }, codigos),
      esquemaSaidaDoJuiz,
      chave,
      codigos,
    );
    const conferidos = conferirVereditos(pontos, saida, new Set(pacote.entradas.map((entrada) => entrada.urn)));
    if (!conferidos.ok) throw falhaDeIA('saida_invalida', `juiz_incompleto:${conferidos.error.length}`);
    if (!planoSemDadoPessoal({ motivos: conferidos.value.map((veredito) => veredito.motivo) }).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_juiz');
    const gravado = await repositorio.registrarEvento(execucao.organizationId, {
      versaoId: versao.id,
      tipo: 'veredito_juiz',
      payload: { vereditos: conferidos.value },
      autoria: autoria(execucao, AGENTE_DO_JUIZ, chave, contexto),
      requestId: requestIdDe(execucao, 'juiz'),
    });
    if (!gravado.ok && gravado.error.codigo !== 'ja_feito') throw falhaDoBanco(gravado.error);
    return conferidos.value;
  }

  async function vereditosParaOAjuste(
    execucao: Execucao,
    contexto: Contexto,
    versao: Versao,
    raiz: string | null,
    cadeia: ReadonlyMap<string, readonly EventoDaCadeia[]>,
    pareceres: readonly Parecer[],
    plano: Plano,
    pacote: PacoteDeLeitura,
    codigos: CodigosDoPacote,
  ): Promise<readonly VereditoDoJuiz[] | undefined> {
    const existente = vereditosDoEvento(raiz === null ? undefined : (cadeia.get(raiz) ?? []).find((evento) => evento.tipo === 'veredito_juiz')?.payload);
    if (existente !== undefined || pontosParaJulgar(pareceres, personas).length === 0) return existente;
    if (raiz !== versao.id) throw falhaDeIA('saida_invalida', 'juiz_ausente_na_cadeia');
    return julgarPontos(execucao, contexto, versao, plano, pareceres, pacote, codigos);
  }

  async function etapaAjustar(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    const versao = await versaoCorrente(execucao);
    const eventos = await repositorio.eventosDaVersao(execucao.organizationId, versao.id);
    const temAjuste = eventos.some((e) => e.tipo === 'ajuste');
    const ultimoGate = [...eventos].reverse().find((e) => e.tipo === 'gate');
    const reprovouNoGate = ultimoGate?.payload.resultado === 'reprovado';

    const cadeia = await carregarCadeia(repositorio, execucao.organizationId, versao.id, eventos);
    const raiz = versaoDaRaizDaCadeia(cadeia, versao.id, execucao.agentRunId);
    const pareceres = raiz === null ? [] : pareceresDe(cadeia.get(raiz) ?? []);
    const comitePediuAjuste = !temAjuste && !aprovadoPeloComite(pareceres);
    if (!reprovouNoGate && !comitePediuAjuste) return { proximo: { etapa: 'gates' }, contagens: { versaoId: versao.id } };

    const pacote = await lerPacote(execucao, contexto, false);
    const codigos = codigosDoPacote(pacote);
    const plano = planoDe(versao.conteudo);
    const consolidacao = consolidarPareceres(pareceres, personas);

    const vereditos = await vereditosParaOAjuste(execucao, contexto, versao, raiz, cadeia, pareceres, plano, pacote, codigos);
    const destinos = destinosDosPontos(pareceres, vereditos, personas);
    if (!destinos.ok) throw falhaDeIA('saida_invalida', `juiz_sem_veredito:${destinos.error.length}`);
    const aplicar = argumentosParaAplicar(consolidacao.argumentos, destinos.value);
    const doGate = reprovouNoGate ? pendenciasDoGate(eventos) : [];
    const haPontos = aplicar.length > 0 || consolidacao.pendenciasObrigatorias.length > 0 || doGate.length > 0;
    const pontosPorGrupo = haPontos ? distribuirPontos(aplicar, consolidacao.pendenciasObrigatorias, doGate) : new Map<number, PontosDoGrupo>();

    const ajustado = await ajustarGrupos({ execucao, contexto, plano, pacote, codigos, pontosPorGrupo, tarefa: TAREFA_PARA_AJUSTAR_AO_COMITE, prefixoDaChave: 'ajustar' });
    const respostas = [...ajustado.respostas, ...respostasDeRecusaDoJuiz(destinos.value)];

    const chave = `${execucao.id}:ajustar:${execucao.rodada}`;
    const ajuste: Ajuste = { responde_a: versao.id, respostas };
    const validado = esquemaAjuste.safeParse(ajuste);
    if (!validado.success) throw falhaDeIA('saida_invalida', motivoDoEsquema(validado.error));
    if (!validarAjuste(pareceres, validado.data, personas).ok) throw falhaDeIA('saida_invalida', 'ajuste_nao_responde_aos_pontos');
    if (conferirAjusteContraOJuiz(pareceres, validado.data, vereditos, personas).length > 0) throw falhaDeIA('saida_invalida', 'ajuste_contra_o_veredito_do_juiz');
    if (!respostasDoAjusteSemDadoPessoal(validado.data.respostas).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_ajuste');
    const lido = lerPlano(ajustado.corrente);
    if (!lido.ok) throw falhaDeIA('saida_invalida', 'plano_ajustado_fora_do_esquema');
    const planoAjustado = lido.value;
    if (!planoSemDadoPessoal(planoAjustado).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_plano_ajustado');
    const referencias = referenciasConferidas(planoAjustado, execucao, await pacoteComAsCitadas(execucao, contexto, planoAjustado, pacote));
    const estado = await estadoDoPlano(execucao);

    const criada = await repositorio.criarVersaoRascunho(execucao.organizationId, {
      planoId: execucao.planoId,
      conteudo: planoAjustado,
      schemaVersion: SCHEMA_VERSION,
      supersedesId: estado?.vigente?.id ?? null,
      autoria: autoria(execucao, AGENTE_DE_PLANO, chave, contexto),
      referencias,
      eventosIniciais: [
        { tipo: 'ajuste', payload: validado.data, autoria: autoria(execucao, AGENTE_DE_PLANO, `${execucao.id}:ajuste:${execucao.rodada}`, contexto) },
      ],
      requestId: requestIdDe(execucao, 'ajustar'),
    });
    if (!criada.ok && criada.error.codigo !== 'ja_feito') throw falhaDoBanco(criada.error);
    return { proximo: { etapa: 'gates' }, contagens: { versaoId: criada.ok ? criada.value.id : versao.id, respostas: respostas.length, chamadas: ajustado.chamadas } };
  }

  async function planosBaseParaRestaurar(execucao: Execucao, versao: Versao): Promise<Plano[]> {
    const ids = await idsDasBasesDoGate(execucao, versao, null);
    const lidos = await Promise.all(ids.map((id) => lerPlanoDaVersao(execucao, id)));
    return lidos.filter((plano): plano is Plano => plano !== null);
  }

  async function etapaCorrigir(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    if ((await versoesDaExecucao(execucao)).length > 0) return { proximo: { etapa: 'comite' }, contagens: { jaRedigido: 1 } };
    if (execucao.versaoBaseId === null) throw new FalhaDaEtapa('interno', false);
    const base = await repositorio.lerVersao(execucao.organizationId, execucao.versaoBaseId);
    if (!base || base.status !== 'rascunho') throw new FalhaDaEtapa('interno', false);
    const eventosDaBase = await repositorio.eventosDaVersao(execucao.organizationId, base.id);
    const falhas = falhasDoGate([...eventosDaBase].reverse().find((evento) => evento.tipo === 'gate')?.payload);
    if (falhas === null) throw new FalhaDaEtapa('interno', false);

    const pacote = await lerPacote(execucao, contexto, false);
    const codigos = codigosDoPacote(pacote);
    const planoBase = planoDe(base.conteudo);
    let planoCorrente = planoBase;
    let restantes = checagensCorrigiveis(falhas);

    let restauradas = 0;
    if (restantes.some((checagem) => checagem.chave === CHAVE_NAO_FAREMOS_PRESERVADO)) {
      const bases = await planosBaseParaRestaurar(execucao, base);
      const restaurado = restaurarNaoFaremos(planoBase, bases);
      if (restaurado.restauradas.length > 0 && restaurarNaoFaremos(restaurado.plano, bases).restauradas.length === 0) {
        planoCorrente = restaurado.plano;
        restauradas = restaurado.restauradas.length;
        restantes = restantes.filter((checagem) => checagem.chave !== CHAVE_NAO_FAREMOS_PRESERVADO);
      }
    }

    const pendencias = pendenciasDeFalhas(restantes, falhas.modelo);
    const ajustado =
      pendencias.length === 0
        ? { corrente: { ...planoCorrente } as Record<string, unknown>, chamadas: 0 }
        : await ajustarGrupos({
            execucao,
            contexto,
            plano: planoCorrente,
            pacote,
            codigos,
            pontosPorGrupo: distribuirPontos([], [], pendencias),
            tarefa: TAREFA_PARA_CORRIGIR_O_GATE,
            prefixoDaChave: 'corrigir',
          });

    const lido = lerPlano(ajustado.corrente);
    if (!lido.ok) throw falhaDeIA('saida_invalida', 'plano_corrigido_fora_do_esquema');
    const planoCorrigido = lido.value;
    if (!planoSemDadoPessoal(planoCorrigido).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_plano_corrigido');
    const referencias = referenciasConferidas(planoCorrigido, execucao, await pacoteComAsCitadas(execucao, contexto, planoCorrigido, pacote));
    const estado = await estadoDoPlano(execucao);
    const criada = await repositorio.criarVersaoRascunho(execucao.organizationId, {
      planoId: execucao.planoId,
      conteudo: planoCorrigido,
      schemaVersion: SCHEMA_VERSION,
      supersedesId: estado?.vigente?.id ?? null,
      autoria: autoria(execucao, AGENTE_DE_PLANO, `${execucao.id}:corrigir`, contexto),
      referencias,
      requestId: requestIdDe(execucao, 'corrigir'),
    });
    if (!criada.ok && criada.error.codigo !== 'ja_feito') throw falhaDoBanco(criada.error);
    return { proximo: { etapa: 'comite' }, contagens: { restauradas, pendencias: pendencias.length, chamadas: ajustado.chamadas } };
  }

  async function resultadoDoGateExistente(eventos: readonly EventoDaVersao[]): Promise<EventoDaVersao | null> {
    let indiceDoGate = -1;
    let indiceDaRevisao = -1;
    eventos.forEach((e, indice) => {
      if (e.tipo === 'gate') indiceDoGate = indice;
      if (e.tipo === 'parecer' || e.tipo === 'ajuste') indiceDaRevisao = indice;
    });
    return indiceDoGate > indiceDaRevisao ? (eventos[indiceDoGate] ?? null) : null;
  }

  async function lerPlanoDaVersao(execucao: Execucao, versaoId: string): Promise<Plano | null> {
    const versao = await repositorio.lerVersao(execucao.organizationId, versaoId);
    const lido = versao ? lerPlano(versao.conteudo) : null;
    return lido?.ok ? lido.value : null;
  }

  async function descartadaPorPessoa(execucao: Execucao, versao: VersaoResumo): Promise<boolean> {
    const evento = EVENTO_DE_DESCARTE[versao.status];
    if (evento === undefined) return false;
    const eventos = await repositorio.eventosDaVersao(execucao.organizationId, versao.id);
    return eventos.some((e) => e.tipo === evento && e.atorTipo === 'usuario');
  }

  async function idsDasBasesDoGate(execucao: Execucao, versao: Versao, ajusteRespondeA: string | null): Promise<string[]> {
    const historico = await repositorio.listarVersoes(execucao.organizationId, execucao.planoId, MAXIMO_DE_VERSOES_LIDAS);
    const anteriores = historico.slice(historico.findIndex((v) => v.id === versao.id) + 1);
    if (execucao.tipo === 'criar') {
      return anteriores.filter((anterior) => anterior.agentRunId === execucao.agentRunId).map((anterior) => anterior.id);
    }
    const ids = new Set<string>();
    if (execucao.versaoBaseId !== null) ids.add(execucao.versaoBaseId);
    if (ajusteRespondeA !== null) ids.add(ajusteRespondeA);
    let encerrouEmAutorPessoa = false;
    for (const anterior of anteriores) {
      const descartada = await descartadaPorPessoa(execucao, anterior);
      if (descartada && anterior.status === 'revogado') break;
      if (descartada) continue;
      ids.add(anterior.id);
      if (anterior.autorTipo === 'usuario') {
        encerrouEmAutorPessoa = true;
        break;
      }
      if (anterior.status === 'vigente') break;
    }
    if (!encerrouEmAutorPessoa) {
      const vigente = (await estadoDoPlano(execucao))?.vigente;
      if (vigente) ids.add(vigente.id);
    }
    return [...ids];
  }

  async function planosBaseDoGate(execucao: Execucao, versao: Versao, ajusteRespondeA: string | null) {
    if (versao.autorTipo !== 'agente') return { exigePlanoBase: false, planosBase: undefined };
    const ids = await idsDasBasesDoGate(execucao, versao, ajusteRespondeA);
    if (ids.length === 0) return { exigePlanoBase: false, planosBase: undefined };
    const bases = await Promise.all(ids.map((id) => lerPlanoDaVersao(execucao, id)));
    if (bases.some((base) => base === null)) return { exigePlanoBase: true, planosBase: undefined };
    return { exigePlanoBase: true, planosBase: bases as Plano[] };
  }

  async function avaliarGate(execucao: Execucao, versao: Versao, eventos: readonly EventoDaVersao[], contexto: Contexto) {
    const plano = planoDe(versao.conteudo);
    const pacote = await pacoteComAsCitadas(execucao, contexto, plano, await lerPacote(execucao, contexto, false));
    const cadeia = await carregarCadeia(repositorio, execucao.organizationId, versao.id, eventos);
    const raiz = versaoDaRaizDaCadeia(cadeia, versao.id, execucao.agentRunId);
    const pareceres = raiz === null ? [] : pareceresDe(cadeia.get(raiz) ?? []);
    const eventoDoAjuste = eventos.find((e) => e.tipo === 'ajuste');
    const ajusteLido = eventoDoAjuste ? esquemaAjuste.safeParse(eventoDoAjuste.payload) : null;
    const base = await planosBaseDoGate(execucao, versao, ajusteLido?.success ? ajusteLido.data.responde_a : null);

    const limites = await avaliadorDeLimites.avaliador(execucao.organizationId, execucao.clientId, plano);
    if (!limites.ok) throw new FalhaDaEtapa('interno', true);

    const doJuiz = raiz === null ? undefined : vereditosDoEvento((cadeia.get(raiz) ?? []).find((evento) => evento.tipo === 'veredito_juiz')?.payload);
    const veredito = rodarGates({
      plano,
      pacote,
      hoje: relogio.agora().toISOString().slice(0, 10),
      pareceres,
      comiteDaMesmaExecucao: raiz !== null,
      ...(ajusteLido?.success ? { ajuste: ajusteLido.data } : {}),
      ...(doJuiz === undefined ? {} : { vereditosDoJuiz: doJuiz }),
      catalogosDeCampos: catalogos,
      avaliarLimite: limites.value,
      medidasComLimite: limites.value.medidasComLimite,
      exigePlanoBase: base.exigePlanoBase,
      ...(base.planosBase ? { planosBase: base.planosBase } : {}),
    });

    let modelo: SaidaDoGateDoModelo | null = null;
    if (veredito.resultado === 'aprovado') {
      const citadasPeloPlano = referenciasDoPlano(plano, { organizacaoId: execucao.organizationId, clienteId: execucao.clientId });
      const pacoteDoGate = pacoteParaEntrada(pacote, MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.gate, {
        primeiras: new Set(citadasPeloPlano.ok ? citadasPeloPlano.value.map((referencia) => referencia.urn) : []),
        comCatalogo: false,
      });
      const chave = `${execucao.id}:gate-modelo:${execucao.rodada}`;
      const dadosDoGate = {
        plano: planoParaOGateDeModelo(plano),
        resumoDoPacote: resumoDoPacote(pacoteDoGate),
        limitesDeclaradosComoNaoAplicaveis: plano.riscos_e_regras.limites_nao_aplicaveis,
        naoFaremosSoDeTexto: plano.estrategia.nao_faremos.filter((item) => item.teste === undefined).map((item) => ({ id: item.id, texto: item.texto })),
        regrasEDecisoesDoCliente: pacoteDoGate.entradas
          .filter((e) => e.tipo === 'regra' || e.tipo === 'decisao')
          .map((e) => ({ urn: e.urn, tipo: e.tipo, titulo: e.titulo, resumo: e.resumo.slice(0, 600) })),
      };
      modelo = await executarIA(execucao, contexto, 'gate', INSTRUCAO_DO_GATE_POR_MODELO, dadosDoGate, esquemaDoGateDoModelo, chave);
      if (!problemasDoGateSemDadoPessoal(modelo.problemas).ok) throw falhaDeIA('saida_invalida', 'dado_pessoal_no_gate');
    }
    const resultado: 'aprovado' | 'reprovado' = veredito.resultado === 'aprovado' && modelo?.resultado === 'aprovado' ? 'aprovado' : 'reprovado';
    const payload = truncarPayloadDoGate({ ...payloadDoGate(veredito), resultado }, modelo);
    return payload;
  }

  async function etapaGates(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    const versao = await versaoCorrente(execucao);
    let eventos = await repositorio.eventosDaVersao(execucao.organizationId, versao.id);
    let gate = await resultadoDoGateExistente(eventos);

    if (!gate) {
      const payload = await avaliarGate(execucao, versao, eventos, contexto);
      const chave = `${execucao.id}:gate:${execucao.rodada}`;
      const gravado = await repositorio.registrarEvento(execucao.organizationId, {
        versaoId: versao.id,
        tipo: 'gate',
        payload,
        autoria: autoria(execucao, AGENTE_DO_GATE, chave, contexto),
        requestId: requestIdDe(execucao, 'gate'),
      });
      if (!gravado.ok && gravado.error.codigo !== 'ja_feito') throw falhaDoBanco(gravado.error);
      eventos = await repositorio.eventosDaVersao(execucao.organizationId, versao.id);
      gate = await resultadoDoGateExistente(eventos);
    }
    const aprovado = gate?.payload.resultado === 'aprovado';
    const contagens = { versaoId: versao.id, gate: aprovado ? 'aprovado' : 'reprovado' };
    if (aprovado) return { proximo: { status: 'concluida', etapa: 'fim', erroCodigo: null, leaseAte: null }, contagens };
    if (execucao.rodada < maximoDeRodadas) return { proximo: { rodada: execucao.rodada + 1, etapa: 'ajustar' }, contagens };
    const erroCodigo = execucao.tipo === 'corrigir_gate' ? 'correcao_nao_convergiu' : 'gate_reprovado';
    return { proximo: { status: 'falhou', erroCodigo, leaseAte: null }, contagens };
  }

  async function executarEtapa(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    if (execucao.pedido.redigido === true) throw new FalhaDaEtapa('interno', false);
    switch (execucao.etapa) {
      case 'ler_brain':
        return etapaLerBrain(execucao, contexto);
      case 'redigir':
        return etapaRedigir(execucao, contexto);
      case 'comite':
        return etapaComite(execucao, contexto);
      case 'ajustar':
        return etapaAjustar(execucao, contexto);
      case 'gates':
        return etapaGates(execucao, contexto);
      case 'fim':
        return { proximo: { status: 'concluida', etapa: 'fim', erroCodigo: null, leaseAte: null } };
    }
  }

  async function auditar(execucao: Execucao, etapa: EtapaDaExecucao, status: string, extra: Record<string, unknown>) {
    await registrarSemFalhar(audit, {
      organizationId: execucao.organizationId,
      actorType: 'agent',
      actorId: AGENTE_DE_PLANO,
      action: 'strategy.run.step',
      targetType: 'strategy_plan_run',
      targetId: execucao.id,
      requestId: requestIdDe(execucao, `passo:${etapa}`),
      sourceIp: null,
      metadata: { clientId: execucao.clientId, planoId: execucao.planoId, kind: execucao.tipo, etapa, status, rodada: execucao.rodada, tentativas: execucao.tentativas, falhas: execucao.falhas, ...extra },
    });
  }

  async function aplicar(execucao: Execucao, mudanca: MudancaDaExecucao, ficha: number): Promise<ResultadoDoPasso | Execucao> {
    const atualizada = await repositorio.atualizarExecucao(execucao.organizationId, execucao.id, mudanca, ficha);
    if (atualizada.ok) return atualizada.value;
    const relida = await repositorio.lerExecucao(execucao.organizationId, execucao.id);
    if (atualizada.error.codigo === 'execucao_perdida') return { estado: 'perdida', execucao: relida };
    return { estado: 'final', execucao: relida };
  }

  async function falhar(execucao: Execucao, falha: FalhaDaEtapa, ficha: number): Promise<ResultadoDoPasso> {
    const reintentar = falha.transitoria && execucao.falhas + 1 < maximoDeTentativas;
    const mudanca: MudancaDaExecucao = reintentar
      ? { status: 'pendente', falhas: execucao.falhas + 1, leaseAte: null }
      : { status: 'falhou', falhas: execucao.falhas + 1, erroCodigo: falha.codigo, leaseAte: null };
    const resultado = await aplicar(execucao, mudanca, ficha);
    if ('estado' in resultado) return resultado;
    await auditar(execucao, execucao.etapa, reintentar ? 'adiada' : 'falhou', { codigo: falha.codigo, transitoria: falha.transitoria, ...(falha.motivo === null ? {} : { motivo: falha.motivo }) });
    return { estado: reintentar ? 'adiado' : 'final', execucao: resultado };
  }

  async function perdida(organizationId: string, execucaoId: string): Promise<ResultadoDoPasso> {
    return { estado: 'perdida', execucao: await repositorio.lerExecucao(organizationId, execucaoId) };
  }

  async function passo(organizationId: string, execucaoId: string, contexto: Contexto): Promise<ResultadoDoPasso> {
    const execucao = await repositorio.lerExecucao(organizationId, execucaoId);
    if (!execucao) return { estado: 'inexistente', execucao: null };
    if (ESTADOS_FINAIS.includes(execucao.status)) return { estado: 'final', execucao };
    if (execucao.status === 'pendente') return { estado: 'nao_reservada', execucao };
    const ficha = contexto.ficha;
    if (execucao.tentativas !== ficha) return { estado: 'perdida', execucao };

    let efeito: Efeito;
    try {
      efeito = await executarEtapa(execucao, contexto);
    } catch (erro) {
      const falha = erro instanceof FalhaDaEtapa ? erro : new FalhaDaEtapa('interno', true);
      if (falha.perdida) return perdida(organizationId, execucaoId);
      return falhar(execucao, falha, ficha);
    }
    const resultado = await aplicar(execucao, { leaseAte: novoLease(), ...efeito.proximo }, ficha);
    if ('estado' in resultado) return resultado;
    await auditar(execucao, execucao.etapa, resultado.status, { proximaEtapa: resultado.etapa, ...(efeito.contagens ?? {}) });
    return { estado: resultado.status === 'rodando' ? 'avancou' : 'final', execucao: resultado };
  }

  return {
    passo: (organizationId, execucaoId, ficha) => passo(organizationId, execucaoId, { ficha }),
    async avancarExecucao(organizationId, execucaoId, opcoes) {
      const limite = relogio.agora().getTime() + opcoes.orcamentoMs;
      const contexto: Contexto = { ficha: opcoes.ficha };
      let ultimo: ResultadoDoPasso;
      let passos = 0;
      do {
        ultimo = await passo(organizationId, execucaoId, contexto);
        passos += 1;
      } while (ultimo.estado === 'avancou' && relogio.agora().getTime() < limite);
      if (ultimo.estado === 'avancou' && ultimo.execucao) {
        const liberada = await repositorio.atualizarExecucao(organizationId, execucaoId, { status: 'pendente', leaseAte: null }, contexto.ficha);
        if (liberada.ok) return { estado: 'adiado', passos, execucao: liberada.value };
      }
      return { estado: ultimo.estado, passos, execucao: ultimo.execucao };
    },
  };
}
