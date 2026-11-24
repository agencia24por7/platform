import type { ContextoBruto, EntradaDeCampo } from './tipos.ts';

export type ModeloDeOperacao = 'leads' | 'ecommerce';

export type CadastroDoCliente = {
  readonly nome: string;
  readonly segmento: string | null;
  readonly modeloDeOperacao: ModeloDeOperacao;
  readonly temRede: boolean;
  readonly redeNome: string | null;
  readonly criadoEm: Date;
};

export const CAMPOS_HERDADOS_DO_CADASTRO = ['nome_empresa', 'segmento'] as const;

function entradaHerdada(fieldKey: string, valor: string, quando: Date): EntradaDeCampo {
  return {
    secao: 'empresa',
    fieldKey,
    valor,
    versao: 0,
    atualizadoEm: quando,
    atualizadoPor: null,
    viaLink: false,
    epistemico: 'fato',
    fonte: 'equipe',
    revisao: 'confirmado',
    compartilhavel: false,
  };
}

export function herdarDoCadastro(contexto: ContextoBruto, cadastro: CadastroDoCliente): ContextoBruto {
  const existentes = new Set(contexto.campos.map((entrada) => entrada.fieldKey));
  const herdados: EntradaDeCampo[] = [];
  const nome = cadastro.nome.trim();
  const segmento = cadastro.segmento?.trim() ?? '';
  if (nome && !existentes.has('nome_empresa')) herdados.push(entradaHerdada('nome_empresa', nome, cadastro.criadoEm));
  if (segmento && !existentes.has('segmento')) herdados.push(entradaHerdada('segmento', segmento, cadastro.criadoEm));
  return herdados.length === 0 ? contexto : { ...contexto, campos: [...contexto.campos, ...herdados] };
}

export function campoEhHerdado(entrada: Pick<EntradaDeCampo, 'versao' | 'fieldKey'>): boolean {
  return entrada.versao === 0 && (CAMPOS_HERDADOS_DO_CADASTRO as readonly string[]).includes(entrada.fieldKey);
}
