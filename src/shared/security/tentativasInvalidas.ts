import {
  cobrarComRecibo as cobrarComReciboDoProcesso,
  consumeAll as consumeAllDoProcesso,
  devolver as devolverDoProcesso,
  existe as existeDoProcesso,
  forget as forgetDoProcesso,
  renovar as renovarDoProcesso,
  type DominioDeLimite,
  type LimitadorDeTaxa,
  type RateLimitVerdict,
  type ReciboDeCobranca,
} from './rateLimit.ts';

export type ContadorDeTentativas = Pick<
  LimitadorDeTaxa,
  'consumeAll' | 'existe' | 'renovar' | 'cobrarComRecibo' | 'devolver' | 'forget'
>;

export type LimiteDaConsulta = {
  readonly dominio: DominioDeLimite;
  readonly chave: string;
  readonly limite: number;
};

export const VIDA_DA_CREDENCIAL_VALIDADA_MS = 24 * 60 * 60 * 1000;

export const VIDA_DA_CREDENCIAL_RECUSADA_MS = 5 * 60 * 1000;

export type OpcoesDaConsultaVigiada = {
  readonly janelaMs: number;
  readonly desconhecidas: LimiteDaConsulta;
  readonly porCredencial: LimiteDaConsulta;
  readonly validada: { readonly chave: string; readonly vidaMs?: number };
  readonly recusada?: { readonly chave: string; readonly vidaMs?: number };
  readonly total?: LimiteDaConsulta;
  readonly contador?: ContadorDeTentativas;
};

export type ResultadoDaTentativa<T> =
  | { readonly tipo: 'barrada'; readonly veredito: RateLimitVerdict }
  | { readonly tipo: 'invalida' }
  | { readonly tipo: 'valida'; readonly valor: T };

export type ConsultaVigiada = {
  readonly resolver: <T>(buscar: () => Promise<T | null>) => Promise<ResultadoDaTentativa<T>>;
};

const CONTADOR_DO_PROCESSO: ContadorDeTentativas = {
  consumeAll: consumeAllDoProcesso,
  existe: existeDoProcesso,
  renovar: renovarDoProcesso,
  cobrarComRecibo: cobrarComReciboDoProcesso,
  devolver: devolverDoProcesso,
  forget: forgetDoProcesso,
};

const INVALIDA = { tipo: 'invalida' } as const;

type Cobranca = { readonly barrada: RateLimitVerdict | null; readonly reciboDaDesconhecida: ReciboDeCobranca | null };

export function vigiarConsulta(opcoes: OpcoesDaConsultaVigiada): ConsultaVigiada {
  const contador = opcoes.contador ?? CONTADOR_DO_PROCESSO;
  const { desconhecidas, porCredencial, validada, recusada } = opcoes;

  const cobrar = (limite: LimiteDaConsulta) =>
    contador.consumeAll([{ dominio: limite.dominio, key: limite.chave, limit: limite.limite }], opcoes.janelaMs);

  const conhecida = () => contador.existe('validadas', validada.chave);
  const jaRecusada = () => (recusada ? contador.existe('recusadas', recusada.chave) : false);

  function registrarRecusa(): void {
    if (!recusada) return;
    contador.renovar('recusadas', recusada.chave, recusada.vidaMs ?? VIDA_DA_CREDENCIAL_RECUSADA_MS);
  }

  function registrarValidacao(): void {
    if (recusada) contador.forget('recusadas', recusada.chave);
    contador.renovar('validadas', validada.chave, validada.vidaMs ?? VIDA_DA_CREDENCIAL_VALIDADA_MS);
  }

  function cobrarAntesDoBanco(eConhecida: boolean): Cobranca {
    if (opcoes.total) {
      const porTotal = cobrar(opcoes.total);
      if (!porTotal.allowed) return { barrada: porTotal, reciboDaDesconhecida: null };
    }
    if (eConhecida) {
      const porCredencialConhecida = cobrar(porCredencial);
      return { barrada: porCredencialConhecida.allowed ? null : porCredencialConhecida, reciboDaDesconhecida: null };
    }
    const { veredito, recibo } = contador.cobrarComRecibo(desconhecidas.dominio, desconhecidas.chave, desconhecidas.limite, opcoes.janelaMs);
    return { barrada: veredito.allowed ? null : veredito, reciboDaDesconhecida: recibo };
  }

  async function resolver<T>(buscar: () => Promise<T | null>): Promise<ResultadoDaTentativa<T>> {
    const eConhecida = conhecida();
    if (!eConhecida && jaRecusada()) return INVALIDA;

    const cobranca = cobrarAntesDoBanco(eConhecida);
    if (cobranca.barrada) return { tipo: 'barrada', veredito: cobranca.barrada };

    const valor = await buscar();

    if (valor === null) {
      if (eConhecida) {
        contador.forget('validadas', validada.chave);
        cobrar(desconhecidas);
      }
      registrarRecusa();
      return INVALIDA;
    }

    registrarValidacao();
    if (eConhecida) return { tipo: 'valida', valor };

    if (cobranca.reciboDaDesconhecida) contador.devolver(cobranca.reciboDaDesconhecida);
    const primeira = cobrar(porCredencial);
    if (!primeira.allowed) return { tipo: 'barrada', veredito: primeira };
    return { tipo: 'valida', valor };
  }

  return { resolver };
}
