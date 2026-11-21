import type { Snapshot } from '../../../../brain/application/construirCatalogo.ts';
import type { AcaoRecomendada } from '../../../../brain/domain/diagnostico.ts';
import type { Acesso, Cobertura, EntradaDoCatalogo } from '../../../../brain/domain/entrada.ts';
import { renderizarCatalogoMd } from '../../../../brain/domain/markdown.ts';
import { rotaDoCliente } from '../enderecos.ts';
import {
  TIPOS_DE_ENTRADA,
  type BrainDoCliente,
  type Capacidade,
  type EntradaDoBrain,
  type Frescor,
  type Lacuna,
  type ProximaAcao,
  type TipoDeEntrada,
} from './tipos.ts';

const DIAS = 90;
const MS_POR_DIA = 86_400_000;
const PESO_DO_FRESCOR: Record<Frescor, number> = { fresco: 1, atrasado: 0.5, parado: 0, desconhecido: 0 };

function diaIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function serieDosUltimos90Dias(cobertura: Cobertura | null, agora: Date): boolean[] | null {
  if (!cobertura || !cobertura.desde || !cobertura.ate) return null;
  const { desde, ate, lacunas } = cobertura;
  return Array.from({ length: DIAS }, (_, i) => {
    const dia = diaIso(new Date(agora.getTime() - (DIAS - 1 - i) * MS_POR_DIA));
    if (dia < desde || dia > ate) return false;
    return !lacunas.some((l) => dia >= l.de && dia <= l.ate);
  });
}

function receita(acesso: Acesso): { via: EntradaDoBrain['acesso']['via']; receita: string } {
  switch (acesso.tipo) {
    case 'bigquery': {
      const exemplo = acesso.exemplosDeConsulta[0]?.sql;
      if (exemplo) return { via: 'bigquery', receita: exemplo };
      const filtros = Object.entries(acesso.filtros).map(([coluna, valor]) => `${coluna} = '${valor}'`);
      const colunas = acesso.colunas.length ? acesso.colunas.slice(0, 12).join(', ') : '*';
      return {
        via: 'bigquery',
        receita: `SELECT ${colunas}\nFROM \`${acesso.conjuntoDeDados}.${acesso.objeto}\`${filtros.length ? `\nWHERE ${filtros.join('\n  AND ')}` : ''}`,
      };
    }
    case 'contexto':
      return { via: 'contexto', receita: acesso.caminho ?? `contexto/${acesso.secao} (${acesso.chaves.join(', ')})` };
    case 'arquivo':
      return { via: 'arquivo', receita: acesso.caminho ?? `${acesso.mime} · ${acesso.tamanhoBytes} bytes` };
    case 'status':
      return { via: 'status', receita: 'Só o estado da conexão; sem dado para consultar.' };
    case 'derivado':
      return { via: 'derivado', receita: `Derivado de:\n${acesso.de.join('\n')}` };
    case 'restrito':
      return { via: 'restrito', receita: acesso.motivo };
    case 'externo':
      return { via: 'externo', receita: `${acesso.sistema}: ${acesso.instrucoes}` };
  }
}

function ehTipoConhecido(tipo: string): tipo is TipoDeEntrada {
  return (TIPOS_DE_ENTRADA as readonly string[]).includes(tipo);
}

function completude(entrada: EntradaDoCatalogo): number {
  if (entrada.qualidade.completude !== null) return entrada.qualidade.completude;
  const c = entrada.cobertura;
  if (c?.diasEsperados && c.diasComDado !== null) return Math.min(c.diasComDado / c.diasEsperados, 1);
  return entrada.frescor?.status === 'fresco' ? 1 : 0.5;
}

export function entradaDaVisao(entrada: EntradaDoCatalogo, agora: Date): EntradaDoBrain | null {
  if (!ehTipoConhecido(entrada.tipo)) return null;
  const c = entrada.cobertura;
  return {
    urn: entrada.urn,
    tipo: entrada.tipo,
    titulo: entrada.titulo,
    descricao: entrada.valorResumido ? `${entrada.descricao} ${entrada.valorResumido}` : entrada.descricao,
    provedor: entrada.plataforma ?? entrada.provedor,
    esquema: (entrada.esquema?.colunas ?? []).map((col) => ({
      nome: col.nome,
      tipo: col.tipo,
      descricao: col.unidade ? `${col.significado} (${col.unidade})` : col.significado,
    })),
    grao: entrada.grao && entrada.grao.length ? entrada.grao.join(' · ') : null,
    cobertura: {
      desde: c?.desde ?? null,
      ate: c?.ate ?? null,
      linhas: c?.linhas ?? null,
      diasComDado: c?.diasComDado ?? null,
      ultimos90Dias: serieDosUltimos90Dias(c, agora),
    },
    frescor: { status: entrada.frescor?.status ?? 'desconhecido', ultimaAtualizacao: entrada.frescor?.ultimaAtualizacao ?? null },
    qualidade: { completude: completude(entrada), avisos: entrada.qualidade.avisos },
    acesso: receita(entrada.acesso),
    sensibilidade: {
      nivel: entrada.sensibilidade.nivel,
      piiPossivel: entrada.sensibilidade.piiPossivel,
      usoPorAgente: entrada.sensibilidade.usoPorAgente,
    },
    tags: entrada.tags,
    relacoes: entrada.relacoes,
  };
}

function depoisDoPrefixo(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

export function acaoDaVisao(acao: AcaoRecomendada, clienteId: string): ProximaAcao {
  const impacto: 1 | 2 | 3 = acao.impacto >= 70 ? 3 : acao.impacto >= 45 ? 2 : 1;
  const base = { id: acao.id, titulo: acao.titulo, porque: acao.motivo, impacto };
  switch (acao.tipo) {
    case 'reautorizar':
      return { ...base, href: `/integracoes/conector/${depoisDoPrefixo(acao.id)}`, rotulo: 'Reautorizar' };
    case 'conectar':
      return { ...base, href: `/integracoes/conector/${depoisDoPrefixo(acao.id)}`, rotulo: 'Conectar' };
    case 'vincular_recurso':
      return { ...base, href: `/clientes/${clienteId}/contas/nova`, rotulo: 'Vincular' };
    case 'investigar_coleta':
    case 'recuperar_lacuna':
      return { ...base, href: rotaDoCliente(clienteId, 'conexoes', { secao: 'fontes' }), rotulo: 'Ver dados' };
    case 'preencher_contexto':
    case 'confirmar_sugestoes':
      return { ...base, href: rotaDoCliente(clienteId, 'contexto', { secao: depoisDoPrefixo(acao.id) }), rotulo: 'Abrir' };
    case 'resolver_contradicao':
      return { ...base, href: rotaDoCliente(clienteId, 'contexto', { secao: depoisDoPrefixo(acao.id).split(':')[0] }), rotulo: 'Revisar' };
  }
}

function media(valores: readonly number[]): number {
  return valores.length === 0 ? 0 : valores.reduce((s, v) => s + v, 0) / valores.length;
}

export function brainDoCatalogo(snapshot: Snapshot, agora: Date): BrainDoCliente {
  const clienteId = snapshot.clienteId;
  const entradas = snapshot.entradas.map((e) => entradaDaVisao(e, agora)).filter((e): e is EntradaDoBrain => e !== null);
  const tabelas = snapshot.entradas.filter((e) => e.tipo === 'tabela_de_dados' && e.cobertura?.diasComDado !== null && e.cobertura !== null);
  const cobertura = Math.round(
    media(tabelas.map((t) => Math.min((t.cobertura!.diasComDado ?? 0) / Math.max(t.cobertura!.diasEsperados ?? DIAS, 1), 1))) * 100,
  );
  const fontes = snapshot.entradas.filter((e) => (e.tipo === 'fonte' || e.tipo === 'tabela_de_dados') && e.frescor);
  const frescor = Math.round(media(fontes.map((f) => PESO_DO_FRESCOR[f.frescor!.status])) * 100);
  const completudeDoContexto = snapshot.diagnostico.contexto?.geral ?? 0;

  const capacidades: Capacidade[] = snapshot.capacidades.map((c) => {
    const plataforma = c.plataformasQueDesbloqueiam[0];
    return {
      id: c.id,
      pergunta: c.titulo,
      estado: c.status,
      evidencias: c.evidencias,
      falta: c.faltando,
      acao:
        c.status !== 'disponivel' && plataforma
          ? { rotulo: `Conectar ${plataforma}`, href: `/integracoes/conector/${plataforma}` }
          : null,
    };
  });

  const lacunas: Lacuna[] = [];
  for (const conector of snapshot.diagnostico.conectores) {
    if (conector.estado === 'nao_conectado' && conector.desbloqueia.length > 0) {
      lacunas.push({ agrupamento: 'conexoes', rotulo: conector.rotulo, href: `/integracoes/conector/${conector.plataforma}` });
    } else if (conector.estado === 'conexao_sem_vinculo') {
      lacunas.push({ agrupamento: 'dados', rotulo: conector.rotulo, href: `/clientes/${clienteId}/contas/nova` });
    }
  }
  for (const secao of snapshot.diagnostico.contexto?.secoes ?? []) {
    if (secao.percentual === 0) {
      lacunas.push({ agrupamento: 'contexto', rotulo: secao.titulo, href: rotaDoCliente(clienteId, 'contexto', { secao: secao.secao }) });
    }
  }
  if (!entradas.some((e) => e.tipo === 'arquivo')) {
    lacunas.push({ agrupamento: 'arquivos', rotulo: 'Manual de marca', href: rotaDoCliente(clienteId, 'contexto', { secao: 'marca' }) });
  }

  return {
    origem: 'real',
    versao: `esquema ${snapshot.schemaVersion}`,
    hash: snapshot.catalogHash.slice(0, 16),
    atualizadoEm: snapshot.geradoEm,
    pulso: {
      saude: Math.round(cobertura * 0.35 + frescor * 0.35 + completudeDoContexto * 0.3),
      cobertura,
      frescor,
      completudeDoContexto,
    },
    entradas,
    capacidades,
    acoes: snapshot.diagnostico.acoes.slice(0, 10).map((a) => acaoDaVisao(a, clienteId)),
    lacunas,
    catalogoMd: renderizarCatalogoMd(
      { nomeDoCliente: snapshot.nomeDoCliente, catalogHash: snapshot.catalogHash, schemaVersion: snapshot.schemaVersion },
      snapshot.entradas,
      snapshot.capacidades,
      snapshot.diagnostico,
    ),
  };
}
