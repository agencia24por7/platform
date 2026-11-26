import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PADRAO_DO_NOME_DE_FERRAMENTA } from './ferramenta.ts';

export const PREFIXO_DA_CREDENCIAL = 'orla_ag_';
const BYTES_DO_SEGREDO = 32;
const PADRAO_DA_CREDENCIAL = /^orla_ag_[A-Za-z0-9_-]{43}$/;

export const VALIDADE_MAXIMA_EM_DIAS = 90;
export const VALIDADE_PADRAO_EM_DIAS = 30;
export const MAXIMO_DE_CLIENTES_POR_CREDENCIAL = 200;
export const MAXIMO_DE_CREDENCIAIS_VIVAS = 20;
const DIA_EM_MS = 86_400_000;

export function gerarCredencial(): string {
  return `${PREFIXO_DA_CREDENCIAL}${randomBytes(BYTES_DO_SEGREDO).toString('base64url')}`;
}

export function formatoDeCredencial(candidata: string): boolean {
  return PADRAO_DA_CREDENCIAL.test(candidata);
}

export function hashDaCredencial(credencial: string): string {
  return createHash('sha256').update(credencial, 'utf8').digest('hex');
}

export function rotuloDaCredencial(credencial: string): string {
  return `${PREFIXO_DA_CREDENCIAL}••••${credencial.slice(-4)}`;
}

export function venceEm(criadaEm: Date, validadeEmDias: number): Date {
  return new Date(criadaEm.getTime() + validadeEmDias * DIA_EM_MS);
}

export const pedidoDeCredencial = z
  .object({
    nome: z.string().trim().min(1).max(80),
    clienteIds: z.array(z.uuid()).min(1).max(MAXIMO_DE_CLIENTES_POR_CREDENCIAL).nullable(),
    ferramentas: z.array(z.string().regex(PADRAO_DO_NOME_DE_FERRAMENTA)).min(1).max(50),
    validadeEmDias: z.number().int().min(1).max(VALIDADE_MAXIMA_EM_DIAS),
  })
  .strict();

export type PedidoDeCredencial = z.infer<typeof pedidoDeCredencial>;

export type CredencialDeAgente = {
  readonly id: string;
  readonly organizationId: string;
  readonly nome: string;
  readonly rotulo: string;
  readonly clienteIds: readonly string[] | null;
  readonly ferramentas: readonly string[];
  readonly venceEm: Date;
  readonly revogadaEm: Date | null;
  readonly criadaEm: Date;
  readonly ultimoUsoEm: Date | null;
};

export type SituacaoDaCredencial = 'ativa' | 'vencida' | 'revogada';

export function situacaoDaCredencial(credencial: Pick<CredencialDeAgente, 'venceEm' | 'revogadaEm'>, agora: Date): SituacaoDaCredencial {
  if (credencial.revogadaEm) return 'revogada';
  return credencial.venceEm.getTime() > agora.getTime() ? 'ativa' : 'vencida';
}
