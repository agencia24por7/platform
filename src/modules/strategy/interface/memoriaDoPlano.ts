import type { PainelDoPlano } from '../application/estrategiaService.ts';
import type { EventoDaVersao, VersaoResumo } from '../application/portas.ts';
import { lerUrn } from '../../brain/domain/urn.ts';
import { comitePorChave } from '../domain/comite/comites.ts';
import { PREFIXO_DO_MOTIVO_DO_JUIZ } from '../domain/comite/juiz.ts';
import { lerPlano, type SecaoDoPlano } from '../domain/plano.ts';
import { ROTULO_DO_STATUS } from '../domain/status.ts';
import { textoDoFocoCompleto } from './focoNaTela.ts';
import { dataEHoraBr, periodoBr, reais } from './formatosDoPlano.ts';
import { tituloDoPlano } from './cardsDePlano.ts';
import type { EntradaDoBrainConhecida } from './visaoDoPlano.ts';
import {
  ROTULO_DA_OUSADIA,
  ROTULO_DA_PLATAFORMA_DO_PLANO,
  ROTULO_DO_MOTIVO_DE_IMPACTO,
  ROTULO_DO_PAPEL_DA_EVIDENCIA,
  ROTULO_DO_TIPO_DE_ENTRADA,
  TITULO_DA_SECAO,
} from './rotulosDoPlano.ts';

export const TITULO_DA_MEMORIA = 'Memória do plano';
export const ROTULO_DO_BOTAO_DA_MEMORIA = 'Baixar memória do plano';
export const AUTOR_AUTOMATICO = 'Revisão automática';
export const LIMITE_DE_VERSOES_DA_MEMORIA = 10;

const TEMA_SEM_SECAO = 'Plano';
const PREFIXO_DOS_SINAIS_DE_CULTURA = 'culture_';
const NIVEIS_DE_IMPACTO: Readonly<Record<string, string>> = { informativo: 'informativo', material: 'material' };
const ROTULO_DO_MARCO: Readonly<Record<string, string>> = {
  proposta: 'Enviada para autorização',
  efetivada: 'Autorizada',
  rejeitada: 'Rejeitada',
  revogada: 'Revogada',
  cancelada: 'Cancelada',
};

export type LinhaDaVersao = {
  readonly id: string;
  readonly rotulo: string;
  readonly quando: string;
  readonly tipo: string;
  readonly autor: string;
  readonly status: string;
  readonly marcos: readonly string[];
};

export type DecisaoDaMemoria = {
  readonly tema: string;
  readonly autor: string;
  readonly acatada: boolean;
  readonly decisao: string;
  readonly motivo: string;
};

export type DecisoesDaVersao = { readonly versao: string; readonly quando: string; readonly itens: readonly DecisaoDaMemoria[] };

export type FonteCitada = { readonly titulo: string; readonly nota: string | null; readonly papel: string };

export type IntencaoDaMemoria = {
  readonly objetivo: string;
  readonly foco: string | null;
  readonly horizonte: string;
  readonly verba: string;
  readonly ousadia: string;
  readonly plataformas: readonly string[];
};

export type CreditosDaMemoria = { readonly pessoas: readonly string[]; readonly comites: readonly string[] };

export type MemoriaDoPlano = {
  readonly titulo: string;
  readonly nomeDoArquivo: string;
  readonly versoes: readonly LinhaDaVersao[];
  readonly versoesParciais: boolean;
  readonly intencao: IntencaoDaMemoria | null;
  readonly decisoes: readonly DecisoesDaVersao[];
  readonly cultura: readonly FonteCitada[];
  readonly evidencias: readonly FonteCitada[];
  readonly creditos: CreditosDaMemoria;
  readonly resultados: readonly string[];
};

export type EntradaDaMemoria = {
  readonly painel: PainelDoPlano;
  readonly entradasDoBrain?: ReadonlyMap<string, EntradaDoBrainConhecida>;
};

const limpar = (texto: unknown): string => (typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : '');

const porCriacao = (a: { readonly criadaEm: Date }, b: { readonly criadaEm: Date }) => a.criadaEm.getTime() - b.criadaEm.getTime();

function nomeDoArquivoDe(titulo: string): string {
  const slug = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `memoria-do-plano${slug === '' ? '' : `-${slug}`}.md`;
}

function criarRotuladorDePessoas(ordemDeAparicao: readonly string[]) {
  const numeros = new Map<string, number>();
  for (const id of ordemDeAparicao) if (!numeros.has(id)) numeros.set(id, numeros.size + 1);
  return (id: string | null): string => (id === null ? AUTOR_AUTOMATICO : `Pessoa ${numeros.get(id) ?? 0}`);
}

function tipoDaVersao(versao: VersaoResumo, temAjuste: boolean): string {
  if (versao.supersedesId === null) return 'Criação do plano';
  if (versao.autorTipo === 'usuario') return 'Edição manual';
  return temAjuste ? 'Ajuste após a revisão' : 'Mudança pelo agente';
}

function autorDaVersao(versao: VersaoResumo, pessoa: (id: string | null) => string): string {
  return versao.autorTipo === 'usuario' && versao.autorUsuarioId !== null ? pessoa(versao.autorUsuarioId) : AUTOR_AUTOMATICO;
}

function autorDoComite(persona: string): string {
  return comitePorChave(persona)?.nome ?? AUTOR_AUTOMATICO;
}

function temaDoTrecho(trecho: string | undefined): string {
  const secao = (trecho ?? '').split('/')[0] ?? '';
  return TITULO_DA_SECAO[secao as SecaoDoPlano] ?? TEMA_SEM_SECAO;
}

function trechosDosPontos(eventosDaVersaoRespondida: readonly EventoDaVersao[]): ReadonlyMap<string, string> {
  const trechos = new Map<string, string>();
  for (const evento of eventosDaVersaoRespondida) {
    if (evento.tipo !== 'parecer') continue;
    const persona = limpar(evento.payload.persona);
    const pontos = Array.isArray(evento.payload.pontos) ? (evento.payload.pontos as { id?: unknown; trecho?: unknown }[]) : [];
    for (const ponto of pontos) if (typeof ponto.id === 'string' && typeof ponto.trecho === 'string') trechos.set(`${persona}/${ponto.id}`, ponto.trecho);
  }
  return trechos;
}

function decisoesDoAjuste(ajuste: EventoDaVersao, eventosPorVersao: ReadonlyMap<string, readonly EventoDaVersao[]>): readonly DecisaoDaMemoria[] {
  const respondida = typeof ajuste.payload.responde_a === 'string' ? ajuste.payload.responde_a : '';
  const trechos = trechosDosPontos([...(eventosPorVersao.get(ajuste.versaoId) ?? []), ...(eventosPorVersao.get(respondida) ?? [])]);
  const respostas = Array.isArray(ajuste.payload.respostas) ? (ajuste.payload.respostas as Record<string, unknown>[]) : [];
  return respostas
    .map((resposta): DecisaoDaMemoria | null => {
      const persona = limpar(resposta.persona);
      const motivo = limpar(resposta.motivo).replace(new RegExp(`^${PREFIXO_DO_MOTIVO_DO_JUIZ}`), '');
      if (resposta.decisao !== 'acatado' && resposta.decisao !== 'nao_acatado') return null;
      const acatada = resposta.decisao === 'acatado';
      return {
        tema: temaDoTrecho(trechos.get(`${persona}/${limpar(resposta.pontoId)}`)),
        autor: autorDoComite(persona),
        acatada,
        decisao: acatada ? 'Acatado' : 'Não acatado',
        motivo,
      };
    })
    .filter((decisao): decisao is DecisaoDaMemoria => decisao !== null)
    .sort((a, b) => a.tema.localeCompare(b.tema, 'pt-BR') || a.autor.localeCompare(b.autor, 'pt-BR'));
}

function fonteCitada(urn: string, papel: string, entradas: ReadonlyMap<string, EntradaDoBrainConhecida> | undefined): FonteCitada {
  const conhecida = entradas?.get(urn);
  const tipo = lerUrn(urn)?.tipo ?? '';
  const titulo = limpar(conhecida?.titulo) || `Entrada de ${ROTULO_DO_TIPO_DE_ENTRADA[tipo] ?? 'contexto'} (indisponível agora)`;
  return { titulo, nota: conhecida?.nota ?? null, papel: ROTULO_DO_PAPEL_DA_EVIDENCIA[papel] ?? papel };
}

function intencaoDaMemoria(painel: PainelDoPlano): IntencaoDaMemoria | null {
  const lido = painel.versaoExibida ? lerPlano(painel.versaoExibida.conteudo) : null;
  if (!lido?.ok) return null;
  const intencao = lido.value.intencao;
  return {
    objetivo: limpar(intencao.objetivo),
    foco: textoDoFocoCompleto(intencao.foco),
    horizonte: periodoBr(intencao.horizonte),
    verba: reais(intencao.verba),
    ousadia: ROTULO_DA_OUSADIA[intencao.ousadia] ?? intencao.ousadia,
    plataformas: (intencao.plataformas ?? []).map((plataforma) => ROTULO_DA_PLATAFORMA_DO_PLANO[plataforma] ?? plataforma),
  };
}

function resultadosDaMemoria(painel: PainelDoPlano): readonly string[] {
  const anotados = painel.historico.eventos
    .filter((evento) => evento.tipo === 'impacto_anotado')
    .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
    .map((evento) => {
      const nivel = NIVEIS_DE_IMPACTO[limpar(evento.payload.impacto)];
      return `Impacto anotado em ${dataEHoraBr(evento.criadoEm)}${nivel ? `: ${nivel}` : ''}`;
    });
  const atual = painel.desatualizado;
  if (atual === null || atual === 'indisponivel' || atual.impacto === 'nenhum') return anotados;
  const motivos = [...new Set(atual.itens.map((item) => ROTULO_DO_MOTIVO_DE_IMPACTO[item.motivo] ?? item.motivo))];
  return [...anotados, `Contexto do cliente mudou desde a autorização (${atual.impacto}): ${motivos.join('; ')}`];
}

export function memoriaDoPlano(entrada: EntradaDaMemoria): MemoriaDoPlano {
  const { painel, entradasDoBrain } = entrada;
  const versoes = [...painel.historico.versoes].sort(porCriacao);
  const eventosPorVersao = new Map<string, EventoDaVersao[]>();
  for (const evento of [...painel.historico.eventos].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())) {
    eventosPorVersao.set(evento.versaoId, [...(eventosPorVersao.get(evento.versaoId) ?? []), evento]);
  }

  const aparicoes = [
    ...versoes.flatMap((versao) => [versao.autorUsuarioId, ...(eventosPorVersao.get(versao.id) ?? []).map((evento) => evento.atorUsuarioId)]),
  ].filter((id): id is string => id !== null);
  const pessoa = criarRotuladorDePessoas(aparicoes);
  const rotuloDaVersao = new Map(versoes.map((versao, indice) => [versao.id, `Versão ${indice + 1}`] as const));

  const linhas = versoes.map((versao): LinhaDaVersao => {
    const eventos = eventosPorVersao.get(versao.id) ?? [];
    return {
      id: versao.id,
      rotulo: rotuloDaVersao.get(versao.id) ?? '',
      quando: dataEHoraBr(versao.criadaEm),
      tipo: tipoDaVersao(versao, eventos.some((evento) => evento.tipo === 'ajuste')),
      autor: autorDaVersao(versao, pessoa),
      status: ROTULO_DO_STATUS[versao.status],
      marcos: eventos
        .filter((evento) => ROTULO_DO_MARCO[evento.tipo] !== undefined)
        .map((evento) => `${ROTULO_DO_MARCO[evento.tipo]} por ${evento.atorUsuarioId === null ? AUTOR_AUTOMATICO : pessoa(evento.atorUsuarioId)} em ${dataEHoraBr(evento.criadoEm)}`),
    };
  });

  const decisoes = versoes.flatMap((versao): DecisoesDaVersao[] => {
    const ajuste = (eventosPorVersao.get(versao.id) ?? []).find((evento) => evento.tipo === 'ajuste');
    if (!ajuste) return [];
    const itens = decisoesDoAjuste(ajuste, eventosPorVersao);
    return itens.length === 0 ? [] : [{ versao: rotuloDaVersao.get(versao.id) ?? '', quando: dataEHoraBr(versao.criadaEm), itens }];
  });

  const citadas = (painel.versaoExibida?.referencias ?? []).map((referencia) => ({ referencia, tipo: lerUrn(referencia.urn)?.tipo ?? '' }));
  const fonte = ({ referencia }: (typeof citadas)[number]) => fonteCitada(referencia.urn, referencia.papel, entradasDoBrain);
  const cultura = citadas.filter(({ tipo }) => tipo.startsWith(PREFIXO_DOS_SINAIS_DE_CULTURA)).map(fonte);
  const evidencias = citadas.filter(({ tipo }) => !tipo.startsWith(PREFIXO_DOS_SINAIS_DE_CULTURA)).map(fonte);

  const personas = new Set<string>();
  for (const evento of painel.historico.eventos) if (evento.tipo === 'parecer') personas.add(limpar(evento.payload.persona));
  const comites = [...personas].flatMap((persona) => {
    const comite = comitePorChave(persona);
    return comite ? [comite.nome] : [];
  });

  const papeisDasPessoas = new Map<string, Set<string>>();
  const marcar = (id: string | null, papel: string) => {
    if (id === null) return;
    papeisDasPessoas.set(id, (papeisDasPessoas.get(id) ?? new Set()).add(papel));
  };
  for (const versao of versoes) {
    if (versao.autorTipo === 'usuario') marcar(versao.autorUsuarioId, 'editou');
    for (const evento of eventosPorVersao.get(versao.id) ?? []) {
      if (evento.tipo === 'proposta') marcar(evento.atorUsuarioId, 'enviou para autorização');
      if (evento.tipo === 'efetivada') marcar(evento.atorUsuarioId, 'autorizou');
    }
  }
  const pessoas = [...papeisDasPessoas.entries()]
    .map(([id, papeis]) => ({ nome: pessoa(id), papeis: [...papeis] }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map(({ nome, papeis }) => `${nome}: ${papeis.join(', ')}`);

  const intencao = intencaoDaMemoria(painel);
  const titulo = tituloDoPlano(intencao?.objetivo ?? null, painel.plano.tipo);
  return {
    titulo,
    nomeDoArquivo: nomeDoArquivoDe(titulo),
    versoes: linhas,
    versoesParciais: versoes.length >= LIMITE_DE_VERSOES_DA_MEMORIA,
    intencao,
    decisoes,
    cultura,
    evidencias,
    creditos: { pessoas, comites: comites.sort((a, b) => a.localeCompare(b, 'pt-BR')) },
    resultados: resultadosDaMemoria(painel),
  };
}

export function memoriaTemConteudo(memoria: MemoriaDoPlano): boolean {
  return memoria.versoes.length > 0;
}
