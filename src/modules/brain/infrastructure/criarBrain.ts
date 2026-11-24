import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { criarArmazenamentoDeContexto } from '@/shared/storage/criarArmazenamentoDeContexto';
import { createBrainService, type BrainService } from '../application/brainService.ts';
import { CONECTORES_POSSIVEIS, plataformasDaTabela } from '../dados/registro.ts';
import { DEFINICOES_DE_CAPACIDADES } from '../dados/capacidades.ts';
import { createBrainRepository } from './brainRepository.ts';
import { carregadorDoServicoDeRegras, type ServicoDeRegrasCompativel } from './carregadorDeRegras.ts';
import { carregadorDoServicoDeContexto, type ServicoDeContextoCompativel } from './carregadorDeContexto.ts';
import { createMedidorBigQuery } from './coberturaBigQuery.ts';
import { objetosDeMedicao } from './provedores/dados.ts';
import { PROVEDORES } from './provedores/index.ts';

export const DIAS_DE_MEDICAO = 400;

export function criarBrain(
  audit: AuditRecorder,
  contexto: ServicoDeContextoCompativel | null = null,
  regras: ServicoDeRegrasCompativel | null = null,
): BrainService {
  const config = env();
  return createBrainService({
    repositorio: createBrainRepository(),
    contexto: carregadorDoServicoDeContexto(contexto),
    regras: carregadorDoServicoDeRegras(regras),
    armazenamento: criarArmazenamentoDeContexto(config),
    medidor: createMedidorBigQuery(),
    audit,
    provedores: PROVEDORES,
    capacidades: DEFINICOES_DE_CAPACIDADES,
    conectores: CONECTORES_POSSIVEIS,
    plataformasDaTabela,
    objetosDeMedicao,
    configuracao: {
      conjuntoDeDados: config.BQ_DATASET,
      bytesMaximosPorConsulta: config.BQ_MAXIMO_BYTES_FATURADOS,
      diasDeMedicao: DIAS_DE_MEDICAO,
    },
    registrarAviso: (evento, dados) => logger.warn(evento, dados),
  });
}
