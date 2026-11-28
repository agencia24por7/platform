import { rotaDoCliente } from '../../clients/domain/painel/enderecos.ts';
import type { MemberRole } from '../../identity/domain/user.ts';
import { aplicarUtm } from '../../../shared/utm/utm.ts';
import type { FaltaParaAplicar } from '../domain/aplicacao.ts';
import { criarPodeRepetir, erroRepetivel } from '../domain/repeticaoDaExecucao.ts';
import { podeExecutar, type AcaoDoPlano } from '../domain/papeis.ts';
import { gruposEditaveis, type GrupoDeCampos } from './camposEditaveisDaSecao.ts';
import { CATALOGOS_DISPONIVEIS } from '../domain/catalogo/disponiveis.ts';
import type { CatalogoDeCampos } from '../domain/catalogo/tipos.ts';
import { lerPlano, type Afirmacao, type Evidencia, type Plano, type SecaoDoPlano } from '../domain/plano.ts';
import { ROTULO_DO_STATUS, type StatusDaVersao } from '../domain/status.ts';
import { ROTULO_DO_TIPO_DE_PLANO, ehTipoDePlano } from '../domain/tipoDePlano.ts';
import type { Execucao } from '../application/portas.ts';
import type { PainelDoPlano } from '../application/estrategiaService.ts';
import { execucaoSemAvanco } from './agendamentoDaAtualizacao.ts';
import { MOTIVO_DE_APAGAR_COM_EXECUCAO, tituloDoPlano } from './cardsDePlano.ts';
import type { FalhaDoGate } from './falhaDoGate.ts';
import { textoDoFocoCompleto } from './focoNaTela.ts';
import { dataEHoraBr, periodoBr, reais } from './formatosDoPlano.ts';
import { TEXTO_DO_BOTAO_APROVAR_SUGESTOES, type LacunaDoPlano } from './lacunasDoPlano.ts';
import { rotaDoPlano } from './rotasDaEstrategia.ts';
import {
  ROTULO_DA_ETAPA,
  ROTULO_DA_MEDIDA,
  ROTULO_DA_PLATAFORMA_DO_PLANO,
  ROTULO_DO_MOTIVO_DE_IMPACTO,
  ROTULO_DO_PAPEL_DA_EVIDENCIA,
  ROTULO_DO_TIPO_DE_ENTRADA,
  TITULO_DA_SECAO,
  TITULO_DA_SECAO_DE_MIDIA,
  nomeDoCampo,
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
  readonly catalogos?: readonly CatalogoDeCampos[];
  readonly agora?: Date;
};

export type NomeDoIconeDaVisao = 'ok' | 'atencao' | 'erro' | 'pausada' | 'nao' | 'vazio';

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

export type BlocoDoResumo =
  | { readonly tipo: 'afirmacao'; readonly rotulo: string; readonly afirmacao: AfirmacaoNaTela }
  | { readonly tipo: 'texto'; readonly rotulo: string; readonly texto: string };

export type CampoDeMidiaNaTela = {
  readonly chave: string;
  readonly rotulo: string;
  readonly valor: string;
  readonly justificativa: string | null;
  readonly marcas: readonly Marca[];
};

export type SecaoDeMidiaNaTela = { readonly chave: string; readonly titulo: string; readonly campos: readonly CampoDeMidiaNaTela[]; readonly aberta: boolean };

export type PlataformaDeMidiaNaTela = {
  readonly plataforma: string;
  readonly rotulo: string;
  readonly link: string | null;
  readonly secoes: readonly SecaoDeMidiaNaTela[];
  readonly aberta: boolean;
};

export type BlocoDoPlano<Conteudo> = {
  readonly chave: SecaoDoPlano;
  readonly titulo: string;
  readonly grupos: readonly GrupoDeCampos[];
  readonly conteudo: Conteudo;
};

export type AvisoDaVisao = {
  readonly chave: string;
  readonly tom: 'info' | 'warn' | 'danger';
  readonly titulo: string;
  readonly texto: string | null;
  readonly itens: readonly string[];
  readonly link: { readonly rotulo: string; readonly href: string } | null;
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
  | 'tentar_de_novo'
  | 'editar_secao'
  | 'apagar_plano';

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
  readonly parada: boolean;
};

export type LacunaNaTela = LacunaDoPlano & { readonly origemRotulo: string; readonly textoEditavel: string | null };

const ROTULO_DA_ORIGEM: Readonly<Record<LacunaDoPlano['origem'], string>> = {
  evidencia: 'Sugestão com base em evidência do cliente',
  hipotese: 'Hipótese do plano, ainda sem evidência',
  sem_sugestao: 'Sem sugestão do plano',
};

export type LacunasNaTela = {
  readonly itens: readonly LacunaNaTela[];
  readonly podeAprovar: boolean;
  readonly textoDoBotao: string;
  readonly regrasHref: string;
};

export type VisaoDoPlano = {
  readonly planoId: string | null;
  readonly temPlano: boolean;
  readonly somenteLeitura: boolean;
  readonly titulo: string;
  readonly tipoRotulo: string;
  readonly plataformas: readonly string[];
  readonly foco: string | null;
  readonly status: StatusDaVersao | null;
  readonly rotuloDoStatus: string;
  readonly icone: NomeDoIconeDaVisao;
  readonly classe: string;
  readonly versao: { readonly id: string; readonly em: Date; readonly emTexto: string } | null;
  readonly avisos: readonly AvisoDaVisao[];
  readonly execucao: ExecucaoNaTela | null;
  readonly acoes: readonly AcaoDaVisao[];
  readonly resumo: BlocoDoPlano<readonly BlocoDoResumo[]> | null;
  readonly midia: BlocoDoPlano<readonly PlataformaDeMidiaNaTela[]> | null;
  readonly lacunas: LacunasNaTela | null;
  readonly falhaDoGate: FalhaDoGate | null;
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

const MOTIVO_DA_REVISAO_EM_ANDAMENTO = 'O plano ainda está em revisão. Aguarde a conferência terminar.';

const MOTIVO_POR_FALTA: Readonly<Record<FaltaParaAplicar, string>> = {
  falta_parecer: MOTIVO_DA_REVISAO_EM_ANDAMENTO,
  falta_gate: MOTIVO_DA_REVISAO_EM_ANDAMENTO,
  gate_anterior_ao_parecer: MOTIVO_DA_REVISAO_EM_ANDAMENTO,
  gate_de_outra_execucao: MOTIVO_DA_REVISAO_EM_ANDAMENTO,
  gate_reprovado: 'O plano não passou na conferência final. Peça uma mudança ao agente ou edite o plano.',
};

export type MensagemDeFalha = { readonly titulo: string; readonly texto: string | null; readonly textoSemBotao: string | null; readonly link: 'config' | null };

export const MENSAGEM_POR_ERRO_DA_EXECUCAO: Readonly<Record<string, MensagemDeFalha>> = {
  ia_nao_configurada: { titulo: 'A inteligência artificial ainda não está configurada', texto: 'Sem ela o plano não pode ser criado nem ajustado.', textoSemBotao: null, link: 'config' },
  ia_limite: { titulo: 'O limite de uso da inteligência artificial foi atingido', texto: 'Quando o limite voltar, use Tentar de novo.', textoSemBotao: 'Quem pode pedir o plano deve repetir mais tarde.', link: null },
  ia_saida_invalida: { titulo: 'A resposta da inteligência artificial não pôde ser usada', texto: 'Ela veio fora do formato esperado. Use Tentar de novo.', textoSemBotao: 'Ela veio fora do formato esperado. Quem pode pedir o plano deve repetir.', link: null },
  ia_falha: { titulo: 'O serviço de inteligência artificial falhou', texto: 'Use Tentar de novo em alguns minutos.', textoSemBotao: 'Quem pode pedir o plano deve repetir em alguns minutos.', link: null },
  ia_tempo: { titulo: 'O pedido demorou mais do que o permitido', texto: 'Use Tentar de novo.', textoSemBotao: 'Quem pode pedir o plano deve repetir.', link: null },
  brain_indisponivel: { titulo: 'Não foi possível ler o contexto do cliente agora', texto: 'Use Tentar de novo em alguns minutos.', textoSemBotao: 'Quem pode pedir o plano deve repetir em alguns minutos.', link: null },
  gate_reprovado: { titulo: 'O plano não passou na conferência final', texto: 'Peça uma mudança ao agente ou edite o plano.', textoSemBotao: null, link: null },
  interno: { titulo: 'Algo deu errado ao montar o plano', texto: 'Use Tentar de novo. Se repetir, avise a equipe.', textoSemBotao: 'Se repetir, avise a equipe.', link: null },
};

const MENSAGEM_DE_FALHA_DESCONHECIDA: MensagemDeFalha = MENSAGEM_POR_ERRO_DA_EXECUCAO['interno']!;

export function mensagemDeFalha(codigo: string | null): MensagemDeFalha {
  return (codigo !== null ? MENSAGEM_POR_ERRO_DA_EXECUCAO[codigo] : undefined) ?? MENSAGEM_DE_FALHA_DESCONHECIDA;
}

export function caminhoLegivel(caminho: string): string {
  const partes = caminho.split('.').filter((parte) => parte !== '');
  if (partes.length === 0) return 'Plano';
  const [raiz, ...resto] = partes;
  const titulo = TITULO_DA_SECAO[raiz as SecaoDoPlano] ?? raiz ?? 'Plano';
  const legiveis = resto.map((parte) => (/^\d+$/.test(parte) ? `item ${Number(parte) + 1}` : parte.replace(/_/g, ' ')));
  return [titulo, ...legiveis].join(' › ');
}

type Contexto = {
  readonly clienteId: string;
  readonly entradas: ReadonlyMap<string, EntradaDoBrainConhecida>;
  readonly hoje: string;
};

function marcasDe(evidencias: readonly Evidencia[], contexto: Contexto): Marca[] {
  const href = rotaDoCliente(contexto.clienteId, 'contexto');
  return evidencias.map((evidencia) => {
    const conhecida = contexto.entradas.get(evidencia.urn);
    const tipoNaUrn = evidencia.urn.split(':')[3] ?? 'entrada';
    const indicacoes = indicacoesDaEvidencia(conhecida, contexto.hoje);
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

function afirmacaoNaTela(afirmacao: Afirmacao, contexto: Contexto): AfirmacaoNaTela {
  return { texto: afirmacao.texto, hipotese: afirmacao.hipotese, marcas: marcasDe(afirmacao.evidencias, contexto) };
}

function nomeDaPlataforma(plataforma: string): string {
  return ROTULO_DA_PLATAFORMA_DO_PLANO[plataforma] ?? plataforma;
}

function blocosDoResumo(plano: Plano, contexto: Contexto): BlocoDoResumo[] {
  const { resumo_executivo: resumo, intencao } = plano;
  const blocos: BlocoDoResumo[] = [
    { tipo: 'texto', rotulo: 'Objetivo', texto: resumo.objetivo },
    { tipo: 'afirmacao', rotulo: 'Aposta central', afirmacao: afirmacaoNaTela(resumo.aposta_central, contexto) },
    { tipo: 'afirmacao', rotulo: 'Resultado esperado', afirmacao: afirmacaoNaTela(resumo.resultado_esperado, contexto) },
    { tipo: 'texto', rotulo: 'Verba e período', texto: `${reais(resumo.verba)} · ${periodoBr(intencao.horizonte)}` },
  ];
  if (intencao.plataformas) blocos.push({ tipo: 'texto', rotulo: 'Plataformas', texto: intencao.plataformas.map(nomeDaPlataforma).join(', ') });
  if (intencao.destino) blocos.push({ tipo: 'texto', rotulo: 'Landing page', texto: intencao.destino.url });
  if (intencao.whatsapp) blocos.push({ tipo: 'texto', rotulo: 'WhatsApp', texto: intencao.whatsapp });
  return blocos;
}

function valorDoCampo(valor: string | number | boolean | readonly string[]): string {
  if (Array.isArray(valor)) return valor.join(', ');
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'number') return valor.toLocaleString('pt-BR');
  return String(valor);
}

function tituloDaSecaoDeMidia(chave: string): string {
  const texto = TITULO_DA_SECAO_DE_MIDIA[chave] ?? nomeDoCampo(chave);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function linkDaPlataforma(plano: Plano, plataforma: string): string | null {
  const { destino, utm } = plano.intencao;
  const parametros = utm?.[plataforma as keyof typeof utm];
  if (!destino || !parametros) return null;
  try {
    return aplicarUtm(destino.url, parametros);
  } catch {
    return null;
  }
}

function plataformasDeMidia(plano: Plano, contexto: Contexto): PlataformaDeMidiaNaTela[] {
  return plano.plano_de_midia.plataformas.map((entrada, indice) => ({
    plataforma: entrada.plataforma,
    rotulo: nomeDaPlataforma(entrada.plataforma),
    link: linkDaPlataforma(plano, entrada.plataforma),
    aberta: indice === 0,
    secoes: entrada.secoes
      .map((secao, posicao) => ({
        chave: secao.secao,
        titulo: tituloDaSecaoDeMidia(secao.secao),
        aberta: indice === 0 && posicao === 0,
        campos: secao.campos.map((campo) => ({
          chave: campo.campo,
          rotulo: nomeDoCampo(campo.campo),
          valor: valorDoCampo(campo.valor),
          justificativa: campo.justificativa.trim() === '' ? null : campo.justificativa,
          marcas: marcasDe(campo.evidencias, contexto),
        })),
      })),
  }));
}

function lacunasNaTela(painel: PainelDoPlano, clienteId: string): LacunasNaTela | null {
  const itens = painel.lacunas ?? [];
  if (itens.length === 0) return null;
  return {
    itens: itens.map((item) => ({ ...item, origemRotulo: ROTULO_DA_ORIGEM[item.origem], textoEditavel: item.editavel ? item.valorLegivel : null })),
    podeAprovar: itens.some((item) => item.podeAprovar),
    textoDoBotao: TEXTO_DO_BOTAO_APROVAR_SUGESTOES,
    regrasHref: rotaDoCliente(clienteId, 'regras', { secao: 'registrar' }),
  };
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
    parada: execucaoSemAvanco(execucao, agora),
  };
}

function avisoDoImpacto(desatualizado: PainelDoPlano['desatualizado'], entradas: ReadonlyMap<string, EntradaDoBrainConhecida>): AvisoDaVisao | null {
  if (desatualizado === null) return null;
  if (desatualizado === 'indisponivel') {
    return {
      chave: 'desatualizado_indisponivel',
      tom: 'info',
      titulo: 'Não foi possível conferir se o contexto do cliente mudou',
      texto: 'A conferência está indisponível agora. O plano autorizado continua valendo.',
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
    return { chave: 'brain_mudou_informativo', tom: 'info', titulo: 'O contexto do cliente mudou, sem efeito material no plano', texto: null, itens: unicos, link: null };
  }
  return {
    chave: 'desatualizado',
    tom: 'warn',
    titulo: 'O plano está desatualizado: o contexto do cliente mudou',
    texto: 'O plano autorizado segue valendo até você abrir uma revisão.',
    itens: unicos,
    link: null,
  };
}

export function podeTentarDeNovo(painel: PainelDoPlano | null, papel: MemberRole): boolean {
  const ultima = painel?.ultimaExecucao ?? null;
  if (!painel || !ultima || painel.execucaoAtiva || ultima.status !== 'falhou') return false;
  if (ultima.tipo === 'corrigir_gate' || !erroRepetivel(ultima.erroCodigo)) return false;
  if (ultima.tipo === 'criar' && !criarPodeRepetir(painel.historico.versoes)) return false;
  return podeExecutar(ultima.tipo === 'criar' ? 'criar' : 'editar', { tipo: 'pessoa', papel });
}

function acaoDeApagar(painel: PainelDoPlano | null, papel: MemberRole): AcaoDaVisao[] {
  if (painel === null || !podeExecutar('remover', { tipo: 'pessoa', papel })) return [];
  const motivos = painel.execucaoAtiva ? [MOTIVO_DE_APAGAR_COM_EXECUCAO] : [];
  return [{ chave: 'apagar_plano', rotulo: 'Apagar plano', habilitada: motivos.length === 0, motivos }];
}

function acoesDaVisao(painel: PainelDoPlano | null, papel: MemberRole): AcaoDaVisao[] {
  return [...acoesDeEdicao(painel, papel), ...acaoDeApagar(painel, papel)];
}

function acoesDeEdicao(painel: PainelDoPlano | null, papel: MemberRole): AcaoDaVisao[] {
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
    if (execucaoAtiva && pode('cancelar')) adicionar('cancelar_execucao', 'Cancelar execução', []);
    if (podeTentarDeNovo(painel, papel)) adicionar('tentar_de_novo', 'Tentar de novo', []);
    return acoes;
  }

  if (status === 'rascunho') {
    const motivos = motivosDeEscrita('aplicar', 'Seu papel não permite aplicar o plano.');
    const faltas: readonly FaltaParaAplicar[] = painel.faltaParaAplicar ?? [];
    adicionar('aplicar', 'Aplicar o plano', [...motivos, ...new Set(faltas.map((falta) => MOTIVO_POR_FALTA[falta]))]);
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
  if (podeTentarDeNovo(painel, papel)) adicionar('tentar_de_novo', 'Tentar de novo', []);
  return acoes;
}

function avisosDeConferencia(plano: Plano, contexto: Contexto): AvisoDaVisao[] {
  const avisos: AvisoDaVisao[] = [];
  const { riscos, regras_aplicaveis: regras, limites_do_cliente: limites, limites_nao_aplicaveis: naoAplicaveis } = plano.riscos_e_regras;
  const citadas = [...riscos, ...regras, ...limites].flatMap((item) => item.evidencias);
  if (marcasDe(citadas, contexto).some((marca) => marca.indicacoes.includes(INDICACAO_NAO_VERIFICADA))) {
    avisos.push({ chave: 'regra_legal_nao_verificada', tom: 'warn', titulo: AVISO_REGRA_LEGAL_NAO_VERIFICADA, texto: null, itens: [], link: null });
  }
  if (naoAplicaveis.length > 0) {
    avisos.push({
      chave: 'limite_nao_aplicavel',
      tom: 'warn',
      titulo: 'Confira antes de autorizar: o plano declara limites que não se aplicam',
      texto: null,
      itens: naoAplicaveis.map((l) => `${ROTULO_DA_MEDIDA[l.medida] ?? l.medida}: ${l.motivo}`),
      link: null,
    });
  }
  return avisos;
}

function avisosDaVisao(painel: PainelDoPlano, plano: Plano | null, planoLegivel: boolean, clienteId: string, agora: Date, contexto: Contexto, repetir: boolean): AvisoDaVisao[] {
  const avisos: AvisoDaVisao[] = [];
  const ativa = painel.execucaoAtiva;
  if (ativa && execucaoSemAvanco(ativa, agora)) {
    avisos.push({
      chave: 'execucao_parada',
      tom: 'warn',
      titulo: 'A execução não está avançando',
      texto: 'Ela pode ter travado. Atualize a tela; se continuar igual, cancele a execução e peça de novo.',
      itens: [],
      link: { rotulo: 'Atualizar', href: rotaDoPlano(clienteId, painel.plano.id) },
    });
  } else if (!ativa && painel.ultimaExecucao?.status === 'falhou') {
    const mensagem = mensagemDeFalha(painel.ultimaExecucao.erroCodigo);
    avisos.push({
      chave: 'execucao_falhou',
      tom: 'danger',
      titulo: mensagem.titulo,
      texto: repetir ? mensagem.texto : (mensagem.textoSemBotao ?? mensagem.texto),
      itens: [],
      link: mensagem.link === 'config' ? { rotulo: 'Abrir configurações', href: '/config' } : null,
    });
  }
  const impacto = avisoDoImpacto(painel.desatualizado, contexto.entradas);
  if (impacto) avisos.push(impacto);
  if (!planoLegivel && painel.versaoExibida) {
    avisos.push({
      chave: 'plano_ilegivel',
      tom: 'danger',
      titulo: 'O conteúdo desta versão não segue o formato atual',
      texto: 'Não é possível mostrar o plano. Peça uma mudança ao agente para gerar uma versão nova.',
      itens: [],
      link: null,
    });
  }
  if (plano) avisos.push(...avisosDeConferencia(plano, contexto));
  return avisos;
}

function rotuloSemVersao(painel: PainelDoPlano): { readonly rotulo: string; readonly icone: NomeDoIconeDaVisao; readonly classe: string } {
  if (painel.execucaoAtiva) return { rotulo: 'Em geração', icone: 'atencao', classe: 'pill--warn' };
  if (painel.ultimaExecucao?.status === 'falhou') return { rotulo: 'Falhou', icone: 'erro', classe: 'pill--danger' };
  const ultima = [...painel.historico.versoes].sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())[0];
  if (ultima) return { rotulo: ROTULO_DO_STATUS[ultima.status], ...APARENCIA_DO_STATUS[ultima.status] };
  if (painel.ultimaExecucao?.status === 'cancelada') return { rotulo: 'Cancelado', icone: 'nao', classe: '' };
  return { rotulo: 'Sem versão', icone: 'vazio', classe: '' };
}

export function visaoDoPlano(entrada: EntradaDaVisao): VisaoDoPlano {
  const { painel, papel, clienteId } = entrada;
  const agora = entrada.agora ?? new Date();
  const catalogos = entrada.catalogos ?? CATALOGOS_DISPONIVEIS;
  const contexto: Contexto = { clienteId, entradas: entrada.entradasDoBrain ?? new Map(), hoje: agora.toISOString().slice(0, 10) };
  const somenteLeitura = papel === 'viewer';
  const acoes = acoesDaVisao(painel, papel);
  const repetir = acoes.some((acao) => acao.chave === 'tentar_de_novo');
  const tipo = painel?.plano.tipo ?? '';
  const tipoRotulo = ehTipoDePlano(tipo) ? ROTULO_DO_TIPO_DE_PLANO[tipo] : tipo;
  const plataformas = (painel?.plano.plataformas ?? []).map(nomeDaPlataforma);
  const execucao = painel?.execucaoAtiva ? execucaoNaTela(painel.execucaoAtiva, agora) : null;

  if (painel === null || painel.versaoExibida === null) {
    const semVersao = painel ? rotuloSemVersao(painel) : { rotulo: 'Sem versão', icone: 'vazio' as const, classe: '' };
    return {
      planoId: painel?.plano.id ?? null,
      temPlano: false,
      somenteLeitura,
      titulo: tituloDoPlano(null, tipo),
      tipoRotulo,
      plataformas,
      foco: textoDoFocoCompleto(painel?.plano.foco),
      status: null,
      rotuloDoStatus: semVersao.rotulo,
      icone: semVersao.icone,
      classe: semVersao.classe,
      versao: null,
      avisos: painel ? avisosDaVisao(painel, null, true, clienteId, agora, contexto, repetir) : [],
      execucao,
      acoes,
      resumo: null,
      midia: null,
      lacunas: painel ? lacunasNaTela(painel, clienteId) : null,
      falhaDoGate: null,
    };
  }

  const versaoExibida = painel.versaoExibida;
  const status = versaoExibida.status;
  const lida = lerPlano(versaoExibida.conteudo);
  const plano = lida.ok ? lida.value : null;
  const aparencia = APARENCIA_DO_STATUS[status];

  return {
    planoId: painel.plano.id,
    temPlano: true,
    somenteLeitura,
    titulo: tituloDoPlano(plano?.intencao.objetivo ?? null, tipo),
    tipoRotulo,
    plataformas,
    foco: textoDoFocoCompleto(painel.plano.foco),
    status,
    rotuloDoStatus: ROTULO_DO_STATUS[status],
    icone: aparencia.icone,
    classe: aparencia.classe,
    versao: { id: versaoExibida.id, em: versaoExibida.criadaEm, emTexto: dataEHoraBr(versaoExibida.criadaEm) },
    avisos: avisosDaVisao(painel, plano, lida.ok, clienteId, agora, contexto, repetir),
    execucao,
    acoes,
    resumo: plano ? { chave: 'resumo_executivo', titulo: TITULO_DA_SECAO.resumo_executivo, grupos: gruposEditaveis('resumo_executivo', plano.resumo_executivo, catalogos), conteudo: blocosDoResumo(plano, contexto) } : null,
    midia: plano ? { chave: 'plano_de_midia', titulo: TITULO_DA_SECAO.plano_de_midia, grupos: gruposEditaveis('plano_de_midia', plano.plano_de_midia, catalogos), conteudo: plataformasDeMidia(plano, contexto) } : null,
    lacunas: lacunasNaTela(painel, clienteId),
    falhaDoGate: painel.falhaDoGate ?? null,
  };
}
