import { ROTULO_DA_SENSIBILIDADE, ROTULO_DO_FRESCOR, type BrainDoCliente } from './tipos.ts';

type SemMd = Omit<BrainDoCliente, 'catalogoMd'>;

const ESTADO: Record<string, string> = { disponivel: 'disponível', parcial: 'parcial', indisponivel: 'indisponível' };

function linhaDaTabela(celulas: readonly string[]): string {
  return `| ${celulas.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
}

export function renderizarCatalogoMd(clienteNome: string, brain: SemMd): string {
  const linhas: string[] = [
    `# Catálogo do Brain · ${clienteNome}`,
    '',
    `versão ${brain.versao} · hash ${brain.hash} · gerado em ${brain.atualizadoEm.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Saúde ${brain.pulso.saude}% · cobertura ${brain.pulso.cobertura}% · frescor ${brain.pulso.frescor}% · contexto ${brain.pulso.completudeDoContexto}%`,
    '',
    '## O que dá para responder',
    '',
  ];
  for (const capacidade of brain.capacidades) {
    linhas.push(`- **${capacidade.pergunta}** — ${ESTADO[capacidade.estado] ?? capacidade.estado}${capacidade.falta.length ? ` (falta: ${capacidade.falta.join('; ')})` : ''}`);
  }
  linhas.push('', '## Entradas', '');
  linhas.push(linhaDaTabela(['URN', 'Tipo', 'Título', 'Frescor', 'Sensibilidade', 'Acesso']));
  linhas.push(linhaDaTabela(['---', '---', '---', '---', '---', '---']));
  for (const entrada of brain.entradas) {
    linhas.push(
      linhaDaTabela([
        `\`${entrada.urn}\``,
        entrada.tipo,
        entrada.titulo,
        ROTULO_DO_FRESCOR[entrada.frescor.status],
        `${ROTULO_DA_SENSIBILIDADE[entrada.sensibilidade.nivel]}${entrada.sensibilidade.piiPossivel ? ' · PII possível' : ''}`,
        entrada.acesso.via,
      ]),
    );
  }
  const comEsquema = brain.entradas.filter((e) => e.esquema.length > 0);
  if (comEsquema.length > 0) {
    linhas.push('', '## Esquemas', '');
    for (const entrada of comEsquema) {
      linhas.push(`### ${entrada.titulo}`, '', `\`${entrada.urn}\` · grão: ${entrada.grao ?? '—'}`, '');
      for (const coluna of entrada.esquema) linhas.push(`- \`${coluna.nome}\` ${coluna.tipo} — ${coluna.descricao}`);
      linhas.push('');
    }
  }
  return linhas.join('\n').trimEnd() + '\n';
}
