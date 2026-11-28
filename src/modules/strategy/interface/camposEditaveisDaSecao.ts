import { err, ok, type Result } from '../../../shared/result/result.ts';
import { VALOR_A_CONFIRMAR, campoNaoVerificado, catalogoDaPlataforma, type CampoDoCatalogo, type CatalogoDeCampos } from '../domain/catalogo/tipos.ts';
import { centavosDeReais, reais } from './formatosDoPlano.ts';
import { ROTULO_DA_PLATAFORMA_DO_PLANO, TITULO_DA_SECAO_DE_MIDIA, nomeDoCampo } from './rotulosDoPlano.ts';

export const SECOES_EDITAVEIS = ['resumo_executivo', 'plano_de_midia'] as const;
export type SecaoEditavel = (typeof SECOES_EDITAVEIS)[number];

export function secaoEditavel(chave: string): chave is SecaoEditavel {
  return (SECOES_EDITAVEIS as readonly string[]).includes(chave);
}

export type TipoDoCampoEditavel = 'texto_curto' | 'texto_longo' | 'numero' | 'dinheiro' | 'escolha';
export type OpcaoDoCampoEditavel = { readonly valor: string; readonly rotulo: string };

export type CampoEditavel = {
  readonly caminho: string;
  readonly rotulo: string;
  readonly tipo: TipoDoCampoEditavel;
  readonly valor: string;
  readonly dica: string | null;
  readonly maximo: number | null;
  readonly opcoes: readonly OpcaoDoCampoEditavel[];
};

export type GrupoDeCampos = { readonly chave: string; readonly titulo: string; readonly campos: readonly CampoEditavel[] };

type Caminho = readonly (string | number)[];
type Descritor = {
  readonly grupo: { readonly chave: string; readonly titulo: string };
  readonly campo: CampoEditavel;
  readonly noDado: Caminho;
  readonly ler: (bruto: string) => Result<unknown, string>;
};

const MAXIMO_DO_OBJETIVO = 400;
const MAXIMO_DA_AFIRMACAO = 600;
const MAXIMO_DO_VALOR_DE_TEXTO = 600;
const MAXIMO_DA_JUSTIFICATIVA = 300;
const MAXIMO_DE_ITENS_DA_LISTA = 50;
const MAXIMO_DO_ITEM_DA_LISTA = 200;
const LIMITE_DO_TEXTO_CURTO = 120;
const PADRAO_DE_NUMERO = /^-?\d+(\.\d+)?$/;
const PADRAO_DE_DESTINO_OU_IDENTIFICADOR = /(^|_)(url|urls|link|domain|pixel|id|ids|phone|whatsapp)(_|$)/;
const MENSAGEM_DE_CAMPO_FIXO = 'Este campo não pode ser editado.';
const ROTULO_DE_A_CONFIRMAR = 'A confirmar';

const registro = (valor: unknown): Record<string, unknown> | null => (valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null);
const texto = (valor: unknown): string | null => (typeof valor === 'string' ? valor : null);
const normalizar = (bruto: string): string => bruto.replace(/\r\n?/g, '\n');

function lerTexto(maximo: number, permiteVazio: boolean): (bruto: string) => Result<unknown, string> {
  return (bruto) => {
    const limpo = normalizar(bruto).trim();
    if (limpo === '' && !permiteVazio) return err('Preencha este campo.');
    if (limpo.length > maximo) return err(`No máximo ${maximo} caracteres.`);
    return ok(limpo);
  };
}

function campoDeTexto(caminho: string, rotulo: string, valor: string, maximo: number, opcoes: { readonly longo?: boolean; readonly permiteVazio?: boolean; readonly dica?: string }): CampoEditavel {
  const longo = opcoes.longo ?? (valor.length > LIMITE_DO_TEXTO_CURTO || valor.includes('\n'));
  return { caminho, rotulo, tipo: longo ? 'texto_longo' : 'texto_curto', valor, dica: opcoes.dica ?? null, maximo, opcoes: [] };
}

function descritoresDoResumo(secao: unknown): Descritor[] {
  const dado = registro(secao);
  if (dado === null) return [];
  const grupo = { chave: 'resumo', titulo: 'Resumo executivo' };
  const descritores: Descritor[] = [];
  const objetivo = texto(dado['objetivo']);
  if (objetivo !== null) {
    descritores.push({ grupo, noDado: ['objetivo'], campo: campoDeTexto('objetivo', 'Objetivo', objetivo, MAXIMO_DO_OBJETIVO, { longo: true }), ler: lerTexto(MAXIMO_DO_OBJETIVO, false) });
  }
  for (const [chave, rotulo] of [['aposta_central', 'Aposta central'], ['resultado_esperado', 'Resultado esperado']] as const) {
    const afirmacao = texto(registro(dado[chave])?.['texto']);
    if (afirmacao === null) continue;
    const caminho = `${chave}.texto`;
    descritores.push({ grupo, noDado: [chave, 'texto'], campo: campoDeTexto(caminho, rotulo, afirmacao, MAXIMO_DA_AFIRMACAO, { longo: true }), ler: lerTexto(MAXIMO_DA_AFIRMACAO, false) });
  }
  const verba = registro(dado['verba']);
  if (verba !== null && typeof verba['centavos'] === 'string' && verba['moeda'] === 'BRL') {
    descritores.push({
      grupo,
      noDado: ['verba'],
      campo: { caminho: 'verba', rotulo: 'Verba', tipo: 'dinheiro', valor: reais({ centavos: verba['centavos'], moeda: 'BRL' }), dica: 'Em reais, por exemplo 15.000,00.', maximo: null, opcoes: [] },
      ler: (bruto) => {
        const centavos = centavosDeReais(normalizar(bruto));
        if (centavos === null) return err('Informe a verba em reais, por exemplo 15.000,00.');
        if (BigInt(centavos) <= 0n) return err('A verba precisa ser maior que zero.');
        return ok({ centavos, moeda: 'BRL' });
      },
    });
  }
  return descritores;
}

function tituloDaSecaoDeMidia(chave: string): string {
  const base = TITULO_DA_SECAO_DE_MIDIA[chave] ?? nomeDoCampo(chave);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function opcoesDeEscolha(campo: CampoDoCatalogo, atual: string): OpcaoDoCampoEditavel[] {
  const valores = [...(campo.opcoes ?? [])];
  if (campoNaoVerificado(campo) && !valores.includes(VALOR_A_CONFIRMAR)) valores.push(VALOR_A_CONFIRMAR);
  if (!valores.includes(atual)) valores.push(atual);
  return valores.map((valor) => ({ valor, rotulo: valor === VALOR_A_CONFIRMAR ? ROTULO_DE_A_CONFIRMAR : valor }));
}

function descritorDoValor(caminho: string, rotulo: string, atual: unknown, campo: CampoDoCatalogo, grupo: Descritor['grupo'], noDado: Caminho): Descritor | null {
  const aceitaAConfirmar = campoNaoVerificado(campo);
  const base = { grupo, noDado };
  if (campo.tipoDoValor === 'escolha') {
    if (typeof atual !== 'string') return null;
    const opcoes = opcoesDeEscolha(campo, atual);
    const validos = new Set(opcoes.map((opcao) => opcao.valor));
    return {
      ...base,
      campo: { caminho, rotulo, tipo: 'escolha', valor: atual, dica: null, maximo: null, opcoes },
      ler: (bruto) => (validos.has(bruto) ? ok(bruto) : err('Escolha uma das opções.')),
    };
  }
  if (campo.tipoDoValor === 'booleano') {
    if (typeof atual !== 'boolean' && atual !== VALOR_A_CONFIRMAR) return null;
    const opcoes: OpcaoDoCampoEditavel[] = [
      { valor: 'true', rotulo: 'Sim' },
      { valor: 'false', rotulo: 'Não' },
      ...(aceitaAConfirmar || atual === VALOR_A_CONFIRMAR ? [{ valor: VALOR_A_CONFIRMAR, rotulo: ROTULO_DE_A_CONFIRMAR }] : []),
    ];
    return {
      ...base,
      campo: { caminho, rotulo, tipo: 'escolha', valor: String(atual), dica: null, maximo: null, opcoes },
      ler: (bruto) => {
        if (bruto === 'true') return ok(true);
        if (bruto === 'false') return ok(false);
        return bruto === VALOR_A_CONFIRMAR && opcoes.some((opcao) => opcao.valor === bruto) ? ok(bruto) : err('Escolha uma das opções.');
      },
    };
  }
  if (campo.tipoDoValor === 'numero') {
    if (typeof atual !== 'number' && typeof atual !== 'string') return null;
    return {
      ...base,
      campo: { caminho, rotulo, tipo: typeof atual === 'number' ? 'numero' : 'texto_curto', valor: String(atual), dica: null, maximo: null, opcoes: [] },
      ler: (bruto) => {
        const limpo = normalizar(bruto).trim();
        if (limpo === VALOR_A_CONFIRMAR && (aceitaAConfirmar || atual === VALOR_A_CONFIRMAR)) return ok(limpo);
        if (!PADRAO_DE_NUMERO.test(limpo) || !Number.isFinite(Number(limpo))) return err('Informe um número.');
        return ok(Number(limpo));
      },
    };
  }
  if (campo.tipoDoValor === 'lista') {
    if (!Array.isArray(atual) || !atual.every((item) => typeof item === 'string')) return null;
    return {
      ...base,
      campo: { caminho, rotulo, tipo: 'texto_longo', valor: atual.join('\n'), dica: 'Um item por linha.', maximo: null, opcoes: [] },
      ler: (bruto) => {
        const itens = normalizar(bruto).split('\n').map((item) => item.trim()).filter((item) => item !== '');
        if (itens.length > MAXIMO_DE_ITENS_DA_LISTA) return err(`No máximo ${MAXIMO_DE_ITENS_DA_LISTA} itens.`);
        if (itens.some((item) => item.length > MAXIMO_DO_ITEM_DA_LISTA)) return err(`Cada item pode ter no máximo ${MAXIMO_DO_ITEM_DA_LISTA} caracteres.`);
        return ok(itens);
      },
    };
  }
  if (typeof atual !== 'string') return null;
  return { ...base, campo: campoDeTexto(caminho, rotulo, atual, MAXIMO_DO_VALOR_DE_TEXTO, {}), ler: lerTexto(MAXIMO_DO_VALOR_DE_TEXTO, false) };
}

function descritoresDaMidia(secao: unknown, catalogos: readonly CatalogoDeCampos[]): Descritor[] {
  const plataformas = registro(secao)?.['plataformas'];
  if (!Array.isArray(plataformas)) return [];
  const descritores: Descritor[] = [];
  plataformas.forEach((plataformaBruta, i) => {
    const plataforma = registro(plataformaBruta);
    const chaveDaPlataforma = texto(plataforma?.['plataforma']);
    const secoes = plataforma?.['secoes'];
    if (chaveDaPlataforma === null || !Array.isArray(secoes)) return;
    const catalogo = catalogoDaPlataforma(catalogos, chaveDaPlataforma as never);
    if (catalogo === undefined) return;
    secoes.forEach((secaoBruta, j) => {
      const secaoDeMidia = registro(secaoBruta);
      const chaveDaSecao = texto(secaoDeMidia?.['secao']);
      const campos = secaoDeMidia?.['campos'];
      if (chaveDaSecao === null || !Array.isArray(campos)) return;
      const grupo = { chave: `${i}.${j}`, titulo: `${ROTULO_DA_PLATAFORMA_DO_PLANO[chaveDaPlataforma] ?? chaveDaPlataforma} › ${tituloDaSecaoDeMidia(chaveDaSecao)}` };
      campos.forEach((campoBruto, k) => {
        const campoDoPlano = registro(campoBruto);
        const chave = texto(campoDoPlano?.['campo']);
        if (campoDoPlano === null || chave === null) return;
        const doCatalogo = catalogo.campos.find((candidato) => candidato.chave === chave);
        if (doCatalogo === undefined || doCatalogo.papel !== undefined || PADRAO_DE_DESTINO_OU_IDENTIFICADOR.test(chave)) return;
        const prefixo = `plataformas.${i}.secoes.${j}.campos.${k}`;
        const rotulo = nomeDoCampo(chave);
        const valor = descritorDoValor(`${prefixo}.valor`, rotulo, campoDoPlano['valor'], doCatalogo, grupo, ['plataformas', i, 'secoes', j, 'campos', k, 'valor']);
        if (valor !== null) descritores.push(valor);
        const justificativa = texto(campoDoPlano['justificativa']);
        if (justificativa !== null) {
          descritores.push({
            grupo,
            noDado: ['plataformas', i, 'secoes', j, 'campos', k, 'justificativa'],
            campo: campoDeTexto(`${prefixo}.justificativa`, `${rotulo}: justificativa`, justificativa, MAXIMO_DA_JUSTIFICATIVA, { longo: true, permiteVazio: true }),
            ler: lerTexto(MAXIMO_DA_JUSTIFICATIVA, true),
          });
        }
      });
    });
  });
  return descritores;
}

function descritoresDaSecao(secao: string, conteudoDaSecao: unknown, catalogos: readonly CatalogoDeCampos[]): Descritor[] {
  if (secao === 'resumo_executivo') return descritoresDoResumo(conteudoDaSecao);
  if (secao === 'plano_de_midia') return descritoresDaMidia(conteudoDaSecao, catalogos);
  return [];
}

export function gruposEditaveis(secao: string, conteudoDaSecao: unknown, catalogos: readonly CatalogoDeCampos[]): GrupoDeCampos[] {
  const grupos = new Map<string, { titulo: string; campos: CampoEditavel[] }>();
  for (const descritor of descritoresDaSecao(secao, conteudoDaSecao, catalogos)) {
    const grupo = grupos.get(descritor.grupo.chave) ?? { titulo: descritor.grupo.titulo, campos: [] };
    grupo.campos.push(descritor.campo);
    grupos.set(descritor.grupo.chave, grupo);
  }
  return [...grupos.entries()].map(([chave, grupo]) => ({ chave, titulo: grupo.titulo, campos: grupo.campos }));
}

export type ErrosDosCampos = Readonly<Record<string, string>>;

function definir(raiz: unknown, caminho: Caminho, valor: unknown): void {
  let atual = raiz as Record<string | number, unknown>;
  for (const chave of caminho.slice(0, -1)) atual = atual[chave] as Record<string | number, unknown>;
  atual[caminho[caminho.length - 1] as string | number] = valor;
}

export function aplicarCampos(
  secao: string,
  conteudoDaSecao: unknown,
  pares: Readonly<Record<string, string>>,
  catalogos: readonly CatalogoDeCampos[],
): Result<unknown, ErrosDosCampos> {
  const descritores = new Map(descritoresDaSecao(secao, conteudoDaSecao, catalogos).map((descritor) => [descritor.campo.caminho, descritor]));
  const erros: Record<string, string> = {};
  const mudancas: { readonly noDado: Caminho; readonly valor: unknown }[] = [];
  for (const [caminho, bruto] of Object.entries(pares)) {
    const descritor = descritores.get(caminho);
    if (descritor === undefined) {
      erros[caminho] = MENSAGEM_DE_CAMPO_FIXO;
      continue;
    }
    if (normalizar(bruto) === normalizar(descritor.campo.valor)) continue;
    const lido = descritor.ler(bruto);
    if (!lido.ok) erros[caminho] = lido.error;
    else mudancas.push({ noDado: descritor.noDado, valor: lido.value });
  }
  if (Object.keys(erros).length > 0) return err(erros);
  const copia = structuredClone(conteudoDaSecao);
  for (const mudanca of mudancas) definir(copia, mudanca.noDado, mudanca.valor);
  return ok(copia);
}

export function errosPorCampoDaSecao(secao: string, detalhes: Readonly<Record<string, string>> | undefined, grupos: readonly GrupoDeCampos[]): ErrosDosCampos {
  const caminhos = grupos.flatMap((grupo) => grupo.campos.map((campo) => campo.caminho));
  const erros: Record<string, string> = {};
  for (const [chave, mensagem] of Object.entries(detalhes ?? {})) {
    const relativo = chave.startsWith(`${secao}.`) ? chave.slice(secao.length + 1) : chave;
    const campo = caminhos.find((caminho) => relativo === caminho || relativo.startsWith(`${caminho}.`));
    if (campo !== undefined) erros[campo] ??= mensagem;
  }
  return erros;
}
