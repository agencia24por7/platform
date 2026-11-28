import type { MemberRole } from '../../identity/domain/user.ts';
import { podeExecutar } from '../domain/papeis.ts';
import type { Campanha, Plano } from '../domain/plano.ts';
import type { Entregavel, PlanoDeProducao, ProducaoDaCampanha } from '../domain/producao/planoDeProducao.ts';
import type { RegistroDeProducao } from '../application/portasDaProducao.ts';
import { dataBr, dataEHoraBr, periodoBr, reais } from './formatosDoPlano.ts';
import { ROTULO_DA_PLATAFORMA_DO_PLANO } from './rotulosDoPlano.ts';
import { rotaDoPlano } from './rotasDaEstrategia.ts';

export const TITULO_DO_PLANO_DE_PRODUCAO = 'Plano de produção';
export const ROTULO_DO_BOTAO_GERAR = 'Gerar plano de produção';
export const ROTULO_DO_BOTAO_GERAR_DE_NOVO = 'Gerar nova versão do plano de produção';
export const ROTULO_DO_DOWNLOAD = 'Baixar em Markdown';
export const ROTULO_DO_LINK_NA_PAGINA_DO_PLANO = 'Plano de produção';

export function rotaDoPlanoDeProducao(clienteId: string, planoId: string): string {
  return `${rotaDoPlano(clienteId, planoId)}/producao`;
}

export function rotaDoDownloadDaProducao(clienteId: string, planoId: string, producaoId: string): string {
  return `${rotaDoPlanoDeProducao(clienteId, planoId)}/download?geracao=${encodeURIComponent(producaoId)}`;
}

export type TomDoEstado = 'info' | 'ok' | 'warn' | 'danger';
export type IconeDoEstado = 'orienta' | 'ok' | 'atencao' | 'erro' | 'agente';

export type EstadoNaTela = {
  readonly tom: TomDoEstado;
  readonly icone: IconeDoEstado;
  readonly titulo: string;
  readonly texto: string;
};

export type TextoNaTela = { readonly campo: string | null; readonly texto: string; readonly tamanho: string };
export type EntregavelNaTela = {
  readonly id: string;
  readonly nome: string;
  readonly tipo: string;
  readonly especificacao: string;
  readonly proporcao: string | null;
  readonly duracao: string | null;
  readonly textos: readonly TextoNaTela[];
  readonly roteiro: readonly string[];
  readonly prompts: readonly { readonly tipo: string; readonly prompt: string }[];
  readonly referencias: readonly string[];
  readonly justificativa: string;
  readonly fontes: readonly string[];
};
export type CampanhaNaTela = {
  readonly id: string;
  readonly titulo: string;
  readonly fatos: readonly string[];
  readonly conceito: string;
  readonly entregaveis: readonly EntregavelNaTela[];
  readonly ferramentas: readonly string[];
  readonly custos: readonly string[];
  readonly workflow: readonly string[];
  readonly lacunas: readonly string[];
};

export type GeracaoNaTela = {
  readonly id: string;
  readonly rotulo: string;
  readonly quando: string;
  readonly estado: EstadoNaTela;
  readonly download: { readonly href: string; readonly nomeDoArquivo: string } | null;
};

export type VisaoDoPlanoDeProducao = {
  readonly titulo: string;
  readonly voltar: { readonly href: string; readonly rotulo: string };
  readonly gerar: { readonly habilitado: boolean; readonly rotulo: string; readonly motivo: string | null };
  readonly estado: EstadoNaTela;
  readonly atualizarAutomaticamente: boolean;
  readonly atual: { readonly geracao: GeracaoNaTela; readonly janela: string; readonly campanhas: readonly CampanhaNaTela[] } | null;
  readonly historico: readonly GeracaoNaTela[];
};

export type GeracaoParaVisao = { readonly registro: RegistroDeProducao; readonly conteudo: PlanoDeProducao | null };

const ROTULO_DO_TIPO: Readonly<Record<Entregavel['tipo'], string>> = { copy: 'Texto (copy)', imagem: 'Imagem', carrossel: 'Carrossel', video: 'Vídeo' };
const ROTULO_DO_USO: Readonly<Record<string, string>> = { inspiracao: 'inspiração', evitar: 'evitar', prova: 'prova' };
const ROTULO_DO_PAPEL: Readonly<Record<string, string>> = {
  redator: 'Redação',
  diretor_de_arte: 'Direção de arte',
  designer: 'Design',
  editor_de_video: 'Edição de vídeo',
  produtor: 'Produção',
  gestor_de_trafego: 'Gestão de tráfego',
  revisor_legal: 'Revisão legal',
  aprovador_do_cliente: 'Aprovação final',
  atendimento: 'Atendimento',
};
const ROTULO_DA_CATEGORIA: Readonly<Record<string, string>> = {
  copy: 'Texto',
  imagem: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  edicao: 'Edição',
  design: 'Design',
  aprovacao: 'Aprovação',
  gestao: 'Gestão',
};
const ROTULO_DO_PROMPT: Readonly<Record<string, string>> = { copy: 'Prompt de texto', imagem: 'Prompt de imagem', video: 'Prompt de vídeo' };

export const MOTIVO_DA_FALHA: Readonly<Record<string, string>> = {
  ia_nao_configurada: 'Nenhum modelo de IA está escolhido para o plano de produção. Escolha em Configurações da IA.',
  ia_limite: 'O limite de uso da IA da organização foi atingido. Tente mais tarde.',
  ia_saida_invalida: 'A IA respondeu fora do formato duas vezes. Tente gerar de novo.',
  ia_falha: 'O fornecedor de IA não respondeu. Tente gerar de novo.',
  ia_tempo: 'A IA demorou demais. Tente gerar de novo.',
  brain_indisponivel: 'O Brain não pôde ser lido. Tente gerar de novo.',
  conferencia_reprovada: 'O plano de produção não passou na conferência (formato da plataforma, referências, custos ou prazos), nem depois de uma correção. Tente gerar de novo.',
  plano_fora_do_estado: 'A versão do plano deixou de estar autorizada durante a geração.',
  plano_sem_campanhas: 'O plano autorizado não tem campanhas para produzir.',
  interno: 'Falha interna ao gerar o plano de produção.',
};

function estadoDaGeracao(registro: RegistroDeProducao): EstadoNaTela {
  if (registro.status === 'pendente') {
    return { tom: 'info', icone: 'agente', titulo: 'Gerando o plano de produção', texto: 'O agente está montando entregáveis, roteiros, prompts e workflow por campanha. A página se atualiza sozinha.' };
  }
  if (registro.status === 'falhou') {
    return { tom: 'danger', icone: 'erro', titulo: 'A geração falhou', texto: MOTIVO_DA_FALHA[registro.erroCodigo ?? 'interno'] ?? MOTIVO_DA_FALHA['interno']! };
  }
  if (registro.redigidoEm !== null) return { tom: 'warn', icone: 'atencao', titulo: 'Conteúdo removido', texto: 'Este plano de produção foi redigido por pedido de privacidade.' };
  return { tom: 'ok', icone: 'ok', titulo: 'Plano de produção pronto', texto: 'Conferido contra o catálogo da plataforma, o pacote do Brain, o orçamento e o calendário do plano.' };
}

function nomeDoArquivo(numero: number, planoId: string): string {
  return `plano-de-producao-${planoId.slice(0, 8)}-v${numero}.md`;
}

function geracaoNaTela(geracao: GeracaoParaVisao, clienteId: string): GeracaoNaTela {
  const { registro } = geracao;
  return {
    id: registro.id,
    rotulo: `Versão ${registro.numero}`,
    quando: dataEHoraBr(registro.concluidoEm ?? registro.criadoEm),
    estado: estadoDaGeracao(registro),
    download: geracao.conteudo === null ? null : { href: rotaDoDownloadDaProducao(clienteId, registro.planoId, registro.id), nomeDoArquivo: nomeDoArquivo(registro.numero, registro.planoId) },
  };
}

function especificacaoNaTela(entregavel: Entregavel): string {
  return entregavel.especificacao.origem === 'catalogo'
    ? `Catálogo da plataforma: ${entregavel.especificacao.campos.join(', ')}`
    : `A confirmar: ${entregavel.especificacao.motivo}`;
}

function entregavelNaTela(entregavel: Entregavel, titulos: ReadonlyMap<string, string>): EntregavelNaTela {
  const titulo = (urn: string) => titulos.get(urn) ?? 'Entrada do Brain';
  return {
    id: entregavel.id,
    nome: entregavel.nome,
    tipo: ROTULO_DO_TIPO[entregavel.tipo],
    especificacao: especificacaoNaTela(entregavel),
    proporcao: entregavel.proporcao,
    duracao: entregavel.duracao_segundos === null ? null : `${entregavel.duracao_segundos} s`,
    textos: entregavel.textos.map((peca) => ({ campo: peca.campo, texto: peca.texto, tamanho: `${[...peca.texto].length} caracteres` })),
    roteiro: [...entregavel.roteiro]
      .sort((a, b) => a.ordem - b.ordem)
      .map((cena) =>
        [`${cena.ordem}. ${cena.cena}`, cena.texto_em_tela ? `Texto em tela: ${cena.texto_em_tela}` : null, cena.audio ? `Áudio: ${cena.audio}` : null, cena.duracao_segundos ? `${cena.duracao_segundos} s` : null]
          .filter((parte): parte is string => parte !== null)
          .join(' · '),
      ),
    prompts: entregavel.prompts.map((prompt) => ({ tipo: ROTULO_DO_PROMPT[prompt.tipo] ?? prompt.tipo, prompt: prompt.prompt })),
    referencias: entregavel.referencias.map((ref) => `${titulo(ref.urn)} (${ROTULO_DO_USO[ref.uso] ?? ref.uso}): ${ref.motivo}`),
    justificativa: entregavel.hipotese && entregavel.evidencias.length === 0 ? `${entregavel.justificativa} (hipótese)` : entregavel.justificativa,
    fontes: entregavel.evidencias.map((ev) => titulo(ev.urn)),
  };
}

function campanhaNaTela(producao: ProducaoDaCampanha, campanha: Campanha | undefined, titulos: ReadonlyMap<string, string>): CampanhaNaTela {
  const nomes = new Map(producao.entregaveis.map((item) => [item.id, item.nome]));
  return {
    id: producao.campanha_id,
    titulo: campanha?.nome ?? producao.campanha_id,
    fatos: campanha
      ? [
          campanha.plataforma ? (ROTULO_DA_PLATAFORMA_DO_PLANO[campanha.plataforma] ?? campanha.plataforma) : 'Sem plataforma',
          `Período ${periodoBr(campanha.periodo)}`,
          `Verba ${reais(campanha.verba)}`,
        ]
      : [],
    conceito: producao.conceito,
    entregaveis: producao.entregaveis.map((item) => entregavelNaTela(item, titulos)),
    ferramentas: producao.ferramentas.map((item) => `${ROTULO_DA_CATEGORIA[item.categoria] ?? item.categoria} · ${ROTULO_DO_PAPEL[item.papel] ?? item.papel}: ${item.ferramenta}. ${item.justificativa}`),
    custos: producao.custos.map((custo) =>
      custo.valor.origem === 'verba_da_campanha'
        ? `${custo.descricao}: ${reais(custo.valor.valor)} da verba da campanha. ${custo.justificativa}`
        : `${custo.descricao}: a confirmar (${custo.valor.motivo}). ${custo.justificativa}`,
    ),
    workflow: producao.workflow.map(
      (etapa) =>
        `${dataBr(etapa.inicio)} a ${dataBr(etapa.fim)} · ${ROTULO_DO_PAPEL[etapa.papel] ?? etapa.papel}: ${etapa.etapa} (${etapa.entregavel_ids.map((id) => nomes.get(id) ?? id).join(', ')})`,
    ),
    lacunas: producao.lacunas.map((lacuna) => `${lacuna.descricao} Impacto: ${lacuna.impacto}`),
  };
}

export function visaoDoPlanoDeProducao(entrada: {
  readonly clienteId: string;
  readonly planoId: string;
  readonly papel: MemberRole;
  readonly temVersaoAutorizada: boolean;
  readonly planoDeMarketing: Plano | null;
  readonly geracoes: readonly GeracaoParaVisao[];
}): VisaoDoPlanoDeProducao {
  const [maisRecente] = entrada.geracoes;
  const pendente = maisRecente?.registro.status === 'pendente';
  const podePedir = podeExecutar('criar', { tipo: 'pessoa', papel: entrada.papel });
  const motivo = !podePedir
    ? 'Seu papel não permite gerar o plano de produção.'
    : !entrada.temVersaoAutorizada
      ? 'O plano precisa estar autorizado para gerar o plano de produção.'
      : pendente
        ? 'Aguarde a geração em andamento terminar.'
        : null;
  const pronta = entrada.geracoes.find((geracao) => geracao.conteudo !== null) ?? null;
  const campanhas = entrada.planoDeMarketing?.campanhas.campanhas ?? [];
  const titulos = new Map((pronta?.conteudo?.referencias ?? []).map((ref) => [ref.urn, ref.titulo]));
  const estado: EstadoNaTela =
    maisRecente === undefined
      ? {
          tom: 'info',
          icone: 'orienta',
          titulo: 'Nenhum plano de produção ainda',
          texto: entrada.temVersaoAutorizada
            ? 'Gere o plano de produção para transformar as campanhas autorizadas em entregáveis, roteiros, prompts e workflow.'
            : 'Autorize o plano para liberar o plano de produção.',
        }
      : estadoDaGeracao(maisRecente.registro);
  return {
    titulo: TITULO_DO_PLANO_DE_PRODUCAO,
    voltar: { href: rotaDoPlano(entrada.clienteId, entrada.planoId), rotulo: 'Voltar ao plano' },
    gerar: { habilitado: motivo === null, rotulo: pronta === null ? ROTULO_DO_BOTAO_GERAR : ROTULO_DO_BOTAO_GERAR_DE_NOVO, motivo },
    estado,
    atualizarAutomaticamente: pendente,
    atual:
      pronta === null || pronta.conteudo === null
        ? null
        : {
            geracao: geracaoNaTela(pronta, entrada.clienteId),
            janela: periodoBr(pronta.conteudo.janela),
            campanhas: pronta.conteudo.campanhas.map((producao) => campanhaNaTela(producao, campanhas.find((c) => c.id === producao.campanha_id), titulos)),
          },
    historico: entrada.geracoes.map((geracao) => geracaoNaTela(geracao, entrada.clienteId)),
  };
}

const ESPECIAIS_DO_MARKDOWN = /[\\`*_{}[\]()#+\-.!|<>~&=]/g;

export function escaparMarkdown(texto: string): string {
  return texto
    .replace(/\r\n?|\n|[\u2028\u2029]/g, ' ')
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(ESPECIAIS_DO_MARKDOWN, (caractere) => `\\${caractere}`);
}

function lista(itens: readonly string[]): string[] {
  return itens.length === 0 ? ['- Sem registro.'] : itens.map((item) => `- ${escaparMarkdown(item)}`);
}

export function planoDeProducaoEmMarkdown(entrada: { readonly tituloDoPlano: string; readonly geracao: GeracaoNaTela; readonly janela: string; readonly campanhas: readonly CampanhaNaTela[] }): string {
  const linhas: string[] = [
    `# ${escaparMarkdown(`${TITULO_DO_PLANO_DE_PRODUCAO}: ${entrada.tituloDoPlano}`)}`,
    '',
    `${escaparMarkdown(entrada.geracao.rotulo)}, ${escaparMarkdown(entrada.geracao.quando)}. Janela do calendário: ${escaparMarkdown(entrada.janela)}.`,
  ];
  for (const campanha of entrada.campanhas) {
    linhas.push('', `## ${escaparMarkdown(campanha.titulo)}`, '', escaparMarkdown(campanha.fatos.join(' · ')), '', `**Conceito:** ${escaparMarkdown(campanha.conceito)}`);
    for (const entregavel of campanha.entregaveis) {
      linhas.push('', `### ${escaparMarkdown(`${entregavel.nome} (${entregavel.tipo})`)}`, '', `- ${escaparMarkdown(entregavel.especificacao)}`);
      if (entregavel.proporcao) linhas.push(`- Proporção: ${escaparMarkdown(entregavel.proporcao)}`);
      if (entregavel.duracao) linhas.push(`- Duração: ${escaparMarkdown(entregavel.duracao)}`);
      linhas.push(`- Justificativa: ${escaparMarkdown(entregavel.justificativa)}`);
      if (entregavel.fontes.length > 0) linhas.push(`- Fontes: ${escaparMarkdown(entregavel.fontes.join('; '))}`);
      if (entregavel.textos.length > 0) linhas.push('', '**Textos**', ...lista(entregavel.textos.map((peca) => `${peca.campo ?? 'texto'}: ${peca.texto} (${peca.tamanho})`)));
      if (entregavel.roteiro.length > 0) linhas.push('', '**Roteiro**', ...lista(entregavel.roteiro));
      linhas.push('', '**Prompts**', ...lista(entregavel.prompts.map((prompt) => `${prompt.tipo}: ${prompt.prompt}`)));
      if (entregavel.referencias.length > 0) linhas.push('', '**Referências**', ...lista(entregavel.referencias));
    }
    linhas.push('', '### Ferramentas', ...lista(campanha.ferramentas), '', '### Custos', ...lista(campanha.custos), '', '### Workflow', ...lista(campanha.workflow), '', '### Lacunas', ...lista(campanha.lacunas));
  }
  return `${linhas.join('\n')}\n`;
}
