import type { StatusDaCapacidade } from '../../../brain/domain/capacidades.ts';
import type { AcaoRecomendada, Diagnostico, TipoDeAcao } from '../../../brain/domain/diagnostico.ts';
import type { OrganizationType } from '../../../organizations/domain/organization.ts';
import { vocabularioDe } from '../../../organizations/domain/vocabulario.ts';
import { acaoDaVisao } from './brain/doCatalogo.ts';
import { rotaDoCliente } from './enderecos.ts';

export type Veredito = 'sim' | 'parcial' | 'nao';

export const ROTULO_DO_VEREDITO: Record<Veredito, string> = { sim: 'Sim', parcial: 'Parcial', nao: 'Não' };

export function vereditoDeProntidao(status: readonly StatusDaCapacidade[]): Veredito {
  if (status.length === 0) return 'nao';
  if (status.every((s) => s === 'disponivel')) return 'sim';
  if (status.every((s) => s === 'indisponivel')) return 'nao';
  return 'parcial';
}

export function ordenarPorPeso(acoes: readonly AcaoRecomendada[]): readonly AcaoRecomendada[] {
  return [...acoes].sort((a, b) => b.impacto - a.impacto || a.id.localeCompare(b.id));
}

export type LacunaDaProntidao = { readonly id: string; readonly titulo: string; readonly impacto: number };

export const LIMITE_DE_LACUNAS = 3;

export function lacunasDaProntidao(acoes: readonly AcaoRecomendada[], limite: number = LIMITE_DE_LACUNAS): readonly LacunaDaProntidao[] {
  return ordenarPorPeso(acoes)
    .slice(0, limite)
    .map((a) => ({ id: a.id, titulo: a.titulo, impacto: a.impacto }));
}

export type AcaoPrincipal = { readonly id: string; readonly titulo: string; readonly rotulo: string; readonly href: string };

export function acaoPrincipal(
  acoes: readonly AcaoRecomendada[],
  clienteId: string,
  podeEditar: boolean,
  tipo: OrganizationType = 'agency',
): AcaoPrincipal | null {
  const primeira = ordenarPorPeso(acoes)[0];
  if (!primeira || !podeEditar) return null;
  const vocabulario = vocabularioDe(tipo);
  const visao = acaoDaVisao(primeira, clienteId);
  if (primeira.tipo === 'preencher_contexto') {
    const href = vocabulario.enviarMapaNoPerfil ? rotaDoCliente(clienteId, 'conexoes', { secao: 'pedir', enviar: 'contexto' }) : visao.href;
    return { id: primeira.id, titulo: primeira.titulo, rotulo: vocabulario.rotuloDaAcaoDeContexto, href };
  }
  const ehConexao = primeira.tipo === 'conectar' || primeira.tipo === 'vincular_recurso';
  return { id: primeira.id, titulo: visao.titulo, rotulo: !vocabulario.enviarMapaNoPerfil && ehConexao ? vocabulario.rotuloDaAcaoDeConexao : visao.rotulo, href: visao.href };
}

export type TomDoBloco = 'ok' | 'atencao' | 'critico' | 'vazio';

export type EstadoDoBloco = { readonly tom: TomDoBloco; readonly rotulo: string; readonly proximoPasso: string | null };

type EntradaDoBloco = Pick<Diagnostico, 'resumo' | 'conectores' | 'fontes' | 'contexto' | 'acoes'>;

const TIPOS_DE_CONEXOES: readonly TipoDeAcao[] = ['reautorizar', 'vincular_recurso', 'conectar', 'investigar_coleta', 'recuperar_lacuna'];
const TIPOS_DE_CONTEXTO: readonly TipoDeAcao[] = ['preencher_contexto', 'confirmar_sugestoes', 'resolver_contradicao'];

function primeiroPasso(acoes: readonly AcaoRecomendada[], tipos: readonly TipoDeAcao[]): string | null {
  return ordenarPorPeso(acoes).find((a) => tipos.includes(a.tipo))?.titulo ?? null;
}

export function blocoDeConexoes(entrada: EntradaDoBloco): EstadoDoBloco {
  const proximoPasso = primeiroPasso(entrada.acoes, TIPOS_DE_CONEXOES);
  const { conectores, fontes } = entrada.resumo;
  if (conectores.precisa_reautorizar > 0) return { tom: 'critico', rotulo: 'Reautorizar', proximoPasso };
  if (conectores.conectado === 0 && conectores.conexao_sem_vinculo === 0) return { tom: 'vazio', rotulo: 'Vazio', proximoPasso };
  if (fontes.parado + fontes.atrasado > 0) return { tom: 'atencao', rotulo: 'Atenção', proximoPasso };
  return { tom: 'ok', rotulo: 'Ok', proximoPasso };
}

export function blocoDeContexto(entrada: EntradaDoBloco): EstadoDoBloco {
  const proximoPasso = primeiroPasso(entrada.acoes, TIPOS_DE_CONTEXTO);
  const contexto = entrada.contexto;
  if (!contexto || contexto.geral === 0) return { tom: 'vazio', rotulo: 'Vazio', proximoPasso };
  if (contexto.essenciaisCompletos && contexto.sugestoesPendentes === 0) return { tom: 'ok', rotulo: 'Completo', proximoPasso };
  return { tom: 'atencao', rotulo: 'Parcial', proximoPasso };
}

export type ProntidaoDoCliente = {
  readonly veredito: Veredito;
  readonly lacunas: readonly LacunaDaProntidao[];
  readonly conexoes: EstadoDoBloco;
  readonly contexto: EstadoDoBloco;
  readonly acoes: readonly AcaoRecomendada[];
};

export function prontidaoDoCliente(entrada: {
  readonly capacidades: readonly { readonly status: StatusDaCapacidade }[];
  readonly diagnostico: EntradaDoBloco;
}): ProntidaoDoCliente {
  const { diagnostico } = entrada;
  return {
    veredito: vereditoDeProntidao(entrada.capacidades.map((c) => c.status)),
    lacunas: lacunasDaProntidao(diagnostico.acoes),
    conexoes: blocoDeConexoes(diagnostico),
    contexto: blocoDeContexto(diagnostico),
    acoes: diagnostico.acoes,
  };
}
