import { SECOES_DO_PLANO, type SecaoDoPlano } from '../plano.ts';
import { PERSONAS, type Persona } from './personas.ts';

export const PADRAO_DA_TAREFA_DO_COMITE = /^[a-z][a-z0-9_]{2,47}$/;
export const PREFIXO_DA_TAREFA_DO_COMITE = 'comite_';
export const MINIMO_DE_MEMBROS_DO_COMITE = 2;
export const MAXIMO_DE_MEMBROS_DO_COMITE = 3;
export const CHAVE_DO_COMITE_OBRIGATORIO = 'risco_legal';

export const SECOES_FORA_DO_COMITE: readonly SecaoDoPlano[] = ['intencao'];
export const SECOES_REVISADAS_PELOS_COMITES: readonly SecaoDoPlano[] = SECOES_DO_PLANO.filter(
  (secao) => !SECOES_FORA_DO_COMITE.includes(secao),
);

export type MembroDoComite = Persona & {
  readonly secoes: readonly SecaoDoPlano[];
  readonly relatora: boolean;
};

export type Comite = {
  readonly chave: string;
  readonly nome: string;
  readonly proposito: string;
  readonly membros: readonly MembroDoComite[];
  readonly secoes: readonly SecaoDoPlano[];
  readonly tarefa: string;
  readonly obrigaAjuste: boolean;
};

type PersonaDeApoio = Omit<Persona, 'reprovacaoObrigaAjuste' | 'secoes'> & { readonly secoes: readonly SecaoDoPlano[] };

function personaAtual(chave: string): Persona {
  const persona = PERSONAS.find((p) => p.chave === chave);
  if (!persona) throw new Error(`Persona ${chave} não existe em PERSONAS.`);
  return persona;
}

function relatoraAtual(chave: string): MembroDoComite {
  const persona = personaAtual(chave);
  return { ...persona, secoes: persona.secoes ?? [], relatora: true };
}

function relatoraNova(persona: PersonaDeApoio): MembroDoComite {
  return { ...persona, reprovacaoObrigaAjuste: false, relatora: true };
}

function apoio(persona: PersonaDeApoio): MembroDoComite {
  return { ...persona, reprovacaoObrigaAjuste: false, relatora: false };
}

function montarComite(chave: string, nome: string, proposito: string, membros: readonly MembroDoComite[]): Comite {
  return {
    chave,
    nome,
    proposito,
    membros,
    secoes: SECOES_DO_PLANO.filter((secao) => membros.some((membro) => membro.secoes.includes(secao))),
    tarefa: `${PREFIXO_DA_TAREFA_DO_COMITE}${chave}`,
    obrigaAjuste: membros.some((membro) => membro.relatora && membro.reprovacaoObrigaAjuste),
  };
}

export const COMITES: readonly Comite[] = [
  montarComite('publicitario', 'Comitê de conceito', 'Garantir que a ideia central seja distinta, memorável e nascida de um insight sustentado pelo pacote.', [
    relatoraAtual('publicitario'),
    apoio({
      chave: 'planejador_de_insight',
      nome: 'Planejador de insight',
      foco: 'Insight do público que sustenta a ideia.',
      olha: ['insight de público', 'tensão que a ideia resolve', 'prova do insight no pacote'],
      instrucao: 'Avalie se a ideia nasce de um insight do público sustentado por evidência do pacote. Aponte ideia sem insight, insight genérico ou insight sem fonte.',
      secoes: ['diagnostico', 'publico_alvo', 'posicionamento_e_mensagem', 'estrategia'],
    }),
  ]),
  montarComite('redator', 'Comitê de mensagem', 'Garantir uma promessa clara, crível e provada, no tom da marca.', [
    relatoraAtual('redator'),
    apoio({
      chave: 'checador_de_promessas',
      nome: 'Checador de promessas',
      foco: 'Cada afirmação do texto tem prova no pacote.',
      olha: ['afirmações', 'provas', 'superlativos e comparativos'],
      instrucao: 'Confira cada afirmação de mensagem e campanha contra a evidência do pacote. Aponte superlativo, comparativo ou número sem fonte vigente.',
      secoes: ['posicionamento_e_mensagem', 'campanhas', 'plano_de_midia'],
    }),
  ]),
  montarComite('buzz_social', 'Comitê de conversa e comunidade', 'Garantir que o plano entre na conversa e nas comunidades com hipótese, respeito e sustentação.', [
    relatoraAtual('buzz_social'),
    apoio({
      chave: 'gestor_de_comunidade',
      nome: 'Gestor de comunidade',
      foco: 'Moderação, cadência e reação da comunidade.',
      olha: ['cadência de conversa', 'moderação e resposta', 'risco de reação negativa'],
      instrucao: 'Avalie se o plano prevê responder, moderar e sustentar a conversa que provoca. Aponte entrada em comunidade sem cadência, sem moderação ou com risco de reação sem plano.',
      secoes: ['comunidades_alvo', 'canais_e_plataformas', 'calendario', 'riscos_e_regras'],
    }),
  ]),
  montarComite('analista_de_dados', 'Comitê de evidência e medição', 'Garantir que todo número tenha evidência e que o plano seja mensurável de ponta a ponta.', [
    relatoraAtual('analista_de_dados'),
    apoio({
      chave: 'especialista_em_mensuracao',
      nome: 'Especialista em mensuração',
      foco: 'Rastreio, eventos de conversão e atribuição.',
      olha: ['eventos de conversão', 'UTM e rastreio', 'janela de atribuição', 'fonte de cada métrica'],
      instrucao: 'Avalie se cada meta tem evento, fonte de dado e rastreio que o pacote mostra existir. Aponte métrica que não se consegue coletar ou atribuição sem base.',
      secoes: ['canais_e_plataformas', 'metas_e_metricas', 'medicao', 'plano_de_midia'],
    }),
  ]),
  montarComite('marqueteiro', 'Comitê de coerência e funil', 'Garantir que público, oferta, canal, funil e campanha formem um conjunto coerente.', [
    relatoraAtual('marqueteiro'),
    apoio({
      chave: 'gerente_de_produto',
      nome: 'Gerente de produto',
      foco: 'Oferta, produto e o que ele de fato entrega.',
      olha: ['oferta', 'produtos em foco', 'diferencial do produto'],
      instrucao: 'Avalie se oferta, campanhas e copy vendem o que o produto entrega segundo o pacote e respeitam o foco do plano. Aponte produto sem papel claro ou promessa além do produto.',
      secoes: ['posicionamento_e_mensagem', 'estrategia', 'campanhas', 'orcamento'],
    }),
  ]),
  montarComite('diretor_de_vendas', 'Comitê de receita', 'Garantir que o plano gere demanda que vira receita e que o time comercial consegue atender.', [
    relatoraAtual('diretor_de_vendas'),
    apoio({
      chave: 'analista_de_receita',
      nome: 'Analista de receita',
      foco: 'Ligação entre lead, pipeline e receita.',
      olha: ['taxa de conversão histórica', 'ciclo de venda', 'receita por canal'],
      instrucao: 'Avalie se as metas levam de lead a receita com taxas do histórico do pacote. Aponte meta de receita sem taxa de conversão sustentada ou ciclo de venda ignorado.',
      secoes: ['diagnostico', 'orcamento', 'metas_e_metricas', 'medicao'],
    }),
  ]),
  montarComite('sdr', 'Comitê de atendimento do lead', 'Garantir que o lead gerado seja atendido a tempo, com resposta às objeções reais.', [
    relatoraAtual('sdr'),
    apoio({
      chave: 'atendimento_conversacional',
      nome: 'Atendimento conversacional',
      foco: 'Primeiro contato no WhatsApp e no destino.',
      olha: ['roteiro do primeiro contato', 'horário e volume de atendimento', 'destino do clique'],
      instrucao: 'Avalie se o destino e o canal de conversa suportam o volume e o horário que as campanhas geram. Aponte campanha que leva a contato sem atendimento previsto.',
      secoes: ['canais_e_plataformas', 'campanhas', 'calendario', 'plano_de_midia'],
    }),
  ]),
  montarComite('representante_do_cliente', 'Comitê do cliente', 'Garantir que o plano respeite a marca, as regras e a realidade do cliente e seja aprovável por ele.', [
    relatoraAtual('representante_do_cliente'),
    apoio({
      chave: 'aprovador_do_cliente',
      nome: 'Aprovador do cliente',
      foco: 'O plano é defensável por quem assina.',
      olha: ['resumo executivo', 'retorno pedido', 'decisões que exigem aval'],
      instrucao: 'Avalie se o resumo responde o que o decisor do cliente perguntaria: quanto custa, o que retorna, o que muda. Aponte decisão relevante sem justificativa no plano.',
      secoes: ['resumo_executivo', 'estrategia', 'orcamento', 'metas_e_metricas', 'calendario'],
    }),
  ]),
  montarComite('risco_legal', 'Comitê de risco e legal', 'Garantir conformidade legal, de plataforma, de privacidade e com os limites do cliente; reprovação obriga ajuste.', [
    relatoraAtual('risco_legal'),
    apoio({
      chave: 'politicas_de_plataforma',
      nome: 'Políticas de plataforma',
      foco: 'Regras de anúncio de cada plataforma escolhida.',
      olha: ['categoria restrita', 'segmentação proibida', 'formato e claim vetados'],
      instrucao: 'Avalie campanhas e plano de mídia contra as regras de plataforma do pacote. Reprove se houver violação; regra que deveria estar no pacote e não está vai para lacunas.',
      secoes: ['canais_e_plataformas', 'campanhas', 'plano_de_midia', 'riscos_e_regras'],
    }),
    apoio({
      chave: 'privacidade_e_dados',
      nome: 'Privacidade e dados',
      foco: 'Dado pessoal, consentimento e segmentação.',
      olha: ['base legal e consentimento', 'público por lista ou dado sensível', 'retenção de lead'],
      instrucao: 'Avalie se público, segmentação, medição e captura de lead respeitam as regras de privacidade do pacote. Reprove uso de dado sensível ou de lista sem base declarada.',
      secoes: ['publico_alvo', 'medicao', 'plano_de_midia', 'riscos_e_regras'],
    }),
  ]),
  montarComite('cultura', 'Comitê de cultura', 'Ancorar o plano na cultura vigente só por sinais culture_* do pacote; sem sinal vigente, lacuna.', [
    relatoraNova({
      chave: 'radar_de_cultura',
      nome: 'Culture Radar',
      foco: 'Tendência, meme e conversa vigentes do pacote.',
      olha: ['sinais culture_* vigentes', 'validade do sinal', 'encaixe com público e comunidade'],
      instrucao: 'Só afirme tendência citando nas fontes um sinal culture_* vigente do pacote. Sem sinal vigente, declare lacuna e não opine sobre tendência. Aponte aposta em tendência sem sinal ou com sinal vencido.',
      secoes: ['publico_alvo', 'comunidades_alvo', 'posicionamento_e_mensagem', 'campanhas', 'calendario'],
    }),
    apoio({
      chave: 'curador_de_referencias',
      nome: 'Curador de referências',
      foco: 'Referências e anti-referências criativas do pacote.',
      olha: ['culture_referencia', 'culture_anti_referencia', 'risco de imitar'],
      instrucao: 'Confira campanhas e mensagem contra as referências e anti-referências culture_* vigentes do pacote. Aponte o que repete anti-referência; sem sinal desse tipo, declare lacuna e não opine.',
      secoes: ['posicionamento_e_mensagem', 'canais_e_plataformas', 'campanhas'],
    }),
  ]),
  montarComite('marca', 'Comitê de marca', 'Proteger a identidade da marca: tom de voz, posicionamento, restrições e coerência com o histórico.', [
    relatoraNova({
      chave: 'guardiao_da_marca',
      nome: 'Brand Guardian',
      foco: 'Tom de voz, posicionamento e restrições da marca.',
      olha: ['tom de voz', 'posicionamento declarado', 'restrições de marca'],
      instrucao: 'Avalie se mensagem, campanhas e canais seguem o tom de voz, o posicionamento e as restrições de marca do pacote. Aponte desvio citando a regra ou o item de marca violado.',
      secoes: ['posicionamento_e_mensagem', 'estrategia', 'canais_e_plataformas', 'campanhas', 'riscos_e_regras'],
    }),
    apoio({
      chave: 'historiador_da_marca',
      nome: 'Historiador da marca',
      foco: 'Coerência com decisões e campanhas passadas.',
      olha: ['decisões registradas', 'campanhas anteriores', 'o que já não funcionou'],
      instrucao: 'Compare o plano com decisões e resultados anteriores da marca no pacote. Aponte repetição do que já falhou ou contradição com decisão registrada sem justificativa.',
      secoes: ['diagnostico', 'estrategia', 'campanhas', 'riscos_e_regras'],
    }),
  ]),
  montarComite('sparring_criativo', 'Sparring criativo', 'Tensionar a ideia: questionar clichê e propor alternativa concreta, sempre ancorada em dado do pacote.', [
    relatoraNova({
      chave: 'provocador_criativo',
      nome: 'Provocador criativo',
      foco: 'Questionar o óbvio e o clichê.',
      olha: ['clichê de categoria', 'ideia previsível', 'território não explorado'],
      instrucao: 'Não concorde por educação. Aponte clichê ou ideia previsível e peça no ajuste uma alternativa concreta ancorada em dado do pacote. Sem dado que sustente a alternativa, não a proponha.',
      secoes: ['posicionamento_e_mensagem', 'estrategia', 'campanhas'],
    }),
    apoio({
      chave: 'explorador_de_territorios',
      nome: 'Explorador de territórios',
      foco: 'Outro território criativo possível.',
      olha: ['território atual', 'território alternativo', 'dado que o sustenta'],
      instrucao: 'Identifique o território criativo do plano e proponha outro, sustentado por evidência do pacote, com o que ganha e o que arrisca. Não aprove só por falta de objeção.',
      secoes: ['publico_alvo', 'comunidades_alvo', 'posicionamento_e_mensagem', 'campanhas'],
    }),
  ]),
  montarComite('producao', 'Comitê de produção', 'Garantir que o plano seja produzível: peças, ferramentas, referências, custo, prazo e fluxo.', [
    relatoraNova({
      chave: 'diretor_de_producao',
      nome: 'Production Director',
      foco: 'Exequibilidade, ferramentas, custo e workflow.',
      olha: ['peças e formatos', 'ferramentas e referências', 'custo de produção', 'fluxo de aprovação'],
      instrucao: 'Avalie se o que o plano pede é produzível só com o que há no plano e no pacote: peças, ferramentas, referências, custo e prazo. Aponte entrega sem recurso, custo ou prazo; não suponha recurso ausente.',
      secoes: ['campanhas', 'orcamento', 'calendario', 'plano_de_midia'],
    }),
    apoio({
      chave: 'produtor_de_conteudo',
      nome: 'Produtor de conteúdo',
      foco: 'Volume e formato de peças por plataforma.',
      olha: ['volume de peças', 'formato por plataforma', 'variações para teste'],
      instrucao: 'Avalie se o volume e os formatos de peça cabem no calendário e nas plataformas escolhidas. Aponte teste A/B sem variação prevista ou formato que a plataforma não aceita.',
      secoes: ['canais_e_plataformas', 'campanhas', 'calendario', 'plano_de_midia'],
    }),
  ]),
  montarComite('memoria_e_decisoes', 'Comitê de memória e decisões', 'Deixar o plano rastreável: decisões, premissas, versões e créditos registrados.', [
    relatoraNova({
      chave: 'construtor_de_caso',
      nome: 'Case Study Builder',
      foco: 'Rastreabilidade de decisões, versões e créditos.',
      olha: ['decisão e porquê', 'evidência de cada decisão', 'versão e autoria'],
      instrucao: 'Avalie se cada decisão relevante diz o porquê e cita evidência ou hipótese, de modo que vire caso. Aponte decisão sem rastro; versão e crédito só com o que há no plano e no pacote.',
      secoes: ['resumo_executivo', 'diagnostico', 'estrategia', 'metas_e_metricas', 'lacunas'],
    }),
    apoio({
      chave: 'auditor_de_premissas',
      nome: 'Auditor de premissas',
      foco: 'Premissas e hipóteses explícitas e testáveis.',
      olha: ['premissas implícitas', 'hipóteses sem teste', 'lacunas não registradas'],
      instrucao: 'Identifique premissas que o plano assume sem dizer e confira se viraram hipótese com teste ou lacuna. Aponte premissa tratada como fato.',
      secoes: ['diagnostico', 'estrategia', 'medicao', 'riscos_e_regras', 'lacunas'],
    }),
  ]),
  montarComite('mercado_e_concorrencia', 'Comitê de mercado e concorrência', 'Situar o plano frente a concorrentes, benchmarks, demanda e sazonalidade do pacote.', [
    relatoraNova({
      chave: 'analista_de_concorrencia',
      nome: 'Analista de concorrência',
      foco: 'Concorrentes e benchmarks do pacote.',
      olha: ['benchmarks', 'posição frente ao concorrente', 'espaço livre'],
      instrucao: 'Compare posicionamento, oferta e metas com os concorrentes e benchmarks do pacote. Aponte diferencial que o concorrente já ocupa ou meta fora do benchmark sem justificativa.',
      secoes: ['diagnostico', 'posicionamento_e_mensagem', 'estrategia', 'metas_e_metricas'],
    }),
    apoio({
      chave: 'analista_de_mercado',
      nome: 'Analista de mercado',
      foco: 'Demanda, sazonalidade e tamanho do público.',
      olha: ['sazonalidade', 'demanda por busca', 'alcance possível'],
      instrucao: 'Avalie se calendário, verba e metas respeitam a sazonalidade, a demanda e o alcance que o pacote mostra. Aponte meta acima do público alcançável ou calendário contra a sazonalidade.',
      secoes: ['diagnostico', 'publico_alvo', 'orcamento', 'metas_e_metricas', 'calendario'],
    }),
  ]),
  montarComite('orcamento_e_eficiencia', 'Comitê de orçamento e eficiência', 'Garantir que a verba seja distribuída e ritmada para o melhor resultado pedido, com custos do histórico.', [
    relatoraNova({
      chave: 'gestor_de_performance',
      nome: 'Gestor de performance',
      foco: 'Custo por resultado e retorno da verba.',
      olha: ['custo por lead ou venda', 'retorno pedido', 'distribuição por campanha'],
      instrucao: 'Avalie se a distribuição da verba entre campanhas e plataformas busca o resultado pedido, com custos do histórico do pacote. Aponte verba em campanha sem custo esperado ou retorno abaixo da intenção.',
      secoes: ['campanhas', 'orcamento', 'metas_e_metricas', 'plano_de_midia'],
    }),
    apoio({
      chave: 'controlador_de_verba',
      nome: 'Controlador de verba',
      foco: 'Ritmo de gasto, reserva de teste e mínimo por plataforma.',
      olha: ['ritmo mensal', 'reserva para teste', 'verba mínima por plataforma'],
      instrucao: 'Avalie se o ritmo de gasto cabe no horizonte e nos limites, se há reserva para teste e se cada plataforma recebe o mínimo para aprender. Aponte verba pulverizada ou sem ritmo.',
      secoes: ['canais_e_plataformas', 'orcamento', 'calendario', 'plano_de_midia'],
    }),
  ]),
  montarComite('jornada_e_retencao', 'Comitê de jornada e retenção', 'Revisar o que acontece depois do clique: destino, conversão, quem não converte e quem já comprou.', [
    relatoraNova({
      chave: 'especialista_em_conversao',
      nome: 'Especialista em conversão',
      foco: 'Pós-clique: destino, página e formulário.',
      olha: ['destino do clique', 'coerência entre anúncio e página', 'fricção de conversão'],
      instrucao: 'Avalie se a promessa do anúncio continua no destino do pacote e se a conversão tem pouca fricção. Aponte campanha cujo destino não sustenta a promessa ou a ação pedida.',
      secoes: ['canais_e_plataformas', 'campanhas', 'medicao', 'plano_de_midia'],
    }),
    apoio({
      chave: 'especialista_em_retencao',
      nome: 'Especialista em retenção',
      foco: 'Nutrição, recompra e relacionamento.',
      olha: ['lead não convertido', 'recompra', 'relacionamento com a base'],
      instrucao: 'Avalie se o plano prevê o que acontece com quem não converte e com quem já comprou, quando o pacote sustenta. Aponte jornada que termina no clique sem justificativa.',
      secoes: ['publico_alvo', 'estrategia', 'campanhas', 'metas_e_metricas'],
    }),
  ]),
];

export function comitePorChave(chave: string, comites: readonly Comite[] = COMITES): Comite | undefined {
  return comites.find((comite) => comite.chave === chave);
}

export function relatoraDoComite(comite: Comite): MembroDoComite {
  const relatora = comite.membros.find((membro) => membro.relatora);
  if (!relatora) throw new Error(`Comitê ${comite.chave} sem relatora.`);
  return relatora;
}

export function personaDoComite(comite: Comite): Persona {
  const relatora = relatoraDoComite(comite);
  return {
    chave: comite.chave,
    nome: comite.nome,
    foco: comite.proposito,
    olha: [...new Set(comite.membros.flatMap((membro) => membro.olha))],
    instrucao: relatora.instrucao,
    reprovacaoObrigaAjuste: comite.obrigaAjuste,
    secoes: comite.secoes,
  };
}

export const PERSONAS_DOS_COMITES: readonly Persona[] = COMITES.map(personaDoComite);

export type FiltroDosComites = {
  readonly secoesTocadas?: readonly SecaoDoPlano[];
  readonly desligados?: readonly string[];
};

export function comitesAtivos(comites: readonly Comite[], filtro: FiltroDosComites = {}): readonly Comite[] {
  const desligados = new Set(filtro.desligados ?? []);
  const tocadas = filtro.secoesTocadas === undefined ? null : new Set(filtro.secoesTocadas);
  return comites.filter((comite) => {
    if (desligados.has(comite.chave) && !comite.obrigaAjuste) return false;
    if (tocadas === null) return true;
    return comite.secoes.some((secao) => tocadas.has(secao));
  });
}

export function comitesConvocados(comites: readonly Comite[], filtro: FiltroDosComites = {}): readonly Comite[] {
  const ativos = new Set(comitesAtivos(comites, filtro).map((comite) => comite.chave));
  return comites.filter((comite) => ativos.has(comite.chave) || comite.obrigaAjuste);
}

export function comitesDesligados(configuracoes: readonly { readonly comite: string; readonly ligado: boolean }[], comites: readonly Comite[] = COMITES): readonly string[] {
  const obrigatorios = new Set(comites.filter((comite) => comite.obrigaAjuste).map((comite) => comite.chave));
  return configuracoes.filter((configuracao) => !configuracao.ligado && !obrigatorios.has(configuracao.comite)).map((configuracao) => configuracao.comite);
}

export function podeDesligarComite(chave: string, comites: readonly Comite[] = COMITES): boolean {
  const comite = comitePorChave(chave, comites);
  return comite !== undefined && !comite.obrigaAjuste;
}

export function secoesAlteradas(antes: Readonly<Record<string, unknown>>, depois: Readonly<Record<string, unknown>>): readonly SecaoDoPlano[] {
  return SECOES_DO_PLANO.filter((secao) => JSON.stringify(antes[secao] ?? null) !== JSON.stringify(depois[secao] ?? null));
}

export function chamadasPorRodadaDoComite(comite: Comite): number {
  return comite.membros.length + NUMERO_DE_MESAS_DO_COMITE;
}

export const NUMERO_DE_MESAS_DO_COMITE = 2;
