import { campoAplicavel, campoNaoVerificado, catalogoDaPlataforma, objetivoDoValor, VALOR_A_CONFIRMAR, type CampoDoCatalogo, type CatalogoDeCampos } from '../catalogo/tipos.ts';
import { problemasDeDependenciaDaMeta } from './dependenciasDaMeta.ts';
import type { CampoDeMidia, IntencaoDoPlano, MidiaDaPlataforma, Plataforma } from '../plano.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_COBERTURA_DO_PLANO_DE_MIDIA = 'cobertura_do_plano_de_midia';

function valorCombina(campo: CampoDoCatalogo, valor: CampoDeMidia['valor']): boolean {
  switch (campo.tipoDoValor) {
    case 'texto':
      return typeof valor === 'string';
    case 'numero':
      return typeof valor === 'number' && Number.isFinite(valor);
    case 'booleano':
      return typeof valor === 'boolean';
    case 'lista':
      return Array.isArray(valor);
    case 'escolha':
      return typeof valor === 'string' && (campo.opcoes ?? []).includes(valor);
  }
}

type Presente = { readonly secao: string; readonly campo: CampoDeMidia };

export const CAMPOS_DE_DESTINO = { url: 'url_de_destino', parametrosDeUrl: 'parametros_de_url', whatsapp: 'numero_do_whatsapp' } as const;

function presentesDaEntrada(entrada: MidiaDaPlataforma): Presente[] {
  return entrada.secoes.flatMap((secao) => secao.campos.map((campo) => ({ secao: secao.secao, campo })));
}

function textoDoValor(valor: CampoDeMidia['valor']): string {
  return Array.isArray(valor) ? valor.join(',') : String(valor);
}

function problemasDoDestino(porChave: ReadonlyMap<string, Presente>, intencao: IntencaoDoPlano, plataforma: Plataforma): string[] {
  const problemas: string[] = [];
  const local = (chave: string) => `plano_de_midia/${plataforma}/${chave}`;
  const url = porChave.get(CAMPOS_DE_DESTINO.url);
  if (url !== undefined && intencao.destino !== undefined && textoDoValor(url.campo.valor) !== intencao.destino.url) {
    problemas.push(`${local(CAMPOS_DE_DESTINO.url)} (difere da landing page da intenção; copie sem alterar)`);
  }
  const zap = porChave.get(CAMPOS_DE_DESTINO.whatsapp);
  if (zap !== undefined && intencao.whatsapp !== undefined && textoDoValor(zap.campo.valor) !== intencao.whatsapp) {
    problemas.push(`${local(CAMPOS_DE_DESTINO.whatsapp)} (difere do WhatsApp da intenção; copie sem alterar)`);
  }
  const parametros = porChave.get(CAMPOS_DE_DESTINO.parametrosDeUrl);
  const utm = intencao.utm?.[plataforma];
  if (parametros !== undefined && utm !== undefined) {
    const texto = textoDoValor(parametros.campo.valor);
    const esperados = [`utm_source=${utm.utm_source}`, `utm_medium=${utm.utm_medium}`, `utm_campaign=${utm.utm_campaign}`];
    if (!esperados.every((par) => texto.includes(par))) {
      problemas.push(`${local(CAMPOS_DE_DESTINO.parametrosDeUrl)} (UTM difere da gerada pelo sistema; copie sem alterar)`);
    }
  }
  return problemas;
}

function ehAConfirmar(campo: CampoDoCatalogo, valor: CampoDeMidia['valor']): boolean {
  return valor === VALOR_A_CONFIRMAR && campoNaoVerificado(campo);
}

export type AnaliseDaPlataforma = { readonly problemas: string[]; readonly pendencias: string[] };

export function analisarPlataforma(entrada: MidiaDaPlataforma | undefined, catalogo: CatalogoDeCampos, intencao: IntencaoDoPlano): AnaliseDaPlataforma {
  const plataforma = catalogo.plataforma;
  const presentes = entrada === undefined ? [] : presentesDaEntrada(entrada);
  const porChave = new Map(presentes.map((p) => [p.campo.campo, p]));
  const problemas: string[] = [];
  const pendencias: string[] = [];
  const local = (chave: string) => `plano_de_midia/${plataforma}/${chave}`;
  const declarado = porChave.get(catalogo.campoDoObjetivo)?.campo.valor;
  const objetivo = objetivoDoValor(declarado);
  if (objetivo === undefined || !catalogo.objetivos.includes(objetivo)) {
    problemas.push(`${local(catalogo.campoDoObjetivo)} (objetivo ausente ou fora do catálogo; não dá para conferir o que se aplica)`);
  }
  for (const campo of catalogo.campos) {
    const achado = porChave.get(campo.chave);
    if (achado === undefined) {
      if (campo.chave !== catalogo.campoDoObjetivo && campo.obrigatorio && campoAplicavel(campo, objetivo)) problemas.push(`${local(campo.chave)} (campo obrigatório ausente)`);
      continue;
    }
    if (achado.secao !== campo.secao) problemas.push(`${local(campo.chave)} (na seção ${achado.secao}; o catálogo pede ${campo.secao})`);
    if (achado.campo.justificativa.trim().length === 0) problemas.push(`${local(campo.chave)} (sem justificativa)`);
    if (ehAConfirmar(campo, achado.campo.valor)) {
      pendencias.push(`${local(campo.chave)} (a confirmar; a API não verifica este campo)`);
      continue;
    }
    if (achado.campo.valor === VALOR_A_CONFIRMAR) {
      problemas.push(`${local(campo.chave)} (a_confirmar só vale em campo que a API não verifica)`);
      continue;
    }
    if (!valorCombina(campo, achado.campo.valor)) problemas.push(`${local(campo.chave)} (valor fora do tipo ${campo.tipoDoValor})`);
  }
  const chavesDoCatalogo = new Set(catalogo.campos.map((campo) => campo.chave));
  for (const { campo } of presentes) {
    if (!chavesDoCatalogo.has(campo.campo)) problemas.push(`${local(campo.campo)} (campo fora do catálogo)`);
  }
  if (plataforma === 'meta') {
    const valores = new Map(presentes.map((p) => [p.campo.campo, p.campo.valor]));
    problemas.push(...problemasDeDependenciaDaMeta(valores, chavesDoCatalogo, local));
  }
  return { problemas: [...problemas, ...problemasDoDestino(porChave, intencao, plataforma)], pendencias };
}

export function problemasDaPlataforma(entrada: MidiaDaPlataforma | undefined, catalogo: CatalogoDeCampos, intencao: IntencaoDoPlano): string[] {
  return analisarPlataforma(entrada, catalogo, intencao).problemas;
}

export function checarCoberturaDoPlanoDeMidia(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano, catalogosDeCampos } = contexto;
  const escolhidas = plano.intencao.plataformas ?? [];
  if (escolhidas.length === 0) {
    return reprovar(CHAVE_COBERTURA_DO_PLANO_DE_MIDIA, 'A intenção não traz plataformas escolhidas.', ['intencao/plataformas']);
  }
  const problemas: string[] = [];
  const pendencias: string[] = [];
  for (const plataforma of escolhidas) {
    const catalogo = catalogoDaPlataforma(catalogosDeCampos, plataforma);
    if (catalogo === undefined) {
      problemas.push(`plano_de_midia/${plataforma} (sem catálogo de campos: não é possível conferir)`);
      continue;
    }
    const entrada = plano.plano_de_midia.plataformas.find((candidata) => candidata.plataforma === plataforma);
    const analise = analisarPlataforma(entrada, catalogo, plano.intencao);
    problemas.push(...analise.problemas);
    pendencias.push(...analise.pendencias);
  }
  if (problemas.length === 0) {
    const motivo = pendencias.length === 0
      ? 'Todo campo aplicável do catálogo está no plano de mídia, com justificativa.'
      : `Cobertura completa, com ${pendencias.length} campo(s) a confirmar.`;
    return aprovar(CHAVE_COBERTURA_DO_PLANO_DE_MIDIA, motivo, pendencias);
  }
  return reprovar(CHAVE_COBERTURA_DO_PLANO_DE_MIDIA, `${problemas.length} problema(s) de cobertura do plano de mídia.`, [...problemas, ...pendencias]);
}
