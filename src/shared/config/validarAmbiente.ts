import { problemasDoAmbiente } from './env.ts';

type Fonte = Record<string, string | undefined>;

export interface ResultadoDaValidacao {
  readonly erros: readonly string[];
  readonly avisos: readonly string[];
}

const OBRIGATORIAS_DA_RELEASE: ReadonlyArray<readonly [string, string]> = [
  ['DATABASE_URL_WORKER', 'obrigatória em produção (papel orla_worker, ADR 0028); o completar-env.sh deriva do DATABASE_URL'],
  ['TOKENS_KMS_KEY', 'obrigatória: sem ela o cofre de tokens falha fechado e o corte deixa toda conexão sem reautorização (ADR 0032)'],
  ['CONTEXT_BUCKET', 'obrigatória: sem ela arquivos do contexto e o brain ficam desligados (ADR 0027)'],
  ['BQ_PROJECT_ID', 'obrigatória: sem ela a coleta não grava no BigQuery'],
  ['TRIA_PROXY_SECRET', 'obrigatória: sem ela o IP do cliente é desconhecido e todos dividem o mesmo balde do limitador (ADR 0060)'],
];

const PARES: ReadonlyArray<readonly [string, string]> = [
  ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  ['META_APP_ID', 'META_APP_SECRET'],
  ['RDSTATION_CLIENT_ID', 'RDSTATION_CLIENT_SECRET'],
];

const TAMANHO_MINIMO_PARA_OCULTAR = 8;

const preenchida = (fonte: Fonte, nome: string): boolean => (fonte[nome] ?? '').trim().length > 0;

export function lerArquivoDeAmbiente(texto: string): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim() || linha.trimStart().startsWith('#')) continue;
    const separador = linha.indexOf('=');
    if (separador <= 0) continue;
    valores[linha.slice(0, separador).trim()] = linha.slice(separador + 1);
  }
  return valores;
}

function ocultarValores(texto: string, fonte: Fonte): string {
  const valores = Object.values(fonte)
    .filter((valor): valor is string => typeof valor === 'string' && valor.length >= TAMANHO_MINIMO_PARA_OCULTAR)
    .sort((a, b) => b.length - a.length);
  return valores.reduce((acumulado, valor) => acumulado.split(valor).join('[omitido]'), texto);
}

function errosDaRelease(fonte: Fonte): string[] {
  const erros = OBRIGATORIAS_DA_RELEASE.filter(([nome]) => !preenchida(fonte, nome)).map(([nome, motivo]) => `${nome}: ${motivo}`);
  for (const [identificador, segredo] of PARES) {
    if (preenchida(fonte, identificador) !== preenchida(fonte, segredo)) {
      erros.push(`${identificador}/${segredo}: só uma das duas está definida; defina as duas ou nenhuma`);
    }
  }
  return erros;
}

function avisosDaRelease(fonte: Fonte): string[] {
  const avisos: string[] = [];
  if (!preenchida(fonte, 'ALERT_WEBHOOK_URL')) avisos.push('ALERT_WEBHOOK_URL ausente: alertas da plataforma ficam só no log e na tela de Coletas');
  if (preenchida(fonte, 'META_APP_ID') && !preenchida(fonte, 'META_LOGIN_CONFIG_ID')) avisos.push('META_LOGIN_CONFIG_ID ausente: a conexão Meta Ads fica desligada');
  if (preenchida(fonte, 'META_APP_ID') && !preenchida(fonte, 'LEADADS_LOGIN_CONFIG_ID')) avisos.push('LEADADS_LOGIN_CONFIG_ID ausente: a conexão Meta Lead Ads fica desligada');
  if (!preenchida(fonte, 'N8N_API_KEY')) avisos.push('N8N_API_KEY ausente: o app não fala com a API do n8n');
  return avisos;
}

export function validarAmbienteDeProducao(fonte: Fonte): ResultadoDaValidacao {
  const emProducao = { ...fonte, NODE_ENV: 'production' };
  const doSchema = problemasDoAmbiente(emProducao);
  const jaApontada = (erro: string) => doSchema.some((problema) => problema.split(':')[0] === erro.split(':')[0]);
  const erros = [...doSchema, ...errosDaRelease(emProducao).filter((erro) => !jaApontada(erro))];
  return {
    erros: erros.map((erro) => ocultarValores(erro, fonte)),
    avisos: avisosDaRelease(emProducao).map((aviso) => ocultarValores(aviso, fonte)),
  };
}
