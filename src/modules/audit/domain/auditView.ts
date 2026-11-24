import type { AuditEntry } from '@/modules/audit/domain/auditEvent';

const PREFIXO_SEGURO = 'https:' + '/'.repeat(2);

const ORDEM_CONHECIDA = [
  'platform',
  'tenantBinding',
  'organizationCreated',
  'vaultAvailable',
  'refreshTokenReceived',
  'grantedScopes',
  'discoveredAccounts',
  'type',
  'role',
  'de',
  'para',
  'name',
  'externalId',
  'clientesNoEscopo',
  'organizacaoInteira',
  'historico',
  'historicoSegue',
  'email',
  'primeiroAcesso',
  'hasManagerAccount',
  'syncEnabled',
  'rows',
  'window',
];

export type Coluna = {
  readonly chave: string;
  readonly rotulo: string;
  readonly numerica: boolean;
};

const ROTULOS: Record<string, string> = {
  platform: 'Plataforma',
  tenantBinding: 'Vínculo',
  organizationCreated: 'Criou org.',
  vaultAvailable: 'Cofre',
  refreshTokenReceived: 'Refresh token',
  grantedScopes: 'Escopos',
  discoveredAccounts: 'Contas descobertas',
  type: 'Tipo',
  role: 'Papel',
  de: 'De',
  para: 'Para',
  name: 'Nome',
  externalId: 'ID externo',
  clientesNoEscopo: 'Clientes no escopo',
  organizacaoInteira: 'Organização inteira',
  historico: 'Histórico',
  historicoSegue: 'Histórico segue',
  invitationId: 'Convite',
  email: 'E-mail',
  primeiroAcesso: 'Primeiro acesso',
  hasManagerAccount: 'Tem MCC',
  syncEnabled: 'Coleta',
};

export function rotuloDe(chave: string): string {
  if (ROTULOS[chave]) return ROTULOS[chave];

  const emPalavras = chave
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .toLowerCase()
    .trim();

  return emPalavras.charAt(0).toUpperCase() + emPalavras.slice(1);
}

export function colunasDeMetadados(entries: readonly AuditEntry[]): readonly Coluna[] {
  const presentes = new Set<string>();
  const numericas = new Map<string, boolean>();

  for (const entry of entries) {
    for (const [chave, valor] of Object.entries(entry.metadata ?? {})) {
      presentes.add(chave);
      numericas.set(chave, (numericas.get(chave) ?? true) && typeof valor === 'number');
    }
  }

  return [...presentes]
    .sort((a, b) => {
      const pa = ORDEM_CONHECIDA.indexOf(a);
      const pb = ORDEM_CONHECIDA.indexOf(b);
      if (pa !== -1 && pb !== -1) return pa - pb;
      if (pa !== -1) return -1;
      if (pb !== -1) return 1;
      return a.localeCompare(b, 'pt-BR');
    })
    .map((chave) => ({ chave, rotulo: rotuloDe(chave), numerica: numericas.get(chave) === true }));
}

export type Celula =
  | { readonly tipo: 'vazio' }
  | { readonly tipo: 'booleano'; readonly verdadeiro: boolean }
  | { readonly tipo: 'lista'; readonly itens: readonly string[] }
  | { readonly tipo: 'texto'; readonly valor: string };

export function encurtarEscopo(valor: string): string {
  if (!valor.startsWith(PREFIXO_SEGURO)) return valor;

  const semProtocolo = valor.slice(PREFIXO_SEGURO.length);
  const partes = semProtocolo.split('/');
  return partes[partes.length - 1] || semProtocolo;
}

export function celulaDe(valor: unknown): Celula {
  if (valor === null || valor === undefined || valor === '') return { tipo: 'vazio' };
  if (typeof valor === 'boolean') return { tipo: 'booleano', verdadeiro: valor };

  if (Array.isArray(valor)) {
    const itens = valor.map((item) => encurtarEscopo(String(item)));
    return itens.length === 0 ? { tipo: 'vazio' } : { tipo: 'lista', itens };
  }

  if (typeof valor === 'object') return { tipo: 'texto', valor: JSON.stringify(valor) };

  return { tipo: 'texto', valor: encurtarEscopo(String(valor)) };
}

export function familiaDe(action: string): string {
  return action.split('.')[0] ?? action;
}

export function acoesPresentes(entries: readonly AuditEntry[]): readonly string[] {
  return [...new Set(entries.map((entry) => entry.action))].sort((a, b) => a.localeCompare(b));
}

export type ResumoFamilia = { readonly familia: string; readonly total: number };

export function resumoPorFamilia(entries: readonly AuditEntry[]): readonly ResumoFamilia[] {
  const contagem = new Map<string, number>();
  for (const entry of entries) {
    const familia = familiaDe(entry.action);
    contagem.set(familia, (contagem.get(familia) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([familia, total]) => ({ familia, total }))
    .sort((a, b) => b.total - a.total || a.familia.localeCompare(b.familia));
}

export type Indicadores = {
  readonly eventos: number;
  readonly atoresDistintos: number;
  readonly automatizados: number;
  readonly percentualAutomatizado: number;
  readonly alertasEFalhas: number;
  readonly ultimoEvento: Date | null;
  readonly cobreJanelaInteira: boolean;
};

const MS_POR_HORA = 3600_000;

function ehAlertaOuFalha(action: string): boolean {
  return action === 'plataforma.alerta' || /(^|[._])(failed|falha)$/.test(action);
}

export function indicadoresDaTrilha(
  entries: readonly AuditEntry[],
  agora: Date,
  janelaEmHoras = 24,
  limiteDaConsulta = 500,
): Indicadores {
  const inicio = agora.getTime() - janelaEmHoras * MS_POR_HORA;
  const naJanela = entries.filter((entry) => entry.occurredAt.getTime() >= inicio);
  const atores = new Set(
    naJanela.flatMap((entry) => (entry.actorId ? [`${entry.actorType}:${entry.actorId}`] : [])),
  );
  const automatizados = naJanela.filter((entry) => entry.actorType !== 'user').length;
  const ultimo = entries.reduce<Date | null>(
    (maisRecente, entry) =>
      maisRecente === null || entry.occurredAt > maisRecente ? entry.occurredAt : maisRecente,
    null,
  );

  return {
    eventos: naJanela.length,
    atoresDistintos: atores.size,
    automatizados,
    percentualAutomatizado:
      naJanela.length === 0 ? 0 : Math.round((automatizados / naJanela.length) * 100),
    alertasEFalhas: naJanela.filter((entry) => ehAlertaOuFalha(entry.action)).length,
    ultimoEvento: ultimo,
    cobreJanelaInteira: entries.length < limiteDaConsulta,
  };
}
