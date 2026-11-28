import type { ErrosDeCampo } from './formulariosDaEstrategia.ts';

export type ChaveDoPasso = 'tipo' | 'destino' | 'horizonte' | 'verba' | 'revisao';

export type PassoDoNovoPlano = {
  readonly chave: ChaveDoPasso;
  readonly rotulo: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly campos: readonly string[];
};

export const PASSOS_DO_NOVO_PLANO: readonly PassoDoNovoPlano[] = [
  { chave: 'tipo', rotulo: 'Tipo', titulo: 'Tipo e plataformas', descricao: 'Que tipo de plano você precisa e onde ele vai rodar.', campos: ['tipoDePlano', 'plataformas'] },
  { chave: 'destino', rotulo: 'Destino', titulo: 'Foco e destino', descricao: 'O que o plano promove e para onde o tráfego vai.', campos: ['foco', 'landingPageId'] },
  { chave: 'horizonte', rotulo: 'Objetivo', titulo: 'Objetivo e horizonte', descricao: 'O que o plano precisa alcançar, em que período e com que ousadia.', campos: ['objetivo', 'inicio', 'fim', 'ousadia'] },
  { chave: 'verba', rotulo: 'Verba', titulo: 'Verba e retorno', descricao: 'Quanto investir e o que se espera em troca.', campos: ['verba', 'retorno'] },
  { chave: 'revisao', rotulo: 'Revisão', titulo: 'Revisão', descricao: 'Confira o que você escolheu antes de pedir o plano.', campos: [] },
];

const PRIMEIRO_PASSO = 0;
const ULTIMO_PASSO = PASSOS_DO_NOVO_PLANO.length - 1;

export function limitarPasso(indice: number): number {
  if (!Number.isInteger(indice)) return PRIMEIRO_PASSO;
  return Math.min(Math.max(indice, PRIMEIRO_PASSO), ULTIMO_PASSO);
}

export function passosComErro(erros: ErrosDeCampo | undefined): ReadonlySet<number> {
  const campos = new Set(Object.keys(erros ?? {}));
  const indices = PASSOS_DO_NOVO_PLANO.flatMap((passo, indice) => (passo.campos.some((campo) => campos.has(campo)) ? [indice] : []));
  return new Set(indices);
}

export function primeiroPassoComErro(erros: ErrosDeCampo | undefined): number | null {
  const [primeiro] = [...passosComErro(erros)].sort((a, b) => a - b);
  return primeiro ?? null;
}

export type EstadoDoPasso = 'concluido' | 'atual' | 'pendente';

export type ItemDoIndicador = {
  readonly indice: number;
  readonly numero: number;
  readonly chave: ChaveDoPasso;
  readonly rotulo: string;
  readonly estado: EstadoDoPasso;
  readonly textoDoEstado: string;
  readonly comErro: boolean;
};

const TEXTO_DO_ESTADO: Readonly<Record<EstadoDoPasso, string>> = { concluido: 'concluído', atual: 'passo atual', pendente: 'a fazer' };

export function indicadorDePassos(atual: number, erros?: ErrosDeCampo): readonly ItemDoIndicador[] {
  const comErro = passosComErro(erros);
  const passoAtual = limitarPasso(atual);
  return PASSOS_DO_NOVO_PLANO.map((passo, indice) => {
    const estado: EstadoDoPasso = indice === passoAtual ? 'atual' : indice < passoAtual ? 'concluido' : 'pendente';
    const comErroNoPasso = comErro.has(indice);
    return {
      indice,
      numero: indice + 1,
      chave: passo.chave,
      rotulo: passo.rotulo,
      estado,
      textoDoEstado: comErroNoPasso ? 'com erro' : TEXTO_DO_ESTADO[estado],
      comErro: comErroNoPasso,
    };
  });
}

export type NavegacaoDoPasso = {
  readonly indice: number;
  readonly anterior: number | null;
  readonly proximo: number | null;
  readonly ultimo: boolean;
  readonly progresso: string;
};

export function navegacaoDoPasso(atual: number): NavegacaoDoPasso {
  const indice = limitarPasso(atual);
  return {
    indice,
    anterior: indice > PRIMEIRO_PASSO ? indice - 1 : null,
    proximo: indice < ULTIMO_PASSO ? indice + 1 : null,
    ultimo: indice === ULTIMO_PASSO,
    progresso: `Passo ${indice + 1} de ${PASSOS_DO_NOVO_PLANO.length}`,
  };
}

const CAMPO_DE_ERRO_POR_ENTRADA: Readonly<Record<string, string>> = { focoMarca: 'foco', produtos: 'foco', modoDaVerba: 'verba' };

export function campoDeErroDaEntrada(nomeDaEntrada: string): string {
  return CAMPO_DE_ERRO_POR_ENTRADA[nomeDaEntrada] ?? nomeDaEntrada;
}

export type CorrecoesDeCampo = { readonly origem: ErrosDeCampo | undefined; readonly campos: ReadonlySet<string> };

export const SEM_CORRECOES: CorrecoesDeCampo = { origem: undefined, campos: new Set() };

export function corrigirCampo(correcoes: CorrecoesDeCampo, erros: ErrosDeCampo | undefined, nomeDaEntrada: string): CorrecoesDeCampo {
  const campo = campoDeErroDaEntrada(nomeDaEntrada);
  if (!erros?.[campo]) return correcoes;
  return { origem: erros, campos: new Set([...(correcoes.origem === erros ? correcoes.campos : []), campo]) };
}

export function errosAposCorrecoes(erros: ErrosDeCampo | undefined, correcoes: CorrecoesDeCampo): ErrosDeCampo {
  return errosVigentes(erros, correcoes.origem === erros ? correcoes.campos : SEM_CORRECOES.campos);
}

export function errosVigentes(erros: ErrosDeCampo | undefined, corrigidos: ReadonlySet<string>): ErrosDeCampo {
  return Object.fromEntries(Object.entries(erros ?? {}).filter(([campo]) => !corrigidos.has(campo)));
}
