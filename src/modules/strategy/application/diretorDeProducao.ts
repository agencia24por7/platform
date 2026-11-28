import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import { CATALOGOS_DISPONIVEIS } from '@/modules/strategy/domain/catalogo/disponiveis';
import type { CatalogoDeCampos } from '@/modules/strategy/domain/catalogo/tipos';
import { abreviarUrnsParaCodigos, codigosDoPacote, esquemaQueAceitaCodigos, type CodigosDoPacote } from '@/modules/strategy/domain/codigosCurtos';
import { pacoteParaEntrada, type PacoteDeLeitura } from '@/modules/strategy/domain/pacote';
import { lerPlano, type Campanha, type Periodo, type Plano } from '@/modules/strategy/domain/plano';
import {
  TIPO_DA_ANTI_REFERENCIA,
  TIPO_DA_REFERENCIA_CRIATIVA,
  conferirPlanoDeProducao,
  conferirProducaoDaCampanha,
  janelaDoCalendario,
  motivoDaConferencia,
  type ProblemaDaProducao,
} from '@/modules/strategy/domain/producao/conferencia';
import { especificacaoParaModelo, especificacoesDaPlataforma } from '@/modules/strategy/domain/producao/especificacoes';
import {
  SCHEMA_VERSION_DA_PRODUCAO,
  TAMANHO_MAXIMO_DA_CAMPANHA_BYTES,
  TAMANHO_MAXIMO_DO_PLANO_DE_PRODUCAO_BYTES,
  tamanhoEmBytes,
  esquemaPlanoDeProducao,
  esquemaProducaoDaCampanha,
  type PlanoDeProducao,
  type ProducaoDaCampanha,
} from '@/modules/strategy/domain/producao/planoDeProducao';
import { INSTRUCAO_DO_DIRETOR_DE_PRODUCAO } from '@/modules/strategy/application/instrucoes/diretorDeProducao';
import { ORCAMENTO_DA_IA } from '@/modules/strategy/application/motorDoPlano';
import type { CodigoDeErroDeIA, ExecutorDeIA, LeitorDoBrain, Relogio, RepositorioDeEstrategia } from '@/modules/strategy/application/portas';
import type { CodigoDeErroDaProducao, MudancaDaProducao, RegistroDeProducao, RepositorioDeProducao } from '@/modules/strategy/application/portasDaProducao';
import { failure, type Failure } from '@/shared/result/failure';
import { ok, type Result } from '@/shared/result/result';
import { logger } from '@/shared/logging/logger';

export const AGENTE_DE_PRODUCAO = 'diretor_de_producao';
export const LEASE_DA_PRODUCAO_MS = 300_000;
export const ORCAMENTO_DA_ROTA_DE_PRODUCAO_MS = 240_000;
export const MAXIMO_DE_FALHAS_TRANSITORIAS_DA_PRODUCAO = 3;
export const MAXIMO_DE_BYTES_DO_PACOTE_DA_PRODUCAO = 30_000;
export const MAXIMO_DE_ERROS_DEVOLVIDOS = 20;

export type ResumoDaProducao = {
  readonly encontradas: number;
  readonly reservadas: number;
  readonly prontas: number;
  readonly falhas: number;
  readonly adiadas: number;
  readonly perdidas: number;
  readonly chamadas: number;
  readonly codigos: Readonly<Record<string, number>>;
};

export type DependenciasDoDiretor = {
  readonly repositorio: RepositorioDeProducao;
  readonly estrategia: Pick<RepositorioDeEstrategia, 'lerVersao'>;
  readonly leitorDoBrain: Pick<LeitorDoBrain, 'lerPacote'>;
  readonly executorDeIA: ExecutorDeIA;
  readonly audit?: AuditRecorder;
  readonly relogio?: Relogio;
  readonly catalogos?: readonly CatalogoDeCampos[];
  readonly orcamentoTotalMs?: number;
  readonly leaseMs?: number;
};

export type DiretorDeProducao = {
  avancar(entrada: { readonly limite: number }): Promise<Result<ResumoDaProducao, Failure>>;
};

const CODIGO_DA_FALHA_DE_IA: Readonly<Record<CodigoDeErroDeIA, CodigoDeErroDaProducao>> = {
  nao_configurada: 'ia_nao_configurada',
  limite_atingido: 'ia_limite',
  saida_invalida: 'ia_saida_invalida',
  falha_do_fornecedor: 'ia_falha',
  tempo_esgotado: 'ia_tempo',
};

const TRANSITORIOS: readonly CodigoDeErroDaProducao[] = ['ia_falha', 'ia_tempo', 'brain_indisponivel'];

class FalhaDaProducao extends Error {
  readonly codigo: CodigoDeErroDaProducao;
  readonly motivoCompacto: string;

  constructor(codigo: CodigoDeErroDaProducao, motivoCompacto: string) {
    super(codigo);
    this.codigo = codigo;
    this.motivoCompacto = motivoCompacto;
  }
}

class ReservaPerdida extends Error {
  constructor() {
    super('reserva_perdida');
  }
}

class EscritaRecusada extends Error {
  constructor() {
    super('escrita_recusada');
  }
}

type Desfecho = 'pronta' | 'falhou' | 'adiada' | 'perdida';

function caminhosDoEsquema(mensagem: string): string[] {
  const achado = /\[esquema:([a-z0-9_.,]*)\]$/i.exec(mensagem)?.[1];
  return achado ? achado.split(',').filter((caminho) => caminho.length > 0) : [];
}

type VersaoLida = Awaited<ReturnType<DependenciasDoDiretor['estrategia']['lerVersao']>>;

function versaoUtilizavel(versao: VersaoLida, registro: RegistroDeProducao): versao is NonNullable<VersaoLida> {
  return versao !== null && versao.planoId === registro.planoId && versao.status === 'vigente' && versao.redigidaEm === null;
}

function motivoDaVersao(versao: VersaoLida): string {
  return `versao:${versao?.status ?? 'inexistente'}`;
}

function contextoDoPlano(plano: Plano, campanha: Campanha) {
  const segmento = plano.publico_alvo.segmentos.find((item) => item.id === campanha.segmento_id);
  return {
    objetivo: plano.resumo_executivo.objetivo,
    aposta_central: plano.resumo_executivo.aposta_central.texto,
    promessa: plano.posicionamento_e_mensagem.promessa.texto,
    provas: plano.posicionamento_e_mensagem.provas.map((prova) => prova.texto),
    tom: plano.posicionamento_e_mensagem.tom,
    a_marca_nao_diz: plano.posicionamento_e_mensagem.a_marca_nao_diz,
    segmento: segmento ? { nome: segmento.nome, descricao: segmento.descricao.texto, momentos_de_compra: segmento.momentos_de_compra } : null,
    nao_faremos: plano.estrategia.nao_faremos.map((item) => item.texto),
    regras: plano.riscos_e_regras.regras_aplicaveis.map((regra) => regra.resumo),
  };
}

function pacoteDoModelo(pacote: PacoteDeLeitura) {
  const criativas = new Set(
    pacote.entradas.filter((entrada) => entrada.tipo === TIPO_DA_REFERENCIA_CRIATIVA || entrada.tipo === TIPO_DA_ANTI_REFERENCIA).map((entrada) => entrada.urn),
  );
  return pacoteParaEntrada(pacote, MAXIMO_DE_BYTES_DO_PACOTE_DA_PRODUCAO, { primeiras: criativas, comCatalogo: false }).entradas.map((entrada) => ({
    ref: entrada.ref,
    tipo: entrada.tipo,
    titulo: entrada.titulo,
    resumo: entrada.resumo,
    nota: entrada.evidencia?.nota ?? null,
    somenteMetadados: entrada.somenteMetadados,
  }));
}

export function createDiretorDeProducao(deps: DependenciasDoDiretor): DiretorDeProducao {
  const relogio = deps.relogio ?? { agora: () => new Date() };
  const catalogos = deps.catalogos ?? CATALOGOS_DISPONIVEIS;
  const orcamentoTotalMs = deps.orcamentoTotalMs ?? ORCAMENTO_DA_ROTA_DE_PRODUCAO_MS;
  const leaseMs = deps.leaseMs ?? LEASE_DA_PRODUCAO_MS;
  const orcamentoDaChamada = ORCAMENTO_DA_IA.diretor_de_producao;

  async function atualizar(registro: RegistroDeProducao, ficha: number, mudanca: MudancaDaProducao): Promise<RegistroDeProducao> {
    const resultado = await deps.repositorio.atualizar(registro.organizationId, registro.id, ficha, mudanca);
    if (resultado.ok) return resultado.value;
    if (resultado.error.codigo === 'execucao_perdida') throw new ReservaPerdida();
    throw new EscritaRecusada();
  }

  const novoLease = () => new Date(relogio.agora().getTime() + leaseMs);

  async function auditar(registro: RegistroDeProducao, status: string, metadados: Record<string, unknown>): Promise<void> {
    if (!deps.audit) return;
    await registrarSemFalhar(deps.audit, {
      organizationId: registro.organizationId,
      actorType: 'agent',
      actorId: AGENTE_DE_PRODUCAO,
      action: 'strategy.production.step',
      targetType: 'strategy_production_plan',
      targetId: registro.id,
      requestId: `producao:${registro.id}:${registro.tentativas}:${status}`.slice(0, 120),
      sourceIp: null,
      metadata: { clientId: registro.clientId, planoId: registro.planoId, versaoId: registro.versaoId, numero: registro.numero, status, tentativas: registro.tentativas, ...metadados },
    });
  }

  async function pedirAoModelo(
    registro: RegistroDeProducao,
    ficha: number,
    dados: Record<string, unknown>,
    codigos: CodigosDoPacote,
    chave: string,
    contador: { chamadas: number },
    prefixoEstavel: number,
  ): Promise<{ readonly ok: true; readonly saida: ProducaoDaCampanha } | { readonly ok: false; readonly codigo: CodigoDeErroDeIA; readonly caminhos: string[] }> {
    await atualizar(registro, ficha, { leaseAte: novoLease() });
    contador.chamadas += 1;
    const resposta = await deps.executorDeIA.executar<ProducaoDaCampanha>({
      tarefa: 'diretor_de_producao',
      instrucoes: INSTRUCAO_DO_DIRETOR_DE_PRODUCAO,
      dados,
      ...(prefixoEstavel > 0 ? { prefixoEstavelDosDados: prefixoEstavel } : {}),
      esquema: esquemaQueAceitaCodigos(esquemaProducaoDaCampanha, codigos),
      orcamento: orcamentoDaChamada,
      organizacaoId: registro.organizationId,
      clienteId: registro.clientId,
      execucaoId: registro.id,
      chaveDeIdempotencia: chave,
    });
    await atualizar(registro, ficha, { leaseAte: novoLease() });
    if (!resposta.ok) return { ok: false, codigo: resposta.error.codigo, caminhos: caminhosDoEsquema(resposta.error.mensagem) };
    const lida = esquemaQueAceitaCodigos(esquemaProducaoDaCampanha, codigos).safeParse(resposta.value.saida);
    if (!lida.success) return { ok: false, codigo: 'saida_invalida', caminhos: lida.error.issues.slice(0, 5).map((problema) => problema.path.map(String).join('.')) };
    return { ok: true, saida: lida.data };
  }

  function falhaDeIA(codigo: CodigoDeErroDeIA, campanhaId: string): FalhaDaProducao {
    const traduzido = CODIGO_DA_FALHA_DE_IA[codigo];
    return new FalhaDaProducao(traduzido, `campanha:${campanhaId}:ia:${codigo}`);
  }

  function dadosDaCampanha(plano: Plano, campanha: Campanha, pacote: PacoteDeLeitura, janela: Periodo): Record<string, unknown> {
    const especificacoes = campanha.plataforma === undefined ? null : especificacoesDaPlataforma(campanha.plataforma, catalogos);
    return {
      pacote: pacoteDoModelo(pacote),
      janela,
      especificacoes: especificacoes === null ? null : especificacoes.map(especificacaoParaModelo),
      contexto: contextoDoPlano(plano, campanha),
      campanha,
    };
  }

  async function gerarCampanha(
    registro: RegistroDeProducao,
    ficha: number,
    plano: Plano,
    campanha: Campanha,
    pacote: PacoteDeLeitura,
    janela: Periodo,
    contador: { chamadas: number },
    prefixoEstavel: number,
  ): Promise<ProducaoDaCampanha> {
    const codigos = codigosDoPacote(pacote);
    const base = dadosDaCampanha(plano, campanha, pacote, janela);
    const contextoDaConferencia = { plano, campanhaId: campanha.id, pacote, janela, catalogos };
    const chave = `${registro.agentRunId}:producao:${campanha.id}`;

    const primeira = await pedirAoModelo(registro, ficha, base, codigos, `${chave}:0`, contador, prefixoEstavel);
    let erros: readonly { readonly caminho: string; readonly codigo: string }[];
    let anterior: ProducaoDaCampanha | null = null;
    if (primeira.ok) {
      const problemas: readonly ProblemaDaProducao[] = conferirProducaoDaCampanha(primeira.saida, contextoDaConferencia);
      if (problemas.length === 0) return primeira.saida;
      erros = problemas;
      anterior = primeira.saida;
    } else {
      if (primeira.codigo !== 'saida_invalida') throw falhaDeIA(primeira.codigo, campanha.id);
      erros = primeira.caminhos.map((caminho) => ({ caminho, codigo: 'fora_do_esquema' }));
    }

    const dadosDaCorrecao = {
      ...base,
      erros: erros.slice(0, MAXIMO_DE_ERROS_DEVOLVIDOS),
      ...(anterior === null ? {} : { respostaAnterior: abreviarUrnsParaCodigos(anterior, codigos) }),
    };
    const segunda = await pedirAoModelo(registro, ficha, dadosDaCorrecao, codigos, `${chave}:1`, contador, prefixoEstavel);
    if (!segunda.ok) {
      if (segunda.codigo === 'saida_invalida') {
        throw new FalhaDaProducao('ia_saida_invalida', `campanha:${campanha.id}:esquema:${segunda.caminhos.slice(0, 3).join(',')}`);
      }
      throw falhaDeIA(segunda.codigo, campanha.id);
    }
    const restantes = conferirProducaoDaCampanha(segunda.saida, contextoDaConferencia);
    if (restantes.length > 0) throw new FalhaDaProducao('conferencia_reprovada', motivoDaConferencia(`campanha:${campanha.id}`, restantes));
    return segunda.saida;
  }

  function progressoValido(registro: RegistroDeProducao, plano: Plano, pacote: PacoteDeLeitura, janela: Periodo): Map<string, ProducaoDaCampanha> {
    const validos = new Map<string, ProducaoDaCampanha>();
    for (const [campanhaId, bruto] of Object.entries(registro.progresso)) {
      const lido = esquemaProducaoDaCampanha.safeParse(bruto);
      if (!lido.success) continue;
      if (conferirProducaoDaCampanha(lido.data, { plano, campanhaId, pacote, janela, catalogos }).length > 0) continue;
      validos.set(campanhaId, lido.data);
    }
    return validos;
  }

  function referenciasDoResultado(campanhas: readonly ProducaoDaCampanha[], pacote: PacoteDeLeitura): PlanoDeProducao['referencias'] {
    const urns = new Set(campanhas.flatMap((item) => item.entregaveis.flatMap((entregavel) => [...entregavel.referencias.map((ref) => ref.urn), ...entregavel.evidencias.map((ev) => ev.urn)])));
    return pacote.entradas.filter((entrada) => urns.has(entrada.urn)).map((entrada) => ({ urn: entrada.urn, hash: entrada.hash, tipo: entrada.tipo, titulo: entrada.titulo }));
  }

  async function falhar(registro: RegistroDeProducao, ficha: number, codigo: CodigoDeErroDaProducao, motivo: string): Promise<Desfecho> {
    const final = await atualizar(registro, ficha, { status: 'falhou', erroCodigo: codigo, motivo: motivoDaConferencia(motivo, []).replace(/:$/, '') || 'falha', leaseAte: null });
    await auditar(final, 'falhou', { codigo });
    return 'falhou';
  }

  async function processar(registro: RegistroDeProducao, prazo: number, contador: { chamadas: number }): Promise<Desfecho> {
    const ficha = registro.tentativas;
    try {
      const versao = await deps.estrategia.lerVersao(registro.organizationId, registro.versaoId);
      if (!versaoUtilizavel(versao, registro)) {
        return await falhar(registro, ficha, 'plano_fora_do_estado', motivoDaVersao(versao));
      }
      const lido = lerPlano(versao.conteudo);
      if (!lido.ok) return await falhar(registro, ficha, 'interno', 'plano_invalido');
      const plano = lido.value;
      if (plano.campanhas.campanhas.length === 0) return await falhar(registro, ficha, 'plano_sem_campanhas', 'plano_sem_campanhas');
      const pacoteLido = await deps.leitorDoBrain.lerPacote(registro.organizationId, registro.clientId);
      if (!pacoteLido.ok) throw new FalhaDaProducao('brain_indisponivel', 'brain_indisponivel');
      const pacote = pacoteLido.value;
      const janela = janelaDoCalendario(plano);
      const prontas = progressoValido(registro, plano, pacote, janela);
      const prefixoEstavel = deps.executorDeIA.prefixoEstavel?.(plano.campanhas.campanhas.map((campanha) => dadosDaCampanha(plano, campanha, pacote, janela))) ?? 0;

      for (const campanha of plano.campanhas.campanhas) {
        if (prontas.has(campanha.id)) continue;
        if (tamanhoEmBytes(Object.fromEntries(prontas)) > TAMANHO_MAXIMO_DO_PLANO_DE_PRODUCAO_BYTES - TAMANHO_MAXIMO_DA_CAMPANHA_BYTES) {
          return await falhar(registro, ficha, 'conferencia_reprovada', 'plano:=grande_demais');
        }
        const atual = await deps.estrategia.lerVersao(registro.organizationId, registro.versaoId);
        if (!versaoUtilizavel(atual, registro)) return await falhar(registro, ficha, 'plano_fora_do_estado', motivoDaVersao(atual));
        if (prazo - relogio.agora().getTime() < orcamentoDaChamada.tempoMaximoMs) {
          await atualizar(registro, ficha, { progresso: Object.fromEntries(prontas), leaseAte: null });
          await auditar(registro, 'adiada', { campanhasProntas: prontas.size, campanhas: plano.campanhas.campanhas.length });
          return 'adiada';
        }
        prontas.set(campanha.id, await gerarCampanha(registro, ficha, plano, campanha, pacote, janela, contador, prefixoEstavel));
        await atualizar(registro, ficha, { progresso: Object.fromEntries(prontas), leaseAte: novoLease() });
      }

      const campanhas = plano.campanhas.campanhas.map((campanha) => prontas.get(campanha.id)!);
      const conteudo: PlanoDeProducao = { schema_version: SCHEMA_VERSION_DA_PRODUCAO, janela, campanhas, referencias: referenciasDoResultado(campanhas, pacote) };
      const valido = esquemaPlanoDeProducao.safeParse(conteudo);
      if (!valido.success) return await falhar(registro, ficha, 'interno', 'conteudo_fora_do_esquema');
      const problemas = conferirPlanoDeProducao(valido.data, plano);
      if (problemas.length > 0) return await falhar(registro, ficha, 'conferencia_reprovada', motivoDaConferencia('plano', problemas));
      const final = await atualizar(registro, ficha, { status: 'pronto', conteudo: valido.data, progresso: {}, leaseAte: null });
      await auditar(final, 'pronto', {
        campanhas: campanhas.length,
        entregaveis: campanhas.reduce((total, item) => total + item.entregaveis.length, 0),
        referencias: valido.data.referencias.length,
      });
      return 'pronta';
    } catch (erro) {
      if (erro instanceof ReservaPerdida) return 'perdida';
      if (erro instanceof EscritaRecusada) return await falhar(registro, ficha, 'interno', 'escrita_recusada');
      if (!(erro instanceof FalhaDaProducao)) throw erro;
      if (!TRANSITORIOS.includes(erro.codigo) || registro.falhas + 1 >= MAXIMO_DE_FALHAS_TRANSITORIAS_DA_PRODUCAO) {
        return await falhar(registro, ficha, erro.codigo, erro.motivoCompacto);
      }
      await atualizar(registro, ficha, { falhas: registro.falhas + 1, leaseAte: null });
      await auditar(registro, 'adiada', { codigo: erro.codigo, transitoria: true });
      return 'adiada';
    }
  }

  return {
    async avancar({ limite }) {
      const inicio = relogio.agora().getTime();
      const prazo = inicio + orcamentoTotalMs;
      let pendentes;
      try {
        pendentes = await deps.repositorio.descobrirPendentes(limite);
      } catch {
        return { ok: false, error: failure('unavailable', 'Não foi possível listar os planos de produção pendentes.') };
      }
      const contador = { chamadas: 0 };
      const resumo = { encontradas: pendentes.length, reservadas: 0, prontas: 0, falhas: 0, adiadas: 0, perdidas: 0 };
      const codigos: Record<string, number> = {};
      for (const pendente of pendentes) {
        if (prazo - relogio.agora().getTime() < orcamentoDaChamada.tempoMaximoMs) break;
        try {
          const reservado = await deps.repositorio.reservar(pendente.organizationId, pendente.id, leaseMs);
          if (!reservado) continue;
          resumo.reservadas += 1;
          if (reservado.status !== 'pendente') {
            resumo.falhas += 1;
            codigos[reservado.erroCodigo ?? 'interno'] = (codigos[reservado.erroCodigo ?? 'interno'] ?? 0) + 1;
            continue;
          }
          const desfecho = await processar(reservado, prazo, contador);
          if (desfecho === 'pronta') resumo.prontas += 1;
          else if (desfecho === 'adiada') resumo.adiadas += 1;
          else if (desfecho === 'perdida') resumo.perdidas += 1;
          else {
            resumo.falhas += 1;
            const lido = await deps.repositorio.ler(pendente.organizationId, pendente.id);
            const codigo = lido?.erroCodigo ?? 'interno';
            codigos[codigo] = (codigos[codigo] ?? 0) + 1;
          }
        } catch (erro) {
          resumo.falhas += 1;
          codigos['excecao'] = (codigos['excecao'] ?? 0) + 1;
          logger.error('strategy.producao.excecao', { erro: erro instanceof Error ? erro.constructor.name : typeof erro, organizationId: pendente.organizationId, producaoId: pendente.id });
        }
      }
      return ok({ ...resumo, chamadas: contador.chamadas, codigos });
    },
  };
}
