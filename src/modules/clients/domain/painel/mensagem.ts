export const PRESETS_DE_SECOES = ['essencial', 'completo', 'personalizado'] as const;
export type PresetDeSecoes = (typeof PRESETS_DE_SECOES)[number];

export const SECOES_ESSENCIAIS = ['empresa', 'produtos', 'publico', 'presenca_digital', 'objetivos'] as const;

export function secoesDoPreset(preset: PresetDeSecoes, todas: readonly string[], escolhidas: readonly string[]): string[] {
  if (preset === 'completo') return [...todas];
  if (preset === 'essencial') return todas.filter((s) => (SECOES_ESSENCIAIS as readonly string[]).includes(s));
  return todas.filter((s) => escolhidas.includes(s));
}

export type DadosDaMensagem = {
  readonly cliente: string;
  readonly organizacao: string;
  readonly link: string;
  readonly expiraEm: Date;
  readonly secoes: readonly string[];
  readonly minutosEstimados: number;
  readonly conviteDeIntegracao?: string | null;
};

const MINUTOS_POR_SECAO = 4;

export function minutosEstimados(quantidadeDeSecoes: number): number {
  return Math.max(MINUTOS_POR_SECAO, quantidadeDeSecoes * MINUTOS_POR_SECAO);
}

function dataCurta(data: Date): string {
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' });
}

export function mensagemProntaDoLink(dados: DadosDaMensagem): string {
  const lista = dados.secoes.map((s) => `• ${s}`).join('\n');
  const partes = [
    `Olá, equipe ${dados.cliente}!`,
    '',
    `Para a ${dados.organizacao} trabalhar com o máximo de contexto sobre o negócio de vocês, preparamos um mapa rápido para preencher. Leva cerca de ${dados.minutosEstimados} minutos, salva sozinho e dá para parar e continuar depois.`,
    '',
    'O que vamos perguntar:',
    lista,
    '',
  ];
  if (dados.conviteDeIntegracao) {
    partes.push(
      'São dois passos no mesmo link:',
      '1 · Conectar as contas (Google, Meta…) com o login de vocês. Nenhuma senha passa por nós.',
      '2 · Preencher o mapa de contexto.',
      '',
      dados.conviteDeIntegracao,
    );
  } else {
    partes.push(dados.link);
  }
  partes.push('', `O link é pessoal e vale até ${dataCurta(dados.expiraEm)}. Qualquer dúvida, é só responder esta mensagem.`);
  return partes.join('\n');
}
