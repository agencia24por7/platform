import { TITULO_DA_MEMORIA, type FonteCitada, type MemoriaDoPlano } from './memoriaDoPlano.ts';

const ESCAPE_HTML: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const CARACTERES_DE_MARKDOWN = /[\\`*_{}[\]()#+!|~$]/g;
const MARCA_DE_ENDERECO = /(:)(?=\/\/)|(@)/g;
const AUTOLINK_WWW = /(^|[^\p{L}\p{N}])(www)\./giu;

export const TEXTO_DE_SEM_REGISTRO = 'Sem registro.';

export function escaparMarkdown(texto: string): string {
  return texto
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[&<>]/g, (caractere) => ESCAPE_HTML[caractere] ?? caractere)
    .replace(CARACTERES_DE_MARKDOWN, (caractere) => `\\${caractere}`)
    .replace(MARCA_DE_ENDERECO, (_, doisPontos: string | undefined, arroba: string | undefined) => `\\${doisPontos ?? arroba ?? ''}`)
    .replace(AUTOLINK_WWW, (_, antes: string, www: string) => `${antes}${www}\\.`)
    .replace(/^([-]|\d+\.)(?=\s|$)/, (inicio) => `\\${inicio}`);
}

const e = escaparMarkdown;

function lista(itens: readonly string[]): string[] {
  return itens.length === 0 ? [TEXTO_DE_SEM_REGISTRO] : itens.map((item) => `- ${item}`);
}

function fonte(item: FonteCitada): string {
  return `${e(item.titulo)} (${e(item.papel)}${item.nota ? `, nota ${e(item.nota)}` : ''})`;
}

export function memoriaEmMarkdown(memoria: MemoriaDoPlano): string {
  const linhas: string[] = [`# ${TITULO_DA_MEMORIA}: ${e(memoria.titulo)}`, ''];

  linhas.push('## Versões', '');
  if (memoria.versoesParciais) linhas.push('Mostra só as versões mais recentes.', '');
  linhas.push(
    ...lista(
      memoria.versoes.map((versao) => {
        const marcos = versao.marcos.length > 0 ? ` ${versao.marcos.map(e).join('; ')}.` : '';
        return `**${e(versao.rotulo)}**, ${e(versao.quando)}: ${e(versao.tipo)}, por ${e(versao.autor)}. Estado: ${e(versao.status)}.${marcos}`;
      }),
    ),
    '',
  );

  linhas.push('## Intenção e foco', '');
  if (memoria.intencao === null) linhas.push(TEXTO_DE_SEM_REGISTRO);
  else {
    const { intencao } = memoria;
    linhas.push(
      `- Objetivo: ${e(intencao.objetivo)}`,
      `- Foco: ${intencao.foco === null ? 'não informado' : e(intencao.foco)}`,
      `- Período: ${e(intencao.horizonte)}`,
      `- Verba: ${e(intencao.verba)}`,
      `- Ousadia: ${e(intencao.ousadia)}`,
      `- Plataformas: ${intencao.plataformas.length === 0 ? 'não informadas' : intencao.plataformas.map(e).join(', ')}`,
    );
  }
  linhas.push('');

  linhas.push('## Decisões criativas', '');
  if (memoria.decisoes.length === 0) linhas.push(TEXTO_DE_SEM_REGISTRO, '');
  for (const grupo of memoria.decisoes) {
    linhas.push(`### ${e(grupo.versao)}, ${e(grupo.quando)}`, '');
    linhas.push(...lista(grupo.itens.map((item) => `**${e(item.tema)}**, ${e(item.autor)}: ${e(item.decisao)}. Motivo: ${e(item.motivo)}`)), '');
  }

  linhas.push('## Sinais de cultura', '', ...lista(memoria.cultura.map(fonte)), '');
  linhas.push('## Evidências citadas', '', ...lista(memoria.evidencias.map(fonte)), '');
  linhas.push('## Créditos', '');
  linhas.push(`- Pessoas: ${memoria.creditos.pessoas.length === 0 ? 'sem registro' : memoria.creditos.pessoas.map(e).join('; ')}`);
  linhas.push(`- Comitês convocados: ${memoria.creditos.comites.length === 0 ? 'sem registro' : memoria.creditos.comites.map(e).join('; ')}`, '');
  linhas.push('## Resultados', '', ...lista(memoria.resultados.map(e)), '');
  linhas.push('_Documento montado só com o que está gravado no plano, sem uso de IA._', '');
  return linhas.join('\n');
}
