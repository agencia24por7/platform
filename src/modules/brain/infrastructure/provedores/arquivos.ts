import type { ArquivoDoContexto } from '../../domain/contexto.ts';
import type { EntradaSemSelo } from '../../domain/entrada.ts';
import { limparTextoLivre } from '../../domain/privacidade.ts';
import type { ContextoDeDescoberta, ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { idSeguro } from '../../domain/urn.ts';
import { RETENCAO_DO_CONTEXTO } from './comum.ts';

const VERSAO = 1;
const ID = 'arquivos';

const CATEGORIA_DO_MIME: readonly [(mime: string) => boolean, string][] = [
  [(mime) => mime.startsWith('image'), 'imagem'],
  [(mime) => mime.startsWith('video'), 'video'],
  [(mime) => /spreadsheet|excel|csv/.test(mime), 'planilha'],
  [(mime) => /pdf|word|document|text|presentation|powerpoint/.test(mime), 'documento'],
];

export function categoriaDoMime(mime: string): string {
  return CATEGORIA_DO_MIME.find(([casa]) => casa(mime))?.[1] ?? 'arquivo';
}

function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function entradaDoArquivo(ctx: ContextoDeDescoberta, arquivo: ArquivoDoContexto, tituloDaSecao: string): EntradaSemSelo {
  const categoria = categoriaDoMime(arquivo.mime);
  const nome = limparTextoLivre(arquivo.nome).slice(0, 100);
  return {
    urn: ctx.urn('arquivo', idSeguro(arquivo.id)),
    tipo: 'arquivo',
    id: idSeguro(arquivo.id),
    titulo: `Arquivo (${categoria}): ${nome}`,
    descricao: `Anexo do contexto do cliente na seção ${tituloDaSecao} (campo ${arquivo.fieldKey}), ${tamanhoLegivel(arquivo.tamanhoBytes)}. O catálogo guarda só os metadados; o conteúdo fica no bucket.`,
    provedor: ID,
    plataforma: null,
    referencia: { sistema: 'bucket', local: arquivo.caminho },
    esquema: null,
    grao: null,
    cobertura: null,
    frescor: { ultimaAtualizacao: arquivo.criadoEm.toISOString(), dadoAte: null, esperadoAte: null, cadenciaEsperada: 'sob_demanda', status: 'fresco' },
    qualidade: { completude: null, avisos: [] },
    acesso: { tipo: 'arquivo', caminho: arquivo.caminho, mime: arquivo.mime, tamanhoBytes: arquivo.tamanhoBytes },
    sensibilidade: { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'permitido', retencao: RETENCAO_DO_CONTEXTO },
    epistemico: { marca: 'fato', fonte: arquivo.fonte, revisao: 'confirmado', sugestoesPendentes: 0 },
    valorResumido: `sha256 ${arquivo.sha256.slice(0, 16)}`,
    tags: ['arquivo', `categoria:${categoria}`, `secao:${idSeguro(arquivo.secao)}`],
    relacoes: [{ tipo: 'anexo_de', urn: ctx.urn('contexto_secao', idSeguro(arquivo.secao)) }],
    versao: VERSAO,
  };
}

export const provedorDeArquivos: ProvedorDeCatalogo = {
  id: ID,
  versao: VERSAO,
  descricao: 'Metadados dos arquivos anexados ao contexto do cliente (nome, tipo, tamanho, seção), sem conteúdo.',
  fase: 'primaria',
  tiposDeclarados: ['arquivo'],
  descobrir(ctx) {
    const contexto = ctx.contexto;
    if (!contexto) return [];
    const titulos = new Map(contexto.catalogo.map((s) => [s.key, s.titulo]));
    return [...contexto.arquivos]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((arquivo) => entradaDoArquivo(ctx, arquivo, titulos.get(arquivo.secao) ?? arquivo.secao));
  },
  saude: (ctx) => (ctx.contexto ? { status: 'ok', motivo: null } : { status: 'indisponivel', motivo: 'Arquivos vêm do contexto do cliente, ainda não ligado.' }),
};
