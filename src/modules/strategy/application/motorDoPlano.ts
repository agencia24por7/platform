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
  esquemaIntencao,
  esquemaParecer,
  esquemaPlano,
  esquemaRespostaDoAjuste,
  fixarIntencao,
  hashesDoPacote,
  lerPlano,
  payloadDoGate,
  parecerSemDadoPessoal,
  planoSemDadoPessoal,
  problemasDoGateSemDadoPessoal,
  respostasDoAjusteSemDadoPessoal,
  sanitizarIntencao,
  referenciasDoPlano,
  referenciasImplicitasDoPacote,
  rodarGates,
  validarAjuste,
  type Ajuste,
  type Intencao,
  type PacoteDeLeitura,
  type Parecer,
  type Persona,
  type Plano,
  type StatusDaVersao,
  type TipoDeEvento,
} from '@/modules/strategy/domain/index';
import { carregarCadeia, pareceresDe, versaoDaRaizDaCadeia } from '@/modules/strategy/application/cadeiaDoComite';
import {
  INSTRUCAO_DO_GATE_POR_MODELO,
  INSTRUCAO_PARA_AJUSTAR_AO_COMITE,
  INSTRUCAO_PARA_AJUSTAR_PLANO,
  INSTRUCAO_PARA_ATUALIZAR_AO_BRAIN,
  INSTRUCAO_PARA_CRIAR_PLANO,
  instrucaoDaPersona,
} from '@/modules/strategy/application/instrucoes/index';
import { MAXIMO_DE_RESERVAS } from '@/modules/strategy/application/portas';
import type {
  AvaliadorDeLimites,
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
export const MAXIMO_DE_TENTATIVAS = 3;
export const PARALELISMO_DO_COMITE = 3;
export { MAXIMO_DE_RESERVAS };
export const LEASE_DA_EXECUCAO_MS = 300_000;
export const LIMITE_DO_PAYLOAD_DO_GATE_BYTES = 15_000;
export const MAXIMO_DE_PROBLEMAS_DO_GATE = 10;
export const MAXIMO_DE_VERSOES_LIDAS = 50;
export const AGENTE_DE_PLANO = 'agente_de_plano';
export const AGENTE_DO_GATE = 'gates';

export const ORCAMENTO_DA_IA: Readonly<Record<TarefaDeIA, { readonly tokensMaximos: number; readonly tempoMaximoMs: number }>> = {
  strategy_plan: { tokensMaximos: 60_000, tempoMaximoMs: 180_000 },
  comite: { tokensMaximos: 12_000, tempoMaximoMs: 60_000 },
  gate: { tokensMaximos: 8_000, tempoMaximoMs: 45_000 },
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

const esquemaDoAjusteDoModelo = z.strictObject({
  plano: esquemaPlano,
  respostas: z.array(esquemaRespostaDoAjuste).max(80),
});

export type EstadoDoPasso = 'avancou' | 'adiado' | 'final' | 'nao_reservada' | 'inexistente' | 'perdida';

export type ResultadoDoPasso = { readonly estado: EstadoDoPasso; readonly execucao: Execucao | null };

export type ResumoDoAvanco = { readonly estado: EstadoDoPasso; readonly passos: number; readonly execucao: Execucao | null };

export type OpcoesDoAvanco = { readonly orcamentoMs: number; readonly ficha: number };

export type DependenciasDoMotor = {
  readonly repositorio: RepositorioDeEstrategia;
  readonly executorDeIA: ExecutorDeIA;
  readonly leitorDoBrain: LeitorDoBrain;
  readonly avaliadorDeLimites: AvaliadorDeLimites;
  readonly audit: AuditRecorder;
  readonly relogio?: Relogio;
  readonly personas?: readonly Persona[];
  readonly maximoDeRodadas?: number;
  readonly maximoDeTentativas?: number;
  readonly paralelismoDoComite?: number;
  readonly leaseMs?: number;
};

export type MotorDoPlano = {
  passo(organizationId: string, execucaoId: string, ficha: number): Promise<ResultadoDoPasso>;
  avancarExecucao(organizationId: string, execucaoId: string, opcoes: OpcoesDoAvanco): Promise<ResumoDoAvanco>;
};

class FalhaDaEtapa extends Error {
  readonly codigo: CodigoDeErroDaExecucao;
  readonly transitoria: boolean;
  readonly perdida: boolean;

  constructor(codigo: CodigoDeErroDaExecucao, transitoria: boolean, perdida = false) {
    super(codigo);
    this.codigo = codigo;
    this.transitoria = transitoria;
    this.perdida = perdida;
  }
}

type Contexto = { pacote?: PacoteDeLeitura; readonly ficha: number };

type Efeito = {
  readonly proximo: Partial<MudancaDaExecucao>;
  readonly contagens?: Readonly<Record<string, number | string>>;
};

function falhaDeIA(codigo: CodigoDeErroDeIA): FalhaDaEtapa {
  return new FalhaDaEtapa(CODIGO_DA_FALHA_DE_IA[codigo], codigo !== 'nao_configurada' && codigo !== 'limite_atingido');
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

export function createMotorDoPlano(deps: DependenciasDoMotor): MotorDoPlano {
  const { repositorio, executorDeIA, leitorDoBrain, avaliadorDeLimites, audit } = deps;
  const relogio = deps.relogio ?? { agora: () => new Date() };
  const personas = deps.personas ?? PERSONAS;
  const maximoDeRodadas = deps.maximoDeRodadas ?? MAXIMO_DE_RODADAS;
  const maximoDeTentativas = deps.maximoDeTentativas ?? MAXIMO_DE_TENTATIVAS;
  const paralelismo = deps.paralelismoDoComite ?? PARALELISMO_DO_COMITE;
  const leaseMs = deps.leaseMs ?? LEASE_DA_EXECUCAO_MS;

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
  ): Promise<T> {
    await renovarLease(execucao, contexto);
    let resposta;
    try {
      resposta = await executorDeIA.executar<T>({
        tarefa,
        instrucoes,
        dados,
        esquema,
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
    if (!resposta.ok) throw falhaDeIA(resposta.error.codigo);
    const lida = esquema.safeParse(resposta.value.saida);
    if (!lida.success) throw falhaDeIA('saida_invalida');
    return lida.data;
  }

  function referenciasConferidas(plano: Plano, execucao: Execucao, pacote: PacoteDeLeitura) {
    const referencias = referenciasDoPlano(plano, { organizacaoId: execucao.organizationId, clienteId: execucao.clientId });
    if (!referencias.ok) throw falhaDeIA('saida_invalida');
    const hashes = hashesDoPacote(pacote);
    const comHash = referencias.value.map((ref) => ({ urn: ref.urn, papel: ref.papel, hash: hashes.get(ref.urn) }));
    if (comHash.some((ref) => ref.hash === undefined)) throw falhaDeIA('saida_invalida');
    const citadas = comHash.map((ref) => ({ urn: ref.urn, papel: ref.papel, hash: ref.hash! }));
    return combinarReferencias(citadas, referenciasImplicitasDoPacote(pacote));
  }

  async function estadoDoPlano(execucao: Execucao) {
    const planos = await repositorio.listarPlanosDoCliente({ organizationId: execucao.organizationId, clientId: execucao.clientId });
    return planos.find((p) => p.plano.id === execucao.planoId) ?? null;
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

  function criarDadosDeRedacao(execucao: Execucao, pacote: PacoteDeLeitura, base: Versao | null) {
    if (execucao.tipo === 'criar') {
      const intencao = esquemaIntencao.safeParse(execucao.pedido);
      if (!intencao.success) throw new FalhaDaEtapa('interno', false);
      const limpa = sanitizarIntencao(intencao.data);
      if (!limpa.ok) throw new FalhaDaEtapa('interno', false);
      return { instrucoes: INSTRUCAO_PARA_CRIAR_PLANO, dados: { intencao: limpa.value, pacote }, intencaoConfiavel: limpa.value };
    }
    if (!base) throw new FalhaDaEtapa('interno', false);
    const planoBase = planoDe(base.conteudo);
    if (execucao.tipo === 'ajustar') {
      const pedida = execucao.pedido.instrucao;
      if (typeof pedida !== 'string') throw new FalhaDaEtapa('interno', false);
      return {
        instrucoes: INSTRUCAO_PARA_AJUSTAR_PLANO,
        dados: { planoBase, instrucaoDaPessoa: textoSeguro(pedida), pacote },
        intencaoConfiavel: planoBase.intencao,
      };
    }
    return { instrucoes: INSTRUCAO_PARA_ATUALIZAR_AO_BRAIN, dados: { planoVigente: planoBase, pacote }, intencaoConfiavel: planoBase.intencao };
  }

  function comIntencaoFixada(plano: Plano, confiavel: Intencao): { plano: Plano; corrigida: number } {
    const fixada = fixarIntencao(plano, confiavel);
    return { plano: fixada.plano, corrigida: fixada.alterada ? 1 : 0 };
  }

  async function etapaRedigir(execucao: Execucao, contexto: Contexto): Promise<Efeito> {
    if ((await versoesDaExecucao(execucao)).length > 0) return { proximo: { etapa: 'comite' }, contagens: { jaRedigido: 1 } };
    const pacote = await lerPacote(execucao, contexto, false);
    const base = execucao.versaoBaseId ? await repositorio.lerVersao(execucao.organizationId, execucao.versaoBaseId) : null;
    const { instrucoes, dados, intencaoConfiavel } = criarDadosDeRedacao(execucao, pacote, base);
    const chave = `${execucao.id}:redigir:${execucao.rodada}`;
    const doModelo = await executarIA(execucao, contexto, 'strategy_plan', instrucoes, dados, esquemaPlano, chave);
    const { plano, corrigida } = comIntencaoFixada(doModelo, intencaoConfiavel);
    if (!planoSemDadoPessoal(plano).ok) throw falhaDeIA('saida_invalida');
    const referencias = referenciasConferidas(plano, execucao, pacote);
    const estado = await estadoDoPlano(execucao);
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
    return { proximo: { etapa: 'comite' }, contagens: { referencias: referencias.length, intencaoCorrigida: corrigida } };
  }

  async function executarPersona(execucao: Execucao, contexto: Contexto, versao: Versao, plano: Plano, pacote: PacoteDeLeitura, persona: Persona) {
    const chave = `${execucao.id}:parecer:${persona.chave}`;
    const dados = { plano, pacote, persona: { chave: persona.chave, nome: persona.nome, foco: persona.foco } };
    const bruto = await executarIA(execucao, contexto, 'comite', instrucaoDaPersona(persona), dados, esquemaParecer, chave);
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
    if (!parecerSemDadoPessoal(parecer).ok) throw falhaDeIA('saida_invalida');
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

  function pendenciasDoGate(eventos: readonly EventoDaVersao[]): string[] {
    const ultimo = [...eventos].reverse().find((e) => e.tipo === 'gate');
    if (!ultimo) return [];
    const checagens = Array.isArray(ultimo.payload.checagens) ? (ultimo.payload.checagens as { chave?: unknown; resultado?: unknown; motivo?: unknown }[]) : [];
    const doCodigo = checagens.filter((c) => c.resultado !== 'aprovado').map((c) => `${String(c.chave)}: ${String(c.motivo)}`);
    const modelo = ultimo.payload.modelo as { problemas?: { trecho?: unknown; problema?: unknown }[] } | null | undefined;
    const doModelo = (modelo?.problemas ?? []).map((p) => `${String(p.trecho)}: ${String(p.problema)}`);
    return [...doCodigo, ...doModelo];
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
    const plano = planoDe(versao.conteudo);
    const consolidacao = consolidarPareceres(pareceres, personas);
    const dados = {
      plano,
      pontos: consolidacao.argumentos,
      pendenciasObrigatorias: consolidacao.pendenciasObrigatorias,
      pendenciasDoGate: reprovouNoGate ? pendenciasDoGate(eventos) : [],
      pacote,
    };
    const chave = `${execucao.id}:ajustar:${execucao.rodada}`;
    const saida = await executarIA(execucao, contexto, 'strategy_plan', INSTRUCAO_PARA_AJUSTAR_AO_COMITE, dados, esquemaDoAjusteDoModelo, chave);

    const ajuste: Ajuste = { responde_a: versao.id, respostas: saida.respostas };
    const validado = esquemaAjuste.safeParse(ajuste);
    if (!validado.success) throw falhaDeIA('saida_invalida');
    if (!validarAjuste(pareceres, validado.data, personas).ok) throw falhaDeIA('saida_invalida');
    if (!respostasDoAjusteSemDadoPessoal(validado.data.respostas).ok) throw falhaDeIA('saida_invalida');
    const { plano: planoAjustado, corrigida } = comIntencaoFixada(saida.plano, plano.intencao);
    if (!planoSemDadoPessoal(planoAjustado).ok) throw falhaDeIA('saida_invalida');
    const referencias = referenciasConferidas(planoAjustado, execucao, pacote);
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
    return { proximo: { etapa: 'gates' }, contagens: { versaoId: criada.ok ? criada.value.id : versao.id, respostas: saida.respostas.length, intencaoCorrigida: corrigida } };
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

  async function foiDescartadaPorPessoa(execucao: Execucao, versao: VersaoResumo): Promise<boolean> {
    const evento = EVENTO_DE_DESCARTE[versao.status];
    if (evento === undefined) return false;
    const eventos = await repositorio.eventosDaVersao(execucao.organizationId, versao.id);
    return eventos.some((e) => e.tipo === evento && e.atorTipo === 'usuario');
  }

  async function idsDasBasesDoGate(execucao: Execucao, versao: Versao, ajusteRespondeA: string | null): Promise<string[]> {
    const ids = new Set<string>();
    if (execucao.versaoBaseId !== null) ids.add(execucao.versaoBaseId);
    if (ajusteRespondeA !== null) ids.add(ajusteRespondeA);
    const historico = await repositorio.listarVersoes(execucao.organizationId, execucao.planoId, MAXIMO_DE_VERSOES_LIDAS);
    const posicao = historico.findIndex((v) => v.id === versao.id);
    let chegouNaDecisaoDePessoa = false;
    for (const anterior of historico.slice(posicao + 1)) {
      if (await foiDescartadaPorPessoa(execucao, anterior)) {
        chegouNaDecisaoDePessoa = true;
        break;
      }
      ids.add(anterior.id);
      if (anterior.autorTipo === 'usuario' || anterior.status === 'vigente') {
        chegouNaDecisaoDePessoa = true;
        break;
      }
    }
    if (!chegouNaDecisaoDePessoa) {
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
    const pacote = await lerPacote(execucao, contexto, false);
    const plano = planoDe(versao.conteudo);
    const cadeia = await carregarCadeia(repositorio, execucao.organizationId, versao.id, eventos);
    const raiz = versaoDaRaizDaCadeia(cadeia, versao.id, execucao.agentRunId);
    const pareceres = raiz === null ? [] : pareceresDe(cadeia.get(raiz) ?? []);
    const eventoDoAjuste = eventos.find((e) => e.tipo === 'ajuste');
    const ajusteLido = eventoDoAjuste ? esquemaAjuste.safeParse(eventoDoAjuste.payload) : null;
    const base = await planosBaseDoGate(execucao, versao, ajusteLido?.success ? ajusteLido.data.responde_a : null);

    const limites = await avaliadorDeLimites.avaliador(execucao.organizationId, execucao.clientId, plano);
    if (!limites.ok) throw new FalhaDaEtapa('interno', true);

    const veredito = rodarGates({
      plano,
      pacote,
      hoje: relogio.agora().toISOString().slice(0, 10),
      pareceres,
      comiteDaMesmaExecucao: raiz !== null,
      ...(ajusteLido?.success ? { ajuste: ajusteLido.data } : {}),
      avaliarLimite: limites.value,
      medidasComLimite: limites.value.medidasComLimite,
      exigePlanoBase: base.exigePlanoBase,
      ...(base.planosBase ? { planosBase: base.planosBase } : {}),
    });

    let modelo: SaidaDoGateDoModelo | null = null;
    if (veredito.resultado === 'aprovado') {
      const chave = `${execucao.id}:gate-modelo:${execucao.rodada}`;
      const dadosDoGate = {
        plano,
        resumoDoPacote: resumoDoPacote(pacote),
        limitesDeclaradosComoNaoAplicaveis: plano.riscos_e_regras.limites_nao_aplicaveis,
        naoFaremosSoDeTexto: plano.estrategia.nao_faremos.filter((item) => item.teste === undefined).map((item) => ({ id: item.id, texto: item.texto })),
        regrasEDecisoesDoCliente: pacote.entradas
          .filter((e) => e.tipo === 'regra' || e.tipo === 'decisao')
          .map((e) => ({ urn: e.urn, tipo: e.tipo, titulo: e.titulo, resumo: e.resumo.slice(0, 600) })),
      };
      modelo = await executarIA(execucao, contexto, 'gate', INSTRUCAO_DO_GATE_POR_MODELO, dadosDoGate, esquemaDoGateDoModelo, chave);
      if (!problemasDoGateSemDadoPessoal(modelo.problemas).ok) throw falhaDeIA('saida_invalida');
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
    return { proximo: { status: 'falhou', erroCodigo: 'gate_reprovado', leaseAte: null }, contagens };
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
    await auditar(execucao, execucao.etapa, reintentar ? 'adiada' : 'falhou', { codigo: falha.codigo, transitoria: falha.transitoria });
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
