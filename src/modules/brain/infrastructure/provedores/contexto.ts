import {
  prefixoDoExportDoContexto,
  type CampoDoContexto,
  type ContextoParaCatalogo,
  type MarcacaoDoContexto,
  type SecaoDoContexto,
} from '../../domain/contexto.ts';
import type { ColunaDoEsquema, EntradaSemSelo, Epistemico, Frescor } from '../../domain/entrada.ts';
import { idSeguro } from '../../domain/urn.ts';
import type { ContextoDeDescoberta, ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { RETENCAO_DO_CONTEXTO } from './comum.ts';

const VERSAO = 1;
const ID = 'contexto';
const TIPOS_RESUMIVEIS = new Set(['selecao', 'multipla', 'booleano', 'escala', 'numero', 'dinheiro']);
const TAMANHO_DO_RESUMO = 560;
export const AVISO_DA_SECAO_COM_DADO_PESSOAL =
  'Listas com possível dado pessoal ficam fora de perfil.json e perfil.md (só a contagem); o conteúdo está na entrada da lista, de uso restrito.';

export function marcaAgregada(marcacoes: readonly MarcacaoDoContexto[]): Epistemico | null {
  if (marcacoes.length === 0) return null;
  const marcas = new Set(marcacoes.map((m) => m.epistemico));
  const revisoes = new Set(marcacoes.map((m) => m.revisao));
  const fontes = new Set(marcacoes.map((m) => m.fonte));
  return {
    marca: marcas.size === 1 ? [...marcas][0]! : 'misto',
    fonte: fontes.size === 1 ? [...fontes][0]! : null,
    revisao: revisoes.size === 1 ? [...revisoes][0]! : 'misto',
    sugestoesPendentes: marcacoes.filter((m) => m.revisao === 'sugerido').length,
  };
}

const ROTULO_DE_TEXTO_LIVRE = 'outro (texto livre omitido)';

function rotuloDaOpcao(campo: CampoDoContexto, valor: unknown): string {
  const opcao = campo.opcoes?.find((o) => o.valor === valor);
  return opcao?.rotulo ?? ROTULO_DE_TEXTO_LIVRE;
}

export function resumirValor(campo: CampoDoContexto, valor: unknown): string | null {
  if (!TIPOS_RESUMIVEIS.has(campo.tipo) || valor === null || valor === undefined || valor === '') return null;
  if (campo.tipo === 'booleano') return typeof valor === 'boolean' ? (valor ? 'sim' : 'não') : null;
  if (campo.tipo === 'dinheiro') return typeof valor === 'number' ? `R$ ${(valor / 100).toFixed(2)}` : null;
  if (campo.tipo === 'numero' || campo.tipo === 'escala') {
    return typeof valor === 'number' ? `${valor}${campo.unidade ? ` ${campo.unidade}` : ''}` : null;
  }
  if (campo.tipo === 'multipla') {
    const valores = Array.isArray(valor) ? valor : (valor as { valores?: unknown })?.valores;
    return Array.isArray(valores) && valores.length > 0 ? valores.map((v) => rotuloDaOpcao(campo, v)).join(', ') : null;
  }
  const selecionado = typeof valor === 'object' && valor !== null ? (valor as { valor?: unknown }).valor : valor;
  return typeof selecionado === 'string' && campo.opcoes?.some((o) => o.valor === selecionado) ? rotuloDaOpcao(campo, selecionado) : null;
}

function esquemaDosCampos(campos: readonly CampoDoContexto[]): ColunaDoEsquema[] {
  return campos.map((campo) => ({
    nome: campo.key.slice(0, 80),
    tipo: campo.tipo,
    significado: `${campo.rotulo}${campo.ajuda ? `: ${campo.ajuda}` : ''}`.slice(0, 400),
    unidade: campo.unidade ?? null,
    anulavel: true,
  }));
}

function frescorDoContexto(contexto: ContextoParaCatalogo, atualizadoEm: readonly Date[]): Frescor {
  const ultima = atualizadoEm.length > 0 ? new Date(Math.max(...atualizadoEm.map((d) => d.getTime()))) : null;
  return {
    ultimaAtualizacao: ultima ? ultima.toISOString() : null,
    dadoAte: null,
    esperadoAte: null,
    cadenciaEsperada: 'sob_demanda',
    status: contexto.brain.pendente ? 'atrasado' : contexto.brain.exportadoEm ? 'fresco' : 'desconhecido',
  };
}

function entradaDaSecao(ctx: ContextoDeDescoberta, contexto: ContextoParaCatalogo, secao: SecaoDoContexto): EntradaSemSelo {
  const valores = Object.values(contexto.campos).filter((v) => v.secao === secao.key);
  const simples = secao.campos.filter((c) => c.tipo !== 'lista');
  const listas = secao.campos.filter((c) => c.tipo === 'lista');
  const completude = contexto.completude.secoes.find((s) => s.secao === secao.key);
  const marcacoes = [...valores, ...listas.flatMap((l) => contexto.listas[l.key] ?? [])];
  const epistemico = marcaAgregada(marcacoes);
  const resumo = simples
    .map((campo) => {
      const valor = contexto.campos[campo.key];
      if (!valor || valor.revisao !== 'confirmado') return null;
      const texto = resumirValor(campo, valor.valor);
      return texto ? `${campo.rotulo}: ${texto}` : null;
    })
    .filter((linha): linha is string => linha !== null)
    .join('; ')
    .slice(0, TAMANHO_DO_RESUMO);
  const essenciaisFaltando = completude ? completude.essenciaisTotal - completude.essenciaisPreenchidos : 0;
  const pessoal = secao.campos.some((c) => c.avisoDeDadoPessoal);
  const arquivos = contexto.arquivos.filter((a) => a.secao === secao.key);
  return {
    urn: ctx.urn('contexto_secao', idSeguro(secao.key)),
    tipo: 'contexto_secao',
    id: idSeguro(secao.key),
    titulo: `Contexto: ${secao.titulo}`,
    descricao: `${secao.descricao} Preenchido em ${completude?.percentual ?? 0}%${essenciaisFaltando > 0 ? `, faltam ${essenciaisFaltando} campo(s) essencial(is)` : ''}.`.slice(0, 600),
    provedor: ID,
    plataforma: null,
    referencia: { sistema: 'bucket', local: `${prefixoDoExportDoContexto(ctx.organizationId, ctx.clienteId)}perfil.json` },
    esquema: { colunas: esquemaDosCampos(simples) },
    grao: null,
    cobertura: null,
    frescor: frescorDoContexto(contexto, valores.map((v) => v.atualizadoEm)),
    qualidade: {
      completude: (completude?.percentual ?? 0) / 100,
      avisos: [
        ...(essenciaisFaltando > 0 ? [`${essenciaisFaltando} campo(s) essencial(is) sem resposta confirmada.`] : []),
        ...(epistemico && epistemico.sugestoesPendentes > 0 ? [`${epistemico.sugestoesPendentes} sugestão(ões) aguardando confirmação.`] : []),
        ...(pessoal ? [AVISO_DA_SECAO_COM_DADO_PESSOAL] : []),
      ],
    },
    acesso: {
      tipo: 'contexto',
      caminho: `${prefixoDoExportDoContexto(ctx.organizationId, ctx.clienteId)}perfil.json`,
      secao: secao.key,
      chaves: simples.map((c) => c.key),
      formato: 'json (perfil.json, chave secoes.<secao>)',
    },
    sensibilidade: {
      nivel: pessoal ? 'pessoal_possivel' : 'negocio',
      piiPossivel: pessoal,
      usoPorAgente: 'permitido',
      retencao: RETENCAO_DO_CONTEXTO,
    },
    epistemico,
    valorResumido: resumo.length > 0 ? resumo : null,
    tags: ['contexto', `secao:${idSeguro(secao.key)}`, ...(completude?.essenciaisCompletos ? ['essenciais_completos'] : [])],
    relacoes: [
      ...listas.map((lista) => ({ tipo: 'contem', urn: ctx.urn('contexto_lista', idSeguro(lista.key)) })),
      ...arquivos.map((arquivo) => ({ tipo: 'anexa', urn: ctx.urn('arquivo', idSeguro(arquivo.id)) })),
    ],
    versao: VERSAO,
  };
}

function entradaDaLista(ctx: ContextoDeDescoberta, contexto: ContextoParaCatalogo, secao: SecaoDoContexto, campo: CampoDoContexto): EntradaSemSelo {
  const itens = contexto.listas[campo.key] ?? [];
  const confirmados = itens.filter((i) => i.revisao === 'confirmado').length;
  const minimo = Math.max(campo.minimo ?? 1, 1);
  const pessoal = Boolean(campo.avisoDeDadoPessoal);
  const caminho = campo.arquivoBrain ? `${prefixoDoExportDoContexto(ctx.organizationId, ctx.clienteId)}${campo.arquivoBrain}` : null;
  return {
    urn: ctx.urn('contexto_lista', idSeguro(campo.key)),
    tipo: 'contexto_lista',
    id: idSeguro(campo.key),
    titulo: `Contexto: ${campo.rotulo}`,
    descricao: `${campo.ajuda ?? `Lista de ${campo.rotulo.toLowerCase()} do cliente`} (seção ${secao.titulo}, ${confirmados} item(ns) confirmado(s)).`.slice(0, 600),
    provedor: ID,
    plataforma: null,
    referencia: { sistema: 'bucket', local: caminho ?? `${prefixoDoExportDoContexto(ctx.organizationId, ctx.clienteId)}perfil.json` },
    esquema: { colunas: esquemaDosCampos(campo.item ?? []) },
    grao: ['item'],
    cobertura: null,
    frescor: frescorDoContexto(contexto, itens.map((i) => i.atualizadoEm)),
    qualidade: {
      completude: Math.min(confirmados / minimo, 1),
      avisos: [
        ...(confirmados < minimo ? [`Mínimo recomendado: ${minimo} item(ns) confirmado(s).`] : []),
        ...(pessoal ? ['Pode conter dado pessoal: o agente vê só os metadados.'] : []),
      ],
    },
    acesso: { tipo: 'contexto', caminho, secao: secao.key, chaves: (campo.item ?? []).map((c) => c.key), formato: 'jsonl (um item por linha)' },
    sensibilidade: {
      nivel: pessoal ? 'pessoal_possivel' : 'negocio',
      piiPossivel: pessoal,
      usoPorAgente: pessoal ? 'restrito' : 'permitido',
      retencao: RETENCAO_DO_CONTEXTO,
    },
    epistemico: marcaAgregada(itens),
    valorResumido: `${confirmados} item(ns) confirmado(s) de ${itens.length}`,
    tags: ['contexto', 'lista', `secao:${idSeguro(secao.key)}`],
    relacoes: [{ tipo: 'parte_de', urn: ctx.urn('contexto_secao', idSeguro(secao.key)) }],
    versao: VERSAO,
  };
}

export const provedorDeContexto: ProvedorDeCatalogo = {
  id: ID,
  versao: VERSAO,
  descricao: 'Seções e listas do contexto do cliente (formulário de contexto), com completude, marcação epistêmica e ponteiro para o export do brain do contexto.',
  fase: 'primaria',
  tiposDeclarados: ['contexto_secao', 'contexto_lista'],
  descobrir(ctx) {
    const contexto = ctx.contexto;
    if (!contexto) return [];
    return contexto.catalogo.flatMap((secao) => [
      entradaDaSecao(ctx, contexto, secao),
      ...secao.campos.filter((c) => c.tipo === 'lista').map((campo) => entradaDaLista(ctx, contexto, secao, campo)),
    ]);
  },
  saude: (ctx) =>
    ctx.contexto ? { status: 'ok', motivo: null } : { status: 'indisponivel', motivo: 'Contexto do cliente ainda não ligado ao catálogo (carregador indisponível).' },
};
