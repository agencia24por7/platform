export const ABAS_DO_CLIENTE = ['visao', 'contexto', 'brain', 'dados', 'acessos', 'configuracoes'] as const;
export type AbaDoCliente = (typeof ABAS_DO_CLIENTE)[number];

export const ROTULO_DA_ABA: Record<AbaDoCliente, string> = {
  visao: 'Visão geral',
  contexto: 'Contexto',
  brain: 'Brain',
  dados: 'Dados',
  acessos: 'Acessos',
  configuracoes: 'Configurações',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idValido(id: string): boolean {
  return UUID.test(id);
}

export function rotaDoCliente(
  clienteId: string,
  aba: AbaDoCliente = 'visao',
  busca: Readonly<Record<string, string | null | undefined>> = {},
): string {
  const base = `/clientes/${encodeURIComponent(clienteId)}${aba === 'visao' ? '' : `/${aba}`}`;
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
