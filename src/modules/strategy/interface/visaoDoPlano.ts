import { rotaDoCliente } from '../../clients/domain/painel/enderecos.ts';
import type { MemberRole } from '../../identity/domain/user.ts';
import { MENSAGEM_DA_FALTA, type FaltaParaAplicar } from '../domain/aplicacao.ts';
import { personaPorChave } from '../domain/comite/personas.ts';
import { podeExecutar, type AcaoDoPlano } from '../domain/papeis.ts';
import { lerPlano, type Afirmacao, type Evidencia, type Plano, type SecaoDoPlano, SECOES_DO_PLANO } from '../domain/plano.ts';
import { ROTULO_DO_STATUS, type StatusDaVersao } from '../domain/status.ts';
import type { EventoDaVersao, Execucao, VersaoResumo } from '../application/portas.ts';
import type { PainelDoPlano } from '../application/estrategiaService.ts';
import { formatarValor } from '../../clients/domain/regras/valor.ts';
import { execucaoSemAvanco } from './agendamentoDaAtualizacao.ts';
import { dataBr, dataEHoraBr, periodoBr, reais } from './formatosDoPlano.ts';
import {
  ROTULO_DA_CHECAGEM,
  ROTULO_DA_ETAPA,
  ROTULO_DA_LACUNA,
  ROTULO_DA_MEDIDA,
  ROTULO_DA_OUSADIA,
  ROTULO_DA_PLATAFORMA_DO_PLANO,
  ROTULO_DA_SEVERIDADE,
  ROTULO_DO_CANAL,
  ROTULO_DO_EVENTO_DO_PLANO,
  ROTULO_DO_EXPERIMENTO,
  ROTULO_DO_FORMATO,
  ROTULO_DO_MOTIVO_DE_IMPACTO,
  ROTULO_DO_NIVEL_DE_META,
  ROTULO_DO_PAPEL_DA_EVIDENCIA,
  ROTULO_DO_PAPEL_DO_CANAL,
  ROTULO_DO_TIPO_DE_ENTRADA,
  ROTULO_DO_VEREDITO_DO_COMITE,
  TITULO_DA_SECAO,
} from './rotulosDoPlano.ts';

export type NotaDaEvidencia = 'A' | 'B' | 'C' | 'D';
export type EntradaDoBrainConhecida = {
  readonly titulo: string;
  readonly nota: NotaDaEvidencia | null;
  readonly categoria?: string;
  readonly validoAte?: string;
  readonly verificadoEm?: string;
};

export const INDICACAO_NAO_VERIFICADA = 'não verificada';
export const INDICACAO_VENCIDA = 'vencida';
export const AVISO_REGRA_LEGAL_NAO_VERIFICADA = 'Regra legal não verificada por pessoa: confirme antes de autorizar';

export function indicacoesDaEvidencia(conhecida: EntradaDoBrainConhecida | undefined, hoje: string): readonly string[] {
  if (conhecida === undefined) return [];
  const indicacoes: string[] = [];
  if (conhecida.categoria === 'regra_legal' && conhecida.verificadoEm === undefined) indicacoes.push(INDICACAO_NAO_VERIFICADA);
  if (conhecida.validoAte !== undefined && conhecida.validoAte < hoje) indicacoes.push(INDICACAO_VENCIDA);
  return indicacoes;
}

export type EntradaDaVisao = {
  readonly painel: PainelDoPlano | null;
  readonly papel: MemberRole;
  readonly clienteId: string;
  readonly entradasDoBrain?: ReadonlyMap<string, EntradaDoBrainConhecida>;
  readonly nomes?: ReadonlyMap<string, string>;
  readonly agora?: Date;
};

export type NomeDoIconeDaVisao = 'ok' | 'atencao' | 'erro' | 'pausada' | 'nao' | 'vazio' | 'pessoa' | 'agente' | 'orienta';

export type Marca = {
  readonly urn: string;
  readonly rotulo: string;
  readonly papel: string;
  readonly nota: NotaDaEvidencia | null;
  readonly indicacoes: readonly string[];
  readonly titulo: string;
  readonly href: string;
};

export type AfirmacaoNaTela = { readonly texto: string; readonly hipotese: boolean; readonly marcas: readonly Marca[] };
export type Celula = string | readonly Marca[];

export type BlocoDaSecao =
  | { readonly tipo: 'afirmacao'; readonly rotulo: string | null; readonly afirmacao: AfirmacaoNaTela }
  | { readonly tipo: 'texto'; readonly rotulo: string | null; readonly texto: string }
  | { readonly tipo: 'lista'; readonly rotulo: string; readonly itens: readonly string[] }
  | {
      readonly tipo: 'cartao';
      readonly titulo: string;
      readonly selo: string | null;
      readonly destaque: boolean;
      readonly fatos: readonly { readonly rotulo: string; readonly valor: string }[];
      readonly afirmacoes: readonly { readonly rotulo: string | null; readonly afirmacao: AfirmacaoNaTela }[];
      readonly marcas: readonly Marca[];
    }
  | { readonly tipo: 'tabela'; readonly rotulo: string | null; readonly colunas: readonly string[]; readonly linhas: readonly (readonly Celula[])[] };

export type SecaoNaTela = {
  readonly chave: SecaoDoPlano;
  readonly titulo: string;
  readonly blocos: readonly BlocoDaSecao[];
  readonly json: string;
};

export type LinkDaVisao = { readonly rotulo: string; readonly href: string };

export type AvisoDaVisao = {
  readonly chave: string;
  readonly tom: 'info' | 'warn' | 'danger';
  readonly titulo: string;
  readonly texto: string | null;
  readonly itens: readonly string[];
  readonly link: LinkDaVisao | null;
};

export type ChaveDeAcao =
  | 'novo_plano'
  | 'aplicar'
  | 'autorizar'
  | 'rejeitar'
  | 'revogar'
  | 'cancelar_rascunho'
  | 'pedir_mudanca'
  | 'pedir_revisao'
  | 'cancelar_execucao'
  | 'editar_secao';

export type AcaoDaVisao = {
  readonly chave: ChaveDeAcao;
  readonly rotulo: string;
  readonly habilitada: boolean;
  readonly motivos: readonly string[];
};

export type EtapaDaVisao = { readonly chave: string; readonly rotulo: string; readonly estado: 'feita' | 'atual' | 'pendente' };

export type ExecucaoNaTela = {
  readonly id: string;
  readonly titulo: string;
  readonly etapas: readonly EtapaDaVisao[];
  readonly etapaAtual: string;
  readonly rodada: number;
  readonly parada: boolean;
};

export type QuemFez = { readonly tipo: 'pessoa' | 'agente' | 'sistema'; readonly rotulo: string };

export type VersaoNaTela = {
  readonly id: string;
  readonly numero: number;
  readonly status: StatusDaVersao;
  readonly rotuloDoStatus: string;
  readonly icone: NomeDoIconeDaVisao;
  readonly classe: string;
  readonly autor: QuemFez;
  readonly em: Date;
  readonly emTexto: string;
  readonly exibida: boolean;
};

export type PontoNaTela = {
  readonly id: string;
  readonly trecho: string;
  readonly problema: string;
  readonly ajustePedido: string;
  readonly resposta: { readonly decisao: 'acatado' | 'nao_acatado'; readonly rotulo: string; readonly motivo: string } | null;
};

export type ParecerNaTela = {
  readonly persona: string;
  readonly nome: string;
  readonly foco: string | null;
  readonly veredito: string;
  readonly rotuloDoVeredito: string;
  readonly icone: NomeDoIconeDaVisao;
  readonly classe: string;
  readonly motivo: string;
  readonly pontos: readonly PontoNaTela[];
};

export type ChecagemNaTela = {
  readonly chave: string;
  readonly rotulo: string;
  readonly resultado: 'aprovado' | 'reprovado' | 'nao_rodou';
  readonly rotuloDoResultado: string;
  readonly icone: NomeDoIconeDaVisao;
  readonly classe: string;
  readonly motivo: string;
  readonly onde: readonly string[];
};

export type GatesNaTela = {
  readonly resultado: 'aprovado' | 'reprovado';
  readonly rotuloDoResultado: string;
  readonly icone: NomeDoIconeDaVisao;
  readonly classe: string;
  readonly emTexto: string;
  readonly checagens: readonly ChecagemNaTela[];
  readonly problemasDoModelo: readonly { readonly trecho: string; readonly problema: string }[];
};

export type EventoNaTela = {
  readonly id: string;
  readonly rotulo: string;
  readonly detalhe: string | null;
  readonly quem: QuemFez;
  readonly versao: number | null;
  readonly em: Date;
  readonly emTexto: string;
};

export type VisaoDoPlano = {
  readonly planoId: string | null;
  readonly temPlano: boolean;
  readonly somenteLeitura: boolean;
  readonly status: StatusDaVersao | null;
  readonly rotuloDoStatus: string | null;
  readonly icone: NomeDoIconeDaVisao | null;
  readonly classe: string;
  readonly versao: {
    readonly id: string;
    readonly numero: number;
    readonly autor: QuemFez;
    readonly em: Date;
    readonly emTexto: string;
  } | null;
  readonly avisos: readonly AvisoDaVisao[];
  readonly execucao: ExecucaoNaTela | null;
  readonly acoes: readonly AcaoDaVisao[];
  readonly secoes: readonly SecaoNaTela[];
  readonly pareceres: readonly ParecerNaTela[];
  readonly pontosPendentesDoComite: number;
  readonly resumoDoComite: string | null;
  readonly gates: GatesNaTela | null;
  readonly checagensReprovadas: number;
  readonly versoes: readonly VersaoNaTela[];
  readonly eventos: readonly EventoNaTela[];
};

export const MAXIMO_DE_CARACTERES_DA_INSTRUCAO = 2000;

const ETAPAS_DA_EXECUCAO = ['ler_brain', 'redigir', 'comite', 'ajustar', 'gates'] as const;

const TITULO_DA_EXECUCAO: Readonly<Record<string, string>> = {
  criar: 'Criando o plano',
  ajustar: 'Ajustando o plano a pedido',
  revisar: 'Revisando o plano',
};

const APARENCIA_DO_STATUS: Readonly<Record<StatusDaVersao, { readonly icone: NomeDoIconeDaVisao; readonly classe: string }>> = {
  rascunho: { icone: 'vazio', classe: '' },
  proposto: { icone: 'atencao', classe: 'pill--warn' },
  vigente: { icone: 'ok', classe: 'pill--ok' },
  superado: { icone: 'pausada', classe: '' },
  revogado: { icone: 'nao', classe: '' },
  rejeitado: { icone: 'erro', classe: 'pill--danger' },
  cancelado: { icone: 'nao', classe: '' },
};

const APARENCIA_DO_VEREDITO: Readonly<Record<string, { readonly icone: NomeDoIconeDaVisao; readonly classe: string }>> = {
  aprova: { icone: 'ok', classe: 'pill--ok' },
  aprova_com_ajuste: { icone: 'atencao', classe: 'pill--warn' },
  reprova: { icone: 'erro', classe: 'pill--danger' },
};

const APARENCIA_DA_CHECAGEM: Readonly<Record<ChecagemNaTela['resultado'], { readonly icone: NomeDoIconeDaVisao; readonly classe: string; readonly rotulo: string }>> = {
  aprovado: { icone: 'ok', classe: 'pill--ok', rotulo: 'Aprovada' },
  reprovado: { icone: 'erro', classe: 'pill--danger', rotulo: 'Reprovada' },
  nao_rodou: { icone: 'atencao', classe: 'pill--warn', rotulo: 'Não rodou' },
};

export type MensagemDeFalha = { readonly titulo: string; readonly texto: string | null; readonly link: 'config' | 'gates' | null };

export const MENSAGEM_POR_ERRO_DA_EXECUCAO: Readonly<Record<string, MensagemDeFalha>> = {
  ia_nao_configurada: { titulo: 'A inteligência artificial ainda não está configurada', texto: 'Sem ela o plano não pode ser criado nem ajustado.', link: 'config' },
  ia_limite: { titulo: 'O limite de uso da inteligência artificial foi atingido', texto: 'Tente de novo mais tarde.', link: null },
  ia_saida_invalida: { titulo: 'A resposta da inteligência artificial não pôde ser usada', texto: 'Ela veio fora do formato esperado. Tente de novo.', link: null },
  ia_falha: { titulo: 'O serviço de inteligência artificial falhou', texto: 'Tente de novo em alguns minutos.', link: null },
  ia_tempo: { titulo: 'O pedido demorou mais do que o permitido', texto: 'Tente de novo.', link: null },
  brain_indisponivel: { titulo: 'Não foi possível ler o Brain do cliente agora', texto: 'Tente de novo em alguns minutos.', link: null },
  gate_reprovado: { titulo: 'Os Gates reprovaram o plano', texto: 'Veja o que falhou na seção Gates e peça uma mudança ao agente ou edite o plano.', link: 'gates' },
  interno: { titulo: 'Algo deu errado ao montar o plano', texto: 'Tente de novo. Se repetir, avise a equipe.', link: null },
};

const MENSAGEM_DE_FALHA_DESCONHECIDA: MensagemDeFalha = MENSAGEM_POR_ERRO_DA_EXECUCAO['interno']!;

export function mensagemDeFalha(codigo: string | null): MensagemDeFalha {
  return (codigo !== null ? MENSAGEM_POR_ERRO_DA_EXECUCAO[codigo] : undefined) ?? MENSAGEM_DE_FALHA_DESCONHECIDA;
}

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

export function caminhoLegivel(caminho: string): string {
  const partes = caminho.split('.').filter((parte) => parte !== '');
  if (partes.length === 0) return 'Plano';
  const [raiz, ...resto] = partes;
  const titulo = TITULO_DA_SECAO[raiz as SecaoDoPlano] ?? raiz ?? 'Plano';
  const legiveis = resto.map((parte) => (/^\d+$/.test(parte) ? `item ${Number(parte) + 1}` : parte.replace(/_/g, ' ')));
  return [titulo, ...legiveis].join(' › ');
}

function marcasDe(
  evidencias: readonly Evidencia[],
  clienteId: string,
  entradas: ReadonlyMap<string, EntradaDoBrainConhecida>,
  hoje: string,
): Marca[] {
  const href = rotaDoCliente(clienteId, 'contexto', { secao: 'brain' });
  return evidencias.map((evidencia) => {
    const conhecida = entradas.get(evidencia.urn);
    const tipoNaUrn = evidencia.urn.split(':')[3] ?? 'entrada';
    const indicacoes = indicacoesDaEvidencia(conhecida, hoje);
    return {
      urn: evidencia.urn,
      rotulo: conhecida?.titulo ?? tipoNaUrn.replace(/_/g, ' '),
      papel: ROTULO_DO_PAPEL_DA_EVIDENCIA[evidencia.papel] ?? evidencia.papel,
      nota: conhecida?.nota ?? null,
      indicacoes,
      titulo: [evidencia.urn, ...indicacoes].join(' · '),
      href,
    };
  });
}

type Contexto = {
  readonly clienteId: string;
  readonly entradas: ReadonlyMap<string, EntradaDoBrainConhecida>;
  readonly hoje: string;
};

function afirmacaoNaTela(afirmacao: Afirmacao, contexto: Contexto): AfirmacaoNaTela {
  return { texto: afirmacao.texto, hipotese: afirmacao.hipotese, marcas: marcasDe(afirmacao.evidencias, contexto.clienteId, contexto.entradas, contexto.hoje) };
}

function cartao(
  titulo: string,
  partes: {
    readonly selo?: string | null;
    readonly destaque?: boolean;
    readonly fatos?: readonly (readonly [string, string | null | undefined])[];
    readonly afirmacoes?: readonly (readonly [string | null, AfirmacaoNaTela | null])[];
    readonly marcas?: readonly Marca[];
  },
): BlocoDaSecao {
  return {
    tipo: 'cartao',
    titulo,
    selo: partes.selo ?? null,
    destaque: partes.destaque ?? false,
    fatos: (partes.fatos ?? []).filter((fato): fato is readonly [string, string] => typeof fato[1] === 'string' && fato[1] !== '').map(([rotulo, valor]) => ({ rotulo, valor })),
    afirmacoes: (partes.afirmacoes ?? []).filter((item): item is readonly [string | null, AfirmacaoNaTela] => item[1] !== null).map(([rotulo, afirmacao]) => ({ rotulo, afirmacao })),
    marcas: partes.marcas ?? [],
  };
}

function quantia(valor: Plano['metas_e_metricas']['metas'][number]['previsto']): string {
  if (valor.unidade === 'contagem') return valor.quantidade.toLocaleString('pt-BR');
  return formatarValor(valor);
}

function blocosDaSecao(chave: SecaoDoPlano, plano: Plano, contexto: Contexto): BlocoDaSecao[] {
  const afirmar = (a: Afirmacao) => afirmacaoNaTela(a, contexto);
  const marcas = (e: readonly Evidencia[]) => marcasDe(e, contexto.clienteId, contexto.entradas, contexto.hoje);
  const canal = (id: string) => plano.canais_e_plataformas.canais.find((c) => c.id === id);
  const segmento = (id: string) => plano.publico_alvo.segmentos.find((s) => s.id === id)?.nome ?? id;
  const conceito = (id: string) => plano.criativos.conceitos.find((c) => c.id === id)?.titulo ?? id;
  const meta = (id: string) => plano.metas_e_metricas.metas.find((m) => m.id === id)?.nome ?? id;
  const nomeDoCanal = (c: string) => ROTULO_DO_CANAL[c] ?? c;
  const nomeDaPlataforma = (p: string | undefined) => (p ? (ROTULO_DA_PLATAFORMA_DO_PLANO[p] ?? p) : null);

  switch (chave) {
    case 'resumo_executivo': {
      const s = plano.resumo_executivo;
      return [
        { tipo: 'texto', rotulo: 'Objetivo', texto: s.objetivo },
        { tipo: 'afirmacao', rotulo: 'Aposta central', afirmacao: afirmar(s.aposta_central) },
        { tipo: 'texto', rotulo: 'Verba', texto: reais(s.verba) },
        { tipo: 'afirmacao', rotulo: 'Resultado esperado', afirmacao: afirmar(s.resultado_esperado) },
      ];
    }
    case 'intencao': {
      const s = plano.intencao;
      return [
        { tipo: 'texto', rotulo: 'Objetivo', texto: s.objetivo },
        { tipo: 'texto', rotulo: 'Horizonte', texto: periodoBr(s.horizonte) },
        { tipo: 'texto', rotulo: 'Ousadia', texto: ROTULO_DA_OUSADIA[s.ousadia] ?? s.ousadia },
        { tipo: 'texto', rotulo: 'Retorno esperado', texto: s.retorno_esperado.valor ? `${s.retorno_esperado.descricao} (${quantia(s.retorno_esperado.valor)})` : s.retorno_esperado.descricao },
        { tipo: 'texto', rotulo: 'Verba', texto: reais(s.verba) },
      ];
    }
    case 'diagnostico': {
      const s = plano.diagnostico;
      return [
        { tipo: 'afirmacao', rotulo: 'Situação', afirmacao: afirmar(s.situacao) },
        { tipo: 'afirmacao', rotulo: 'Obstáculo principal', afirmacao: afirmar(s.obstaculo_principal) },
        ...s.historico_de_desempenho.map((a, i): BlocoDaSecao => ({ tipo: 'afirmacao', rotulo: i === 0 ? 'Histórico de desempenho' : null, afirmacao: afirmar(a) })),
        ...s.o_que_os_dados_mostram.map((a, i): BlocoDaSecao => ({ tipo: 'afirmacao', rotulo: i === 0 ? 'O que os dados mostram' : null, afirmacao: afirmar(a) })),
      ];
    }
    case 'publico_alvo':
      return plano.publico_alvo.segmentos.map((s) =>
        cartao(s.nome, {
          fatos: [['Momentos de compra', s.momentos_de_compra.join('; ')]],
          afirmacoes: [
            ['Quem é', afirmar(s.descricao)],
            ['Tamanho estimado', s.tamanho_estimado ? afirmar(s.tamanho_estimado) : null],
            ['Quem converte', s.quem_converte ? afirmar(s.quem_converte) : null],
          ],
        }),
      );
    case 'comunidades_alvo':
      return plano.comunidades_alvo.comunidades.map((c) =>
        cartao(c.nome, {
          fatos: [
            ['Onde', c.onde],
            ['Público', c.segmento_id ? segmento(c.segmento_id) : null],
            ['Tipo de creator', c.tipo_de_creator],
          ],
          afirmacoes: [['Como entrar', afirmar(c.como_entrar)]],
        }),
      );
    case 'posicionamento_e_mensagem': {
      const s = plano.posicionamento_e_mensagem;
      return [
        { tipo: 'afirmacao', rotulo: 'Promessa', afirmacao: afirmar(s.promessa) },
        ...s.provas.map((a, i): BlocoDaSecao => ({ tipo: 'afirmacao', rotulo: i === 0 ? 'Provas' : null, afirmacao: afirmar(a) })),
        { tipo: 'texto', rotulo: 'Tom', texto: s.tom },
        ...(s.a_marca_nao_diz.length > 0 ? [{ tipo: 'lista', rotulo: 'O que a marca não diz', itens: s.a_marca_nao_diz } as const] : []),
      ];
    }
    case 'estrategia': {
      const s = plano.estrategia;
      return [
        { tipo: 'afirmacao', rotulo: 'Política escolhida', afirmacao: afirmar(s.politica) },
        ...(s.nao_faremos.length > 0 ? [{ tipo: 'lista', rotulo: 'O que não faremos', itens: s.nao_faremos.map((n) => n.texto) } as const] : []),
        ...s.hipoteses.map((h) =>
          cartao(`Hipótese: ${h.afirmacao}`, {
            selo: 'hipótese',
            fatos: [
              ['Premissas', h.premissas.join('; ')],
              ['Métrica', h.metrica],
              ['Limiar', h.limiar],
              ['Checagem em', dataBr(h.data_de_checagem)],
            ],
            marcas: marcas(h.evidencias),
          }),
        ),
      ];
    }
    case 'canais_e_plataformas': {
      const s = plano.canais_e_plataformas;
      return [
        ...s.canais.map((c) =>
          cartao([nomeDoCanal(c.canal), nomeDaPlataforma(c.plataforma)].filter(Boolean).join(' · '), {
            selo: ROTULO_DO_PAPEL_DO_CANAL[c.papel] ?? c.papel,
            afirmacoes: [['Por quê', afirmar(c.justificativa)]],
          }),
        ),
        ...(s.divisao_marca_e_ativacao ? [{ tipo: 'afirmacao', rotulo: 'Divisão entre marca e ativação', afirmacao: afirmar(s.divisao_marca_e_ativacao) } as const] : []),
      ];
    }
    case 'campanhas':
      return plano.campanhas.campanhas.map((c) =>
        cartao(c.nome, {
          selo: [nomeDoCanal(c.canal), nomeDaPlataforma(c.plataforma)].filter(Boolean).join(' · '),
          fatos: [
            ['Objetivo', c.objetivo],
            ['Público', segmento(c.segmento_id)],
            ['Oferta', c.oferta],
            ['Formato', ROTULO_DO_FORMATO[c.formato] ?? c.formato],
            ['Conceito', conceito(c.conceito_id)],
            ['Verba', reais(c.verba)],
            ['Período', periodoBr(c.periodo)],
            ['Métrica de sucesso', c.metrica_de_sucesso],
            ['Meta', meta(c.meta_id)],
          ],
        }),
      );
    case 'criativos':
      return plano.criativos.conceitos.map((c) => cartao(c.titulo, { fatos: [['Ideia', c.ideia], ['O que testar', c.o_que_testar], ['Hipótese', c.hipotese_id ?? null]] }));
    case 'orcamento': {
      const s = plano.orcamento;
      return [
        { tipo: 'texto', rotulo: 'Total', texto: reais(s.total) },
        { tipo: 'texto', rotulo: 'Verba de teste', texto: reais(s.verba_de_teste) },
        {
          tipo: 'tabela',
          rotulo: 'Divisão por canal',
          colunas: ['Canal', 'Valor'],
          linhas: s.por_canal.map((p) => {
            const c = canal(p.canal_id);
            return [c ? [nomeDoCanal(c.canal), nomeDaPlataforma(c.plataforma)].filter(Boolean).join(' · ') : p.canal_id, reais(p.valor)];
          }),
        },
      ];
    }
    case 'metas_e_metricas':
      return [
        {
          tipo: 'tabela',
          rotulo: null,
          colunas: ['Meta', 'Nível', 'Métrica', 'Previsto', 'Janela', 'Custo e qualidade', 'Base'],
          linhas: plano.metas_e_metricas.metas.map((m): Celula[] => [
            m.nome,
            ROTULO_DO_NIVEL_DE_META[m.nivel] ?? m.nivel,
            m.metrica,
            quantia(m.previsto),
            periodoBr(m.janela),
            `${m.metrica_de_custo} · ${m.metrica_de_qualidade}`,
            [
              ...(m.hipotese ? ['hipótese'] : []),
              ...(m.nota_da_evidencia ? [`nota ${m.nota_da_evidencia}`] : []),
            ].join(', ') || '—',
          ]),
        },
        ...plano.metas_e_metricas.metas
          .filter((m) => m.evidencias.length > 0)
          .map((m): BlocoDaSecao => ({ tipo: 'tabela', rotulo: `Evidências de "${m.nome}"`, colunas: ['Fontes'], linhas: [[marcas(m.evidencias)]] })),
      ];
    case 'medicao':
      return plano.medicao.itens.map((i) =>
        cartao(`Como medir: ${meta(i.meta_id)}`, {
          fatos: [
            ['Forma de medir', i.como_medir],
            ['Fonte', i.fonte],
            ['Experimento', i.experimento ? `${ROTULO_DO_EXPERIMENTO[i.experimento.tipo] ?? i.experimento.tipo}: ${i.experimento.descricao}` : null],
            ['Critério de parada', i.criterio_de_parada],
            ['Critério de escala', i.criterio_de_escala],
          ],
        }),
      );
    case 'calendario':
      return plano.calendario.fases.map((f) =>
        cartao(f.nome, { fatos: [['Período', periodoBr(f.periodo)], ...f.marcos.map((m): readonly [string, string] => [dataBr(m.data), m.descricao])] }),
      );
    case 'riscos_e_regras': {
      const s = plano.riscos_e_regras;
      const citadas = [...s.riscos, ...s.regras_aplicaveis, ...s.limites_do_cliente].flatMap((item) => item.evidencias);
      const temRegraLegalNaoVerificada = marcas(citadas).some((marca) => marca.indicacoes.includes(INDICACAO_NAO_VERIFICADA));
      return [
        ...(temRegraLegalNaoVerificada
          ? [cartao(AVISO_REGRA_LEGAL_NAO_VERIFICADA, { selo: 'Confira antes de autorizar', destaque: true })]
          : []),
        ...s.riscos.map((r) =>
          cartao(r.descricao, { selo: `Severidade ${(ROTULO_DA_SEVERIDADE[r.severidade] ?? r.severidade).toLowerCase()}`, fatos: [['Mitigação', r.mitigacao]], marcas: marcas(r.evidencias) }),
        ),
        ...s.regras_aplicaveis.map((r) => cartao(r.resumo, { selo: 'Regra aplicável', marcas: marcas(r.evidencias) })),
        ...s.limites_do_cliente.map((r) => cartao(r.resumo, { selo: 'Limite do cliente', marcas: marcas(r.evidencias) })),
        ...s.limites_nao_aplicaveis.map((l) =>
          cartao(`O plano declara que o limite ${(ROTULO_DA_MEDIDA[l.medida] ?? l.medida).toLowerCase()} não se aplica`, {
            selo: 'Confira antes de autorizar',
            destaque: true,
            fatos: [['Motivo', l.motivo]],
          }),
        ),
      ];
    }
    case 'lacunas':
      return plano.lacunas.itens.map((l) =>
        cartao(l.descricao, { selo: ROTULO_DA_LACUNA[l.tipo] ?? l.tipo, fatos: [['Impacto', l.impacto], ['Como preencher', l.como_preencher]] }),
      );
  }
}

export function lacunasDeLimite(plano: Plano): readonly Plano['lacunas']['itens'][number][] {
  return plano.lacunas.itens.filter((l) => l.tipo === 'limite_ausente');
}

function quemFez(tipo: 'usuario' | 'agente' | 'sistema', usuarioId: string | null, agentId: string | null, nomes: ReadonlyMap<string, string>): QuemFez {
  if (tipo === 'agente') return { tipo: 'agente', rotulo: `Agente ${agentId ?? ''}`.trim() };
  if (tipo === 'sistema') return { tipo: 'sistema', rotulo: 'Sistema' };
  return { tipo: 'pessoa', rotulo: (usuarioId ? nomes.get(usuarioId) : undefined) ?? 'Membro da equipe' };
}

function numerosDasVersoes(versoes: readonly VersaoResumo[]): ReadonlyMap<string, number> {
  const ordenadas = [...versoes].sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime());
  return new Map(ordenadas.map((versao, indice) => [versao.id, indice + 1]));
}

function execucaoNaTela(execucao: Execucao, agora: Date): ExecucaoNaTela {
  const atual = ETAPAS_DA_EXECUCAO.indexOf(execucao.etapa as (typeof ETAPAS_DA_EXECUCAO)[number]);
  const etapas = ETAPAS_DA_EXECUCAO.map((chave, indice): EtapaDaVisao => ({
    chave,
    rotulo: ROTULO_DA_ETAPA[chave] ?? chave,
    estado: execucao.etapa === 'fim' || indice < atual ? 'feita' : indice === atual ? 'atual' : 'pendente',
  }));
  return {
    id: execucao.id,
    titulo: TITULO_DA_EXECUCAO[execucao.tipo] ?? 'Trabalhando no plano',
    etapas,
    etapaAtual: ROTULO_DA_ETAPA[execucao.etapa] ?? 'Finalizando',
    rodada: execucao.rodada,
    parada: execucaoSemAvanco(execucao, agora),
  };
}

function pareceresNaTela(painel: PainelDoPlano): ParecerNaTela[] {
  const respostas = new Map<string, { decisao: 'acatado' | 'nao_acatado'; motivo: string }>();
  const listaDeRespostas = painel.ajuste?.payload.respostas;
  if (Array.isArray(listaDeRespostas)) {
    for (const bruta of listaDeRespostas) {
      const r = registro(bruta);
      const decisao = r?.decisao === 'acatado' || r?.decisao === 'nao_acatado' ? r.decisao : null;
      if (r && decisao) respostas.set(`${String(r.persona)}/${String(r.pontoId)}`, { decisao, motivo: texto(r.motivo) ?? '' });
    }
  }
  return painel.pareceres.map((parecer): ParecerNaTela => {
    const persona = personaPorChave(parecer.persona);
    const aparencia = APARENCIA_DO_VEREDITO[parecer.veredito] ?? { icone: 'orienta' as const, classe: '' };
    const brutos = Array.isArray(parecer.payload.pontos) ? parecer.payload.pontos : [];
    const pontos = brutos.flatMap((bruto): PontoNaTela[] => {
      const p = registro(bruto);
      const id = texto(p?.id);
      if (!p || !id) return [];
      const resposta = respostas.get(`${parecer.persona}/${id}`);
      return [
        {
          id,
          trecho: texto(p.trecho) ?? '',
          problema: texto(p.problema) ?? '',
          ajustePedido: texto(p.ajustePedido) ?? '',
          resposta: resposta ? { decisao: resposta.decisao, rotulo: resposta.decisao === 'acatado' ? 'Acatado' : 'Não acatado', motivo: resposta.motivo } : null,
        },
      ];
    });
    return {
      persona: parecer.persona,
      nome: persona?.nome ?? parecer.persona.replace(/_/g, ' '),
      foco: persona?.foco ?? null,
      veredito: parecer.veredito,
      rotuloDoVeredito: ROTULO_DO_VEREDITO_DO_COMITE[parecer.veredito] ?? parecer.veredito,
      icone: aparencia.icone,
      classe: aparencia.classe,
      motivo: texto(parecer.payload.motivo) ?? '',
      pontos,
    };
  });
}

function gatesNaTela(painel: PainelDoPlano): GatesNaTela | null {
  const gate = painel.gate;
  if (!gate) return null;
  const versaoId = painel.versaoExibida?.id;
  const evento = [...painel.historico.eventos]
    .filter((e) => e.tipo === 'gate' && e.versaoId === versaoId)
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())[0];
  const modelo = registro(evento?.payload.modelo);
  const problemasBrutos = Array.isArray(modelo?.problemas) ? modelo.problemas : [];

  const checagens = gate.checagens.flatMap((bruta): ChecagemNaTela[] => {
    const c = registro(bruta);
    const chave = texto(c?.chave);
    if (!c || !chave) return [];
    const resultado = c.resultado === 'aprovado' || c.resultado === 'reprovado' ? c.resultado : 'nao_rodou';
    const aparencia = APARENCIA_DA_CHECAGEM[resultado];
    return [
      {
        chave,
        rotulo: ROTULO_DA_CHECAGEM[chave] ?? chave.replace(/_/g, ' '),
        resultado,
        rotuloDoResultado: aparencia.rotulo,
        icone: aparencia.icone,
        classe: aparencia.classe,
        motivo: texto(c.motivo) ?? '',
        onde: Array.isArray(c.onde) ? c.onde.filter((o): o is string => typeof o === 'string') : [],
      },
    ];
  });
  const aprovado = gate.resultado === 'aprovado';
  return {
    resultado: gate.resultado,
    rotuloDoResultado: aprovado ? 'Gates aprovados' : 'Gates reprovaram',
    icone: aprovado ? 'ok' : 'erro',
    classe: aprovado ? 'pill--ok' : 'pill--danger',
    emTexto: dataEHoraBr(gate.criadoEm),
    checagens,
    problemasDoModelo: problemasBrutos.flatMap((bruto) => {
      const p = registro(bruto);
      const trecho = texto(p?.trecho);
      const problema = texto(p?.problema);
      return trecho && problema ? [{ trecho, problema }] : [];
    }),
  };
}

function detalheDoEvento(evento: EventoDaVersao): string | null {
  const p = evento.payload;
  if (evento.tipo === 'parecer') {
    const persona = personaPorChave(String(p.persona ?? ''));
    const veredito = ROTULO_DO_VEREDITO_DO_COMITE[String(p.veredito ?? '')];
    return [persona?.nome ?? texto(p.persona), veredito].filter(Boolean).join(': ') || null;
  }
  if (evento.tipo === 'gate') return p.resultado === 'aprovado' ? 'Aprovado' : 'Reprovado';
  return null;
}

function avisoDoImpacto(desatualizado: PainelDoPlano['desatualizado'], entradas: ReadonlyMap<string, EntradaDoBrainConhecida>): AvisoDaVisao | null {
  if (desatualizado === null) return null;
  if (desatualizado === 'indisponivel') {
    return {
      chave: 'desatualizado_indisponivel',
      tom: 'info',
      titulo: 'Não foi possível conferir se o Brain mudou',
      texto: 'A conferência com o Brain está indisponível agora. O plano autorizado continua valendo.',
      itens: [],
      link: null,
    };
  }
  if (desatualizado.impacto === 'nenhum') return null;
  const itens = desatualizado.itens.map((item) => {
    const motivo = ROTULO_DO_MOTIVO_DE_IMPACTO[item.motivo] ?? item.motivo;
    const titulo = entradas.get(item.urn)?.titulo;
    if (titulo) return `${motivo}: ${titulo}`;
    return `${motivo}${item.tipo ? ` (${ROTULO_DO_TIPO_DE_ENTRADA[item.tipo] ?? item.tipo.replace(/_/g, ' ')})` : ''}`;
  });
  const unicos = [...new Set(itens)];
  if (desatualizado.impacto === 'informativo') {
    return { chave: 'brain_mudou_informativo', tom: 'info', titulo: 'O Brain mudou, sem efeito material no plano', texto: null, itens: unicos, link: null };
  }
  return {
    chave: 'desatualizado',
    tom: 'warn',
    titulo: 'O plano está desatualizado: o Brain mudou',
    texto: 'O plano autorizado segue valendo até você abrir uma revisão.',
    itens: unicos,
    link: null,
  };
}

function acoesDaVisao(painel: PainelDoPlano | null, papel: MemberRole): AcaoDaVisao[] {
  const pode = (acao: AcaoDoPlano) => podeExecutar(acao, { tipo: 'pessoa', papel });
  if (papel === 'viewer') return [];
  const execucaoAtiva = painel?.execucaoAtiva ?? null;
  const status = painel?.status ?? null;
  const acoes: AcaoDaVisao[] = [];
  const motivosDeEscrita = (acao: AcaoDoPlano, quem: string): string[] => {
    const motivos: string[] = [];
    if (!pode(acao)) motivos.push(quem);
    if (execucaoAtiva) motivos.push('Há uma execução em andamento: aguarde ou cancele.');
    return motivos;
  };
  const adicionar = (chave: ChaveDeAcao, rotulo: string, motivos: readonly string[]) => acoes.push({ chave, rotulo, habilitada: motivos.length === 0, motivos });

  if (painel === null || status === null) {
    adicionar('novo_plano', 'Novo plano', motivosDeEscrita('criar', 'Seu papel não permite criar plano.'));
    if (execucaoAtiva && pode('cancelar')) adicionar('cancelar_execucao', 'Cancelar execução', []);
    return acoes;
  }

  if (status === 'rascunho') {
    const motivos = motivosDeEscrita('aplicar', 'Seu papel não permite aplicar o plano.');
    const faltas: readonly FaltaParaAplicar[] = painel.faltaParaAplicar ?? [];
    adicionar('aplicar', 'Aplicar o plano', [...motivos, ...faltas.map((falta) => MENSAGEM_DA_FALTA[falta])]);
  }
  if (status === 'proposto') {
    const doPapel = 'Só quem administra pode autorizar ou rejeitar o plano.';
    adicionar('autorizar', 'Autorizar', motivosDeEscrita('autorizar', doPapel).filter((m) => !m.startsWith('Há uma execução')));
    adicionar('rejeitar', 'Rejeitar', motivosDeEscrita('rejeitar', doPapel).filter((m) => !m.startsWith('Há uma execução')));
  }
  if (status === 'vigente') {
    adicionar('revogar', 'Revogar', pode('revogar') ? [] : ['Só quem administra pode revogar o plano.']);
  }
  if (status === 'rascunho') {
    adicionar('cancelar_rascunho', 'Cancelar rascunho', pode('cancelar') ? [] : ['Seu papel não permite cancelar o rascunho.']);
  }
  if (status === 'rascunho' || status === 'proposto' || status === 'vigente') {
    adicionar('pedir_mudanca', 'Pedir mudança ao agente', motivosDeEscrita('editar', 'Seu papel não permite pedir mudança.'));
    adicionar('editar_secao', 'Editar seção', motivosDeEscrita('editar', 'Seu papel não permite editar o plano.'));
  }
  if (status === 'vigente' && painel.desatualizado !== null && painel.desatualizado !== 'indisponivel' && painel.desatualizado.impacto === 'material') {
    adicionar('pedir_revisao', 'Pedir revisão', motivosDeEscrita('editar', 'Seu papel não permite pedir revisão.'));
  }
  if (execucaoAtiva) adicionar('cancelar_execucao', 'Cancelar execução', pode('cancelar') ? [] : ['Seu papel não permite cancelar a execução.']);
  return acoes;
}

function avisosDaVisao(
  painel: PainelDoPlano,
  plano: Plano | null,
  planoLegivel: boolean,
  clienteId: string,
  agora: Date,
  entradas: ReadonlyMap<string, EntradaDoBrainConhecida>,
): AvisoDaVisao[] {
  const avisos: AvisoDaVisao[] = [];
  const ativa = painel.execucaoAtiva;
  if (ativa && execucaoSemAvanco(ativa, agora)) {
    avisos.push({
      chave: 'execucao_parada',
      tom: 'warn',
      titulo: 'A execução não está avançando',
      texto: 'Ela pode ter travado. Atualize a tela; se continuar igual, cancele a execução e peça de novo.',
      itens: [],
      link: { rotulo: 'Atualizar', href: rotaDoCliente(clienteId, 'estrategia', { secao: 'plano', tipo: painel.plano.tipo }) },
    });
  } else if (ativa) {
    const etapa = ROTULO_DA_ETAPA[ativa.etapa] ?? 'Finalizando';
    avisos.push({
      chave: 'em_andamento',
      tom: 'info',
      titulo: `${TITULO_DA_EXECUCAO[ativa.tipo] ?? 'Trabalhando no plano'}: etapa "${etapa}"`,
      texto: 'Isso leva alguns minutos. Você pode sair desta tela e voltar depois.',
      itens: [],
      link: null,
    });
  } else if (painel.ultimaExecucao?.status === 'falhou') {
    const mensagem = mensagemDeFalha(painel.ultimaExecucao.erroCodigo);
    avisos.push({
      chave: 'execucao_falhou',
      tom: 'danger',
      titulo: mensagem.titulo,
      texto: mensagem.texto,
      itens: [],
      link:
        mensagem.link === 'config'
          ? { rotulo: 'Abrir configurações', href: '/config' }
          : mensagem.link === 'gates'
            ? { rotulo: 'Ver os Gates', href: rotaDoCliente(clienteId, 'estrategia', { secao: 'gates' }) }
            : null,
    });
  }
  const impacto = avisoDoImpacto(painel.desatualizado, entradas);
  if (impacto) avisos.push(impacto);
  if (!planoLegivel && painel.versaoExibida) {
    avisos.push({
      chave: 'plano_ilegivel',
      tom: 'danger',
      titulo: 'O conteúdo desta versão não segue o formato atual',
      texto: 'Não é possível mostrar o plano por seção. Peça uma mudança ao agente para gerar uma versão nova.',
      itens: [],
      link: null,
    });
  }
  if (plano && plano.lacunas.itens.length > 0) {
    const faltaLimite = lacunasDeLimite(plano);
    avisos.push({
      chave: 'lacunas',
      tom: 'warn',
      titulo: `O plano aponta ${plano.lacunas.itens.length} ${plano.lacunas.itens.length === 1 ? 'lacuna' : 'lacunas'} no Brain`,
      texto: 'Preencher o que falta deixa o plano mais firme.',
      itens: plano.lacunas.itens.map((l) => l.descricao),
      link: faltaLimite.length > 0 ? { rotulo: 'Definir limites em Regras', href: rotaDoCliente(clienteId, 'regras', { secao: 'registrar', natureza: 'limite', ...(faltaLimite[0]?.medida ? { definicao: faltaLimite[0].medida } : {}) }) } : null,
    });
  }
  return avisos;
}

function versoesNaTela(painel: PainelDoPlano, nomes: ReadonlyMap<string, string>, exibidaId: string | null): VersaoNaTela[] {
  const numeros = numerosDasVersoes(painel.historico.versoes);
  return [...painel.historico.versoes]
    .sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
    .map((versao): VersaoNaTela => {
      const aparencia = APARENCIA_DO_STATUS[versao.status];
      return {
        id: versao.id,
        numero: numeros.get(versao.id) ?? 0,
        status: versao.status,
        rotuloDoStatus: ROTULO_DO_STATUS[versao.status],
        icone: aparencia.icone,
        classe: aparencia.classe,
        autor: quemFez(versao.autorTipo, versao.autorUsuarioId, versao.agentId, nomes),
        em: versao.criadaEm,
        emTexto: dataEHoraBr(versao.criadaEm),
        exibida: versao.id === exibidaId,
      };
    });
}

function eventosNaTela(painel: PainelDoPlano, nomes: ReadonlyMap<string, string>, numeros: ReadonlyMap<string, number>): EventoNaTela[] {
  return [...painel.historico.eventos]
    .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
    .map((evento): EventoNaTela => ({
      id: evento.id,
      rotulo: ROTULO_DO_EVENTO_DO_PLANO[evento.tipo] ?? evento.tipo,
      detalhe: detalheDoEvento(evento),
      quem: quemFez(evento.atorTipo, evento.atorUsuarioId, evento.agentId, nomes),
      versao: numeros.get(evento.versaoId) ?? null,
      em: evento.criadoEm,
      emTexto: dataEHoraBr(evento.criadoEm),
    }));
}

function avisoDeHistoricoSemVersaoAtiva(painel: PainelDoPlano, clienteId: string): AvisoDaVisao | null {
  const ultima = [...painel.historico.versoes].sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())[0];
  if (!ultima) return null;
  return {
    chave: 'sem_versao_ativa',
    tom: 'info',
    titulo: 'Não há plano em rascunho nem autorizado',
    texto: `Status da última versão: ${ROTULO_DO_STATUS[ultima.status].toLowerCase()}. As versões e os eventos continuam no Histórico.`,
    itens: [],
    link: { rotulo: 'Ver o Histórico', href: rotaDoCliente(clienteId, 'estrategia', { secao: 'historico', tipo: painel.plano.tipo }) },
  };
}

export function visaoDoPlano(entrada: EntradaDaVisao): VisaoDoPlano {
  const { painel, papel, clienteId } = entrada;
  const nomes = entrada.nomes ?? new Map<string, string>();
  const agora = entrada.agora ?? new Date();
  const contexto: Contexto = { clienteId, entradas: entrada.entradasDoBrain ?? new Map(), hoje: agora.toISOString().slice(0, 10) };
  const somenteLeitura = papel === 'viewer';
  const acoes = acoesDaVisao(painel, papel);

  if (painel === null || painel.versaoExibida === null) {
    const falhaOuAndamento = painel ? avisosDaVisao(painel, null, true, clienteId, agora, contexto.entradas) : [];
    const semVersaoAtiva = painel ? avisoDeHistoricoSemVersaoAtiva(painel, clienteId) : null;
    const numerosSemVersaoAtiva = painel ? numerosDasVersoes(painel.historico.versoes) : new Map<string, number>();
    return {
      planoId: painel?.plano.id ?? null,
      temPlano: false,
      somenteLeitura,
      status: null,
      rotuloDoStatus: null,
      icone: null,
      classe: '',
      versao: null,
      avisos: semVersaoAtiva ? [...falhaOuAndamento, semVersaoAtiva] : falhaOuAndamento,
      execucao: painel?.execucaoAtiva ? execucaoNaTela(painel.execucaoAtiva, agora) : null,
      acoes,
      secoes: [],
      pareceres: [],
      pontosPendentesDoComite: 0,
      resumoDoComite: null,
      gates: null,
      checagensReprovadas: 0,
      versoes: painel ? versoesNaTela(painel, nomes, null) : [],
      eventos: painel ? eventosNaTela(painel, nomes, numerosSemVersaoAtiva) : [],
    };
  }

  const versaoExibida = painel.versaoExibida;
  const status = versaoExibida.status;
  const lida = lerPlano(versaoExibida.conteudo);
  const plano = lida.ok ? lida.value : null;
  const numeros = numerosDasVersoes(painel.historico.versoes);
  const aparenciaDoStatus = APARENCIA_DO_STATUS[status];

  const secoes: SecaoNaTela[] = plano
    ? SECOES_DO_PLANO.map((chave) => ({
        chave,
        titulo: TITULO_DA_SECAO[chave],
        blocos: blocosDaSecao(chave, plano, contexto),
        json: JSON.stringify(plano[chave], null, 2),
      }))
    : [];

  const pareceres = pareceresNaTela(painel);
  const pontosPendentes = pareceres.reduce((total, p) => total + p.pontos.filter((ponto) => ponto.resposta === null).length, 0);
  const gates = gatesNaTela(painel);

  const versoes = versoesNaTela(painel, nomes, versaoExibida.id);
  const eventos = eventosNaTela(painel, nomes, numeros);

  const resumoDoComite =
    pareceres.length === 0 ? null : `${pareceres.length} ${pareceres.length === 1 ? 'persona opinou' : 'personas opinaram'}; ${pontosPendentes === 0 ? 'todos os pontos têm resposta' : `${pontosPendentes} ${pontosPendentes === 1 ? 'ponto sem resposta' : 'pontos sem resposta'}`}.`;

  return {
    planoId: painel.plano.id,
    temPlano: true,
    somenteLeitura,
    status,
    rotuloDoStatus: ROTULO_DO_STATUS[status],
    icone: aparenciaDoStatus.icone,
    classe: aparenciaDoStatus.classe,
    versao: {
      id: versaoExibida.id,
      numero: numeros.get(versaoExibida.id) ?? 1,
      autor: quemFez(versaoExibida.autorTipo, versaoExibida.autorUsuarioId, versaoExibida.agentId, nomes),
      em: versaoExibida.criadaEm,
      emTexto: dataEHoraBr(versaoExibida.criadaEm),
    },
    avisos: avisosDaVisao(painel, plano, lida.ok, clienteId, agora, contexto.entradas),
    execucao: painel.execucaoAtiva ? execucaoNaTela(painel.execucaoAtiva, agora) : null,
    acoes,
    secoes,
    pareceres,
    pontosPendentesDoComite: pontosPendentes,
    resumoDoComite,
    gates,
    checagensReprovadas: gates?.checagens.filter((c) => c.resultado !== 'aprovado').length ?? 0,
    versoes,
    eventos,
  };
}
