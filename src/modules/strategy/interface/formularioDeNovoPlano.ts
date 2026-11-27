import { rotaDoCliente } from '../../clients/domain/painel/enderecos.ts';
import type { ModeloDeCriacao, PreviaDeUtmDoPedido } from '../application/estrategiaService.ts';
import { OUSADIAS } from '../domain/plano.ts';
import { ROTULO_DA_OUSADIA } from './rotulosDoPlano.ts';
import type { CamposBrutos, ErrosDeCampo } from './formulariosDaEstrategia.ts';

export type OpcaoDoFormulario = { readonly valor: string; readonly rotulo: string; readonly marcada: boolean };

export type FormularioDeNovoPlano = {
  readonly tipos: readonly OpcaoDoFormulario[];
  readonly plataformas: readonly OpcaoDoFormulario[];
  readonly landingPages: readonly OpcaoDoFormulario[];
  readonly foco: {
    readonly marca: { readonly rotulo: string; readonly marcada: boolean };
    readonly produtos: readonly OpcaoDoFormulario[];
    readonly semProdutos: { readonly texto: string; readonly link: { readonly rotulo: string; readonly href: string } | null } | null;
    readonly chave: string;
  };
  readonly ousadias: readonly OpcaoDoFormulario[];
  readonly selecionados: { readonly tipo: string; readonly landingPage: string; readonly ousadia: string };
  readonly whatsapp: { readonly texto: string; readonly ausente: boolean; readonly link: { readonly rotulo: string; readonly href: string } | null };
  readonly semLandingPage: { readonly texto: string; readonly link: { readonly rotulo: string; readonly href: string } } | null;
  readonly podeCriar: boolean;
  readonly chaveDeIdempotencia: string;
  readonly valores: { readonly objetivo: string; readonly inicio: string; readonly fim: string; readonly retorno: string; readonly verba: string };
};

export type PreviaNaTela = {
  readonly itens: readonly {
    readonly plataforma: string;
    readonly rotulo: string;
    readonly url: string;
    readonly parametros: readonly { readonly nome: string; readonly valor: string }[];
  }[];
};

const OUSADIA_PADRAO = 'moderado';
const PRIMEIRO_TIPO_PADRAO = 'aquisicao';

function listaDe(texto: string | undefined): readonly string[] {
  return (texto ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '');
}

export function formularioDeNovoPlano(modelo: ModeloDeCriacao, valores: CamposBrutos, clienteId: string): FormularioDeNovoPlano {
  const tipoEscolhido = valores['tipoDePlano'] ?? modelo.tipos.find((t) => t.tipo === PRIMEIRO_TIPO_PADRAO)?.tipo ?? modelo.tipos[0]?.tipo;
  const plataformasEscolhidas = new Set(listaDe(valores['plataformas']));
  const ousadiaEscolhida = valores['ousadia'] ?? OUSADIA_PADRAO;
  const paginaEscolhida = valores['landingPageId'];
  const destino = rotaDoCliente(clienteId, 'contexto', { secao: 'destino' });
  const marcaEscolhida = valores['focoMarca'] === '1';
  const produtosEscolhidos = new Set(marcaEscolhida ? [] : listaDe(valores['produtos']));
  const semProdutos = modelo.produtosIndisponiveis
    ? { texto: 'Não foi possível ler os produtos do cliente agora. Tente de novo ou escolha campanha de marca.', link: null }
    : modelo.produtos.length === 0
      ? { texto: 'O cliente ainda não tem produto cadastrado no Contexto. Você ainda pode criar uma campanha de marca.', link: { rotulo: 'Cadastrar produtos', href: rotaDoCliente(clienteId, 'contexto') } }
      : null;
  return {
    tipos: modelo.tipos.map((t) => ({ valor: t.tipo, rotulo: t.rotulo, marcada: t.tipo === tipoEscolhido })),
    plataformas: modelo.plataformas.map((p) => ({ valor: p.plataforma, rotulo: p.rotulo, marcada: plataformasEscolhidas.has(p.plataforma) })),
    landingPages: modelo.landingPages.map((pagina) => ({ valor: pagina.id, rotulo: `${pagina.rotulo} (${pagina.url})`, marcada: pagina.id === paginaEscolhida })),
    foco: {
      marca: { rotulo: 'Campanha de marca', marcada: marcaEscolhida },
      produtos: modelo.produtos.map((produto) => ({ valor: produto.urn, rotulo: produto.rotulo, marcada: produtosEscolhidos.has(produto.urn) })),
      semProdutos,
      chave: `${marcaEscolhida ? 'marca' : 'produtos'}:${[...produtosEscolhidos].sort().join(',')}`,
    },
    ousadias: OUSADIAS.map((nivel) => ({ valor: nivel, rotulo: ROTULO_DA_OUSADIA[nivel] ?? nivel, marcada: nivel === ousadiaEscolhida })),
    selecionados: {
      tipo: tipoEscolhido ?? '',
      landingPage: modelo.landingPages.some((pagina) => pagina.id === paginaEscolhida) ? (paginaEscolhida ?? '') : '',
      ousadia: ousadiaEscolhida,
    },
    whatsapp: modelo.whatsappAusente
      ? { texto: 'O cliente ainda não tem WhatsApp cadastrado.', ausente: true, link: { rotulo: 'Cadastrar o WhatsApp do cliente', href: destino } }
      : { texto: modelo.whatsapp ?? '', ausente: false, link: null },
    semLandingPage: modelo.landingPages.length === 0 ? { texto: 'O cliente ainda não tem landing page cadastrada.', link: { rotulo: 'Cadastrar landing page', href: destino } } : null,
    podeCriar: modelo.podeCriar,
    chaveDeIdempotencia: valores['chaveDeIdempotencia'] ?? modelo.chaveDeIdempotencia,
    valores: {
      objetivo: valores['objetivo'] ?? '',
      inicio: valores['inicio'] ?? '',
      fim: valores['fim'] ?? '',
      retorno: valores['retorno'] ?? '',
      verba: valores['verba'] ?? '',
    },
  };
}

export function previaNaTela(previa: PreviaDeUtmDoPedido): PreviaNaTela {
  return {
    itens: previa.itens.map((item) => ({
      plataforma: item.plataforma,
      rotulo: item.rotulo,
      url: item.url,
      parametros: [
        { nome: 'utm_source', valor: item.utm.utm_source },
        { nome: 'utm_medium', valor: item.utm.utm_medium },
        { nome: 'utm_campaign', valor: item.utm.utm_campaign },
      ],
    })),
  };
}

const CAMPO_POR_CHAVE_DO_SERVIDOR: Readonly<Record<string, string>> = {
  tipoDePlano: 'tipoDePlano',
  plataformas: 'plataformas',
  landingPageId: 'landingPageId',
  foco: 'foco',
  produtos: 'foco',
  nomeDaCampanha: 'objetivo',
  objetivo: 'objetivo',
  inicio: 'inicio',
  horizonte: 'inicio',
  ousadia: 'ousadia',
  retorno_esperado: 'retorno',
  verba: 'verba',
};

export function campoDoFormulario(chaveDoServidor: string): string | null {
  const partes = chaveDoServidor.split('.');
  const ultima = partes[partes.length - 1] ?? '';
  if (ultima === 'fim' && partes.includes('horizonte')) return 'fim';
  for (const parte of partes) {
    const campo = CAMPO_POR_CHAVE_DO_SERVIDOR[parte];
    if (campo !== undefined) return campo;
  }
  return null;
}

export function errosPorCampo(detalhes: Readonly<Record<string, string>> | undefined): ErrosDeCampo {
  const erros: Record<string, string> = {};
  for (const [chave, mensagem] of Object.entries(detalhes ?? {})) {
    const campo = campoDoFormulario(chave);
    if (campo !== null) erros[campo] ??= mensagem;
  }
  return erros;
}
