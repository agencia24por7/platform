import { createHash } from 'node:crypto';

export const INICIO_DOS_TEMPOS = new Date('1970-01-01T00:00:00.000Z');
export const FIM_DOS_TEMPOS = new Date('9999-12-31T00:00:00.000Z');

export type OrigemDaFonte = 'ad_account' | 'connection_account';

export type EstadoDaFonte = {
  readonly organizationId: string;
  readonly platform: string;
  readonly externalId: string;
  readonly origem: OrigemDaFonte;
  readonly clientId: string | null;
  readonly status: string;
  readonly nome: string | null;
};

export type EstadoDoCliente = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly nome: string;
  readonly status: string;
  readonly parentClientId: string | null;
  readonly businessModel: string;
};

export type PosseAnterior = { readonly clientId: string | null; readonly status: string };

export type MudancaDePosse = {
  readonly organizationId: string;
  readonly platform: string;
  readonly externalId: string;
  readonly em: Date;
  readonly antes: PosseAnterior | null;
};

export type Registro<A> = { readonly chave: string; readonly atributos: A };

export type VersaoExistente = {
  readonly chave: string;
  readonly abertas: number;
  readonly hashAberta: string | null;
};

export type Segmento<A> = { readonly validoDe: Date; readonly atributos: A };

export type NovaVersao<A> = {
  readonly sk: string;
  readonly chave: string;
  readonly atributos: A;
  readonly hash: string;
  readonly validoDe: Date;
  readonly validoAte: Date;
  readonly atual: boolean;
};

export type ResumoScd2 = {
  readonly novas: number;
  readonly alteradas: number;
  readonly inalteradas: number;
  readonly encerradas: number;
  readonly reabertas: number;
  readonly versoesInseridas: number;
};

export type PlanoScd2<A> = {
  readonly agora: Date;
  readonly fechar: readonly string[];
  readonly inserir: readonly NovaVersao<A>[];
  readonly resumo: ResumoScd2;
};

export type RegrasScd2<A> = {
  readonly hashDe: (atributos: A) => string;
  readonly historicoInicial?: (registro: Registro<A>) => readonly Segmento<A>[];
};

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

export const chaveDaFonte = (fonte: Pick<EstadoDaFonte, 'organizationId' | 'platform' | 'externalId'>): string =>
  `${fonte.organizationId}|${fonte.platform}|${fonte.externalId}`;

export const chaveDoCliente = (cliente: Pick<EstadoDoCliente, 'organizationId' | 'clientId'>): string =>
  `${cliente.organizationId}|${cliente.clientId}`;

export const hashDaFonte = (fonte: EstadoDaFonte): string => sha256(JSON.stringify([fonte.clientId, fonte.status, fonte.nome]));

export const STATUS_DE_CLIENTE_EXCLUIDO = 'excluido';

export const statusDoClienteNaDimensao = (status: string, excluidoEm: Date | null): string =>
  excluidoEm === null ? status : STATUS_DE_CLIENTE_EXCLUIDO;

export const hashDoCliente = (cliente: EstadoDoCliente): string =>
  sha256(JSON.stringify([cliente.nome, cliente.status, cliente.parentClientId, cliente.businessModel]));

export const skDaVersao = (chave: string, validoDe: Date): string => sha256(`${chave}|${validoDe.toISOString()}`);

function versoesDosSegmentos<A>(chave: string, segmentos: readonly Segmento<A>[], hashDe: (atributos: A) => string): NovaVersao<A>[] {
  return segmentos.map((segmento, indice) => {
    const proximo = segmentos[indice + 1];
    return {
      sk: skDaVersao(chave, segmento.validoDe),
      chave,
      atributos: segmento.atributos,
      hash: hashDe(segmento.atributos),
      validoDe: segmento.validoDe,
      validoAte: proximo ? proximo.validoDe : FIM_DOS_TEMPOS,
      atual: !proximo,
    };
  });
}

export function planejarScd2<A>(
  atuais: readonly Registro<A>[],
  existentes: readonly VersaoExistente[],
  agora: Date,
  regras: RegrasScd2<A>,
): PlanoScd2<A> {
  const porChave = new Map(existentes.map((existente) => [existente.chave, existente]));
  const vistas = new Set<string>();
  const fechar: string[] = [];
  const inserir: NovaVersao<A>[] = [];
  let novas = 0;
  let alteradas = 0;
  let inalteradas = 0;
  let reabertas = 0;
  let encerradas = 0;

  for (const registro of atuais) {
    if (vistas.has(registro.chave)) continue;
    vistas.add(registro.chave);

    const existente = porChave.get(registro.chave);
    const hash = regras.hashDe(registro.atributos);
    const versaoDeAgora = versoesDosSegmentos(registro.chave, [{ validoDe: agora, atributos: registro.atributos }], regras.hashDe);

    if (!existente) {
      novas += 1;
      const segmentos = regras.historicoInicial?.(registro) ?? [{ validoDe: INICIO_DOS_TEMPOS, atributos: registro.atributos }];
      inserir.push(...versoesDosSegmentos(registro.chave, segmentos, regras.hashDe));
      continue;
    }

    if (existente.abertas === 0) {
      reabertas += 1;
      inserir.push(...versaoDeAgora);
      continue;
    }

    if (existente.abertas === 1 && existente.hashAberta === hash) {
      inalteradas += 1;
      continue;
    }

    alteradas += 1;
    fechar.push(registro.chave);
    inserir.push(...versaoDeAgora);
  }

  for (const existente of existentes) {
    if (vistas.has(existente.chave) || existente.abertas === 0) continue;
    encerradas += 1;
    fechar.push(existente.chave);
  }

  return {
    agora,
    fechar,
    inserir,
    resumo: { novas, alteradas, inalteradas, encerradas, reabertas, versoesInseridas: inserir.length },
  };
}

function semRepeticao<A>(segmentos: readonly Segmento<A>[], hashDe: (atributos: A) => string): Segmento<A>[] {
  const resultado: Segmento<A>[] = [];
  for (const segmento of segmentos) {
    const anterior = resultado[resultado.length - 1];
    if (anterior && anterior.validoDe.getTime() === segmento.validoDe.getTime()) {
      resultado[resultado.length - 1] = segmento;
      continue;
    }
    if (anterior && hashDe(anterior.atributos) === hashDe(segmento.atributos)) continue;
    resultado.push(segmento);
  }
  return resultado;
}

export function reconstruirPosse(
  atual: EstadoDaFonte,
  mudancas: readonly MudancaDePosse[],
  agora: Date,
): readonly Segmento<EstadoDaFonte>[] {
  const ordenadas = mudancas
    .filter((mudanca) => mudanca.em.getTime() > INICIO_DOS_TEMPOS.getTime() && mudanca.em.getTime() < agora.getTime())
    .sort((a, b) => a.em.getTime() - b.em.getTime());

  const segmentos: Segmento<EstadoDaFonte>[] = ordenadas.map((mudanca, indice) => ({
    validoDe: indice === 0 ? INICIO_DOS_TEMPOS : ordenadas[indice - 1]!.em,
    atributos: mudanca.antes
      ? { ...atual, clientId: mudanca.antes.clientId, status: mudanca.antes.status }
      : { ...atual, clientId: null, status: STATUS_DE_DONO_DESCONHECIDO },
  }));
  segmentos.push({ validoDe: ordenadas.length > 0 ? ordenadas[ordenadas.length - 1]!.em : INICIO_DOS_TEMPOS, atributos: atual });

  const compactos = semRepeticao(segmentos, hashDaFonte);
  while (compactos.length > 1 && semDonoConhecidoPorEscolha(compactos[0]!.atributos)) {
    compactos.shift();
    compactos[0] = { ...compactos[0]!, validoDe: INICIO_DOS_TEMPOS };
  }
  return compactos;
}

export const STATUS_DE_DONO_DESCONHECIDO = 'desconhecido';

export const donoDesconhecido = (fonte: Pick<EstadoDaFonte, 'clientId' | 'status'>): boolean =>
  fonte.clientId === null && fonte.status === STATUS_DE_DONO_DESCONHECIDO;

const semDonoConhecidoPorEscolha = (fonte: EstadoDaFonte): boolean => fonte.clientId === null && !donoDesconhecido(fonte);

export function registrosDasFontes(fontes: readonly EstadoDaFonte[]): Registro<EstadoDaFonte>[] {
  return fontes.map((fonte) => ({ chave: chaveDaFonte(fonte), atributos: fonte }));
}

export function registrosDosClientes(clientes: readonly EstadoDoCliente[]): Registro<EstadoDoCliente>[] {
  return clientes.map((cliente) => ({ chave: chaveDoCliente(cliente), atributos: cliente }));
}

export function planejarFontes(
  fontes: readonly EstadoDaFonte[],
  existentes: readonly VersaoExistente[],
  mudancas: readonly MudancaDePosse[],
  agora: Date,
): PlanoScd2<EstadoDaFonte> {
  const mudancasPorChave = new Map<string, MudancaDePosse[]>();
  for (const mudanca of mudancas) {
    const chave = chaveDaFonte(mudanca);
    mudancasPorChave.set(chave, [...(mudancasPorChave.get(chave) ?? []), mudanca]);
  }

  return planejarScd2(registrosDasFontes(fontes), existentes, agora, {
    hashDe: hashDaFonte,
    historicoInicial: (registro) => reconstruirPosse(registro.atributos, mudancasPorChave.get(registro.chave) ?? [], agora),
  });
}

export function planejarClientes(
  clientes: readonly EstadoDoCliente[],
  existentes: readonly VersaoExistente[],
  agora: Date,
): PlanoScd2<EstadoDoCliente> {
  return planejarScd2(registrosDosClientes(clientes), existentes, agora, { hashDe: hashDoCliente });
}
