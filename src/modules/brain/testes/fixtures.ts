import type { ContextoParaCatalogo } from '../domain/contexto.ts';
import type { InventarioDoCliente } from '../domain/inventario.ts';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const CLIENTE = '22222222-2222-4222-8222-222222222222';
export const OUTRO_CLIENTE = '33333333-3333-4333-8333-333333333333';
export const AGORA = new Date('2026-11-20T15:00:00Z');

export const CONEXAO_META = 'aaaaaaaa-0000-4000-8000-000000000001';
export const CONEXAO_GOOGLE = 'aaaaaaaa-0000-4000-8000-000000000002';
export const CONEXAO_GA4 = 'aaaaaaaa-0000-4000-8000-000000000003';
export const CONEXAO_SC = 'aaaaaaaa-0000-4000-8000-000000000004';
export const FONTE_META = 'bbbbbbbb-0000-4000-8000-000000000001';
export const FONTE_GOOGLE = 'bbbbbbbb-0000-4000-8000-000000000002';
export const FONTE_GA4 = 'bbbbbbbb-0000-4000-8000-000000000003';
export const FONTE_DESVINCULADA = 'bbbbbbbb-0000-4000-8000-000000000004';
export const ARQUIVO = 'cccccccc-0000-4000-8000-000000000001';

export const EMAIL_SENSIVEL = 'contato.pessoal@exemplo.com.br';

export function inventario(): InventarioDoCliente {
  return {
    cliente: {
      id: CLIENTE,
      organizationId: ORG,
      nome: 'Loja Exemplo',
      parentClientId: null,
      status: 'active',
      modeloDeNegocio: 'ecommerce',
      segmento: 'varejo',
    },
    conexoesDaOrganizacao: [
      { id: CONEXAO_META, platform: 'meta', rotulo: 'BM da agência', status: 'active', expiraEm: null, autorizadaEm: new Date('2026-01-01T00:00:00Z') },
      { id: CONEXAO_GOOGLE, platform: 'google', rotulo: 'MCC da agência', status: 'active', expiraEm: null, autorizadaEm: new Date('2026-01-01T00:00:00Z') },
      { id: CONEXAO_GA4, platform: 'ga4', rotulo: 'Google da loja', status: 'reauth_pending', expiraEm: null, autorizadaEm: new Date('2026-01-01T00:00:00Z') },
      { id: CONEXAO_SC, platform: 'searchconsole', rotulo: 'Search Console', status: 'active', expiraEm: null, autorizadaEm: new Date('2026-01-01T00:00:00Z') },
    ],
    fontes: [
      {
        id: FONTE_META, fonteTipo: 'ad_account', platform: 'meta', externalId: 'act_123456', nome: 'Loja Exemplo Ads', estado: 'linked',
        vinculada: true, coletaHabilitada: true, conexaoId: CONEXAO_META, moeda: 'BRL', fuso: 'America/Sao_Paulo',
      },
      {
        id: FONTE_GOOGLE, fonteTipo: 'ad_account', platform: 'google', externalId: '1234567890', nome: 'Loja Exemplo Google', estado: 'linked',
        vinculada: true, coletaHabilitada: true, conexaoId: CONEXAO_GOOGLE, moeda: 'BRL', fuso: 'America/Sao_Paulo',
      },
      {
        id: FONTE_GA4, fonteTipo: 'connection_account', platform: 'ga4', externalId: 'properties/987', nome: 'Site da loja', estado: 'linked',
        vinculada: true, coletaHabilitada: true, conexaoId: CONEXAO_GA4, moeda: 'BRL', fuso: 'America/Sao_Paulo',
      },
      {
        id: FONTE_DESVINCULADA, fonteTipo: 'ad_account', platform: 'google', externalId: '5555555555', nome: 'Conta antiga', estado: 'unlinked',
        vinculada: false, coletaHabilitada: false, conexaoId: CONEXAO_GOOGLE, moeda: 'BRL', fuso: null,
      },
    ],
    coletas: [
      {
        fonteId: FONTE_META,
        janelasOk: [
          { de: '2026-08-01', ate: '2026-09-30' },
          { de: '2026-10-06', ate: '2026-11-12' },
          { de: '2026-11-06', ate: '2026-11-19' },
        ],
        ultimaColetaOkEm: new Date('2026-11-20T09:00:00Z'),
        ultimaTentativaEm: new Date('2026-11-20T09:00:00Z'),
        ultimoStatus: 'success',
        falhasRecentes: {},
        parciaisRecentes: 0,
        avisosRecentes: { limiar_de_privacidade: 2 },
        faltantesRecentes: {},
        pausadaAte: null,
      },
      {
        fonteId: FONTE_GOOGLE,
        janelasOk: [{ de: '2026-09-01', ate: '2026-11-15' }],
        ultimaColetaOkEm: new Date('2026-11-16T09:00:00Z'),
        ultimaTentativaEm: new Date('2026-11-20T09:00:00Z'),
        ultimoStatus: 'failed',
        falhasRecentes: { limite_de_uso: 4 },
        parciaisRecentes: 1,
        avisosRecentes: {},
        faltantesRecentes: {},
        pausadaAte: new Date('2026-11-21T00:00:00Z'),
      },
      {
        fonteId: FONTE_GA4,
        janelasOk: [{ de: '2026-06-01', ate: '2026-10-01' }],
        ultimaColetaOkEm: new Date('2026-10-02T09:00:00Z'),
        ultimaTentativaEm: new Date('2026-11-20T09:00:00Z'),
        ultimoStatus: 'failed',
        falhasRecentes: { falha_coletor: 3 },
        parciaisRecentes: 0,
        avisosRecentes: {},
        faltantesRecentes: { reauth_pending: 2 },
        pausadaAte: null,
      },
    ],
    cobertura: [
      { tabela: 'fato_ads_diario', desde: '2026-01-01', ate: '2026-11-19', linhas: 5000, diasComDado: 320, medidoEm: new Date('2026-11-20T13:00:00Z') },
      { tabela: 'fato_ga4_diario', desde: '2026-01-01', ate: '2026-10-01', linhas: 900, diasComDado: 270, medidoEm: new Date('2026-11-10T13:00:00Z') },
    ],
  };
}

const marcacao = (epistemico: 'fato' | 'hipotese' | 'desejo', revisao: 'confirmado' | 'sugerido' = 'confirmado', fonte = 'equipe') => ({
  epistemico,
  revisao,
  fonte,
  compartilhavel: true,
});

export function contexto(): ContextoParaCatalogo {
  const em = new Date('2026-11-18T10:00:00Z');
  return {
    catalogoVersao: 1,
    catalogo: [
      {
        key: 'empresa',
        titulo: 'Empresa',
        descricao: 'Quem é a empresa e o que ela faz.',
        campos: [
          { key: 'nome_fantasia', rotulo: 'Nome fantasia', ajuda: null, nivel: 'essencial', tipo: 'texto', visivelAoCliente: true, contaNaCompletude: true },
          {
            key: 'segmento', rotulo: 'Segmento', ajuda: 'Ramo principal.', nivel: 'essencial', tipo: 'selecao', visivelAoCliente: true, contaNaCompletude: true,
            opcoes: [{ valor: 'varejo', rotulo: 'Varejo' }, { valor: 'servicos', rotulo: 'Serviços' }],
          },
          {
            key: 'canais_de_venda', rotulo: 'Canais de venda', ajuda: null, nivel: 'aprofundar', tipo: 'multipla', visivelAoCliente: true, contaNaCompletude: true,
            opcoes: [{ valor: 'loja_fisica', rotulo: 'Loja física' }, { valor: 'site', rotulo: 'Site' }],
          },
          { key: 'ticket_medio', rotulo: 'Ticket médio', ajuda: null, nivel: 'aprofundar', tipo: 'dinheiro', visivelAoCliente: true, contaNaCompletude: true },
        ],
      },
      {
        key: 'marca',
        titulo: 'Marca',
        descricao: 'Como a marca se comunica.',
        campos: [
          {
            key: 'tom_de_voz', rotulo: 'Tom de voz', ajuda: null, nivel: 'essencial', tipo: 'selecao', visivelAoCliente: true, contaNaCompletude: true,
            opcoes: [{ valor: 'proximo', rotulo: 'Próximo' }, { valor: 'formal', rotulo: 'Formal' }],
          },
          { key: 'manual_da_marca', rotulo: 'Manual da marca', ajuda: null, nivel: 'aprofundar', tipo: 'arquivo', visivelAoCliente: true, contaNaCompletude: true },
        ],
      },
      {
        key: 'publico',
        titulo: 'Público',
        descricao: 'Para quem a empresa vende.',
        campos: [
          {
            key: 'personas', rotulo: 'Personas', ajuda: 'Perfis de cliente ideal.', nivel: 'essencial', tipo: 'lista', visivelAoCliente: true, contaNaCompletude: true,
            minimo: 2, campoTitulo: 'nome', arquivoBrain: 'personas.jsonl',
            item: [{ key: 'nome', rotulo: 'Nome', ajuda: null, nivel: 'essencial', tipo: 'texto', visivelAoCliente: true, contaNaCompletude: true }],
          },
        ],
      },
      {
        key: 'comercial',
        titulo: 'Comercial',
        descricao: 'Como a empresa vende.',
        campos: [
          {
            key: 'depoimentos', rotulo: 'Depoimentos', ajuda: null, nivel: 'aprofundar', tipo: 'lista', visivelAoCliente: true, contaNaCompletude: true,
            minimo: 1, campoTitulo: 'autor', arquivoBrain: 'depoimentos.jsonl', avisoDeDadoPessoal: 'Pode conter nome de cliente final.',
            item: [{ key: 'autor', rotulo: 'Autor', ajuda: null, nivel: 'aprofundar', tipo: 'texto', visivelAoCliente: true, contaNaCompletude: true }],
          },
        ],
      },
    ],
    campos: {
      nome_fantasia: { ...marcacao('fato'), secao: 'empresa', fieldKey: 'nome_fantasia', valor: `Loja ${EMAIL_SENSIVEL}`, versao: 1, atualizadoEm: em },
      segmento: { ...marcacao('fato'), secao: 'empresa', fieldKey: 'segmento', valor: 'varejo', versao: 1, atualizadoEm: em },
      canais_de_venda: { ...marcacao('fato'), secao: 'empresa', fieldKey: 'canais_de_venda', valor: ['site', 'texto livre da equipe'], versao: 1, atualizadoEm: em },
      ticket_medio: { ...marcacao('fato'), secao: 'empresa', fieldKey: 'ticket_medio', valor: 15990, versao: 1, atualizadoEm: em },
      tom_de_voz: { ...marcacao('hipotese', 'sugerido', 'ia'), secao: 'marca', fieldKey: 'tom_de_voz', valor: 'proximo', versao: 1, atualizadoEm: em },
    },
    listas: {
      personas: [
        { ...marcacao('fato'), id: 'dddddddd-0000-4000-8000-000000000001', secao: 'publico', listKey: 'personas', dados: { nome: 'Ana Compradora' }, versao: 1, atualizadoEm: em },
        { ...marcacao('hipotese'), id: 'dddddddd-0000-4000-8000-000000000002', secao: 'publico', listKey: 'personas', dados: { nome: 'ana compradora' }, versao: 1, atualizadoEm: em },
      ],
      depoimentos: [
        { ...marcacao('fato'), id: 'dddddddd-0000-4000-8000-000000000003', secao: 'comercial', listKey: 'depoimentos', dados: { autor: 'Maria (11) 98765-4321' }, versao: 1, atualizadoEm: em },
      ],
    },
    arquivos: [
      {
        id: ARQUIVO, secao: 'marca', fieldKey: 'manual_da_marca', caminho: `orgs/${ORG}/clientes/${CLIENTE}/arquivos/${ARQUIVO}-manual.pdf`,
        nome: `manual ${EMAIL_SENSIVEL}.pdf`, mime: 'application/pdf', tamanhoBytes: 2_500_000, sha256: 'a'.repeat(64), fonte: 'equipe',
        compartilhavel: true, criadoEm: em,
      },
    ],
    completude: {
      geral: 40,
      essenciaisCompletos: false,
      secoes: [
        { secao: 'empresa', percentual: 75, preenchidos: 3, total: 4, essenciaisPreenchidos: 1, essenciaisTotal: 2, essenciaisCompletos: false },
        { secao: 'marca', percentual: 0, preenchidos: 0, total: 2, essenciaisPreenchidos: 0, essenciaisTotal: 1, essenciaisCompletos: false },
        { secao: 'publico', percentual: 50, preenchidos: 0, total: 1, essenciaisPreenchidos: 0, essenciaisTotal: 1, essenciaisCompletos: false },
        { secao: 'comercial', percentual: 100, preenchidos: 1, total: 1, essenciaisPreenchidos: 0, essenciaisTotal: 0, essenciaisCompletos: true },
      ],
    },
    brain: { exportadoEm: new Date('2026-11-18T11:00:00Z'), hash: 'b'.repeat(64), pendente: false, ultimoErro: null },
  };
}
