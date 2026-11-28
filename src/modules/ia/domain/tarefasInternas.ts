import { z } from 'zod';
import { COMITES } from '../../strategy/domain/comite/comites.ts';
import { definirTarefa, type ClasseDeCapacidade, type Tarefa } from './tarefa.ts';

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

export const JUIZ_DA_ESTRATEGIA = definirTarefa({
  chave: 'juiz',
  classe: 'raciocinio_forte',
  instrucao: 'Julgue com neutralidade cada ponto de mudança dos comitês sobre o plano de marketing recebido como dado: aceite o concreto, provado pelo pacote de leitura e que melhora o resultado; rejeite o vago ou sem prova; não descarte ponto por ser criativo.',
  saida: SAIDA_ESTRUTURADA_DA_ESTRATEGIA,
  orcamento: { passos: 1, tokensDeSaida: 4_500, tempoMs: 60_000 },
  raciocinio: 'low',
});

export const DIRETOR_DE_PRODUCAO = definirTarefa({
  chave: 'diretor_de_producao',
  classe: 'raciocinio_forte',
  instrucao: 'Transforme uma campanha de um plano de marketing autorizado em plano de produção (entregáveis, roteiro, prompts, referências, ferramentas, custos e workflow), usando só o plano e o pacote de leitura recebidos como dado.',
  saida: SAIDA_ESTRUTURADA_DA_ESTRATEGIA,
  orcamento: { passos: 1, tokensDeSaida: 8_000, tempoMs: 115_000 },
  raciocinio: 'low',
});

const COMITES_DE_RACIOCINIO_FORTE: readonly string[] = ['risco_legal', 'marca', 'sparring_criativo', 'cultura', 'producao', 'memoria_e_decisoes'];

export function classeDoComite(chave: string): ClasseDeCapacidade {
  return COMITES_DE_RACIOCINIO_FORTE.includes(chave) ? 'raciocinio_forte' : 'rapido_e_barato';
}

export type TarefaDeComiteInterna = Tarefa<Record<string, unknown>> & { readonly comite: string; readonly titulo: string };

export const TAREFAS_DOS_COMITES: readonly TarefaDeComiteInterna[] = COMITES.map((comite) => ({
  ...definirTarefa({
    chave: comite.tarefa,
    classe: classeDoComite(comite.chave),
    instrucao: `Delibere como membro ou mesa do ${comite.nome} sobre o plano de marketing recebido como dado, citando só fontes do pacote de leitura.`,
    saida: SAIDA_ESTRUTURADA_DA_ESTRATEGIA,
    orcamento: { passos: 1, tokensDeSaida: 5_000, tempoMs: 90_000 },
    raciocinio: 'low',
  }),
  comite: comite.chave,
  titulo: comite.nome.startsWith('Comitê') ? comite.nome : `Comitê ${comite.nome}`,
}));

export const TAREFAS_INTERNAS = [
  { chave: TESTE_DE_MODELO.chave, titulo: 'Teste de modelo', classe: TESTE_DE_MODELO.classe },
  { chave: PLANO_DE_ESTRATEGIA.chave, titulo: 'Estratégia: redação e ajuste do plano, por grupo de seções', classe: PLANO_DE_ESTRATEGIA.classe },
  { chave: COMITE_DA_ESTRATEGIA.chave, titulo: 'Estratégia: parecer de cada persona do Comitê', classe: COMITE_DA_ESTRATEGIA.classe },
  { chave: JUIZ_DA_ESTRATEGIA.chave, titulo: 'Estratégia: juiz das mudanças pedidas pelo Comitê', classe: JUIZ_DA_ESTRATEGIA.classe },
  { chave: GATE_DA_ESTRATEGIA.chave, titulo: 'Estratégia: conferência de qualidade do plano (Gate)', classe: GATE_DA_ESTRATEGIA.classe },
  { chave: DIRETOR_DE_PRODUCAO.chave, titulo: 'Estratégia: plano de produção (Production Director), por campanha', classe: DIRETOR_DE_PRODUCAO.classe },
] as const;

export const TAREFAS_CONFIGURAVEIS: readonly { readonly chave: string; readonly titulo: string; readonly classe: ClasseDeCapacidade; readonly herdaDe?: string }[] = [
  ...TAREFAS_INTERNAS,
  ...TAREFAS_DOS_COMITES.map((tarefa) => ({ chave: tarefa.chave, titulo: tarefa.titulo, classe: tarefa.classe, herdaDe: COMITE_DA_ESTRATEGIA.chave })),
];
