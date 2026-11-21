import { ROTULO_DA_SENSIBILIDADE, ROTULO_DO_FRESCOR, type BrainDoCliente } from './tipos.ts';
import { AVISO_DE_DADOS, textoNeutro } from '../../../../../shared/markdown/dadoNoMarkdown.ts';

type SemMd = Omit<BrainDoCliente, 'catalogoMd'>;

const ESTADO: Record<string, string> = { disponivel: 'disponível', parcial: 'parcial', indisponivel: 'indisponível' };

function linhaDaTabela(celulas: readonly string[]): string {
  return `| ${celulas.join(' | ')} |`;
}

export function renderizarCatalogoMd(clienteNome: string, brain: SemMd): string {
  const linhas: string[] = [
    `# Catálogo do Brain · ${textoNeutro(clienteNome)}`,
    '',
    `> ${AVISO_DE_DADOS}`,
    '',
    `versão ${brain.versao} · hash ${brain.hash} · gerado em ${brain.atualizadoEm.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Saúde ${brain.pulso.saude}% · cobertura ${brain.pulso.cobertura}% · frescor ${brain.pulso.frescor}% · contexto ${brain.pulso.completudeDoContexto}%`,
    '',
    '## O que dá para responder',
    '',
  ];
  for (const capacidade of brain.capacidades) {
    const falta = capacidade.falta.length ? ` (falta: ${textoNeutro(capacidade.falta.join('; '))})` : '';
    linhas.push(`- **${textoNeutro(capacidade.pergunta)}** — ${ESTADO[capacidade.estado] ?? capacidade.estado}${falta}`);
  }
  linhas.push('', '## Entradas', '');
  linhas.push(linhaDaTabela(['URN', 'Tipo', 'Título', 'Frescor', 'Sensibilidade', 'Acesso']));
  linhas.push(linhaDaTabela(['---', '---', '---', '---', '---', '---']));
  for (const entrada of brain.entradas) {
    linhas.push(
      linhaDaTabela([
        `\`${entrada.urn}\``,
        textoNeutro(entrada.tipo),
        textoNeutro(entrada.titulo),
        ROTULO_DO_FRESCOR[entrada.frescor.status],
        `${ROTULO_DA_SENSIBILIDADE[entrada.sensibilidade.nivel]}${entrada.sensibilidade.piiPossivel ? ' · PII possível' : ''}`,
        textoNeutro(entrada.acesso.via),
      ]),
    );
  }
  const comEsquema = brain.entradas.filter((e) => e.esquema.length > 0);
  if (comEsquema.length > 0) {
    linhas.push('', '## Esquemas', '');
    for (const entrada of comEsquema) {
      linhas.push(`### ${textoNeutro(entrada.titulo)}`, '', `\`${entrada.urn}\` · grão: ${textoNeutro(entrada.grao ?? '—')}`, '');
      for (const coluna of entrada.esquema) {
        linhas.push(`- \`${coluna.nome}\` ${textoNeutro(coluna.tipo)} — ${textoNeutro(coluna.descricao)}`);
      }
      linhas.push('');
    }
  }
  return linhas.join('\n').trimEnd() + '\n';
}
