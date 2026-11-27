import type { SecaoDoPlano } from '../plano.ts';

export const PADRAO_DA_CHAVE_DA_PERSONA = /^[a-z][a-z0-9_]{1,47}$/;

export type Persona = {
  readonly chave: string;
  readonly nome: string;
  readonly foco: string;
  readonly olha: readonly string[];
  readonly instrucao: string;
  readonly reprovacaoObrigaAjuste: boolean;
  readonly secoes?: readonly SecaoDoPlano[];
};

export const PERSONAS: readonly Persona[] = [
  {
    chave: 'publicitario',
    nome: 'Publicitário',
    foco: 'Conceito, posicionamento e força da ideia.',
    olha: ['conceito de criativo', 'posicionamento', 'diferenciação'],
    instrucao: 'Avalie se a ideia central é distinta, memorável e coerente com o posicionamento. Aponte conceito fraco ou genérico.',
    reprovacaoObrigaAjuste: false,
    secoes: ['posicionamento_e_mensagem', 'estrategia', 'campanhas', 'plano_de_midia'],
  },
  {
    chave: 'redator',
    nome: 'Redator',
    foco: 'Mensagem, tom e clareza da promessa.',
    olha: ['promessa', 'provas', 'tom', 'clareza do texto'],
    instrucao: 'Avalie se a promessa é clara, crível e sustentada por provas. Aponte exagero, ambiguidade ou tom fora da marca.',
    reprovacaoObrigaAjuste: false,
    secoes: ['posicionamento_e_mensagem', 'campanhas', 'plano_de_midia'],
  },
  {
    chave: 'buzz_social',
    nome: 'Buzz e social',
    foco: 'Comunidades, creators e conversa.',
    olha: ['comunidades alvo', 'papel de creators', 'como entrar na conversa'],
    instrucao: 'Avalie se a entrada nas comunidades é realista e respeitosa. Aponte aposta em creator ou comunidade sem hipótese e sem teste.',
    reprovacaoObrigaAjuste: false,
    secoes: ['publico_alvo', 'comunidades_alvo', 'canais_e_plataformas', 'campanhas'],
  },
  {
    chave: 'analista_de_dados',
    nome: 'Analista de dados',
    foco: 'Evidência, métrica, medição e tamanho de amostra.',
    olha: ['notas de evidência', 'metas e métricas pareadas', 'forma de medir', 'experimento'],
    instrucao: 'Avalie se cada número tem evidência com nota e se a medição permite concluir algo. Aponte meta sem base e métrica sem par.',
    reprovacaoObrigaAjuste: false,
    secoes: ['diagnostico', 'estrategia', 'metas_e_metricas', 'medicao', 'orcamento'],
  },
  {
    chave: 'marqueteiro',
    nome: 'Marqueteiro',
    foco: 'Público, canal, funil e coerência do todo.',
    olha: ['público-alvo', 'canais', 'funil', 'coerência entre seções'],
    instrucao: 'Avalie se público, canal, mensagem e campanha formam um conjunto coerente. Aponte lacuna de funil e canal sem papel claro.',
    reprovacaoObrigaAjuste: false,
    secoes: ['resumo_executivo', 'publico_alvo', 'posicionamento_e_mensagem', 'canais_e_plataformas', 'campanhas', 'orcamento', 'calendario'],
  },
  {
    chave: 'diretor_de_vendas',
    nome: 'Diretor de vendas',
    foco: 'Impacto em receita, qualidade do lead e capacidade do time.',
    olha: ['receita esperada', 'qualidade do lead', 'capacidade comercial'],
    instrucao: 'Avalie se o plano gera demanda que o time consegue atender e converter. Aponte volume sem qualidade e meta sem ligação com receita.',
    reprovacaoObrigaAjuste: false,
    secoes: ['resumo_executivo', 'diagnostico', 'publico_alvo', 'campanhas', 'metas_e_metricas'],
  },
  {
    chave: 'sdr',
    nome: 'SDR',
    foco: 'Passagem do lead, objeções reais e tempo de resposta.',
    olha: ['passagem do lead', 'objeções', 'tempo de resposta'],
    instrucao: 'Avalie se a passagem do lead e o tratamento de objeções estão previstos. Aponte promessa que a abordagem comercial não sustenta.',
    reprovacaoObrigaAjuste: false,
    secoes: ['publico_alvo', 'posicionamento_e_mensagem', 'campanhas', 'plano_de_midia', 'calendario'],
  },
  {
    chave: 'representante_do_cliente',
    nome: 'Representante do cliente',
    foco: 'Respeito à marca, às regras e à realidade do cliente.',
    olha: ['marca', 'regras e limites do cliente', 'realidade operacional'],
    instrucao: 'Avalie se o plano respeita a marca, as regras e a capacidade real do cliente. Aponte o que o cliente recusaria ou não conseguiria executar.',
    reprovacaoObrigaAjuste: false,
    secoes: ['resumo_executivo', 'posicionamento_e_mensagem', 'estrategia', 'campanhas', 'orcamento', 'riscos_e_regras'],
  },
  {
    chave: 'risco_legal',
    nome: 'Risco e legal',
    foco: 'Regra legal, regra de plataforma e limites do cliente.',
    olha: ['regras legais aplicáveis', 'regras de plataforma', 'limites do cliente', 'riscos de marca'],
    instrucao: 'Avalie conformidade com regra legal, política de plataforma e limite do cliente. Reprove se houver violação ou regra aplicável ausente.',
    reprovacaoObrigaAjuste: true,
    secoes: ['posicionamento_e_mensagem', 'estrategia', 'campanhas', 'orcamento', 'plano_de_midia', 'riscos_e_regras'],
  },
];

export function personaPorChave(chave: string, personas: readonly Persona[] = PERSONAS): Persona | undefined {
  return personas.find((persona) => persona.chave === chave);
}
