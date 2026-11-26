import { aplicarPoliticaDeUso } from '@/modules/brain/domain/politica';
import { textoSeguro } from '@/modules/brain/domain/privacidade';
import type { EntradaDoCatalogo } from '@/modules/brain/domain/entrada';
import type { BrainService } from '@/modules/brain/application/brainService';
import type { MemberRole } from '@/modules/identity/domain/user';
import { err, ok, type Result } from '@/shared/result/result';
import { catalogoAtualDoPacote } from '@/modules/strategy/application/catalogoAtual';
import type { ErroDoBrain, LeitorDoBrain, Relogio } from '@/modules/strategy/application/portas';
import {
  MAXIMO_DE_BYTES_DO_PACOTE_LIDO,
  MAXIMO_DE_ENTRADAS_LIDAS_DO_BRAIN,
  esquemaEntradaDoPacote,
  esquemaPacoteDeLeitura,
  MAXIMO_DE_ITENS_DO_CATALOGO,
  type EntradaDoPacote,
  type ItemDoCatalogo,
  type PacoteDeLeitura,
} from '@/modules/strategy/domain/index';

export type DependenciasDoLeitorDoBrain = {
  readonly brain: Pick<BrainService, 'montarNaOrganizacao'>;
  readonly relogio?: Relogio;
  readonly maximoDeEntradas?: number;
  readonly maximoDeBytes?: number;
};

const TIPOS_FORA_DO_PACOTE: readonly string[] = ['arquivo'];
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
  const visiveis = aplicarPoliticaDeUso(entradas).entradas.filter((entrada) => !TIPOS_FORA_DO_PACOTE.includes(entrada.tipo));
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

const PAPEL_DE_LEITURA_DO_MOTOR: MemberRole = 'admin';

export function criarLeitorDoBrain(dependencias: DependenciasDoLeitorDoBrain): LeitorDoBrain {
  const relogio = dependencias.relogio ?? { agora: () => new Date() };
  const limites = {
    maximoDeEntradas: dependencias.maximoDeEntradas ?? MAXIMO_DE_ENTRADAS_LIDAS_DO_BRAIN,
    maximoDeBytes: dependencias.maximoDeBytes ?? MAXIMO_DE_BYTES_DO_PACOTE_LIDO,
  };
  return {
    catalogoDoSnapshot(organizacaoId, clienteId, snapshot) {
      if (snapshot.organizationId !== organizacaoId || snapshot.clienteId !== clienteId) return null;
      return catalogoAtualDoPacote(montarPacote(organizacaoId, clienteId, relogio.agora(), snapshot.entradas, limites));
    },
    async lerPacote(organizacaoId, clienteId): Promise<Result<PacoteDeLeitura, ErroDoBrain>> {
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
        const pacote = montarPacote(organizacaoId, clienteId, relogio.agora(), snapshot.value.entradas, limites);
        const lido = esquemaPacoteDeLeitura.safeParse(pacote);
        if (!lido.success) return err({ codigo: 'brain_indisponivel', mensagem: 'O pacote lido do Brain é inválido.' });
        return ok(lido.data);
      } catch {
        return err({ codigo: 'brain_indisponivel', mensagem: 'O Brain não respondeu.' });
      }
    },
  };
}
