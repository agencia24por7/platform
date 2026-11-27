import type { LandingPage } from '../destino/tipos.ts';

export type VisaoDoDestino = {
  readonly podeEditar: boolean;
  readonly whatsapp: { readonly valor: string | null; readonly situacao: string };
  readonly paginas: readonly { readonly id: string; readonly rotulo: string; readonly url: string }[];
  readonly semPaginas: string;
};

export function visaoDoDestino(entrada: { readonly whatsapp: string | null; readonly paginas: readonly LandingPage[]; readonly podeEditar: boolean }): VisaoDoDestino {
  return {
    podeEditar: entrada.podeEditar,
    whatsapp: {
      valor: entrada.whatsapp,
      situacao: entrada.whatsapp === null ? 'Ainda não cadastrado. Os planos precisam dele.' : 'Usado nos links e nos planos deste cliente.',
    },
    paginas: entrada.paginas
      .filter((pagina) => pagina.arquivadaEm === null)
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
      .map((pagina) => ({ id: pagina.id, rotulo: pagina.rotulo, url: pagina.url })),
    semPaginas: entrada.podeEditar ? 'Cadastre ao menos uma landing page para pedir planos.' : 'Nenhuma landing page cadastrada.',
  };
}
