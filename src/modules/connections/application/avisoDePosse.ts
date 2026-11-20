import { logger } from '@/shared/logging/logger';

export type AvisoDePosse = {
  posseMudou(motivo: string): void;
};

export const semAvisoDePosse: AvisoDePosse = { posseMudou: () => undefined };

export function avisarMudancaDePosse(aviso: AvisoDePosse, motivo: string): void {
  try {
    aviso.posseMudou(motivo);
  } catch (error) {
    logger.error('conexoes.aviso_de_posse.erro', { motivo, error: error instanceof Error ? error.message : 'desconhecido' });
  }
}
