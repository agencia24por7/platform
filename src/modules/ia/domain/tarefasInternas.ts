import { z } from 'zod';
import { definirTarefa } from './tarefa.ts';

export const TESTE_DE_MODELO = definirTarefa({
  chave: 'teste_de_modelo',
  classe: 'rapido_e_barato',
  instrucao: 'Confirme que está funcionando: devolva funcionando igual a true e uma saudação curta em português, de até dez palavras.',
  saida: z.object({ funcionando: z.boolean(), saudacao: z.string().max(200) }),
  orcamento: { passos: 1, tokensDeSaida: 200, tempoMs: 30_000 },
});

export const TAREFAS_INTERNAS = [
  { chave: TESTE_DE_MODELO.chave, titulo: 'Teste de modelo', classe: TESTE_DE_MODELO.classe },
] as const;
