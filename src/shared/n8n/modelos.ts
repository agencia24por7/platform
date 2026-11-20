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

export const PASTAS_DE_MODELO = ['n8n/workflows/coletores/', 'n8n/workflows/executores/'];

export const ehModelo = (caminho: string) => PASTAS_DE_MODELO.some((pasta) => caminho.startsWith(pasta));

export const PASTAS_FORA_DA_PLATAFORMA = ['n8n/workflows/clientes/', 'n8n/workflows/agencia/'];

export const ehDaPlataforma = (caminho: string) => !PASTAS_FORA_DA_PLATAFORMA.some((pasta) => caminho.startsWith(pasta));
