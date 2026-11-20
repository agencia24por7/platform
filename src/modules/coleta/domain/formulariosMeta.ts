export const CAMPOS_DO_FORMULARIO = ['formId', 'nome', 'status', 'leadsTotal', 'leadsExpirados', 'criadoEm'] as const;

export type FormularioMeta = {
  readonly formId: string;
  readonly nome: string | null;
  readonly status: string | null;
  readonly leadsTotal: number | null;
  readonly leadsExpirados: number | null;
  readonly criadoEm: string | null;
};

const TAMANHO_MAXIMO_DE_ROTULO = 200;
const ID_DA_META = /^\d{5,25}$/;
const STATUS = /^[A-Z_]{1,40}$/;

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, TAMANHO_MAXIMO_DE_ROTULO) : null;
}

function contagem(valor: unknown): number | null {
  const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  return typeof numero === 'number' && Number.isFinite(numero) && numero >= 0 ? Math.trunc(numero) : null;
}

function instante(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor) return null;
  const data = new Date(valor.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export function formularioDaLinha(bruta: Readonly<Record<string, unknown>>): FormularioMeta | null {
  const formId = typeof bruta.formId === 'string' && ID_DA_META.test(bruta.formId) ? bruta.formId : null;
  if (!formId) return null;
  const status = typeof bruta.status === 'string' && STATUS.test(bruta.status) ? bruta.status : null;

  return {
    formId,
    nome: texto(bruta.nome),
    status,
    leadsTotal: contagem(bruta.leadsTotal),
    leadsExpirados: contagem(bruta.leadsExpirados),
    criadoEm: instante(bruta.criadoEm),
  };
}

export function formulariosUnicos(linhas: readonly Readonly<Record<string, unknown>>[]): readonly FormularioMeta[] {
  const porId = new Map<string, FormularioMeta>();
  for (const linha of linhas) {
    const formulario = formularioDaLinha(linha);
    if (formulario) porId.set(formulario.formId, formulario);
  }
  return [...porId.values()];
}

export type ContextoDoFatoFormularios = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly pageId: string;
  readonly dataSnapshot: string;
  readonly execucaoId: string;
  readonly inseridoEm: string;
};

export const COLUNAS_DO_FATO_FORMULARIOS = [
  'organization_id', 'client_id', 'page_id', 'form_id', 'data_snapshot', 'nome', 'status', 'leads_total',
  'leads_expirados', 'criado_em', 'execucao_id', 'inserido_em',
] as const;

export const TIPOS_DO_FATO_FORMULARIOS: Readonly<Record<(typeof COLUNAS_DO_FATO_FORMULARIOS)[number], string>> = {
  organization_id: 'STRING', client_id: 'STRING', page_id: 'STRING', form_id: 'STRING', data_snapshot: 'DATE',
  nome: 'STRING', status: 'STRING', leads_total: 'INT64', leads_expirados: 'INT64', criado_em: 'TIMESTAMP',
  execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
};

export function linhaDoFatoFormularios(
  formulario: FormularioMeta,
  ctx: ContextoDoFatoFormularios,
): Record<(typeof COLUNAS_DO_FATO_FORMULARIOS)[number], unknown> {
  return {
    organization_id: ctx.organizationId,
    client_id: ctx.clientId,
    page_id: ctx.pageId,
    form_id: formulario.formId,
    data_snapshot: ctx.dataSnapshot,
    nome: formulario.nome,
    status: formulario.status,
    leads_total: formulario.leadsTotal,
    leads_expirados: formulario.leadsExpirados,
    criado_em: formulario.criadoEm,
    execucao_id: ctx.execucaoId,
    inserido_em: ctx.inseridoEm,
  };
}
