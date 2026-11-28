import type { LandingPage } from '../destino/tipos.ts';

export type VisaoDoDestino = {
  readonly podeEditar: boolean;
  readonly whatsapp: { readonly valor: string | null; readonly situacao: string };
  readonly paginas: readonly { readonly id: string; readonly rotulo: string; readonly url: string }[];
  readonly semPaginas: string;
  readonly progresso: { readonly percentual: number; readonly completo: boolean; readonly resumo: string };
};

function progressoDoDestino(temWhatsapp: boolean, paginas: number): VisaoDoDestino['progresso'] {
  const feitos = (temWhatsapp ? 1 : 0) + (paginas > 0 ? 1 : 0);
  const resumo = [temWhatsapp ? 'WhatsApp ok' : 'Sem WhatsApp', paginas === 0 ? 'nenhuma página' : `${paginas} ${paginas === 1 ? 'página' : 'páginas'}`].join(' · ');
  return { percentual: feitos * 50, completo: feitos === 2, resumo };
}

export function visaoDoDestino(entrada: { readonly whatsapp: string | null; readonly paginas: readonly LandingPage[]; readonly podeEditar: boolean }): VisaoDoDestino {
  const ativas = entrada.paginas.filter((pagina) => pagina.arquivadaEm === null);
  return {
    podeEditar: entrada.podeEditar,
    whatsapp: {
      valor: entrada.whatsapp,
      situacao: entrada.whatsapp === null ? 'Ainda não cadastrado. Os planos precisam dele.' : 'Usado nos links e nos planos deste cliente.',
    },
    paginas: [...ativas]
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
      .map((pagina) => ({ id: pagina.id, rotulo: pagina.rotulo, url: pagina.url })),
    semPaginas: entrada.podeEditar ? 'Cadastre ao menos uma landing page para pedir planos.' : 'Nenhuma landing page cadastrada.',
    progresso: progressoDoDestino(entrada.whatsapp !== null, ativas.length),
  };
}
