import { z } from 'zod';
import { definirTarefa } from './tarefa.ts';

export const TESTE_DE_MODELO = definirTarefa({
  chave: 'teste_de_modelo',
  classe: 'rapido_e_barato',
  instrucao: 'Confirme que está funcionando: devolva funcionando igual a true e uma saudação curta em português, de até dez palavras.',
  saida: z.object({ funcionando: z.boolean(), saudacao: z.string().max(200) }),
  orcamento: { passos: 1, tokensDeSaida: 200, tempoMs: 30_000 },
});

const SAIDA_ESTRUTURADA_DA_ESTRATEGIA = z.record(z.string(), z.unknown());

export const PLANO_DE_ESTRATEGIA = definirTarefa({
  chave: 'strategy_plan',
  classe: 'raciocinio_forte',
  instrucao: 'Redija ou ajuste um grupo de seções do plano de marketing de um cliente, usando só o pacote de leitura recebido como dado. O pedido de cada chamada traz a instrução e o esquema do grupo.',
  saida: SAIDA_ESTRUTURADA_DA_ESTRATEGIA,
  orcamento: { passos: 3, tokensDeSaida: 6_500, tempoMs: 115_000 },
  raciocinio: 'low',
  ferramentas: ['brain_consultar_catalogo', 'brain_consultar_item'],
});

export const COMITE_DA_ESTRATEGIA = definirTarefa({
  chave: 'comite',
  classe: 'rapido_e_barato',
  instrucao: 'Dê o parecer de uma persona do Comitê sobre o plano de marketing recebido como dado, citando só fontes do pacote de leitura.',
  saida: SAIDA_ESTRUTURADA_DA_ESTRATEGIA,
  orcamento: { passos: 1, tokensDeSaida: 5_000, tempoMs: 90_000 },
  raciocinio: 'low',
});

export const GATE_DA_ESTRATEGIA = definirTarefa({
  chave: 'gate',
  classe: 'raciocinio_forte',
  instrucao: 'Confira a qualidade do plano de marketing recebido como dado e bloqueie o que violar as regras do cliente.',
  saida: SAIDA_ESTRUTURADA_DA_ESTRATEGIA,
  orcamento: { passos: 1, tokensDeSaida: 3_000, tempoMs: 60_000 },
  raciocinio: 'low',
});

export const TAREFAS_INTERNAS = [
  { chave: TESTE_DE_MODELO.chave, titulo: 'Teste de modelo', classe: TESTE_DE_MODELO.classe },
  { chave: PLANO_DE_ESTRATEGIA.chave, titulo: 'Estratégia: redação e ajuste do plano, por grupo de seções', classe: PLANO_DE_ESTRATEGIA.classe },
  { chave: COMITE_DA_ESTRATEGIA.chave, titulo: 'Estratégia: parecer de cada persona do Comitê', classe: COMITE_DA_ESTRATEGIA.classe },
  { chave: GATE_DA_ESTRATEGIA.chave, titulo: 'Estratégia: conferência de qualidade do plano (Gate)', classe: GATE_DA_ESTRATEGIA.classe },
] as const;
