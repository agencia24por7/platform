export const PASTA_DOS_WORKFLOWS = 'n8n/workflows';

export const PASTA_DOS_COLETORES = 'n8n/workflows/coletores/';
export const PASTA_DOS_EXECUTORES = 'n8n/workflows/executores/';

export const COLETOR_DA_PLATAFORMA: Readonly<Record<string, string>> = {
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

export const EXECUTOR_DA_PLATAFORMA: Readonly<Record<string, string>> = {
  google: 'n8n/workflows/executores/executor-mcc.json',
  meta: 'n8n/workflows/executores/executor-meta-partner.json',
};

export const ROTULO_DO_WORKFLOW_DA_PLATAFORMA: Readonly<Record<string, string>> = {
  google: 'Google Ads',
  meta: 'Meta Ads',
  ga4: 'Google Analytics',
  searchconsole: 'Search Console',
  youtube: 'YouTube',
  gbp: 'Google Minha Empresa',
  gtm: 'Google Tag Manager',
  rdstation: 'RD Station CRM',
  pixel: 'Meta Pixel',
  leadads: 'Meta Lead Ads',
};

export const nomeDoColetor = (platform: string) => `ORLA · ${ROTULO_DO_WORKFLOW_DA_PLATAFORMA[platform]} · coletor`;
export const nomeDoExecutor = (platform: string) => `ORLA · ${ROTULO_DO_WORKFLOW_DA_PLATAFORMA[platform]} · executor`;

export const ROTA_DO_TOKEN = 'http://app:3000/api/v0/coleta/token';
export const CREDENCIAL_DO_WORKER = 'ORLA · worker token';

export const WORKFLOW_DE_CONFORMIDADE_DO_YOUTUBE = 'n8n/workflows/plataforma/youtube-conformidade-diaria.json';
export const WORKFLOW_DE_RENOVACAO_DE_TOKENS = 'n8n/workflows/plataforma/tokens-renovacao.json';
export const ARQUIVO_DO_ALERTA_DA_PLATAFORMA = 'n8n/workflows/plataforma/alertas-de-falha.json';

export const WORKFLOWS_DA_PLATAFORMA = [
  'n8n/workflows/plataforma/retencao-diaria.json',
  'n8n/workflows/plataforma/dimensoes-diarias.json',
  'n8n/workflows/plataforma/contexto-brain-diario.json',
  WORKFLOW_DE_CONFORMIDADE_DO_YOUTUBE,
  WORKFLOW_DE_RENOVACAO_DE_TOKENS,
] as const;

export const ehSubWorkflowGenerico = (caminho: string) =>
  caminho.startsWith(PASTA_DOS_COLETORES) || caminho.startsWith(PASTA_DOS_EXECUTORES);

export function ordemDeImplantacao(caminho: string): number {
  if (caminho === ARQUIVO_DO_ALERTA_DA_PLATAFORMA) return 0;
  if (ehSubWorkflowGenerico(caminho)) return 1;
  if (caminho === 'n8n/workflows/coleta-backfill-janela.json') return 2;
  return 3;
}

export const PASTAS_FORA_DA_PLATAFORMA = ['n8n/workflows/clientes/', 'n8n/workflows/agencia/'];

export const ehDaPlataforma = (caminho: string) => !PASTAS_FORA_DA_PLATAFORMA.some((pasta) => caminho.startsWith(pasta));
