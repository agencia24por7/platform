export type ClienteDoInventario = {
  readonly id: string;
  readonly organizationId: string;
  readonly nome: string;
  readonly parentClientId: string | null;
  readonly status: string;
  readonly modeloDeNegocio: string;
  readonly segmento: string | null;
};

export type ConexaoDoInventario = {
  readonly id: string;
  readonly platform: string;
  readonly rotulo: string;
  readonly status: string;
  readonly expiraEm: Date | null;
  readonly autorizadaEm: Date;
};

export type TipoDeFonte = 'ad_account' | 'connection_account';

export type FonteDoInventario = {
  readonly id: string;
  readonly fonteTipo: TipoDeFonte;
  readonly platform: string;
  readonly externalId: string;
  readonly nome: string;
  readonly estado: string;
  readonly vinculada: boolean;
  readonly coletaHabilitada: boolean;
  readonly conexaoId: string;
  readonly moeda: string | null;
  readonly fuso: string | null;
};

export type JanelaColetada = { readonly de: string; readonly ate: string };

export type ResumoDeColetas = {
  readonly fonteId: string;
  readonly janelasOk: readonly JanelaColetada[];
  readonly ultimaColetaOkEm: Date | null;
  readonly ultimaTentativaEm: Date | null;
  readonly ultimoStatus: string | null;
  readonly falhasRecentes: Readonly<Record<string, number>>;
  readonly parciaisRecentes: number;
  readonly avisosRecentes: Readonly<Record<string, number>>;
  readonly faltantesRecentes: Readonly<Record<string, number>>;
  readonly pausadaAte: Date | null;
};

export type MedidaDeCobertura = {
  readonly tabela: string;
  readonly desde: string | null;
  readonly ate: string | null;
  readonly linhas: number;
  readonly diasComDado: number | null;
  readonly medidoEm: Date;
};

export type InventarioDoCliente = {
  readonly cliente: ClienteDoInventario;
  readonly conexoesDaOrganizacao: readonly ConexaoDoInventario[];
  readonly fontes: readonly FonteDoInventario[];
  readonly coletas: readonly ResumoDeColetas[];
  readonly cobertura: readonly MedidaDeCobertura[];
};

export function fontesVinculadas(inventario: InventarioDoCliente): readonly FonteDoInventario[] {
  return inventario.fontes.filter((fonte) => fonte.vinculada);
}

export function plataformasVinculadas(inventario: InventarioDoCliente): readonly string[] {
  return [...new Set(fontesVinculadas(inventario).map((fonte) => fonte.platform))].sort();
}
