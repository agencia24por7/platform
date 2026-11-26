import type { z } from 'zod';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export const CLASSES_DE_FERRAMENTA = ['leitura', 'reversivel_dentro_do_teto', 'irreversivel_ou_gasto_novo'] as const;
export type ClasseDeFerramenta = (typeof CLASSES_DE_FERRAMENTA)[number];

export const CLASSES_LIBERADAS: readonly ClasseDeFerramenta[] = ['leitura'];

export const PADRAO_DO_NOME_DE_FERRAMENTA = /^[a-z][a-z0-9_]{2,63}$/;
const DESCRICAO_MAXIMA = 600;

export type EscopoDoAgente = {
  readonly credencialId: string;
  readonly organizationId: string;
  readonly clienteIds: readonly string[] | null;
  readonly ferramentas: readonly string[];
  readonly requestId: string;
  readonly sourceIp: string | null;
};

export type Ferramenta<E = unknown> = {
  readonly nome: string;
  readonly descricao: string;
  readonly classe: ClasseDeFerramenta;
  readonly entrada: z.ZodType<E>;
  executar(entrada: E, escopo: EscopoDoAgente): Promise<Result<unknown, Failure>>;
};

export type FerramentaRegistrada = Ferramenta<never>;

export type RegistroDeFerramentas = {
  nomes(): readonly string[];
  permitidas(escopo: Pick<EscopoDoAgente, 'ferramentas'>): readonly FerramentaRegistrada[];
};

export function definirFerramenta<E>(ferramenta: Ferramenta<E>): FerramentaRegistrada {
  return ferramenta as unknown as FerramentaRegistrada;
}

export function clienteNoEscopo(escopo: Pick<EscopoDoAgente, 'clienteIds'>, clienteId: string): boolean {
  return escopo.clienteIds === null || escopo.clienteIds.includes(clienteId);
}

function recusa(ferramenta: FerramentaRegistrada): string | null {
  if (!PADRAO_DO_NOME_DE_FERRAMENTA.test(ferramenta.nome)) return 'nome fora do padrão';
  if (ferramenta.descricao.length === 0 || ferramenta.descricao.length > DESCRICAO_MAXIMA) return 'descrição vazia ou longa demais';
  if (!CLASSES_LIBERADAS.includes(ferramenta.classe)) return `classe ${ferramenta.classe} ainda não é liberada (ADR 0057 §4)`;
  return null;
}

export function criarRegistro(ferramentas: readonly FerramentaRegistrada[]): RegistroDeFerramentas {
  const porNome = new Map<string, FerramentaRegistrada>();
  for (const ferramenta of ferramentas) {
    const motivo = recusa(ferramenta);
    if (motivo) throw new Error(`Ferramenta ${ferramenta.nome} recusada pelo registro: ${motivo}.`);
    if (porNome.has(ferramenta.nome)) throw new Error(`Ferramenta ${ferramenta.nome} registrada duas vezes.`);
    porNome.set(ferramenta.nome, ferramenta);
  }
  const ordenadas = [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome));

  return {
    nomes: () => ordenadas.map((ferramenta) => ferramenta.nome),
    permitidas: (escopo) => ordenadas.filter((ferramenta) => escopo.ferramentas.includes(ferramenta.nome)),
  };
}
