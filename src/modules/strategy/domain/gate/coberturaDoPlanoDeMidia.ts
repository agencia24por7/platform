import { campoAplicavel, campoNaoVerificado, catalogoDaPlataforma, objetivoDoValor, VALOR_A_CONFIRMAR, type CampoDoCatalogo, type CatalogoDeCampos, type PapelDoCampo } from '../catalogo/tipos.ts';
import { problemasDeDependenciaDaMeta } from './dependenciasDaMeta.ts';
import { problemasDeDependenciaDoGoogle } from './dependenciasDoGoogle.ts';
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

function presentesDaEntrada(entrada: MidiaDaPlataforma): Presente[] {
  return entrada.secoes.flatMap((secao) => secao.campos.map((campo) => ({ secao: secao.secao, campo })));
}

function textoDoValor(valor: CampoDeMidia['valor']): string {
  return Array.isArray(valor) ? valor.join(',') : String(valor);
}

function utmConfere(valor: CampoDeMidia['valor'], utm: { readonly utm_source: string; readonly utm_medium: string; readonly utm_campaign: string }): boolean {
  const consulta = new URLSearchParams(textoDoValor(valor).replace(/^\?/, ''));
  const esperado: Record<string, string> = { utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign };
  return Object.entries(esperado).every(([chave, valorEsperado]) => {
    const achados = consulta.getAll(chave);
    return achados.length === 1 && achados[0] === valorEsperado;
  });
}

function problemasDoDestino(catalogo: CatalogoDeCampos, porChave: ReadonlyMap<string, Presente>, intencao: IntencaoDoPlano, objetivo: string | undefined): string[] {
  const plataforma = catalogo.plataforma;
  const problemas: string[] = [];
  const local = (chave: string) => `plano_de_midia/${plataforma}/${chave}`;
  const utm = intencao.utm?.[plataforma];
  const conferencias: ReadonlyArray<{ papel: PapelDoCampo; existe: boolean; confere: (valor: CampoDeMidia['valor']) => boolean; erro: string }> = [
    { papel: 'url_destino', existe: intencao.destino !== undefined, confere: (valor) => textoDoValor(valor) === intencao.destino?.url, erro: 'difere da landing page da intenção; copie sem alterar' },
    { papel: 'whatsapp', existe: intencao.whatsapp !== undefined, confere: (valor) => textoDoValor(valor) === intencao.whatsapp, erro: 'difere do WhatsApp da intenção; copie sem alterar' },
    { papel: 'utm', existe: utm !== undefined, confere: (valor) => utm !== undefined && utmConfere(valor, utm), erro: 'UTM difere da gerada pelo sistema; copie sem alterar' },
  ];
  const semDestino = objetivo !== undefined && (catalogo.objetivosSemDestino ?? []).includes(objetivo);
  for (const { papel, existe, confere, erro } of conferencias) {
    if (semDestino && (papel === 'url_destino' || papel === 'utm')) {
      for (const campo of catalogo.campos.filter((candidato) => candidato.papel === papel && porChave.has(candidato.chave))) {
        problemas.push(`${local(campo.chave)} (o objetivo ${objetivo} não carrega URL nem UTM; não preencha)`);
      }
      continue;
    }
    const campos = catalogo.campos.filter((campo) => campo.papel === papel && campoAplicavel(campo, objetivo));
    const exigido = papel !== 'whatsapp' || catalogo.campos.some((campo) => campo.papel === papel);
    if (existe && exigido && campos.length === 0) {
      problemas.push(`plano_de_midia/${plataforma} (o catálogo não tem campo aplicável ao objetivo com papel ${papel}; não dá para garantir o valor da intenção)`);
    }
    for (const campo of campos) {
      const achado = porChave.get(campo.chave);
      if (achado === undefined || achado.campo.valor === VALOR_A_CONFIRMAR) continue;
      if (!existe) problemas.push(`${local(campo.chave)} (a intenção não tem o valor do papel ${papel}; não preencha)`);
      else if (!confere(achado.campo.valor)) problemas.push(`${local(campo.chave)} (${erro})`);
    }
  }
  return problemas;
}

function ehAConfirmar(campo: CampoDoCatalogo, valor: CampoDeMidia['valor']): boolean {
  return valor === VALOR_A_CONFIRMAR && campoNaoVerificado(campo) && campo.papel === undefined;
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
  if (plataforma === 'google') {
    const valores = new Map(presentes.map((p) => [p.campo.campo, p.campo.valor]));
    problemas.push(...problemasDeDependenciaDoGoogle(valores, objetivo, local, catalogo));
  }
  return { problemas: [...problemas, ...problemasDoDestino(catalogo, porChave, intencao, objetivo)], pendencias };
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
