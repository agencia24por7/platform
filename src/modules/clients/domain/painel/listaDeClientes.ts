import { ROTULO_DA_SITUACAO, type Situacao } from '../ciclo.ts';
import { ROTULO_DO_VEREDITO, type Veredito } from './prontidao.ts';

export type TomDoIndicador = 'ok' | 'atencao' | 'critico' | 'neutro';
export type IconeDoVeredito = 'ok' | 'parcial' | 'nao';

export type FiltroDaLista = {
  readonly situacao: Exclude<Situacao, 'archived'> | null;
  readonly busca: string;
  readonly arquivados: boolean;
};

type ValorBruto = string | readonly string[] | undefined;

export type ClienteDaLista = {
  readonly id: string;
  readonly name: string;
  readonly segment: string | null;
  readonly businessModel: 'leads' | 'ecommerce' | string;
  readonly accountCount: number;
  readonly status: Situacao;
  readonly parentClientId: string | null;
};

export type LinhaDaLista = {
  readonly id: string;
  readonly nome: string;
  readonly href: string;
  readonly filial: boolean;
  readonly segmento: string;
  readonly modelo: string;
  readonly contas: number;
  readonly situacao: { readonly rotulo: string; readonly tom: TomDoIndicador };
  readonly prontidao: { readonly rotulo: string; readonly icone: IconeDoVeredito; readonly tom: TomDoIndicador } | null;
};

export type ChipDaLista = { readonly chave: string; readonly rotulo: string; readonly total: number; readonly href: string; readonly ativo: boolean };

export type VisaoDaListaDeClientes = {
  readonly linhas: readonly LinhaDaLista[];
  readonly chips: readonly ChipDaLista[];
  readonly arquivados: { readonly total: number; readonly href: string; readonly ativo: boolean };
  readonly limpar: string | null;
  readonly vazio: string | null;
  readonly temCadastro: boolean;
};

export const ROTA_DA_LISTA = '/clientes';
const SITUACOES_DA_LISTA = ['active', 'paused'] as const;
const TOM_DA_SITUACAO: Record<Situacao, TomDoIndicador> = { active: 'ok', paused: 'atencao', archived: 'neutro' };
const TOM_DO_VEREDITO: Record<Veredito, TomDoIndicador> = { sim: 'ok', parcial: 'atencao', nao: 'critico' };
const ICONE_DO_VEREDITO: Record<Veredito, IconeDoVeredito> = { sim: 'ok', parcial: 'parcial', nao: 'nao' };
const ROTULO_DO_MODELO: Record<string, string> = { ecommerce: 'E-commerce', leads: 'Leads' };

function primeiro(valor: ValorBruto): string | undefined {
  return Array.isArray(valor) ? valor[0] : (valor as string | undefined);
}

export function lerFiltroDaLista(bruto: { readonly situacao?: ValorBruto; readonly busca?: ValorBruto; readonly lista?: ValorBruto }): FiltroDaLista {
  const situacao = primeiro(bruto.situacao);
  return {
    situacao: (SITUACOES_DA_LISTA as readonly string[]).includes(situacao ?? '') ? (situacao as FiltroDaLista['situacao']) : null,
    busca: (primeiro(bruto.busca) ?? '').trim().slice(0, 120),
    arquivados: primeiro(bruto.lista) === 'arquivados',
  };
}

export function hrefDaLista(filtro: FiltroDaLista): string {
  const params = new URLSearchParams();
  if (filtro.arquivados) params.set('lista', 'arquivados');
  else if (filtro.situacao) params.set('situacao', filtro.situacao);
  if (filtro.busca) params.set('busca', filtro.busca);
  const query = params.toString();
  return query ? `${ROTA_DA_LISTA}?${query}` : ROTA_DA_LISTA;
}

function correspondeABusca(cliente: ClienteDaLista, busca: string): boolean {
  return busca === '' || cliente.name.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'));
}

export function clientesVisiveis<T extends ClienteDaLista>(clientes: readonly T[], filtro: FiltroDaLista): T[] {
  return clientes.filter((cliente) => {
    if (filtro.arquivados !== (cliente.status === 'archived')) return false;
    if (filtro.situacao && cliente.status !== filtro.situacao) return false;
    return correspondeABusca(cliente, filtro.busca);
  });
}

export function visaoDaListaDeClientes(
  clientes: readonly ClienteDaLista[],
  filtro: FiltroDaLista,
  vereditos: ReadonlyMap<string, Veredito>,
  substantivo: string,
): VisaoDaListaDeClientes {
  const operacao = clientes.filter((cliente) => cliente.status !== 'archived');
  const totalArquivados = clientes.length - operacao.length;
  const visiveis = clientesVisiveis(clientes, filtro);
  const chips: ChipDaLista[] = [
    { chave: 'todas', rotulo: 'todas', total: operacao.length, href: hrefDaLista({ ...filtro, situacao: null, arquivados: false }), ativo: !filtro.arquivados && filtro.situacao === null },
    ...SITUACOES_DA_LISTA.map((situacao) => ({
      chave: situacao,
      rotulo: ROTULO_DA_SITUACAO[situacao],
      total: operacao.filter((cliente) => cliente.status === situacao).length,
      href: hrefDaLista({ ...filtro, situacao, arquivados: false }),
      ativo: !filtro.arquivados && filtro.situacao === situacao,
    })).filter((chip) => chip.total > 0),
  ];
  const linhas = visiveis.map((cliente): LinhaDaLista => {
    const veredito = vereditos.get(cliente.id);
    return {
      id: cliente.id,
      nome: cliente.name,
      href: `${ROTA_DA_LISTA}/${encodeURIComponent(cliente.id)}`,
      filial: cliente.parentClientId !== null,
      segmento: cliente.segment ?? '—',
      modelo: ROTULO_DO_MODELO[cliente.businessModel] ?? ROTULO_DO_MODELO['leads']!,
      contas: cliente.accountCount,
      situacao: { rotulo: ROTULO_DA_SITUACAO[cliente.status], tom: TOM_DA_SITUACAO[cliente.status] },
      prontidao: veredito ? { rotulo: ROTULO_DO_VEREDITO[veredito], icone: ICONE_DO_VEREDITO[veredito], tom: TOM_DO_VEREDITO[veredito] } : null,
    };
  });
  const filtrando = filtro.situacao !== null || filtro.busca !== '' || filtro.arquivados;
  return {
    linhas,
    chips,
    arquivados: { total: totalArquivados, href: hrefDaLista(filtro.arquivados ? { situacao: null, busca: '', arquivados: false } : { situacao: null, busca: filtro.busca, arquivados: true }), ativo: filtro.arquivados },
    limpar: filtrando ? ROTA_DA_LISTA : null,
    vazio:
      clientes.length === 0
        ? `Nenhum cadastro ainda. Comece criando o primeiro ${substantivo}.`
        : linhas.length > 0
          ? null
          : filtro.arquivados && filtro.busca === ''
            ? `Nenhum ${substantivo} arquivado.`
            : `Nenhum ${substantivo} encontrado com esse filtro.`,
    temCadastro: clientes.length > 0,
  };
}
