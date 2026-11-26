export const ABAS_DO_CLIENTE = ['conexoes', 'contexto', 'regras'] as const;
export type AbaDoCliente = (typeof ABAS_DO_CLIENTE)[number];

export const ROTULO_DA_ABA: Record<AbaDoCliente, string> = {
  conexoes: 'Conexões',
  contexto: 'Contexto',
  regras: 'Regras',
};

export const SECOES_DE_CONEXOES = ['fontes', 'pedir'] as const;
export type SecaoDeConexoes = (typeof SECOES_DE_CONEXOES)[number];

export const ROTULO_DA_SECAO_DE_CONEXOES: Record<SecaoDeConexoes, string> = {
  fontes: 'Fontes',
  pedir: 'Pedir ao cliente',
};

export const SECOES_DE_CONTEXTO = ['perfil', 'brain'] as const;
export type SecaoDeContexto = (typeof SECOES_DE_CONTEXTO)[number];

export const ROTULO_DA_SECAO_DE_CONTEXTO: Record<SecaoDeContexto, string> = {
  perfil: 'Mapa de contexto',
  brain: 'Brain',
};

export function secaoDeConexoes(bruto: string | null | undefined): SecaoDeConexoes {
  return (SECOES_DE_CONEXOES as readonly string[]).includes(bruto ?? '') ? (bruto as SecaoDeConexoes) : 'fontes';
}

export function secaoDeContexto(bruto: string | null | undefined): SecaoDeContexto {
  return bruto === 'brain' ? 'brain' : 'perfil';
}

export const SEGMENTOS_LEGADOS = ['visao', 'brain', 'dados', 'acessos', 'configuracoes'] as const;
export type SegmentoLegado = (typeof SEGMENTOS_LEGADOS)[number];

const DESTINO_DO_LEGADO: Record<SegmentoLegado, { readonly aba: AbaDoCliente; readonly secao: string | null }> = {
  visao: { aba: 'conexoes', secao: null },
  dados: { aba: 'conexoes', secao: 'fontes' },
  acessos: { aba: 'conexoes', secao: 'pedir' },
  configuracoes: { aba: 'conexoes', secao: null },
  brain: { aba: 'contexto', secao: 'brain' },
};

export function destinoDaRotaLegada(
  clienteId: string,
  segmento: SegmentoLegado,
  busca: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): string {
  const pedeEnvio = [busca['enviar']].flat()[0] === 'contexto';
  const { aba, secao } = pedeEnvio ? { aba: 'conexoes' as const, secao: 'pedir' } : DESTINO_DO_LEGADO[segmento];
  const preservada: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(busca)) {
    const primeiro = Array.isArray(valor) ? valor[0] : valor;
    if (typeof primeiro === 'string' && primeiro) preservada[chave] = primeiro;
  }
  if (secao) preservada['secao'] = secao;
  return rotaDoCliente(clienteId, aba, preservada);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idValido(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

export function rotaDoCliente(
  clienteId: string,
  aba: AbaDoCliente = 'conexoes',
  busca: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const base = `/clientes/${encodeURIComponent(clienteId)}/${aba}`;
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(busca)) {
    if (valor) params.set(chave, valor);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function comAviso(destino: string, tipo: 'feito' | 'erro', mensagem: string): string {
  const separador = destino.includes('?') ? '&' : '?';
  return `${destino}${separador}${tipo}=${encodeURIComponent(mensagem)}`;
}

export function enderecoDoFormulario(base: string, token: string): string {
  return `${base.replace(/[/]+$/, '')}/contexto/${encodeURIComponent(token)}`;
}

export function enderecoDoConvite(base: string, token: string): string {
  return `${base.replace(/[/]+$/, '')}/convite/${encodeURIComponent(token)}`;
}

export function destinoSeguro(bruto: string | null | undefined, clienteId: string): string {
  const padrao = rotaDoCliente(clienteId);
  if (!bruto) return padrao;
  const prefixo = `/clientes/${clienteId}`;
  if (!bruto.startsWith(prefixo)) return padrao;
  const resto = bruto.slice(prefixo.length);
  if (resto !== '' && !/^[/?]/.test(resto)) return padrao;
  if (/[\\]|[/][/]|[\r\n]/.test(resto)) return padrao;
  return bruto;
}
