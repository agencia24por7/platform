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

const TIPOS_QUE_BLOQUEIAM: readonly TipoDeAcao[] = ['reautorizar', 'vincular_recurso', 'conectar', 'investigar_coleta', 'preencher_contexto'];

export function lacunasDaProntidao(acoes: readonly AcaoRecomendada[], limite: number = LIMITE_DE_LACUNAS): readonly LacunaDaProntidao[] {
  return ordenarPorPeso(acoes)
    .filter((a) => TIPOS_QUE_BLOQUEIAM.includes(a.tipo))
    .slice(0, limite)
    .map((a) => ({ id: a.id, titulo: a.titulo, impacto: a.impacto }));
}

export type AcaoPrincipal = { readonly id: string; readonly titulo: string; readonly rotulo: string; readonly href: string; readonly ehConexao: boolean };

export type OpcoesDaAcaoPrincipal = {
  readonly podeEditar: boolean;
  readonly organizacaoInteira: boolean;
  readonly tipo?: OrganizationType;
};

const TIPOS_DE_CONTEXTO_DA_ACAO: readonly TipoDeAcao[] = ['preencher_contexto', 'confirmar_sugestoes', 'resolver_contradicao'];

export function acaoPrincipal(acoes: readonly AcaoRecomendada[], clienteId: string, opcoes: OpcoesDaAcaoPrincipal): AcaoPrincipal | null {
  if (!opcoes.podeEditar) return null;
  const elegiveis = opcoes.organizacaoInteira ? acoes : acoes.filter((a) => TIPOS_DE_CONTEXTO_DA_ACAO.includes(a.tipo));
  const primeira = ordenarPorPeso(elegiveis)[0];
  if (!primeira) return null;
  const vocabulario = vocabularioDe(opcoes.tipo ?? 'agency');
  const visao = acaoDaVisao(primeira, clienteId);
  if (primeira.tipo === 'preencher_contexto') {
    const href = vocabulario.enviarMapaNoPerfil && opcoes.organizacaoInteira ? rotaDoCliente(clienteId, 'conexoes', { enviar: 'contexto' }) : visao.href;
    const rotulo = opcoes.organizacaoInteira ? vocabulario.rotuloDaAcaoDeContexto : 'Preencher contexto';
    return { id: primeira.id, titulo: primeira.titulo, rotulo, href, ehConexao: false };
  }
  const ehConexao = primeira.tipo === 'conectar' || primeira.tipo === 'vincular_recurso';
  if (primeira.tipo === 'reautorizar') {
    const href = primeira.alvo ? `/integracoes/${primeira.alvo}` : visao.href;
    return { id: primeira.id, titulo: visao.titulo, rotulo: visao.titulo, href, ehConexao: false };
  }
  if (ehConexao) {
    const especifico = primeira.tipo === 'conectar' ? visao.titulo : 'Vincular';
    const rotulo = vocabulario.enviarMapaNoPerfil ? especifico : vocabulario.rotuloDaAcaoDeConexao;
    return { id: primeira.id, titulo: visao.titulo, rotulo, href: visao.href, ehConexao: true };
  }
  return { id: primeira.id, titulo: visao.titulo, rotulo: visao.rotulo, href: visao.href, ehConexao: false };
}

export type ConexaoDoCliente = {
  readonly id: string;
  readonly platform: string;
  readonly rotulo: string;
  readonly precisaReautorizar: boolean;
  readonly fontesDoCliente: number;
};

export function acoesDeReautorizacaoDoCliente(conexoes: readonly ConexaoDoCliente[]): readonly AcaoRecomendada[] {
  const porPlataforma = new Map<string, { conexao: ConexaoDoCliente; fontes: number }>();
  for (const conexao of conexoes) {
    if (!conexao.precisaReautorizar || conexao.fontesDoCliente === 0) continue;
    const atual = porPlataforma.get(conexao.platform);
    const fontes = (atual?.fontes ?? 0) + conexao.fontesDoCliente;
    const representante = !atual || conexao.fontesDoCliente > atual.conexao.fontesDoCliente ? conexao : atual.conexao;
    porPlataforma.set(conexao.platform, { conexao: representante, fontes });
  }
  return [...porPlataforma.entries()].map(([plataforma, { conexao, fontes }]) => ({
    id: `reautorizar:${plataforma}`,
    tipo: 'reautorizar' as const,
    impacto: 100 + Math.min(fontes, 99) / 100,
    titulo: `Reautorizar ${conexao.rotulo}`,
    motivo: 'A autorização expirou ou foi revogada: a coleta parou para as fontes desta conexão.',
    alvo: conexao.id,
  }));
}

export function acoesComConexoesDoCliente(acoes: readonly AcaoRecomendada[], conexoes: readonly ConexaoDoCliente[]): readonly AcaoRecomendada[] {
  return [...acoes.filter((a) => a.tipo !== 'reautorizar'), ...acoesDeReautorizacaoDoCliente(conexoes)];
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
  if (entrada.acoes.some((a) => a.tipo === 'reautorizar')) return { tom: 'critico', rotulo: 'Reautorizar', proximoPasso };
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
  const base = vereditoDeProntidao(entrada.capacidades.map((c) => c.status));
  const veredito: Veredito = base === 'sim' && diagnostico.acoes.some((a) => a.tipo === 'reautorizar') ? 'parcial' : base;
  return {
    veredito,
    lacunas: lacunasDaProntidao(diagnostico.acoes),
    conexoes: blocoDeConexoes(diagnostico),
    contexto: blocoDeContexto(diagnostico),
    acoes: diagnostico.acoes,
  };
}
