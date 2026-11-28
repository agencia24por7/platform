import { z } from 'zod';
import { err, ok, type Result } from '../../../shared/result/result.ts';
import { dataIsoValida } from '../domain/datas.ts';
import { OUSADIAS, PLATAFORMAS, type Plataforma, type SecaoDoPlano } from '../domain/plano.ts';
import { TIPOS_DE_PLANO, type TipoDePlano } from '../domain/tipoDePlano.ts';
import { secaoEditavel, type SecaoEditavel } from './camposEditaveisDaSecao.ts';
import { lerVerbaDoFormulario, periodoDaVerba } from './verbaDoPlano.ts';

export type CamposBrutos = Readonly<Record<string, string | undefined>>;
export type ErrosDeCampo = Readonly<Record<string, string>>;

const CAMPOS_DE_VALOR_MULTIPLO: ReadonlySet<string> = new Set(['plataformas', 'produtos']);

export function camposBrutosDasEntradas(entradas: Iterable<readonly [string, unknown]>): CamposBrutos {
  const campos: Record<string, string> = {};
  for (const [chave, valor] of entradas) {
    if (typeof valor !== 'string') continue;
    campos[chave] = CAMPOS_DE_VALOR_MULTIPLO.has(chave) && campos[chave] !== undefined ? `${campos[chave]},${valor}` : valor;
  }
  return campos;
}

export function listaSeparadaPorVirgula(texto: string | undefined): readonly string[] {
  return (texto ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '');
}

export const TAMANHO_MAXIMO_DA_INSTRUCAO_NA_TELA = 2000;

const identificador = z.string().uuid('Identificador inválido.');

const esquemaDoId = (chave: string) => z.strictObject({ [chave]: identificador });

export function lerIdDoCampo(campos: CamposBrutos, chave: string): Result<string, ErrosDeCampo> {
  const lido = esquemaDoId(chave).safeParse({ [chave]: campos[chave] ?? '' });
  return lido.success ? ok(lido.data[chave] as string) : err({ [chave]: 'Identificador inválido.' });
}

export type FocoDoFormulario = { readonly tipo: 'marca' } | { readonly tipo: 'produtos'; readonly produtos: readonly string[] };

export type IntencaoDoFormulario = {
  readonly tipoDePlano: TipoDePlano;
  readonly plataformas: readonly Plataforma[];
  readonly landingPageId: string;
  readonly foco: FocoDoFormulario;
  readonly intencao: {
    readonly objetivo: string;
    readonly horizonte: { readonly inicio: string; readonly fim: string };
    readonly ousadia: (typeof OUSADIAS)[number];
    readonly retorno_esperado: { readonly descricao: string };
    readonly verba: { readonly centavos: string; readonly moeda: 'BRL' };
  };
};

const MAXIMO_DE_PRODUTOS_NO_FORMULARIO = 20;

export function lerFocoDoFormulario(campos: CamposBrutos): Result<FocoDoFormulario, ErrosDeCampo> {
  const marca = (campos['focoMarca'] ?? '').trim() === '1';
  const produtos = [...new Set((campos['produtos'] ?? '').split(',').map((item) => item.trim()).filter((item) => item !== ''))];
  if (marca && produtos.length > 0) return err({ foco: 'Escolha produtos ou campanha de marca, não os dois.' });
  if (marca) return ok({ tipo: 'marca' });
  if (produtos.length === 0) return err({ foco: 'Escolha ao menos um produto ou marque campanha de marca.' });
  if (produtos.length > MAXIMO_DE_PRODUTOS_NO_FORMULARIO) return err({ foco: `Escolha no máximo ${MAXIMO_DE_PRODUTOS_NO_FORMULARIO} produtos.` });
  return ok({ tipo: 'produtos', produtos });
}

const esquemaDaData = z.string().refine(dataIsoValida, 'Informe uma data válida.');

export function lerIntencaoDoFormulario(campos: CamposBrutos): Result<IntencaoDoFormulario, ErrosDeCampo> {
  const erros: Record<string, string> = {};
  const aparado = (chave: string) => (campos[chave] ?? '').trim();

  const tipo = z.enum(TIPOS_DE_PLANO).safeParse(aparado('tipoDePlano'));
  if (!tipo.success) erros['tipoDePlano'] = 'Escolha o tipo de plano.';

  const plataformas = [...new Set(aparado('plataformas').split(',').map((item) => item.trim()).filter((item) => item !== ''))];
  const plataformasLidas = z.array(z.enum(PLATAFORMAS)).min(1).safeParse(plataformas);
  if (!plataformasLidas.success) erros['plataformas'] = 'Escolha ao menos uma plataforma.';

  const landingPage = identificador.safeParse(aparado('landingPageId'));
  if (!landingPage.success) erros['landingPageId'] = 'Escolha a landing page.';

  const foco = lerFocoDoFormulario(campos);
  if (!foco.ok) erros['foco'] = foco.error['foco'] ?? 'Defina o foco do plano.';

  const objetivo = aparado('objetivo');
  if (objetivo.length < 3) erros['objetivo'] = 'Descreva o objetivo (mínimo 3 caracteres).';
  else if (objetivo.length > 600) erros['objetivo'] = 'O objetivo pode ter no máximo 600 caracteres.';

  const inicio = esquemaDaData.safeParse(aparado('inicio'));
  if (!inicio.success) erros['inicio'] = 'Informe a data de início.';
  const fim = esquemaDaData.safeParse(aparado('fim'));
  if (!fim.success) erros['fim'] = 'Informe a data de fim.';
  if (inicio.success && fim.success && inicio.data > fim.data) erros['fim'] = 'O fim não pode ser antes do início.';

  const ousadia = z.enum(OUSADIAS).safeParse(aparado('ousadia'));
  if (!ousadia.success) erros['ousadia'] = 'Escolha o nível de ousadia.';

  const retorno = aparado('retorno');
  if (retorno.length < 3) erros['retorno'] = 'Descreva o retorno esperado (mínimo 3 caracteres).';
  else if (retorno.length > 400) erros['retorno'] = 'O retorno esperado pode ter no máximo 400 caracteres.';

  const periodo = inicio.success && fim.success ? periodoDaVerba({ inicio: inicio.data, fim: fim.data }) : null;
  const verba = lerVerbaDoFormulario(campos, periodo);
  if (!verba.ok) erros['verba'] = verba.error;

  if (Object.keys(erros).length > 0 || !plataformasLidas.success || !landingPage.success || !foco.ok || !tipo.success || !inicio.success || !fim.success || !ousadia.success || !verba.ok || verba.value === null) return err(erros);
  const centavos = verba.value;

  return ok({
    tipoDePlano: tipo.data,
    plataformas: plataformasLidas.data,
    landingPageId: landingPage.data,
    foco: foco.value,
    intencao: {
      objetivo,
      horizonte: { inicio: inicio.data, fim: fim.data },
      ousadia: ousadia.data,
      retorno_esperado: { descricao: retorno },
      verba: { centavos, moeda: 'BRL' },
    },
  });
}

export type PedidoDePrevia = {
  readonly tipoDePlano: TipoDePlano;
  readonly plataformas: readonly Plataforma[];
  readonly landingPageId: string;
  readonly nomeDaCampanha: string;
  readonly inicio: string;
};

export function lerPedidoDePrevia(campos: CamposBrutos): Result<PedidoDePrevia, ErrosDeCampo> {
  const erros: Record<string, string> = {};
  const aparado = (chave: string) => (campos[chave] ?? '').trim();
  const tipo = z.enum(TIPOS_DE_PLANO).safeParse(aparado('tipoDePlano'));
  if (!tipo.success) erros['tipoDePlano'] = 'Escolha o tipo de plano.';
  const plataformas = z.array(z.enum(PLATAFORMAS)).min(1).safeParse([...new Set(aparado('plataformas').split(',').map((item) => item.trim()).filter((item) => item !== ''))]);
  if (!plataformas.success) erros['plataformas'] = 'Escolha ao menos uma plataforma para ver os links.';
  const landingPage = identificador.safeParse(aparado('landingPageId'));
  if (!landingPage.success) erros['landingPageId'] = 'Escolha a landing page.';
  const objetivo = aparado('objetivo');
  if (objetivo.length < 3) erros['objetivo'] = 'Descreva o objetivo para ver os links (mínimo 3 caracteres).';
  const inicio = esquemaDaData.safeParse(aparado('inicio'));
  if (!inicio.success) erros['inicio'] = 'Informe a data de início para ver os links.';
  if (!tipo.success || !plataformas.success || !landingPage.success || !inicio.success || objetivo.length < 3) return err(erros);
  return ok({ tipoDePlano: tipo.data, plataformas: plataformas.data, landingPageId: landingPage.data, nomeDaCampanha: objetivo, inicio: inicio.data });
}

export function lerPedidoDeMudanca(campos: CamposBrutos): Result<{ readonly planoId: string; readonly versaoId: string; readonly instrucao: string }, ErrosDeCampo> {
  const lido = z
    .strictObject({
      planoId: identificador,
      versaoId: identificador,
      instrucao: z.string().trim().min(3, 'Descreva a mudança (mínimo 3 caracteres).').max(TAMANHO_MAXIMO_DA_INSTRUCAO_NA_TELA, `A mudança pode ter no máximo ${TAMANHO_MAXIMO_DA_INSTRUCAO_NA_TELA} caracteres.`),
    })
    .safeParse({ planoId: campos['planoId'] ?? '', versaoId: campos['versaoId'] ?? '', instrucao: campos['instrucao'] ?? '' });
  if (lido.success) return ok(lido.data);
  const erros: Record<string, string> = {};
  for (const problema of lido.error.issues) erros[String(problema.path[0] ?? 'instrucao')] ??= problema.message;
  return err(erros);
}

export const PREFIXO_DO_CAMPO_EDITAVEL = 'campo:';
export const MAXIMO_DE_CAMPOS_ENVIADOS = 1000;
export const MAXIMO_DO_VALOR_ENVIADO = 12_000;
const MAXIMO_DO_CAMINHO_ENVIADO = 200;

export type EdicaoPorCampos = {
  readonly planoId: string;
  readonly versaoId: string;
  readonly secao: SecaoEditavel;
  readonly pares: Readonly<Record<string, string>>;
};

export function lerEdicaoPorCampos(campos: CamposBrutos): Result<EdicaoPorCampos, ErrosDeCampo> {
  const planoId = lerIdDoCampo(campos, 'planoId');
  if (!planoId.ok) return err({ planoId: 'Plano inválido.' });
  const versaoId = lerIdDoCampo(campos, 'versaoId');
  if (!versaoId.ok) return err({ versaoId: 'Versão inválida.' });
  const secao = campos['secao'] ?? '';
  if (!secaoEditavel(secao)) return err({ secao: 'Esta seção não pode ser editada.' });
  if (campos['json'] !== undefined) return err({ edicao: 'O envio da edição não aceita conteúdo bruto.' });
  const pares: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    if (!chave.startsWith(PREFIXO_DO_CAMPO_EDITAVEL) || valor === undefined) continue;
    const caminho = chave.slice(PREFIXO_DO_CAMPO_EDITAVEL.length);
    if (caminho === '' || caminho.length > MAXIMO_DO_CAMINHO_ENVIADO) return err({ edicao: 'Campo inválido no envio.' });
    if (valor.length > MAXIMO_DO_VALOR_ENVIADO) return err({ [caminho]: 'O valor é grande demais.' });
    pares[caminho] = valor;
  }
  const quantidade = Object.keys(pares).length;
  if (quantidade === 0) return err({ edicao: 'Nenhum campo foi enviado.' });
  if (quantidade > MAXIMO_DE_CAMPOS_ENVIADOS) return err({ edicao: 'Campos demais no envio.' });
  return ok({ planoId: planoId.value, versaoId: versaoId.value, secao, pares });
}

export function trocarSecao(conteudo: unknown, secao: SecaoDoPlano, valor: unknown): Record<string, unknown> | null {
  if (typeof conteudo !== 'object' || conteudo === null || Array.isArray(conteudo)) return null;
  return { ...(conteudo as Record<string, unknown>), [secao]: valor };
}
