export const ABAS_DO_CLIENTE = ['conexoes', 'contexto', 'regras', 'estrategia', 'atividade'] as const;
export type AbaDoCliente = (typeof ABAS_DO_CLIENTE)[number];

export const ROTULO_DA_ABA: Record<AbaDoCliente, string> = {
  conexoes: 'Conexões',
  contexto: 'Contexto',
  regras: 'Regras',
  estrategia: 'Estratégia',
  atividade: 'Atividade',
};

export function abaDoSegmento(segmento: string | null): AbaDoCliente {
  return (ABAS_DO_CLIENTE as readonly string[]).includes(segmento ?? '') ? (segmento as AbaDoCliente) : 'conexoes';
}

export function abaComAcaoNoCabecalho(segmento: string | null, ehConexao: boolean): boolean {
  if (segmento === 'contexto') return true;
  if (segmento === null || segmento === 'conexoes') return !ehConexao;
  return false;
}

export const SECOES_DE_ATIVIDADE = ['pedidos', 'contexto', 'regras'] as const;
export type SecaoDeAtividade = (typeof SECOES_DE_ATIVIDADE)[number];

export const ROTULO_DA_SECAO_DE_ATIVIDADE: Record<SecaoDeAtividade, string> = {
  pedidos: 'Pedidos ao cliente',
  contexto: 'Histórico do contexto',
  regras: 'Linha do tempo de Regras',
};

export function ancoraDaAtividade(secao: SecaoDeAtividade): string {
  return `atividade-${secao}`;
}

export function rotaDaAtividade(clienteId: string, secao: SecaoDeAtividade, busca: Readonly<Record<string, string | null | undefined>> = {}): string {
  return `${rotaDoCliente(clienteId, 'atividade', busca)}#${ancoraDaAtividade(secao)}`;
}

export const SECOES_DE_CONTEXTO = ['perfil', 'brain', 'destino'] as const;
export type SecaoDeContexto = (typeof SECOES_DE_CONTEXTO)[number];

export const ROTULO_DA_SECAO_DE_CONTEXTO: Record<SecaoDeContexto, string> = {
  perfil: 'Mapa de contexto',
  brain: 'Brain',
  destino: 'Destino',
};

export function secaoDeContexto(bruto: string | null | undefined): SecaoDeContexto {
  return bruto === 'brain' || bruto === 'destino' ? bruto : 'perfil';
}

export const SECOES_DE_ESTRATEGIA = ['plano', 'comite', 'gates', 'historico'] as const;
export type SecaoDeEstrategia = (typeof SECOES_DE_ESTRATEGIA)[number];

export const ROTULO_DA_SECAO_DE_ESTRATEGIA: Record<SecaoDeEstrategia, string> = {
  plano: 'Plano',
  comite: 'Comitê',
  gates: 'Gates',
  historico: 'Histórico',
};

export function secaoDeEstrategia(bruto: string | null | undefined): SecaoDeEstrategia {
  return (SECOES_DE_ESTRATEGIA as readonly string[]).includes(bruto ?? '') ? (bruto as SecaoDeEstrategia) : 'plano';
}

export const SEGMENTOS_LEGADOS = ['visao', 'brain', 'dados', 'acessos', 'configuracoes'] as const;
export type SegmentoLegado = (typeof SEGMENTOS_LEGADOS)[number];

const DESTINO_DO_LEGADO: Record<SegmentoLegado, { readonly aba: AbaDoCliente; readonly secao: string | null }> = {
  visao: { aba: 'conexoes', secao: null },
  dados: { aba: 'conexoes', secao: null },
  acessos: { aba: 'atividade', secao: null },
  configuracoes: { aba: 'conexoes', secao: null },
  brain: { aba: 'contexto', secao: 'brain' },
};

export function destinoDaRotaLegada(
  clienteId: string,
  segmento: SegmentoLegado,
  busca: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): string {
  const pedeEnvio = [busca['enviar']].flat()[0] === 'contexto';
  const { aba, secao } = pedeEnvio ? { aba: 'conexoes' as const, secao: null } : DESTINO_DO_LEGADO[segmento];
  const preservada: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(busca)) {
    if (chave === 'secao') continue;
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
