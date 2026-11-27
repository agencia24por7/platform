import type { Plano, SecaoDoPlano } from './plano.ts';

const SECOES_SEMPRE_PRESENTES: readonly SecaoDoPlano[] = ['intencao'];

export function secoesDoPlano(plano: Plano, secoes: readonly SecaoDoPlano[] | undefined): Partial<Record<SecaoDoPlano, unknown>> | Plano {
  if (secoes === undefined) return plano;
  const escolhidas = new Set<SecaoDoPlano>([...SECOES_SEMPRE_PRESENTES, ...secoes]);
  return Object.fromEntries(Object.entries(plano).filter(([chave]) => chave === 'schema_version' || escolhidas.has(chave as SecaoDoPlano)));
}

export function semCampo(valor: unknown, chave: string): unknown {
  if (Array.isArray(valor)) return valor.map((item) => semCampo(item, chave));
  if (valor === null || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.entries(valor).filter(([nome]) => nome !== chave).map(([nome, filho]) => [nome, semCampo(filho, chave)]));
}

export const SECOES_QUE_O_GATE_DE_MODELO_CONFERE: readonly SecaoDoPlano[] = [
  'diagnostico',
  'publico_alvo',
  'posicionamento_e_mensagem',
  'estrategia',
  'campanhas',
  'metas_e_metricas',
  'plano_de_midia',
];

export function planoParaOGateDeModelo(plano: Plano): unknown {
  const secoes = secoesDoPlano(plano, SECOES_QUE_O_GATE_DE_MODELO_CONFERE);
  return semCampo(secoes, 'evidencias');
}
