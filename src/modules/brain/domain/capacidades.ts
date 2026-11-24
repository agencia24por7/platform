import type { EntradaDoCatalogo } from './entrada.ts';
import { lacunasEssenciais, definicoesVigentesDoCatalogo, type RegrasParaCatalogo } from './regras.ts';
import { hojeEmSaoPaulo, somarDias } from './tempo.ts';

export type Requisito =
  | { readonly tipo: 'tabela_com_dado'; readonly rotulo: string; readonly tabelas: readonly string[]; readonly diasRecentes: number }
  | { readonly tipo: 'plataforma_vinculada'; readonly rotulo: string; readonly plataformas: readonly string[] }
  | { readonly tipo: 'contexto_secao'; readonly rotulo: string; readonly secao: string; readonly completudeMinima: number }
  | { readonly tipo: 'limites_essenciais'; readonly rotulo: string }
  | { readonly tipo: 'algum'; readonly rotulo: string; readonly requisitos: readonly Requisito[] };

export type DefinicaoDeCapacidade = {
  readonly id: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly perguntas: readonly string[];
  readonly requisitos: readonly Requisito[];
  readonly tags: readonly string[];
};

export type StatusDoRequisito = 'atendido' | 'parcial' | 'ausente';
export type StatusDaCapacidade = 'disponivel' | 'parcial' | 'indisponivel';

export type AvaliacaoDoRequisito = {
  readonly rotulo: string;
  readonly status: StatusDoRequisito;
  readonly evidencias: readonly string[];
  readonly faltando: readonly string[];
};

export type AvaliacaoDeCapacidade = {
  readonly id: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly perguntas: readonly string[];
  readonly status: StatusDaCapacidade;
  readonly evidencias: readonly string[];
  readonly faltando: readonly string[];
  readonly requisitos: readonly AvaliacaoDoRequisito[];
  readonly plataformasQueDesbloqueiam: readonly string[];
};

type Indice = {
  readonly tabelas: ReadonlyMap<string, EntradaDoCatalogo>;
  readonly fontesPorPlataforma: ReadonlyMap<string, readonly EntradaDoCatalogo[]>;
  readonly secoes: ReadonlyMap<string, EntradaDoCatalogo>;
  readonly contextoDisponivel: boolean;
  readonly regras: RegrasParaCatalogo | null;
  readonly limitesVigentes: ReadonlyMap<string, string>;
  readonly hoje: string;
};

export function indexar(entradas: readonly EntradaDoCatalogo[], agora: Date, regras: RegrasParaCatalogo | null = null): Indice {
  const tabelas = new Map<string, EntradaDoCatalogo>();
  const fontesPorPlataforma = new Map<string, EntradaDoCatalogo[]>();
  const secoes = new Map<string, EntradaDoCatalogo>();
  const limitesVigentes = new Map<string, string>();
  for (const entrada of entradas) {
    if (entrada.tipo === 'limite') limitesVigentes.set(entrada.id, entrada.urn);
    if (entrada.tipo === 'tabela_de_dados') tabelas.set(entrada.id, entrada);
    if (entrada.tipo === 'contexto_secao') secoes.set(entrada.id, entrada);
    if (entrada.tipo === 'fonte' && entrada.plataforma) {
      fontesPorPlataforma.set(entrada.plataforma, [...(fontesPorPlataforma.get(entrada.plataforma) ?? []), entrada]);
    }
  }
  return { tabelas, fontesPorPlataforma, secoes, contextoDisponivel: secoes.size > 0, regras, limitesVigentes, hoje: hojeEmSaoPaulo(agora) };
}

const ORDEM: readonly StatusDoRequisito[] = ['ausente', 'parcial', 'atendido'];

function melhor(avaliacoes: readonly AvaliacaoDoRequisito[], rotulo: string): AvaliacaoDoRequisito {
  if (avaliacoes.length === 0) return { rotulo, status: 'ausente', evidencias: [], faltando: [rotulo] };
  const topo = avaliacoes.reduce((acc, atual) => (ORDEM.indexOf(atual.status) > ORDEM.indexOf(acc.status) ? atual : acc));
  if (topo.status === 'atendido') return { ...topo, rotulo };
  return {
    rotulo,
    status: topo.status,
    evidencias: [...new Set(avaliacoes.flatMap((a) => a.evidencias))].sort(),
    faltando: [`${rotulo}: ${[...new Set(avaliacoes.flatMap((a) => a.faltando))].join(' ou ')}`],
  };
}

export function avaliarRequisito(requisito: Requisito, indice: Indice): AvaliacaoDoRequisito {
  const { rotulo } = requisito;
  switch (requisito.tipo) {
    case 'tabela_com_dado': {
      const limite = somarDias(indice.hoje, -requisito.diasRecentes);
      const presentes = requisito.tabelas.map((t) => indice.tabelas.get(t)).filter((e): e is EntradaDoCatalogo => e !== undefined);
      const recentes = presentes.filter((e) => (e.cobertura?.ate ?? '') >= limite);
      if (recentes.length > 0) return { rotulo, status: 'atendido', evidencias: recentes.map((e) => e.urn).sort(), faltando: [] };
      if (presentes.length > 0) {
        return {
          rotulo,
          status: 'parcial',
          evidencias: presentes.map((e) => e.urn).sort(),
          faltando: [`${rotulo}: sem dado nos últimos ${requisito.diasRecentes} dias`],
        };
      }
      return { rotulo, status: 'ausente', evidencias: [], faltando: [rotulo] };
    }
    case 'plataforma_vinculada': {
      const fontes = requisito.plataformas.flatMap((p) => indice.fontesPorPlataforma.get(p) ?? []);
      const ativas = fontes.filter((f) => f.frescor?.status !== 'parado');
      if (ativas.length > 0) return { rotulo, status: 'atendido', evidencias: ativas.map((f) => f.urn).sort(), faltando: [] };
      if (fontes.length > 0) {
        return { rotulo, status: 'parcial', evidencias: fontes.map((f) => f.urn).sort(), faltando: [`${rotulo}: coleta parada`] };
      }
      return { rotulo, status: 'ausente', evidencias: [], faltando: [rotulo] };
    }
    case 'contexto_secao': {
      const secao = indice.secoes.get(requisito.secao);
      if (!secao) {
        const motivo = indice.contextoDisponivel ? rotulo : `${rotulo} (contexto do cliente indisponível)`;
        return { rotulo, status: 'ausente', evidencias: [], faltando: [motivo] };
      }
      const completude = secao.qualidade.completude ?? 0;
      if (completude >= requisito.completudeMinima) return { rotulo, status: 'atendido', evidencias: [secao.urn], faltando: [] };
      const falta = `${rotulo}: ${Math.round(completude * 100)}% preenchido, mínimo ${Math.round(requisito.completudeMinima * 100)}%`;
      return { rotulo, status: completude > 0 ? 'parcial' : 'ausente', evidencias: completude > 0 ? [secao.urn] : [], faltando: [falta] };
    }
    case 'limites_essenciais': {
      if (!indice.regras) return { rotulo, status: 'ausente', evidencias: [], faltando: [`${rotulo} (regras do cliente indisponíveis)`] };
      const essenciais = definicoesVigentesDoCatalogo(indice.regras.definicoes).filter((d) => d.essencial && d.ativo);
      const faltam = lacunasEssenciais(indice.regras);
      const evidencias = [...indice.limitesVigentes.entries()]
        .filter(([id]) => essenciais.some((d) => id.startsWith(`${d.chave}--`)))
        .map(([, urn]) => urn)
        .sort();
      if (faltam.length === 0) return { rotulo, status: 'atendido', evidencias, faltando: [] };
      const falta = `${rotulo}: falta definir ${faltam.map((l) => l.chave).join(', ')}`;
      return { rotulo, status: evidencias.length > 0 ? 'parcial' : 'ausente', evidencias, faltando: [falta] };
    }
    case 'algum':
      return melhor(requisito.requisitos.map((filho) => avaliarRequisito(filho, indice)), rotulo);
  }
}

export function plataformasDoRequisito(requisito: Requisito): readonly string[] {
  if (requisito.tipo === 'plataforma_vinculada') return requisito.plataformas;
  if (requisito.tipo === 'algum') return requisito.requisitos.flatMap(plataformasDoRequisito);
  return [];
}

export function avaliarCapacidade(
  definicao: DefinicaoDeCapacidade,
  indice: Indice,
  plataformasDaTabela: (tabela: string) => readonly string[],
): AvaliacaoDeCapacidade {
  const requisitos = definicao.requisitos.map((requisito) => avaliarRequisito(requisito, indice));
  const todos = requisitos.every((r) => r.status === 'atendido');
  const algum = requisitos.some((r) => r.status !== 'ausente');
  const desbloqueiam = definicao.requisitos
    .filter((_, indiceDoRequisito) => requisitos[indiceDoRequisito]!.status !== 'atendido')
    .flatMap((requisito) => {
      const tabelas = coletarTabelas(requisito);
      return [...plataformasDoRequisito(requisito), ...tabelas.flatMap(plataformasDaTabela)];
    });
  return {
    id: definicao.id,
    titulo: definicao.titulo,
    descricao: definicao.descricao,
    perguntas: definicao.perguntas,
    status: todos ? 'disponivel' : algum ? 'parcial' : 'indisponivel',
    evidencias: [...new Set(requisitos.flatMap((r) => r.evidencias))].sort(),
    faltando: requisitos.flatMap((r) => r.faltando),
    requisitos,
    plataformasQueDesbloqueiam: [...new Set(desbloqueiam)].sort(),
  };
}

function coletarTabelas(requisito: Requisito): readonly string[] {
  if (requisito.tipo === 'tabela_com_dado') return requisito.tabelas;
  if (requisito.tipo === 'algum') return requisito.requisitos.flatMap(coletarTabelas);
  return [];
}

export function avaliarCapacidades(
  definicoes: readonly DefinicaoDeCapacidade[],
  entradas: readonly EntradaDoCatalogo[],
  agora: Date,
  plataformasDaTabela: (tabela: string) => readonly string[],
  regras: RegrasParaCatalogo | null = null,
): readonly AvaliacaoDeCapacidade[] {
  const indice = indexar(entradas, agora, regras);
  return [...definicoes].sort((a, b) => a.id.localeCompare(b.id)).map((d) => avaliarCapacidade(d, indice, plataformasDaTabela));
}

export function validarDefinicoes(definicoes: readonly DefinicaoDeCapacidade[], tabelasConhecidas: ReadonlySet<string>): readonly string[] {
  const problemas: string[] = [];
  const ids = new Set<string>();
  const verificar = (id: string, requisito: Requisito): void => {
    if (requisito.tipo === 'tabela_com_dado') {
      for (const tabela of requisito.tabelas) if (!tabelasConhecidas.has(tabela)) problemas.push(`${id}: tabela ${tabela} desconhecida`);
      if (requisito.tabelas.length === 0) problemas.push(`${id}: requisito sem tabela`);
    }
    if (requisito.tipo === 'contexto_secao' && (requisito.completudeMinima <= 0 || requisito.completudeMinima > 1)) {
      problemas.push(`${id}: completudeMinima fora de (0, 1]`);
    }
    if (requisito.tipo === 'algum') requisito.requisitos.forEach((filho) => verificar(id, filho));
  };
  for (const definicao of definicoes) {
    if (ids.has(definicao.id)) problemas.push(`${definicao.id}: id repetido`);
    ids.add(definicao.id);
    if (!/^[a-z][a-z0-9_]{1,47}$/.test(definicao.id)) problemas.push(`${definicao.id}: id fora do padrão`);
    if (definicao.requisitos.length === 0) problemas.push(`${definicao.id}: sem requisitos`);
    definicao.requisitos.forEach((requisito) => verificar(definicao.id, requisito));
  }
  return problemas;
}
