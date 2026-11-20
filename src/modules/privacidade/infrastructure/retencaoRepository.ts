import { sql } from '@/shared/db/client';

export type ResumoDaRetencao = Readonly<Record<string, number>>;

export type RetencaoRepository = {
  aplicar(): Promise<ResumoDaRetencao>;
};

export function createRetencaoRepository(): RetencaoRepository {
  return {
    async aplicar() {
      const rows = (await sql()`SELECT core.aplicar_retencao() AS resumo`) as unknown as {
        resumo: ResumoDaRetencao;
      }[];
      return rows[0]!.resumo;
    },
  };
}
