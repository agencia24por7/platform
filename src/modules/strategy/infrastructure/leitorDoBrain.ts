import { aplicarPoliticaDeUso } from '@/modules/brain/domain/politica';
import { textoSeguro, TEXTO_OMITIDO } from '@/modules/brain/domain/privacidade';
import type { CarregadorDeContexto, ItemDoContexto } from '@/modules/brain/domain/contexto';
import { hashEstavel } from '@/modules/brain/domain/jsonEstavel';
import { criarUrn, idSeguro } from '@/modules/brain/domain/urn';
import type { EntradaDoCatalogo } from '@/modules/brain/domain/entrada';
import type { BrainService } from '@/modules/brain/application/brainService';
import type { MemberRole } from '@/modules/identity/domain/user';
import { err, ok, type Result } from '@/shared/result/result';
import { catalogoAtualDoPacote } from '@/modules/strategy/application/catalogoAtual';
import type { ErroDoBrain, LeitorDoBrain, ProdutoDoContexto, Relogio } from '@/modules/strategy/application/portas';
import {
  MAXIMO_DE_BYTES_DO_PACOTE_LIDO,
  MAXIMO_DE_ENTRADAS_LIDAS_DO_BRAIN,
  esquemaEntradaDoPacote,
  esquemaPacoteDeLeitura,
  MAXIMO_DE_ITENS_DO_CATALOGO,
  TIPO_DA_ENTRADA_DE_PRODUTO,
  type EntradaDoPacote,
  type ItemDoCatalogo,
  type PacoteDeLeitura,
} from '@/modules/strategy/domain/index';

export type DependenciasDoLeitorDoBrain = {
  readonly brain: Pick<BrainService, 'montarNaOrganizacao'>;
  readonly carregadorDeContexto?: CarregadorDeContexto;
  readonly relogio?: Relogio;
  readonly maximoDeEntradas?: number;
  readonly maximoDeBytes?: number;
};

const TAMANHO_DO_TITULO_NO_CATALOGO = 80;
const TIPOS_DE_REGRA = ['regra', 'limite', 'decisao'];
const TAMANHO_DO_RESUMO = 600;

export function prioridadeDaEntrada(entrada: Pick<EntradaDoCatalogo, 'tipo' | 'provedor' | 'evidencia'>): number {
  if (TIPOS_DE_REGRA.includes(entrada.tipo)) return 0;
  if (entrada.tipo.startsWith('contexto')) return 1;
  if (entrada.provedor === 'desempenho') return 2;
  if (entrada.provedor === 'conhecimento' || entrada.evidencia !== undefined) return 3;
  return 4;
}

export function paraEntradaDoPacote(entrada: EntradaDoCatalogo): EntradaDoPacote {
  const somenteMetadados = entrada.acesso.tipo === 'restrito';
  const base = {
    urn: entrada.urn,
    hash: entrada.hash,
    tipo: entrada.tipo,
    titulo: textoSeguro(entrada.titulo).slice(0, 160) || entrada.tipo,
    resumo: somenteMetadados ? '' : textoSeguro(entrada.valorResumido ?? entrada.descricao).slice(0, TAMANHO_DO_RESUMO),
    somenteMetadados,
  };
  const evidencia = entrada.evidencia;
  if (evidencia === undefined) return base;
  return {
    ...base,
    evidencia: {
      nota: evidencia.nota,
      categoria: evidencia.categoria,
      jurisdicao: evidencia.jurisdicao,
      obrigatoria: evidencia.obrigatoria,
      ...(evidencia.validoAte === undefined ? {} : { validoAte: evidencia.validoAte }),
      ...(evidencia.verificadoEm === undefined ? {} : { verificadoEm: evidencia.verificadoEm }),
    },
  };
}

function tamanhoEmBytes(entrada: EntradaDoPacote): number {
  return new TextEncoder().encode(JSON.stringify(entrada)).length;
}

export function montarPacote(
  organizacaoId: string,
  clienteId: string,
  lidoEm: Date,
  entradas: readonly EntradaDoCatalogo[],
  limites: { readonly maximoDeEntradas: number; readonly maximoDeBytes: number },
): PacoteDeLeitura {
  const visiveis = aplicarPoliticaDeUso(entradas).entradas;
  let descartadasPorFormato = 0;
  const validas: { readonly prioridade: number; readonly entrada: EntradaDoPacote }[] = [];
  for (const origem of visiveis) {
    const convertida = esquemaEntradaDoPacote.safeParse(paraEntradaDoPacote(origem));
    if (convertida.success) validas.push({ prioridade: prioridadeDaEntrada(origem), entrada: convertida.data });
    else descartadasPorFormato += 1;
  }
  validas.sort((a, b) => a.prioridade - b.prioridade || a.entrada.urn.localeCompare(b.entrada.urn));

  const mantidas: EntradaDoPacote[] = [];
  let bytes = 0;
  for (const { entrada } of validas) {
    const tamanho = tamanhoEmBytes(entrada);
    if (mantidas.length >= limites.maximoDeEntradas || bytes + tamanho > limites.maximoDeBytes) continue;
    mantidas.push(entrada);
    bytes += tamanho;
  }

  const incluidas = new Set(mantidas.map((entrada) => entrada.urn));
  const catalogo: ItemDoCatalogo[] = validas.slice(0, MAXIMO_DE_ITENS_DO_CATALOGO).map(({ entrada }) => ({
    urn: entrada.urn,
    tipo: entrada.tipo,
    titulo: entrada.titulo.slice(0, TAMANHO_DO_TITULO_NO_CATALOGO),
    ...(entrada.evidencia === undefined ? {} : { nota: entrada.evidencia.nota }),
    ...(entrada.evidencia?.validoAte === undefined ? {} : { validoAte: entrada.evidencia.validoAte }),
    incluida: incluidas.has(entrada.urn),
  }));

  return {
    organizacaoId,
    clienteId,
    lidoEm: lidoEm.toISOString(),
    entradas: mantidas,
    catalogo,
    omitidasPorTamanho: validas.length - mantidas.length,
    descartadasPorFormato,
  };
}

const CHAVE_DA_LISTA_DE_PRODUTOS = 'produtos';
const TAMANHO_DO_ROTULO_DO_PRODUTO = 120;
const CAMPOS_DE_TEXTO_DO_PRODUTO: readonly (readonly [string, string])[] = [
  ['categoria', 'Categoria'],
  ['descricao', 'Descrição'],
  ['para_quem', 'Para quem é'],
  ['problema_que_resolve', 'Problema que resolve'],
  ['objecoes', 'Objeções'],
  ['recorrencia', 'Recorrência'],
  ['papel', 'Papel no negócio'],
];
const CAMPOS_DE_DINHEIRO_DO_PRODUTO: readonly (readonly [string, string])[] = [
  ['preco', 'Preço'],
  ['ticket_medio', 'Ticket médio'],
];

function textoDoValor(valor: unknown): string | null {
  if (typeof valor === 'string') return valor.trim() === '' ? null : valor;
  if (Array.isArray(valor)) {
    const itens = valor.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    return itens.length > 0 ? itens.join(', ') : null;
  }
  if (valor !== null && typeof valor === 'object') {
    const registro = valor as { valor?: unknown; valores?: unknown };
    return textoDoValor(registro.valor ?? registro.valores);
  }
  return null;
}

function dinheiroDoValor(valor: unknown): string | null {
  const bruto = typeof valor === 'object' && valor !== null ? (valor as { centavos?: unknown }).centavos : valor;
  const centavos = typeof bruto === 'string' ? Number(bruto) : bruto;
  return typeof centavos === 'number' && Number.isFinite(centavos) ? `R$ ${(centavos / 100).toFixed(2)}` : null;
}

export function produtoDoItem(organizacaoId: string, clienteId: string, item: ItemDoContexto): ProdutoDoContexto | null {
  const nome = typeof item.dados['nome'] === 'string' ? textoSeguro(item.dados['nome']).slice(0, TAMANHO_DO_ROTULO_DO_PRODUTO) : '';
  if (nome === '' || nome === TEXTO_OMITIDO) return null;
  let urn: string;
  try {
    urn = criarUrn(organizacaoId, clienteId, TIPO_DA_ENTRADA_DE_PRODUTO, idSeguro(item.id));
  } catch {
    return null;
  }
  const partes = [
    ...CAMPOS_DE_TEXTO_DO_PRODUTO.map(([chave, rotulo]) => [rotulo, textoDoValor(item.dados[chave])] as const),
    ...CAMPOS_DE_DINHEIRO_DO_PRODUTO.map(([chave, rotulo]) => [rotulo, dinheiroDoValor(item.dados[chave])] as const),
  ]
    .filter((parte): parte is readonly [string, string] => parte[1] !== null)
    .map(([rotulo, valor]) => `${rotulo}: ${valor}`);
  const hash = hashEstavel({ id: item.id, dados: item.dados });
  const entrada = esquemaEntradaDoPacote.safeParse({
    foco: true,
    urn,
    hash,
    tipo: TIPO_DA_ENTRADA_DE_PRODUTO,
    titulo: nome,
    resumo: textoSeguro(partes.join('; ')).slice(0, TAMANHO_DO_RESUMO),
    somenteMetadados: false,
  });
  return entrada.success ? { urn, rotulo: nome, hash, entrada: entrada.data } : null;
}

const SEM_LIMITE_DE_LEITURA = { maximoDeEntradas: Number.MAX_SAFE_INTEGER, maximoDeBytes: Number.MAX_SAFE_INTEGER };
const PAPEL_DE_LEITURA_DO_MOTOR: MemberRole = 'admin';

export function criarLeitorDoBrain(dependencias: DependenciasDoLeitorDoBrain): LeitorDoBrain {
  const relogio = dependencias.relogio ?? { agora: () => new Date() };
  const limites = {
    maximoDeEntradas: dependencias.maximoDeEntradas ?? MAXIMO_DE_ENTRADAS_LIDAS_DO_BRAIN,
    maximoDeBytes: dependencias.maximoDeBytes ?? MAXIMO_DE_BYTES_DO_PACOTE_LIDO,
  };
  async function lerSnapshot(organizacaoId: string, clienteId: string): Promise<Result<{ readonly entradas: readonly EntradaDoCatalogo[] }, ErroDoBrain>> {
    try {
      const snapshot = await dependencias.brain.montarNaOrganizacao(organizacaoId, clienteId, PAPEL_DE_LEITURA_DO_MOTOR);
      if (!snapshot.ok) {
        return err(
          snapshot.error.code === 'not_found'
            ? { codigo: 'cliente_inexistente', mensagem: 'Cliente não encontrado no Brain.' }
            : { codigo: 'brain_indisponivel', mensagem: 'O Brain não respondeu.' },
        );
      }
      if (snapshot.value.organizationId !== organizacaoId || snapshot.value.clienteId !== clienteId) {
        return err({ codigo: 'brain_indisponivel', mensagem: 'O Brain devolveu outro cliente.' });
      }
      return ok({ entradas: snapshot.value.entradas });
    } catch {
      return err({ codigo: 'brain_indisponivel', mensagem: 'O Brain não respondeu.' });
    }
  }

  return {
    async produtosDoContexto(organizacaoId, clienteId): Promise<Result<readonly ProdutoDoContexto[], ErroDoBrain>> {
      const carregador = dependencias.carregadorDeContexto;
      if (carregador === undefined || !carregador.disponivel) return err({ codigo: 'brain_indisponivel', mensagem: 'O Contexto do cliente não está disponível.' });
      try {
        const contexto = await carregador.carregar({ organizationId: organizacaoId, clientId: clienteId }, 'equipe');
        if (contexto === null) return err({ codigo: 'brain_indisponivel', mensagem: 'O Contexto do cliente não respondeu.' });
        const itens = contexto.listas[CHAVE_DA_LISTA_DE_PRODUTOS] ?? [];
        const produtos = itens
          .filter((item) => item.revisao === 'confirmado' && item.secao === CHAVE_DA_LISTA_DE_PRODUTOS)
          .map((item) => produtoDoItem(organizacaoId, clienteId, item))
          .filter((produto): produto is ProdutoDoContexto => produto !== null)
          .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR') || a.urn.localeCompare(b.urn));
        return ok(produtos);
      } catch {
        return err({ codigo: 'brain_indisponivel', mensagem: 'O Contexto do cliente não respondeu.' });
      }
    },
    catalogoDoSnapshot(organizacaoId, clienteId, snapshot) {
      if (snapshot.organizationId !== organizacaoId || snapshot.clienteId !== clienteId) return null;
      return catalogoAtualDoPacote(montarPacote(organizacaoId, clienteId, relogio.agora(), snapshot.entradas, SEM_LIMITE_DE_LEITURA));
    },
    async entradasPorUrn(organizacaoId, clienteId, urns): Promise<Result<EntradaDoPacote[], ErroDoBrain>> {
      if (urns.length === 0) return ok([]);
      const snapshot = await lerSnapshot(organizacaoId, clienteId);
      if (!snapshot.ok) return snapshot;
      const pedidas = new Set(urns);
      const achadas: EntradaDoPacote[] = [];
      for (const origem of aplicarPoliticaDeUso(snapshot.value.entradas).entradas) {
        if (!pedidas.has(origem.urn)) continue;
        const convertida = esquemaEntradaDoPacote.safeParse(paraEntradaDoPacote(origem));
        if (convertida.success) achadas.push(convertida.data);
      }
      return ok(achadas);
    },
    async lerPacote(organizacaoId, clienteId): Promise<Result<PacoteDeLeitura, ErroDoBrain>> {
      const snapshot = await lerSnapshot(organizacaoId, clienteId);
      if (!snapshot.ok) return snapshot;
      const pacote = montarPacote(organizacaoId, clienteId, relogio.agora(), snapshot.value.entradas, limites);
      const lido = esquemaPacoteDeLeitura.safeParse(pacote);
      if (!lido.success) return err({ codigo: 'brain_indisponivel', mensagem: 'O pacote lido do Brain é inválido.' });
      return ok(lido.data);
    },
  };
}
