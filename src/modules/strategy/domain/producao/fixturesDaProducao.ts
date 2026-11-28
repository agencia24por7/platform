import { hashDeTeste, pacoteDeTeste, urnDeTeste, URN_BENCHMARK_B, URN_DESEMPENHO } from '../fixturesDeTeste.ts';
import type { PacoteDeLeitura } from '../pacote.ts';
import type { ProducaoDaCampanha } from './planoDeProducao.ts';

export const URN_REFERENCIA = urnDeTeste('culture_referencia', 'ref-campanha');
export const URN_ANTI_REFERENCIA = urnDeTeste('culture_anti_referencia', 'anti-ref');
export const JANELA_DE_TESTE = { inicio: '2026-12-01', fim: '2027-02-28' };

export function pacoteDaProducao(): PacoteDeLeitura {
  const base = pacoteDeTeste();
  return {
    ...base,
    entradas: [
      ...base.entradas,
      { urn: URN_REFERENCIA, hash: hashDeTeste(91), tipo: 'culture_referencia', titulo: 'Campanha de referência do setor', resumo: 'Formato de depoimento curto.', somenteMetadados: false, evidencia: { nota: 'B', categoria: 'benchmark' } },
      { urn: URN_ANTI_REFERENCIA, hash: hashDeTeste(92), tipo: 'culture_anti_referencia', titulo: 'Humor apelativo', resumo: 'Evitar piada com o produto.', somenteMetadados: false, evidencia: { nota: 'C', categoria: 'benchmark' } },
    ],
  };
}

export function producaoDaBusca(): ProducaoDaCampanha {
  return {
    campanha_id: 'cp_busca',
    conceito: 'Entrega rápida como prova de qualidade para quem já pesquisa.',
    entregaveis: [
      {
        id: 'rsa_principal',
        nome: 'Anúncio responsivo principal',
        tipo: 'copy',
        especificacao: { origem: 'catalogo', campos: ['ad_headlines', 'ad_descriptions'] },
        proporcao: null,
        duracao_segundos: null,
        textos: [
          { campo: 'ad_headlines', texto: 'Orçamento sem compromisso' },
          { campo: 'ad_headlines', texto: 'Entrega rápida na região' },
          { campo: 'ad_headlines', texto: 'Qualidade que chega cedo' },
          { campo: 'ad_descriptions', texto: 'Peça seu orçamento hoje e receba a resposta no mesmo dia.' },
          { campo: 'ad_descriptions', texto: 'Qualidade com entrega rápida para toda a região.' },
        ],
        roteiro: [],
        prompts: [{ tipo: 'copy', prompt: 'Escreva variações de título até 30 caracteres no tom direto e acolhedor, sem prometer preço.' }],
        referencias: [
          { urn: URN_REFERENCIA, uso: 'inspiracao', motivo: 'Mesmo formato direto.' },
          { urn: URN_ANTI_REFERENCIA, uso: 'evitar', motivo: 'O plano não usa humor.' },
        ],
        justificativa: 'Busca converte mais que social no histórico.',
        evidencias: [{ urn: URN_DESEMPENHO, papel: 'favor' }],
        hipotese: false,
      },
    ],
    ferramentas: [{ categoria: 'copy', papel: 'redator', ferramenta: 'Editor de texto com contagem de caracteres', justificativa: 'Garante o limite do catálogo.' }],
    custos: [
      { id: 'c_redacao', descricao: 'Redação dos anúncios', entregavel_ids: ['rsa_principal'], valor: { origem: 'verba_da_campanha', valor: { centavos: '50000', moeda: 'BRL' } }, justificativa: 'Fatia pequena da verba da campanha.' },
    ],
    workflow: [
      { id: 'w_redacao', etapa: 'Redigir títulos e descrições', papel: 'redator', entregavel_ids: ['rsa_principal'], inicio: '2026-12-01', fim: '2026-12-03', depende_de: [] },
      { id: 'w_revisao', etapa: 'Revisão legal', papel: 'revisor_legal', entregavel_ids: ['rsa_principal'], inicio: '2026-12-04', fim: '2026-12-05', depende_de: ['w_redacao'] },
    ],
    lacunas: [],
  };
}

export function producaoDoSocial(): ProducaoDaCampanha {
  return {
    campanha_id: 'cp_social',
    conceito: 'Guia de compras como serviço para empresas.',
    entregaveis: [
      {
        id: 'video_guia',
        nome: 'Vídeo do guia',
        tipo: 'video',
        especificacao: { origem: 'catalogo', campos: ['creative_video_id'] },
        proporcao: null,
        duracao_segundos: 15,
        textos: [],
        roteiro: [{ ordem: 1, cena: 'Abertura com o guia na mão.', texto_em_tela: 'Guia de compras', audio: null, duracao_segundos: 5 }],
        prompts: [{ tipo: 'video', prompt: 'Vídeo curto de 15 segundos mostrando o guia de compras.' }],
        referencias: [],
        justificativa: 'Hipótese de que vídeo curto gera lembrança.',
        evidencias: [{ urn: URN_BENCHMARK_B, papel: 'premissa' }],
        hipotese: true,
      },
    ],
    ferramentas: [],
    custos: [{ id: 'c_video', descricao: 'Produção do vídeo', entregavel_ids: ['video_guia'], valor: { origem: 'a_confirmar', motivo: 'Sem orçamento de produção no plano.' }, justificativa: 'Depende de cotação.' }],
    workflow: [{ id: 'w_video', etapa: 'Gravar e editar', papel: 'editor_de_video', entregavel_ids: ['video_guia'], inicio: '2026-12-01', fim: '2026-12-10', depende_de: [] }],
    lacunas: [{ id: 'l_custo', descricao: 'Custo de produção do vídeo não está no plano.', impacto: 'Custo fica a confirmar.' }],
  };
}
