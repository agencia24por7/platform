import { sql } from '@/shared/db/client';
import {
  DIAS_ATE_O_ALERTA_SAIR_DA_CONTAGEM,
  DIAS_DE_RETENCAO_DO_ALERTA,
  JANELA_DE_DEDUPLICACAO_EM_MINUTOS,
  type AlertaLimpo,
} from '@/modules/alertas/domain/alerta';

export type ResultadoDoRegistro = { readonly id: string; readonly deduplicado: boolean };

export type AlertaRepository = {
  registrar(alerta: AlertaLimpo): Promise<ResultadoDoRegistro>;
  contarAbertos(): Promise<number>;
  resolverAbertos(): Promise<number>;
  expurgarAntigos(): Promise<number>;
};

type LinhaDoRegistro = { atualizado_id: string | null; inserido_id: string | null };

export function createAlertaRepository(): AlertaRepository {
  return {
    async registrar(alerta) {
      const linhas = (await sql()`
        WITH atualizado AS (
          UPDATE automation.alertas
             SET ocorrencias = ocorrencias + 1, ultima_em = now()
           WHERE assinatura = ${alerta.assinatura}
             AND resolvido_em IS NULL
             AND ultima_em > now() - make_interval(mins => ${JANELA_DE_DEDUPLICACAO_EM_MINUTOS})
          RETURNING id
        ),
        inserido AS (
          INSERT INTO automation.alertas (workflow_id, workflow_nome, no, mensagem, assinatura)
          SELECT ${alerta.workflowId}, ${alerta.workflowNome}, ${alerta.no}, ${alerta.mensagem}, ${alerta.assinatura}
           WHERE NOT EXISTS (SELECT 1 FROM atualizado)
          RETURNING id
        )
        SELECT (SELECT id FROM atualizado LIMIT 1) AS atualizado_id, (SELECT id FROM inserido LIMIT 1) AS inserido_id
      `) as unknown as LinhaDoRegistro[];
      const linha = linhas[0]!;
      return { id: (linha.inserido_id ?? linha.atualizado_id)!, deduplicado: linha.inserido_id === null };
    },

    async contarAbertos() {
      const linhas = (await sql()`
        SELECT count(*)::int AS total
          FROM automation.alertas
         WHERE resolvido_em IS NULL
           AND ultima_em > now() - make_interval(days => ${DIAS_ATE_O_ALERTA_SAIR_DA_CONTAGEM})
      `) as unknown as { total: number }[];
      return linhas[0]!.total;
    },

    async resolverAbertos() {
      const resolvidos = await sql()`UPDATE automation.alertas SET resolvido_em = now() WHERE resolvido_em IS NULL`;
      return resolvidos.count;
    },

    async expurgarAntigos() {
      const apagados = await sql()`
        DELETE FROM automation.alertas WHERE ultima_em < now() - make_interval(days => ${DIAS_DE_RETENCAO_DO_ALERTA})
      `;
      return apagados.count;
    },
  };
}
