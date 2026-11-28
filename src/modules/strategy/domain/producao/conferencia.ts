import type { CatalogoDeCampos } from '../catalogo/tipos.ts';
import { CATALOGOS_DISPONIVEIS } from '../catalogo/disponiveis.ts';
import { centavosDe, somaDeCentavos, type Dinheiro } from '../dinheiro.ts';
import type { PacoteDeLeitura } from '../pacote.ts';
import type { Campanha, Periodo, Plano } from '../plano.ts';
import { planoSemDadoPessoal } from '../privacidadeDoPlano.ts';
import { especificacoesDaPlataforma, type EspecificacaoDoCampo, type MidiaDoCampo } from './especificacoes.ts';
import {
  TAMANHO_MAXIMO_DA_CAMPANHA_BYTES,
  TAMANHO_MAXIMO_DO_PLANO_DE_PRODUCAO_BYTES,
  tamanhoEmBytes,
  type Entregavel,
  type PlanoDeProducao,
  type ProducaoDaCampanha,
  type TipoDeEntregavel,
} from './planoDeProducao.ts';

export const CODIGOS_DA_CONFERENCIA = [
  'campanha_diferente',
  'campanha_inexistente',
  'campanha_sem_producao',
  'id_repetido',
  'especificacao_sem_catalogo',
  'lacuna_ausente',
  'campo_fora_do_catalogo',
  'midia_incompativel',
  'texto_acima_do_limite',
  'pecas_acima_do_limite',
  'texto_de_campo_nao_especificado',
  'copy_sem_texto',
  'video_sem_roteiro',
  'textos_fora_de_copy',
  'duracao_fora_de_video',
  'proporcao_divergente',
  'proporcao_sem_catalogo',
  'proporcoes_misturadas',
  'prompt_ausente',
  'referencia_fora_do_pacote',
  'evidencia_fora_do_pacote',
  'anti_referencia_mal_usada',
  'evitar_sem_anti_referencia',
  'sem_fundamento',
  'custo_sem_entregavel',
  'custo_acima_da_verba',
  'custo_acima_do_orcamento',
  'custo_zerado',
  'etapa_fora_da_janela',
  'etapa_apos_a_campanha',
  'etapa_invertida',
  'dependencia_inexistente',
  'dependencia_fora_de_ordem',
  'etapa_antes_da_dependencia',
  'etapa_sem_entregavel',
  'entregavel_sem_etapa',
  'dado_pessoal',
  'grande_demais',
] as const;
export type CodigoDaConferencia = (typeof CODIGOS_DA_CONFERENCIA)[number];

export type ProblemaDaProducao = { readonly caminho: string; readonly codigo: CodigoDaConferencia };

export const TIPO_DA_REFERENCIA_CRIATIVA = 'culture_referencia';
export const TIPO_DA_ANTI_REFERENCIA = 'culture_anti_referencia';

export type ContextoDaCampanha = {
  readonly plano: Plano;
  readonly campanhaId: string;
  readonly pacote: Pick<PacoteDeLeitura, 'entradas'>;
  readonly janela: Periodo;
  readonly catalogos?: readonly CatalogoDeCampos[];
};

const MIDIA_DO_TIPO: Readonly<Record<TipoDeEntregavel, MidiaDoCampo>> = {
  copy: 'texto',
  imagem: 'imagem',
  carrossel: 'imagem',
  video: 'video',
};

const PROMPT_DO_TIPO: Readonly<Record<TipoDeEntregavel, string>> = {
  copy: 'copy',
  imagem: 'imagem',
  carrossel: 'imagem',
  video: 'video',
};

export function janelaDoCalendario(plano: Plano): Periodo {
  const fases = plano.calendario.fases;
  if (fases.length === 0) return plano.intencao.horizonte;
  const inicio = fases.map((fase) => fase.periodo.inicio).sort()[0]!;
  const fim = fases.map((fase) => fase.periodo.fim).sort().at(-1)!;
  return { inicio, fim };
}

export function campanhaDoPlano(plano: Plano, campanhaId: string): Campanha | undefined {
  return plano.campanhas.campanhas.find((campanha) => campanha.id === campanhaId);
}

function repetidos(ids: readonly string[]): string[] {
  const vistos = new Set<string>();
  const saida = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) saida.add(id);
    vistos.add(id);
  }
  return [...saida];
}

type Registrar = (caminho: string, codigo: CodigoDaConferencia) => void;

function conferirEspecificacao(
  entregavel: Entregavel,
  caminho: string,
  especificacoes: readonly EspecificacaoDoCampo[] | null,
  registrar: Registrar,
): void {
  const especificacao = entregavel.especificacao;
  const midia = MIDIA_DO_TIPO[entregavel.tipo];
  if (entregavel.tipo !== 'copy' && entregavel.textos.length > 0) registrar(`${caminho}.textos`, 'textos_fora_de_copy');
  if (entregavel.tipo === 'copy' && entregavel.textos.length === 0) registrar(`${caminho}.textos`, 'copy_sem_texto');
  if (entregavel.tipo === 'video' && entregavel.roteiro.length === 0) registrar(`${caminho}.roteiro`, 'video_sem_roteiro');
  if (entregavel.tipo !== 'video' && entregavel.duracao_segundos !== null) registrar(`${caminho}.duracao_segundos`, 'duracao_fora_de_video');
  if (!entregavel.prompts.some((prompt) => prompt.tipo === PROMPT_DO_TIPO[entregavel.tipo])) registrar(`${caminho}.prompts`, 'prompt_ausente');

  if (especificacao.origem === 'a_confirmar') {
    if (entregavel.proporcao !== null) registrar(`${caminho}.proporcao`, 'proporcao_sem_catalogo');
    for (const [i, peca] of entregavel.textos.entries()) {
      if (peca.campo !== null) registrar(`${caminho}.textos.${i}.campo`, 'texto_de_campo_nao_especificado');
    }
    return;
  }
  if (especificacoes === null) {
    registrar(`${caminho}.especificacao`, 'especificacao_sem_catalogo');
    return;
  }
  const porCampo = new Map(especificacoes.map((item) => [item.campo, item]));
  const usados: EspecificacaoDoCampo[] = [];
  for (const [i, campo] of especificacao.campos.entries()) {
    const item = porCampo.get(campo);
    if (item === undefined) {
      registrar(`${caminho}.especificacao.campos.${i}`, 'campo_fora_do_catalogo');
      continue;
    }
    if (item.midia !== midia) registrar(`${caminho}.especificacao.campos.${i}`, 'midia_incompativel');
    usados.push(item);
  }
  for (const repetido of repetidos(especificacao.campos)) registrar(`${caminho}.especificacao.campos.${repetido}`, 'id_repetido');

  const proporcoes = [...new Set(usados.map((item) => item.proporcao))];
  if (proporcoes.length > 1) registrar(`${caminho}.especificacao.campos`, 'proporcoes_misturadas');
  else if (proporcoes[0] === null || proporcoes.length === 0) {
    if (entregavel.proporcao !== null) registrar(`${caminho}.proporcao`, 'proporcao_sem_catalogo');
  } else if (entregavel.proporcao !== proporcoes[0]) registrar(`${caminho}.proporcao`, 'proporcao_divergente');

  const contagem = new Map<string, number>();
  for (const [i, peca] of entregavel.textos.entries()) {
    if (peca.campo === null) continue;
    const item = usados.find((candidato) => candidato.campo === peca.campo);
    if (item === undefined) {
      registrar(`${caminho}.textos.${i}.campo`, 'texto_de_campo_nao_especificado');
      continue;
    }
    if (item.caracteres !== null && [...peca.texto].length > item.caracteres) registrar(`${caminho}.textos.${i}.texto`, 'texto_acima_do_limite');
    contagem.set(peca.campo, (contagem.get(peca.campo) ?? 0) + 1);
  }
  for (const [campo, total] of contagem) {
    const maximo = porCampo.get(campo)?.maximoDePecas ?? null;
    if (maximo !== null && total > maximo) registrar(`${caminho}.textos.${campo}`, 'pecas_acima_do_limite');
  }
}

function conferirFontes(entregavel: Entregavel, caminho: string, tiposPorUrn: ReadonlyMap<string, string>, registrar: Registrar): void {
  if (!entregavel.hipotese && entregavel.evidencias.length === 0) registrar(`${caminho}.evidencias`, 'sem_fundamento');
  for (const [i, evidencia] of entregavel.evidencias.entries()) {
    if (!tiposPorUrn.has(evidencia.urn)) registrar(`${caminho}.evidencias.${i}.urn`, 'evidencia_fora_do_pacote');
  }
  for (const [i, referencia] of entregavel.referencias.entries()) {
    const tipo = tiposPorUrn.get(referencia.urn);
    if (tipo === undefined) {
      registrar(`${caminho}.referencias.${i}.urn`, 'referencia_fora_do_pacote');
      continue;
    }
    if (tipo === TIPO_DA_ANTI_REFERENCIA && referencia.uso !== 'evitar') registrar(`${caminho}.referencias.${i}.uso`, 'anti_referencia_mal_usada');
    if (referencia.uso === 'evitar' && tipo !== TIPO_DA_ANTI_REFERENCIA) registrar(`${caminho}.referencias.${i}.uso`, 'evitar_sem_anti_referencia');
  }
}

function conferirCustos(producao: ProducaoDaCampanha, campanha: Campanha, idsDosEntregaveis: ReadonlySet<string>, registrar: Registrar): void {
  const fatias: Dinheiro[] = [];
  for (const [i, custo] of producao.custos.entries()) {
    for (const [j, id] of custo.entregavel_ids.entries()) {
      if (!idsDosEntregaveis.has(id)) registrar(`custos.${i}.entregavel_ids.${j}`, 'custo_sem_entregavel');
    }
    if (custo.valor.origem !== 'verba_da_campanha') continue;
    if (centavosDe(custo.valor.valor) <= 0n) registrar(`custos.${i}.valor`, 'custo_zerado');
    fatias.push(custo.valor.valor);
  }
  if (somaDeCentavos(fatias) > centavosDe(campanha.verba)) registrar('custos', 'custo_acima_da_verba');
}

function conferirWorkflow(producao: ProducaoDaCampanha, campanha: Campanha, janela: Periodo, idsDosEntregaveis: ReadonlySet<string>, registrar: Registrar): void {
  const anteriores = new Map<string, string>();
  const cobertos = new Set<string>();
  for (const [i, etapa] of producao.workflow.entries()) {
    const caminho = `workflow.${i}`;
    if (etapa.inicio > etapa.fim) registrar(caminho, 'etapa_invertida');
    if (etapa.inicio < janela.inicio || etapa.fim > janela.fim) registrar(caminho, 'etapa_fora_da_janela');
    if (etapa.fim > campanha.periodo.fim) registrar(caminho, 'etapa_apos_a_campanha');
    for (const [j, id] of etapa.entregavel_ids.entries()) {
      if (!idsDosEntregaveis.has(id)) registrar(`${caminho}.entregavel_ids.${j}`, 'etapa_sem_entregavel');
      else cobertos.add(id);
    }
    for (const [j, dependencia] of etapa.depende_de.entries()) {
      const fimDaDependencia = anteriores.get(dependencia);
      if (fimDaDependencia === undefined) {
        const existe = producao.workflow.some((outra) => outra.id === dependencia);
        registrar(`${caminho}.depende_de.${j}`, existe ? 'dependencia_fora_de_ordem' : 'dependencia_inexistente');
        continue;
      }
      if (etapa.inicio < fimDaDependencia) registrar(`${caminho}.depende_de.${j}`, 'etapa_antes_da_dependencia');
    }
    anteriores.set(etapa.id, etapa.fim);
  }
  for (const id of idsDosEntregaveis) if (!cobertos.has(id)) registrar(`entregaveis.${id}`, 'entregavel_sem_etapa');
}

export function conferirProducaoDaCampanha(producao: ProducaoDaCampanha, contexto: ContextoDaCampanha): ProblemaDaProducao[] {
  const problemas: ProblemaDaProducao[] = [];
  const registrar: Registrar = (caminho, codigo) => problemas.push({ caminho, codigo });

  if (producao.campanha_id !== contexto.campanhaId) registrar('campanha_id', 'campanha_diferente');
  const campanha = campanhaDoPlano(contexto.plano, contexto.campanhaId);
  if (campanha === undefined) {
    registrar('campanha_id', 'campanha_inexistente');
    return problemas;
  }
  if (tamanhoEmBytes(producao) > TAMANHO_MAXIMO_DA_CAMPANHA_BYTES) registrar('', 'grande_demais');

  for (const [nome, ids] of [
    ['entregaveis', producao.entregaveis.map((item) => item.id)],
    ['custos', producao.custos.map((item) => item.id)],
    ['workflow', producao.workflow.map((item) => item.id)],
    ['lacunas', producao.lacunas.map((item) => item.id)],
  ] as const) {
    for (const repetido of repetidos(ids)) registrar(`${nome}.${repetido}`, 'id_repetido');
  }

  const especificacoes = campanha.plataforma === undefined ? null : especificacoesDaPlataforma(campanha.plataforma, contexto.catalogos ?? CATALOGOS_DISPONIVEIS);
  const tiposPorUrn = new Map(contexto.pacote.entradas.map((entrada) => [entrada.urn, entrada.tipo]));
  let aConfirmar = false;
  for (const [i, entregavel] of producao.entregaveis.entries()) {
    const caminho = `entregaveis.${i}`;
    if (entregavel.especificacao.origem === 'a_confirmar') aConfirmar = true;
    conferirEspecificacao(entregavel, caminho, especificacoes, registrar);
    conferirFontes(entregavel, caminho, tiposPorUrn, registrar);
  }
  const semCatalogo = especificacoes === null;
  if ((aConfirmar || semCatalogo) && producao.lacunas.length === 0) registrar('lacunas', 'lacuna_ausente');
  if (producao.custos.some((custo) => custo.valor.origem === 'a_confirmar') && producao.lacunas.length === 0) registrar('lacunas', 'lacuna_ausente');

  const idsDosEntregaveis = new Set(producao.entregaveis.map((item) => item.id));
  conferirCustos(producao, campanha, idsDosEntregaveis, registrar);
  conferirWorkflow(producao, campanha, contexto.janela, idsDosEntregaveis, registrar);

  const privacidade = planoSemDadoPessoal(producao);
  if (!privacidade.ok) for (const achado of privacidade.error.slice(0, 5)) registrar(achado.caminho, 'dado_pessoal');

  return dedup(problemas);
}

function dedup(problemas: readonly ProblemaDaProducao[]): ProblemaDaProducao[] {
  const vistos = new Set<string>();
  return problemas.filter((problema) => {
    const chave = `${problema.caminho}|${problema.codigo}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

export function conferirPlanoDeProducao(producao: PlanoDeProducao, plano: Plano): ProblemaDaProducao[] {
  const problemas: ProblemaDaProducao[] = [];
  if (tamanhoEmBytes(producao) > TAMANHO_MAXIMO_DO_PLANO_DE_PRODUCAO_BYTES) problemas.push({ caminho: '', codigo: 'grande_demais' });
  const cobertas = new Set(producao.campanhas.map((item) => item.campanha_id));
  for (const repetido of repetidos(producao.campanhas.map((item) => item.campanha_id))) problemas.push({ caminho: `campanhas.${repetido}`, codigo: 'id_repetido' });
  for (const campanha of plano.campanhas.campanhas) {
    if (!cobertas.has(campanha.id)) problemas.push({ caminho: `campanhas.${campanha.id}`, codigo: 'campanha_sem_producao' });
  }
  for (const item of producao.campanhas) {
    if (campanhaDoPlano(plano, item.campanha_id) === undefined) problemas.push({ caminho: `campanhas.${item.campanha_id}`, codigo: 'campanha_inexistente' });
  }
  const fatias = producao.campanhas.flatMap((item) => item.custos.flatMap((custo) => (custo.valor.origem === 'verba_da_campanha' ? [custo.valor.valor] : [])));
  if (somaDeCentavos(fatias) > centavosDe(plano.orcamento.total)) problemas.push({ caminho: 'custos', codigo: 'custo_acima_do_orcamento' });
  return problemas;
}

const CARACTERES_DO_MOTIVO = /[^A-Za-z0-9_.:;,=-]/g;

export function motivoDaConferencia(prefixo: string, problemas: readonly ProblemaDaProducao[]): string {
  const itens = problemas.slice(0, 4).map((problema) => `${problema.caminho.replace(CARACTERES_DO_MOTIVO, '').slice(-60)}=${problema.codigo}`);
  const motivo = `${prefixo.replace(CARACTERES_DO_MOTIVO, '')}:${itens.join(';')}`.replace(CARACTERES_DO_MOTIVO, '').slice(0, 240);
  return motivo.length === 0 ? 'conferencia' : motivo;
}
