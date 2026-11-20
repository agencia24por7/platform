import { criarArmazenamentoGcs } from './armazenamentoGcs.ts';
import { criarArmazenamentoNulo } from './armazenamentoNulo.ts';
import type { ArmazenamentoDeContexto } from './tipos.ts';

export type AmbienteDoArmazenamento = {
  CONTEXT_BUCKET?: string | undefined;
};

export function criarArmazenamentoDeContexto(
  env: AmbienteDoArmazenamento,
  fabricaGcs: (bucket: string) => ArmazenamentoDeContexto = criarArmazenamentoGcs,
): ArmazenamentoDeContexto {
  const bucket = env.CONTEXT_BUCKET?.trim();
  return bucket ? fabricaGcs(bucket) : criarArmazenamentoNulo();
}
