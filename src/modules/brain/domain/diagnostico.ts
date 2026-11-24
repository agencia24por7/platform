import type { AvaliacaoDeCapacidade } from './capacidades.ts';
import type { ContextoParaCatalogo, ItemDoContexto } from './contexto.ts';
import type { EntradaDoCatalogo, StatusDeFrescor } from './entrada.ts';
import { lacunasEssenciais, propostasPendentes, type LacunaEssencial, type RegrasParaCatalogo } from './regras.ts';
import type { ConexaoDoInventario, InventarioDoCliente, ResumoDeColetas } from './inventario.ts';

export const VERSAO_DO_DIAGNOSTICO = 2;

export type ConectorDoDiagnostico = {
  readonly plataforma: string;
  readonly rotulo: string;
  readonly paraQueServe: string;
  readonly coletavel: boolean;
};

export type EstadoDoConector = 'conectado' | 'precisa_reautorizar' | 'conexao_sem_vinculo' | 'nao_conectado' | 'fora_da_coleta';

export type ConectorDiagnosticado = {
  readonly plataforma: string;
  readonly rotulo: string;
  readonly estado: EstadoDoConector;
  readonly fontes: readonly string[];
  readonly desbloqueia: readonly string[];
  readonly paraQueServe: string;
};

export type FonteDiagnosticada = {
  readonly urn: string;
  readonly plataforma: string;
  readonly titulo: string;
  readonly frescor: StatusDeFrescor;
  readonly dadoAte: string | null;
  readonly diasFaltando: number | null;
  readonly lacunas: readonly { readonly de: string; readonly ate: string; readonly dias: number }[];
  readonly falhasRecentes: Readonly<Record<string, number>>;
  readonly parciaisRecentes: number;
  readonly pausadaAte: string | null;
};

export type SecaoDiagnosticada = {
  readonly secao: string;
  readonly titulo: string;
  readonly percentual: number;
  readonly essenciaisCompletos: boolean;
  readonly essenciaisFaltando: number;
  readonly sugestoesPendentes: number;
  readonly hipotesesEmEssenciais: number;
};

export type Contradicao = { readonly secao: string; readonly chave: string; readonly descricao: string };

export type ContextoDiagnosticado = {
  readonly geral: number;
  readonly essenciaisCompletos: boolean;
  readonly secoes: readonly SecaoDiagnosticada[];
  readonly contradicoes: readonly Contradicao[];
  readonly sugestoesPendentes: number;
};

export type AvisoDeQualidade = {
  readonly tipo: string;
  readonly fonte: string;
  readonly ocorrencias: number;
  readonly explicacao: string;
};

export type TipoDeAcao =
  | 'reautorizar'
  | 'vincular_recurso'
  | 'conectar'
  | 'investigar_coleta'
  | 'recuperar_lacuna'
  | 'preencher_contexto'
  | 'confirmar_sugestoes'
  | 'resolver_contradicao'
  | 'definir_limite'
  | 'decidir_propostas';

export type AcaoRecomendada = {
  readonly id: string;
  readonly tipo: TipoDeAcao;
  readonly impacto: number;
  readonly titulo: string;
  readonly motivo: string;
  readonly alvo: string | null;
};

export type RegrasDiagnosticadas = {
  readonly vigentes: number;
  readonly propostasPendentes: number;
  readonly aRevisar: number;
  readonly lacunasEssenciais: readonly LacunaEssencial[];
};

export type Diagnostico = {
  readonly schemaVersion: number;
  readonly resumo: {
    readonly conectores: Readonly<Record<EstadoDoConector, number>>;
    readonly fontes: Readonly<Record<StatusDeFrescor, number>>;
    readonly capacidades: Readonly<Record<AvaliacaoDeCapacidade['status'], number>>;
    readonly contexto: { readonly disponivel: boolean; readonly geral: number | null; readonly essenciaisCompletos: boolean | null };
    readonly acoes: number;
  };
  readonly conectores: readonly ConectorDiagnosticado[];
  readonly fontes: readonly FonteDiagnosticada[];
  readonly contexto: ContextoDiagnosticado | null;
  readonly regras: RegrasDiagnosticadas | null;
  readonly qualidade: readonly AvisoDeQualidade[];
  readonly acoes: readonly AcaoRecomendada[];
};

export type EntradaDoDiagnostico = {
  readonly entradas: readonly EntradaDoCatalogo[];
  readonly inventario: InventarioDoCliente;
  readonly contexto: ContextoParaCatalogo | null;
  readonly regras?: RegrasParaCatalogo | null;
  readonly capacidades: readonly AvaliacaoDeCapacidade[];
  readonly conectores: readonly ConectorDoDiagnostico[];
};

const STATUS_QUE_PEDEM_REAUTORIZACAO = new Set(['reauth_pending', 'revoked', 'degraded']);

export const EXPLICACAO_DOS_AVISOS: Readonly<Record<string, string>> = {
  limiar_de_privacidade: 'A plataforma omitiu valores abaixo do limiar de privacidade: números pequenos podem estar subcontados.',
  linhas_agrupadas: 'A plataforma agrupou linhas raras em "(other)": detalhe fino pode faltar.',
  alcance_omitido: 'Alcance não informado em alguns dias: não some alcance entre dias.',
  receita_indisponivel: 'Receita não disponível para parte do período.',
  parcial_aceita: 'Uma janela ficou parcial três vezes e foi aceita para não travar a coleta.',
  versao_da_api: 'A versão da API mudou durante o período.',
  uso_de_cota: 'A coleta chegou perto do limite de uso da API.',
  limite_de_uso: 'Coletas falharam por limite de uso da API; o dado pode estar atrasado.',
  falha_coletor: 'O coletor falhou em execuções recentes.',
  coleta_incompleta: 'Execuções recentes terminaram incompletas.',
  parcial: 'Execuções recentes terminaram parciais (dias podem estar incompletos).',
};

function contarPor<T extends string>(chaves: readonly T[], valores: readonly T[]): Record<T, number> {
  const contagem = Object.fromEntries(chaves.map((chave) => [chave, 0])) as Record<T, number>;
  for (const valor of valores) contagem[valor] += 1;
  return contagem;
}

function estadoDoConector(
  conector: ConectorDoDiagnostico,
  fontes: readonly EntradaDoCatalogo[],
  conexoes: readonly ConexaoDoInventario[],
): EstadoDoConector {
  const daPlataforma = conexoes.filter((c) => c.platform === conector.plataforma);
  const precisaReautorizar = daPlataforma.some((c) => STATUS_QUE_PEDEM_REAUTORIZACAO.has(c.status));
  if (fontes.length > 0) return precisaReautorizar && daPlataforma.every((c) => STATUS_QUE_PEDEM_REAUTORIZACAO.has(c.status)) ? 'precisa_reautorizar' : 'conectado';
  if (!conector.coletavel) return 'fora_da_coleta';
  if (daPlataforma.length > 0) return precisaReautorizar ? 'precisa_reautorizar' : 'conexao_sem_vinculo';
  return 'nao_conectado';
}

function diagnosticarConectores(entrada: EntradaDoDiagnostico): readonly ConectorDiagnosticado[] {
  const fontes = entrada.entradas.filter((e) => e.tipo === 'fonte');
  return entrada.conectores.map((conector) => {
    const daPlataforma = fontes.filter((f) => f.plataforma === conector.plataforma);
    return {
      plataforma: conector.plataforma,
      rotulo: conector.rotulo,
      estado: estadoDoConector(conector, daPlataforma, entrada.inventario.conexoesDaOrganizacao),
      fontes: daPlataforma.map((f) => f.urn).sort(),
      desbloqueia: entrada.capacidades
        .filter((c) => c.status !== 'disponivel' && c.plataformasQueDesbloqueiam.includes(conector.plataforma))
        .map((c) => c.id),
      paraQueServe: conector.paraQueServe,
    };
  });
}

function diagnosticarFontes(entrada: EntradaDoDiagnostico): readonly FonteDiagnosticada[] {
  const coletas = new Map<string, ResumoDeColetas>(entrada.inventario.coletas.map((c) => [c.fonteId, c]));
  return entrada.entradas
    .filter((e) => e.tipo === 'fonte')
    .map((fonte) => {
      const resumo = coletas.get(fonte.id);
      return {
        urn: fonte.urn,
        plataforma: fonte.plataforma ?? 'desconhecida',
        titulo: fonte.titulo,
        frescor: fonte.frescor?.status ?? 'desconhecido',
        dadoAte: fonte.frescor?.dadoAte ?? null,
        diasFaltando: fonte.cobertura?.diasFaltando ?? null,
        lacunas: fonte.cobertura?.lacunas ?? [],
        falhasRecentes: resumo?.falhasRecentes ?? {},
        parciaisRecentes: resumo?.parciaisRecentes ?? 0,
        pausadaAte: resumo?.pausadaAte ? resumo.pausadaAte.toISOString() : null,
      };
    });
}

function normalizar(texto: unknown): string {
  return typeof texto === 'string' ? texto.normalize('NFKD').replace(/\p{M}+/gu, '').trim().toLowerCase() : '';
}

function contradicoesDaLista(secao: string, listKey: string, campoTitulo: string | undefined, itens: readonly ItemDoContexto[]): readonly Contradicao[] {
  if (!campoTitulo) return [];
  const porTitulo = new Map<string, Set<string>>();
  for (const item of itens) {
    const titulo = normalizar(item.dados[campoTitulo]);
    if (!titulo) continue;
    porTitulo.set(titulo, new Set([...(porTitulo.get(titulo) ?? []), item.epistemico]));
  }
  return [...porTitulo.entries()]
    .filter(([, marcas]) => marcas.size > 1)
    .map(([, marcas]) => ({
      secao,
      chave: listKey,
      descricao: `Itens da lista ${listKey} com o mesmo título aparecem marcados como ${[...marcas].sort().join(' e ')}.`,
    }));
}

export function diagnosticarContexto(contexto: ContextoParaCatalogo): ContextoDiagnosticado {
  const completudePorSecao = new Map(contexto.completude.secoes.map((s) => [s.secao, s]));
  const contradicoes: Contradicao[] = [];
  let pendentesTotal = 0;
  const secoes = contexto.catalogo.map((secao): SecaoDiagnosticada => {
    const completude = completudePorSecao.get(secao.key);
    const valores = Object.values(contexto.campos).filter((v) => v.secao === secao.key && secao.campos.some((c) => c.key === v.fieldKey));
    const itens = secao.campos.flatMap((campo) => (campo.tipo === 'lista' ? contexto.listas[campo.key] ?? [] : []));
    const essenciais = new Set(secao.campos.filter((c) => c.nivel === 'essencial').map((c) => c.key));
    const sugestoesPendentes = [...valores, ...itens].filter((m) => m.revisao === 'sugerido').length;
    const hipotesesEmEssenciais = valores.filter((v) => essenciais.has(v.fieldKey) && v.epistemico === 'hipotese').length;
    pendentesTotal += sugestoesPendentes;
    for (const campo of secao.campos) {
      if (campo.tipo === 'lista') contradicoes.push(...contradicoesDaLista(secao.key, campo.key, campo.campoTitulo, contexto.listas[campo.key] ?? []));
    }
    return {
      secao: secao.key,
      titulo: secao.titulo,
      percentual: completude?.percentual ?? 0,
      essenciaisCompletos: completude?.essenciaisCompletos ?? false,
      essenciaisFaltando: completude ? Math.max(completude.essenciaisTotal - completude.essenciaisPreenchidos, 0) : essenciais.size,
      sugestoesPendentes,
      hipotesesEmEssenciais,
    };
  });
  return {
    geral: contexto.completude.geral,
    essenciaisCompletos: contexto.completude.essenciaisCompletos,
    secoes,
    contradicoes,
    sugestoesPendentes: pendentesTotal,
  };
}

export function diagnosticarRegras(regras: RegrasParaCatalogo): RegrasDiagnosticadas {
  return {
    vigentes: regras.decisoes.filter((d) => d.vigente).length,
    propostasPendentes: propostasPendentes(regras),
    aRevisar: regras.decisoes.filter((d) => d.aRevisar && d.status !== 'rejeitada' && d.status !== 'revogada').length,
    lacunasEssenciais: lacunasEssenciais(regras),
  };
}

function avisosDeQualidade(entrada: EntradaDoDiagnostico): readonly AvisoDeQualidade[] {
  const urnPorFonte = new Map(entrada.entradas.filter((e) => e.tipo === 'fonte').map((e) => [e.id, e.urn]));
  const avisos: AvisoDeQualidade[] = [];
  for (const resumo of entrada.inventario.coletas) {
    const urn = urnPorFonte.get(resumo.fonteId);
    if (!urn) continue;
    const ocorrencias: Record<string, number> = { ...resumo.avisosRecentes };
    for (const [codigo, quantidade] of Object.entries(resumo.falhasRecentes)) ocorrencias[codigo] = (ocorrencias[codigo] ?? 0) + quantidade;
    for (const [causa, quantidade] of Object.entries(resumo.faltantesRecentes)) ocorrencias[causa] = (ocorrencias[causa] ?? 0) + quantidade;
    if (resumo.parciaisRecentes > 0) ocorrencias.parcial = (ocorrencias.parcial ?? 0) + resumo.parciaisRecentes;
    for (const [tipo, quantidade] of Object.entries(ocorrencias)) {
      if (quantidade <= 0) continue;
      avisos.push({ tipo, fonte: urn, ocorrencias: quantidade, explicacao: EXPLICACAO_DOS_AVISOS[tipo] ?? `Ocorrência recente: ${tipo}.` });
    }
  }
  return avisos.sort((a, b) => `${a.fonte}|${a.tipo}`.localeCompare(`${b.fonte}|${b.tipo}`));
}

function acoesRecomendadas(
  entrada: EntradaDoDiagnostico,
  conectores: readonly ConectorDiagnosticado[],
  fontes: readonly FonteDiagnosticada[],
  contexto: ContextoDiagnosticado | null,
  regras: RegrasDiagnosticadas | null,
): readonly AcaoRecomendada[] {
  const acoes: AcaoRecomendada[] = [];
  const titulos = new Map(entrada.capacidades.map((c) => [c.id, c.titulo]));
  const listaDeCapacidades = (ids: readonly string[]) => ids.map((id) => titulos.get(id) ?? id).join(', ');

  for (const conector of conectores) {
    const ganhos = conector.desbloqueia.length;
    if (conector.estado === 'precisa_reautorizar') {
      acoes.push({
        id: `reautorizar:${conector.plataforma}`,
        tipo: 'reautorizar',
        impacto: 100,
        titulo: `Reautorizar ${conector.rotulo}`,
        motivo: 'A autorização expirou ou foi revogada: a coleta parou para as fontes desta conexão.',
        alvo: conector.fontes[0] ?? null,
      });
    }
    if (conector.estado === 'conexao_sem_vinculo') {
      acoes.push({
        id: `vincular:${conector.plataforma}`,
        tipo: 'vincular_recurso',
        impacto: 70 + Math.min(ganhos, 5) * 4,
        titulo: `Vincular um recurso de ${conector.rotulo} a este cliente`,
        motivo: ganhos > 0 ? `A organização já tem a conexão; vincular libera: ${listaDeCapacidades(conector.desbloqueia)}.` : 'A organização já tem a conexão, mas nenhum recurso dela está vinculado a este cliente.',
        alvo: null,
      });
    }
    if (conector.estado === 'nao_conectado' && ganhos > 0) {
      acoes.push({
        id: `conectar:${conector.plataforma}`,
        tipo: 'conectar',
        impacto: 50 + Math.min(ganhos, 5) * 6,
        titulo: `Conectar ${conector.rotulo}`,
        motivo: `Libera: ${listaDeCapacidades(conector.desbloqueia)}.`,
        alvo: null,
      });
    }
  }

  for (const fonte of fontes) {
    if (fonte.frescor === 'parado' || fonte.frescor === 'atrasado') {
      const parado = fonte.frescor === 'parado';
      acoes.push({
        id: `investigar:${fonte.urn}`,
        tipo: 'investigar_coleta',
        impacto: parado ? 80 : 55,
        titulo: `${parado ? 'Coleta parada' : 'Coleta atrasada'}: ${fonte.titulo}`,
        motivo: fonte.dadoAte ? `Dado mais recente em ${fonte.dadoAte}.` : 'Ainda não há coleta concluída desta fonte.',
        alvo: fonte.urn,
      });
    }
    const faltando = fonte.diasFaltando ?? 0;
    if (faltando > 0 && fonte.frescor !== 'parado') {
      acoes.push({
        id: `lacuna:${fonte.urn}`,
        tipo: 'recuperar_lacuna',
        impacto: 40 + Math.min(faltando, 30),
        titulo: `Recuperar ${faltando} dia(s) sem coleta: ${fonte.titulo}`,
        motivo: 'Há intervalos sem coleta concluída dentro do histórico; um backfill da janela resolve.',
        alvo: fonte.urn,
      });
    }
  }

  if (contexto) {
    for (const secao of contexto.secoes) {
      if (secao.essenciaisFaltando > 0) {
        acoes.push({
          id: `preencher:${secao.secao}`,
          tipo: 'preencher_contexto',
          impacto: 35 + Math.min(secao.essenciaisFaltando, 5) * 3,
          titulo: `Preencher ${secao.essenciaisFaltando} campo(s) essencial(is) de ${secao.titulo}`,
          motivo: `Seção em ${secao.percentual}%: sem os essenciais o agente responde com menos contexto.`,
          alvo: null,
        });
      }
      if (secao.sugestoesPendentes > 0) {
        acoes.push({
          id: `confirmar:${secao.secao}`,
          tipo: 'confirmar_sugestoes',
          impacto: 30,
          titulo: `Revisar ${secao.sugestoesPendentes} sugestão(ões) pendente(s) em ${secao.titulo}`,
          motivo: 'Sugestões não confirmadas não entram no brain do contexto.',
          alvo: null,
        });
      }
    }
    for (const contradicao of contexto.contradicoes) {
      acoes.push({
        id: `contradicao:${contradicao.secao}:${contradicao.chave}`,
        tipo: 'resolver_contradicao',
        impacto: 33,
        titulo: `Resolver marcação divergente em ${contradicao.secao}`,
        motivo: contradicao.descricao,
        alvo: null,
      });
    }
  }

  if (regras) {
    for (const lacuna of regras.lacunasEssenciais) {
      acoes.push({
        id: `definir_limite:${lacuna.chave}`,
        tipo: 'definir_limite',
        impacto: 45,
        titulo: `Definir o limite: ${lacuna.nome}`,
        motivo: 'Sem este limite vigente o agente não tem teto para planejar nem para agir; registre em Regras do cliente.',
        alvo: null,
      });
    }
    if (regras.propostasPendentes > 0) {
      acoes.push({
        id: 'decidir_propostas',
        tipo: 'decidir_propostas',
        impacto: 32,
        titulo: `Decidir ${regras.propostasPendentes} proposta(s) de regra ou limite`,
        motivo: 'Propostas de agentes não valem até uma pessoa efetivar ou rejeitar.',
        alvo: null,
      });
    }
  }

  const unicas = [...new Map(acoes.map((a) => [a.id, a])).values()];
  return unicas.sort((a, b) => b.impacto - a.impacto || a.id.localeCompare(b.id));
}

export function diagnosticarCliente(entrada: EntradaDoDiagnostico): Diagnostico {
  const conectores = diagnosticarConectores(entrada);
  const fontes = diagnosticarFontes(entrada);
  const contexto = entrada.contexto ? diagnosticarContexto(entrada.contexto) : null;
  const regras = entrada.regras ? diagnosticarRegras(entrada.regras) : null;
  const acoes = acoesRecomendadas(entrada, conectores, fontes, contexto, regras);
  return {
    schemaVersion: VERSAO_DO_DIAGNOSTICO,
    resumo: {
      conectores: contarPor(['conectado', 'precisa_reautorizar', 'conexao_sem_vinculo', 'nao_conectado', 'fora_da_coleta'], conectores.map((c) => c.estado)),
      fontes: contarPor(['fresco', 'atrasado', 'parado', 'desconhecido'], fontes.map((f) => f.frescor)),
      capacidades: contarPor(['disponivel', 'parcial', 'indisponivel'], entrada.capacidades.map((c) => c.status)),
      contexto: {
        disponivel: contexto !== null,
        geral: contexto?.geral ?? null,
        essenciaisCompletos: contexto?.essenciaisCompletos ?? null,
      },
      acoes: acoes.length,
    },
    conectores,
    fontes,
    contexto,
    regras,
    qualidade: avisosDeQualidade(entrada),
    acoes,
  };
}
