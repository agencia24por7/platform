import type { SecaoDoPlano } from '../domain/plano.ts';

export const TITULO_DA_SECAO: Readonly<Record<SecaoDoPlano, string>> = {
  resumo_executivo: 'Resumo executivo',
  intencao: 'Intenção',
  diagnostico: 'Diagnóstico',
  publico_alvo: 'Público-alvo',
  comunidades_alvo: 'Comunidades alvo',
  posicionamento_e_mensagem: 'Posicionamento e mensagem',
  estrategia: 'Estratégia',
  canais_e_plataformas: 'Canais e plataformas',
  campanhas: 'Campanhas',
  orcamento: 'Orçamento',
  metas_e_metricas: 'Metas e métricas',
  medicao: 'Medição',
  calendario: 'Calendário',
  plano_de_midia: 'Plano de mídia',
  riscos_e_regras: 'Riscos e regras',
  lacunas: 'Lacunas',
};

export const TITULO_DA_SECAO_DE_MIDIA: Readonly<Record<string, string>> = {
  objetivo: 'Objetivo',
  publico: 'Público',
  orcamento_e_lances: 'Orçamento e lances',
  programacao: 'Programação',
  posicionamentos: 'Posicionamentos',
  conversao: 'Conversão',
  copy: 'Textos',
  testes_ab: 'Testes A/B',
  metas: 'Metas',
};


export const ROTULO_DA_PLATAFORMA_DO_PLANO: Readonly<Record<string, string>> = {
  google: 'Google',
  meta: 'Meta',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  microsoft: 'Microsoft',
  x: 'X',
  pinterest: 'Pinterest',
  kwai: 'Kwai',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  rd_station: 'RD Station',
  outra: 'Outra',
};


export const ROTULO_DA_OUSADIA: Readonly<Record<string, string>> = { conservador: 'Conservador', moderado: 'Moderado', ousado: 'Ousado' };
export const ROTULO_DO_PAPEL_DA_EVIDENCIA: Readonly<Record<string, string>> = { favor: 'a favor', contra: 'contra', premissa: 'premissa' };

export const ROTULO_DA_CHECAGEM: Readonly<Record<string, string>> = {
  urns_no_pacote: 'Toda afirmação cita uma fonte do contexto do cliente',
  evidencia_vigente: 'Nenhuma evidência vencida',
  meta_sem_nota_d: 'Nenhuma meta sustentada só por nota D',
  limites_do_cliente: 'Limites e regras do cliente respeitados',
  nao_faremos: 'O que "não faremos" foi respeitado',
  regra_legal_presente: 'Regra legal aplicável presente',
  secoes_obrigatorias: 'Seções obrigatórias preenchidas',
  orcamento_fecha: 'A verba fecha com a soma das campanhas',
  foco_verba_por_produto: 'A verba por produto fecha com o total',
  foco_alinhamento: 'As campanhas seguem o foco do plano',
  objetivo_com_metrica: 'Todo objetivo tem métrica e forma de medir',
  comite_completo: 'Revisão do plano completa e todos os pontos respondidos',
  nao_faremos_preservado: 'O que "não faremos" da versão base foi mantido',
};

export const ROTULO_DA_MEDIDA: Readonly<Record<string, string>> = {
  gasto: 'Gasto',
  custo_por_aquisicao: 'Custo por aquisição',
  custo_por_lead: 'Custo por lead',
  retorno: 'Retorno',
};

export const ROTULO_DA_NOTA: Readonly<Record<string, string>> = {
  A: 'Nota A: fonte primária',
  B: 'Nota B: pesquisa com método',
  C: 'Nota C: dado de fornecedor',
  D: 'Nota D: não verificável',
};

export const ROTULO_DA_ETAPA: Readonly<Record<string, string>> = {
  ler_brain: 'Lendo o contexto do cliente',
  redigir: 'Redigindo o plano',
  comite: 'Revisando o plano',
  ajustar: 'Ajustando o plano',
  gates: 'Conferindo o plano',
};

export const ROTULO_DO_MOTIVO_DE_IMPACTO: Readonly<Record<string, string>> = {
  entrada_removida: 'Entrada removida do Brain',
  hash_mudou: 'Conteúdo da entrada mudou',
  evidencia_vencida: 'Evidência vencida',
  limite_ou_regra_mudou: 'Limite ou regra mudou',
  limite_ou_regra_novo: 'Limite ou regra nova',
  entrada_nova_relevante: 'Entrada nova relevante',
};

export const ROTULO_DO_TIPO_DE_ENTRADA: Readonly<Record<string, string>> = {
  decisao: 'decisão',
  contexto_secao: 'seção de contexto',
  contexto_lista: 'lista de contexto',
};

export function nomeDoCampo(chave: string): string {
  return chave.replace(/_/g, ' ');
}
