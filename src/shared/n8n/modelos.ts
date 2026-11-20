export const PASTA_DOS_WORKFLOWS = 'n8n/workflows';

export const MODELO_DE_COLETOR: Readonly<Record<string, string>> = {
  google: 'n8n/workflows/coletores/coletor-google-ads.json',
  meta: 'n8n/workflows/coletores/coletor-meta-insights.json',
  ga4: 'n8n/workflows/coletores/coletor-ga4.json',
  searchconsole: 'n8n/workflows/coletores/coletor-searchconsole.json',
  youtube: 'n8n/workflows/coletores/coletor-youtube.json',
  gbp: 'n8n/workflows/coletores/coletor-gbp.json',
  gtm: 'n8n/workflows/coletores/coletor-gtm.json',
  rdstation: 'n8n/workflows/coletores/coletor-rdstation.json',
  pixel: 'n8n/workflows/coletores/coletor-meta-dataset.json',
  leadads: 'n8n/workflows/coletores/coletor-meta-formularios.json',
};

export const MODELO_DE_EXECUTOR: Readonly<Record<string, string>> = {
  google: 'n8n/workflows/executores/executor-mcc.json',
  meta: 'n8n/workflows/executores/executor-meta-partner.json',
};

export const PASTA_DE_REVOGACAO = 'n8n/workflows/plataforma/revogacao/';

export const MODELO_DE_REVOGACAO: Readonly<Record<string, string>> = {
  google: `${PASTA_DE_REVOGACAO}revogar-google.json`,
  meta: `${PASTA_DE_REVOGACAO}revogar-meta.json`,
};

export const WORKFLOW_DE_REVOGACAO = 'n8n/workflows/plataforma/revogar-acesso.json';
export const WEBHOOK_DE_REVOGACAO = 'orla-revogar-acesso';
export const WEBHOOK_DO_PORTADOR_DO_GOOGLE = 'orla-revogar-google-portador';
export const WORKFLOW_DE_CONFORMIDADE_DO_YOUTUBE = 'n8n/workflows/plataforma/youtube-conformidade-diaria.json';

export const PASTAS_DE_MODELO = ['n8n/workflows/coletores/', 'n8n/workflows/executores/', PASTA_DE_REVOGACAO];

export const ehModelo = (caminho: string) => PASTAS_DE_MODELO.some((pasta) => caminho.startsWith(pasta));

export const PASTAS_FORA_DA_PLATAFORMA = ['n8n/workflows/clientes/', 'n8n/workflows/agencia/'];

export const ehDaPlataforma = (caminho: string) => !PASTAS_FORA_DA_PLATAFORMA.some((pasta) => caminho.startsWith(pasta));
