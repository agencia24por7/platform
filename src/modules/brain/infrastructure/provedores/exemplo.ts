import { SAUDE_OK, type ProvedorDeCatalogo } from '../../domain/provedor.ts';

export const provedorDeExemplo: ProvedorDeCatalogo = {
  id: 'exemplo',
  versao: 1,
  descricao: 'Fonte de exemplo: prova que uma fonte nova entra no catálogo com um arquivo e uma linha no registro.',
  fase: 'primaria',
  tiposDeclarados: ['planilha_externa'],
  descobrir(ctx) {
    return [
      {
        urn: ctx.urn('planilha_externa', 'metas-2026'),
        tipo: 'planilha_externa',
        id: 'metas-2026',
        titulo: 'Planilha de metas 2026',
        descricao: 'Metas mensais de leads e investimento combinadas com o cliente. Responde se o mês está dentro da meta.',
        provedor: 'exemplo',
        plataforma: null,
        referencia: { sistema: 'planilha', local: 'exemplo://metas-2026' },
        esquema: {
          colunas: [
            { nome: 'mes', tipo: 'DATE', significado: 'Mês da meta.', unidade: 'data', anulavel: false },
            { nome: 'meta_leads', tipo: 'INT64', significado: 'Leads esperados no mês.', unidade: 'leads', anulavel: false },
          ],
        },
        grao: ['mes'],
        cobertura: null,
        frescor: null,
        qualidade: { completude: 1, avisos: [] },
        acesso: { tipo: 'externo', sistema: 'planilha', instrucoes: 'Ler pela integração de planilhas quando existir.' },
        sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'Enquanto o cliente existir.' },
        epistemico: { marca: 'desejo', fonte: 'equipe', revisao: 'confirmado', sugestoesPendentes: 0 },
        valorResumido: null,
        tags: ['exemplo', 'metas'],
        relacoes: [],
        versao: 1,
      },
    ];
  },
  saude: () => SAUDE_OK,
};
