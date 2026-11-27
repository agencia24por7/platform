import { z } from 'zod';
import { FORNECEDORES, type Fornecedor } from './tarefa.ts';

export const ROTULO_DO_FORNECEDOR: Record<Fornecedor, string> = {
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  openai: 'OpenAI (GPT)',
  xai: 'xAI (Grok)',
  moonshot: 'Moonshot AI (Kimi)',
};

export function fornecedorConhecido(candidato: string): Fornecedor | null {
  return FORNECEDORES.find((fornecedor) => fornecedor === candidato) ?? null;
}

export function aadDaChave(organizationId: string, fornecedor: Fornecedor): Buffer {
  return Buffer.from(`orla.ia.chave.v1|${organizationId}|${fornecedor}`, 'utf8');
}

const CHAVE_MINIMA = 20;
const CHAVE_MAXIMA = 400;

export type MotivoDaChave = 'chave_com_espaco' | 'chave_curta';

export const MENSAGEM_DA_CHAVE: Record<MotivoDaChave, string> = {
  chave_com_espaco: 'A chave não pode conter espaço nem quebra de linha.',
  chave_curta: 'A chave parece incompleta.',
};

export function validarChaveDeFornecedor(bruta: string): MotivoDaChave | null {
  const chave = bruta.trim();
  if (/\s/.test(chave)) return 'chave_com_espaco';
  if (chave.length < CHAVE_MINIMA || chave.length > CHAVE_MAXIMA) return 'chave_curta';
  return null;
}

export function rotuloDaChaveDeFornecedor(chave: string): string {
  return `••••${chave.trim().slice(-4)}`;
}

export const PADRAO_DO_MODELO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
export const MAXIMO_DE_MODELOS = 500;

const NAO_GERA_TEXTO = /embed|whisper|tts|dall-e|image|imagen|audio|realtime|moderation|transcri|veo|aqa|robotics|computer-use/i;

export function modelosDeTexto(ids: readonly string[]): readonly string[] {
  const validos = ids.filter((id) => PADRAO_DO_MODELO.test(id) && !NAO_GERA_TEXTO.test(id));
  return [...new Set(validos)].sort().slice(0, MAXIMO_DE_MODELOS);
}

export type ChaveGuardada = {
  readonly fornecedor: Fornecedor;
  readonly rotulo: string;
  readonly modelos: readonly string[];
  readonly modelosListadosEm: Date | null;
  readonly atualizadaEm: Date;
};

export type EscolhaDeModelo = {
  readonly tarefa: string;
  readonly fornecedor: Fornecedor;
  readonly modelo: string;
};

export type ConfiguracaoDeIa = {
  readonly ligada: boolean;
  readonly chamadasPorDia: number;
  readonly tokensPorDia: number;
};

export const CONFIGURACAO_PADRAO: ConfiguracaoDeIa = { ligada: true, chamadasPorDia: 200, tokensPorDia: 2_000_000 };

export const tetosDeIa = z
  .object({
    chamadasPorDia: z.number().int().min(1).max(100_000),
    tokensPorDia: z.number().int().min(1_000).max(1_000_000_000),
  })
  .strict();

export type UsoDoDia = { readonly chamadas: number; readonly tokens: number };

export type EstadoDaTarefa = 'configurada' | 'sem_modelo' | 'modelo_indisponivel';

export function estadoDaTarefa(escolha: EscolhaDeModelo | undefined, chaves: readonly ChaveGuardada[]): EstadoDaTarefa {
  if (!escolha) return 'sem_modelo';
  const chave = chaves.find((candidata) => candidata.fornecedor === escolha.fornecedor);
  return chave && chave.modelos.includes(escolha.modelo) ? 'configurada' : 'modelo_indisponivel';
}

export type MotivoDoBloqueio = 'desligada' | 'teto_de_chamadas' | 'teto_de_tokens';

export const MENSAGEM_DO_BLOQUEIO: Record<MotivoDoBloqueio, string> = {
  desligada: 'A IA está desligada para esta organização.',
  teto_de_chamadas: 'A organização atingiu o teto diário de chamadas de IA.',
  teto_de_tokens: 'A organização atingiu o teto diário de tokens de IA.',
};

export function bloqueioDoDia(config: ConfiguracaoDeIa, uso: UsoDoDia, tokensDaReserva: number): MotivoDoBloqueio | null {
  if (!config.ligada) return 'desligada';
  if (uso.chamadas >= config.chamadasPorDia) return 'teto_de_chamadas';
  if (uso.tokens + tokensDaReserva > config.tokensPorDia) return 'teto_de_tokens';
  return null;
}
