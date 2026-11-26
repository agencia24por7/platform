import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { CatalogoDeModelos } from '../application/modelosService.ts';
import type { Fornecedor } from '../domain/tarefa.ts';

const PRAZO_MS = 10_000;
const RESPOSTA_MAXIMA = 2_000_000;
const PREFIXO_DO_GOOGLE = 'models/';

type Consulta = {
  readonly url: string;
  cabecalhos(chave: string): Record<string, string>;
  ids(corpo: unknown): readonly string[];
};

type ComLista = { readonly data?: readonly { readonly id?: unknown }[] };
type ModeloDoGoogle = { readonly name?: unknown; readonly supportedGenerationMethods?: unknown };
type ListaDoGoogle = { readonly models?: readonly ModeloDoGoogle[] };

const textos = (valores: readonly unknown[]): readonly string[] => valores.filter((valor): valor is string => typeof valor === 'string');
const idsDaLista = (corpo: unknown): readonly string[] => textos(((corpo as ComLista).data ?? []).map((item) => item.id));
const portador = (chave: string) => ({ Authorization: `Bearer ${chave}` });

function geraConteudo(modelo: ModeloDoGoogle): boolean {
  return Array.isArray(modelo.supportedGenerationMethods) && modelo.supportedGenerationMethods.includes('generateContent');
}

function idDoGoogle(modelo: ModeloDoGoogle): string | null {
  if (typeof modelo.name !== 'string') return null;
  return modelo.name.startsWith(PREFIXO_DO_GOOGLE) ? modelo.name.slice(PREFIXO_DO_GOOGLE.length) : modelo.name;
}

const CONSULTAS: Record<Fornecedor, Consulta> = {
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    cabecalhos: (chave) => ({ 'x-goog-api-key': chave }),
    ids: (corpo) => textos(((corpo as ListaDoGoogle).models ?? []).filter(geraConteudo).map(idDoGoogle)),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models?limit=1000',
    cabecalhos: (chave) => ({ 'x-api-key': chave, 'anthropic-version': '2023-06-01' }),
    ids: idsDaLista,
  },
  openai: { url: 'https://api.openai.com/v1/models', cabecalhos: portador, ids: idsDaLista },
  xai: { url: 'https://api.x.ai/v1/models', cabecalhos: portador, ids: idsDaLista },
  moonshot: { url: 'https://api.moonshot.ai/v1/models', cabecalhos: portador, ids: idsDaLista },
};

const CHAVE_RECUSADA = failure('validation', 'O fornecedor recusou essa chave. Confira se está correta e ativa.');
const FORNECEDOR_FORA = failure('unavailable', 'O fornecedor não respondeu agora. Tente de novo em instantes.');
const LISTA_VAZIA = failure('validation', 'A chave foi aceita, mas não alcança nenhum modelo de texto.');

const RECUSA_DA_CHAVE = new Set([400, 401, 403]);

type OpcoesDaBusca = { readonly headers: Record<string, string>; readonly signal: AbortSignal; readonly redirect: 'error' };
export type Buscador = (url: string, opcoes: OpcoesDaBusca) => Promise<Response>;

export function createCatalogoDeModelos(buscar: Buscador = fetch): CatalogoDeModelos {
  return {
    async listar(fornecedor, chave): Promise<Result<readonly string[], Failure>> {
      const consulta = CONSULTAS[fornecedor];
      const url = consulta.url;
      try {
        const resposta = await buscar(url, { headers: consulta.cabecalhos(chave), signal: AbortSignal.timeout(PRAZO_MS), redirect: 'error' });
        if (RECUSA_DA_CHAVE.has(resposta.status)) return err(CHAVE_RECUSADA);
        if (!resposta.ok) return err(FORNECEDOR_FORA);
        const texto = await resposta.text();
        if (texto.length > RESPOSTA_MAXIMA) return err(FORNECEDOR_FORA);
        const ids = consulta.ids(JSON.parse(texto));
        return ids.length > 0 ? ok(ids) : err(LISTA_VAZIA);
      } catch {
        return err(FORNECEDOR_FORA);
      }
    },
  };
}
