import { rotaDoCliente } from '../../clients/domain/painel/enderecos.ts';
import { ROTULO_DO_TIPO_DE_PLANO, TIPOS_DE_PLANO, type TipoDePlano } from '../domain/tipoDePlano.ts';

export type ItemDoSeletorDeTipos = {
  readonly tipo: TipoDePlano;
  readonly rotulo: string;
  readonly existe: boolean;
  readonly selecionado: boolean;
  readonly href: string;
};

export type SeletorDeTipos = {
  readonly existentes: readonly ItemDoSeletorDeTipos[];
  readonly novos: readonly ItemDoSeletorDeTipos[];
  readonly mostrar: boolean;
};

export function seletorDeTipos(entrada: {
  readonly clienteId: string;
  readonly secao: string;
  readonly tiposComPlano: readonly string[];
  readonly selecionado: string | null;
}): SeletorDeTipos {
  const itens = TIPOS_DE_PLANO.map((tipo): ItemDoSeletorDeTipos => {
    const existe = entrada.tiposComPlano.includes(tipo);
    return {
      tipo,
      rotulo: ROTULO_DO_TIPO_DE_PLANO[tipo],
      existe,
      selecionado: entrada.selecionado === tipo,
      href: existe
        ? rotaDoCliente(entrada.clienteId, 'estrategia', { secao: entrada.secao, tipo })
        : rotaDoCliente(entrada.clienteId, 'estrategia', { secao: 'plano', novo: '1', tipo }),
    };
  });
  const existentes = itens.filter((item) => item.existe);
  const novos = itens.filter((item) => !item.existe);
  return { existentes, novos, mostrar: existentes.length > 0 && (existentes.length > 1 || novos.length > 0) };
}
