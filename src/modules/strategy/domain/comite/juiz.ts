import { z } from 'zod';
import { err, ok, type Result } from '../../../../shared/result/result.ts';
import { esquemaId, esquemaUrn } from '../plano.ts';
import type { Ajuste, RespostaDoAjuste } from './ajuste.ts';
import { consolidarPareceres, type Argumento } from './consolidacao.ts';
import type { Parecer } from './parecer.ts';
import { PADRAO_DA_CHAVE_DA_PERSONA, PERSONAS, type Persona } from './personas.ts';

export const VEREDITOS_DO_JUIZ = ['aceito', 'rejeitado'] as const;
export type DecisaoDoJuiz = (typeof VEREDITOS_DO_JUIZ)[number];

export const MAXIMO_DE_PONTOS_NO_JUIZ = 45;
export const MAXIMO_DE_PROVAS_POR_VEREDITO = 3;
export const TAMANHO_MAXIMO_DO_VEREDITO_BYTES = 16384;
export const PREFIXO_DO_MOTIVO_DO_JUIZ = 'Juiz: ';

export const esquemaVereditoDoJuiz = z.strictObject({
  persona: z.string().regex(PADRAO_DA_CHAVE_DA_PERSONA),
  pontoId: esquemaId,
  veredito: z.enum(VEREDITOS_DO_JUIZ),
  motivo: z.string().min(1).max(160).regex(/\S/, 'Motivo não pode ser vazio.'),
  prova: z.array(esquemaUrn).max(MAXIMO_DE_PROVAS_POR_VEREDITO),
});
export type VereditoDoJuiz = z.infer<typeof esquemaVereditoDoJuiz>;

export const esquemaSaidaDoJuiz = z
  .strictObject({ vereditos: z.array(esquemaVereditoDoJuiz).max(MAXIMO_DE_PONTOS_NO_JUIZ) })
  .refine((saida) => new TextEncoder().encode(JSON.stringify(saida)).length <= TAMANHO_MAXIMO_DO_VEREDITO_BYTES, 'Veredito acima do tamanho máximo.');
export type SaidaDoJuiz = z.infer<typeof esquemaSaidaDoJuiz>;

export type PontoParaOJuiz = {
  readonly persona: string;
  readonly pontoId: string;
  readonly trecho: string;
  readonly problema: string;
  readonly ajustePedido: string;
  readonly fontes: readonly string[];
};

export const chaveDoPontoDoJuiz = (persona: string, pontoId: string) => `${persona}/${pontoId}`;

export function pontosObrigatorios(pareceres: readonly Parecer[], personas: readonly Persona[] = PERSONAS): ReadonlySet<string> {
  return new Set(consolidarPareceres(pareceres, personas).pendenciasObrigatorias.map((p) => chaveDoPontoDoJuiz(p.persona, p.pontoId)));
}

export function pontosParaJulgar(pareceres: readonly Parecer[], personas: readonly Persona[] = PERSONAS): PontoParaOJuiz[] {
  const obrigatorios = pontosObrigatorios(pareceres, personas);
  return pareceres.flatMap((parecer) =>
    parecer.pontos
      .filter((ponto) => !obrigatorios.has(chaveDoPontoDoJuiz(parecer.persona, ponto.id)))
      .map((ponto) => ({
        persona: parecer.persona,
        pontoId: ponto.id,
        trecho: ponto.trecho,
        problema: ponto.problema,
        ajustePedido: ponto.ajustePedido,
        fontes: ponto.fontes,
      })),
  );
}

export type ErroDoJuiz = {
  readonly codigo: 'ponto_sem_veredito' | 'veredito_duplicado' | 'veredito_sem_ponto';
  readonly persona: string;
  readonly pontoId: string;
};

export function conferirVereditos(
  esperados: readonly PontoParaOJuiz[],
  saida: SaidaDoJuiz,
  urnsDoPacote: ReadonlySet<string>,
): Result<VereditoDoJuiz[], ErroDoJuiz[]> {
  const erros: ErroDoJuiz[] = [];
  const pedidos = new Set(esperados.map((p) => chaveDoPontoDoJuiz(p.persona, p.pontoId)));
  const vistos = new Set<string>();
  for (const veredito of saida.vereditos) {
    const chave = chaveDoPontoDoJuiz(veredito.persona, veredito.pontoId);
    if (vistos.has(chave)) erros.push({ codigo: 'veredito_duplicado', persona: veredito.persona, pontoId: veredito.pontoId });
    else if (!pedidos.has(chave)) erros.push({ codigo: 'veredito_sem_ponto', persona: veredito.persona, pontoId: veredito.pontoId });
    vistos.add(chave);
  }
  for (const ponto of esperados) {
    if (!vistos.has(chaveDoPontoDoJuiz(ponto.persona, ponto.pontoId))) erros.push({ codigo: 'ponto_sem_veredito', persona: ponto.persona, pontoId: ponto.pontoId });
  }
  if (erros.length > 0) return err(erros);
  return ok(saida.vereditos.map((veredito) => ({ ...veredito, prova: veredito.prova.filter((urn) => urnsDoPacote.has(urn)) })));
}

export type DestinoDoPonto = {
  readonly decisao: RespostaDoAjuste['decisao'];
  readonly origem: 'obrigatoria' | 'juiz';
  readonly motivo?: string;
};

export function motivoDoJuiz(motivo: string): string {
  return `${PREFIXO_DO_MOTIVO_DO_JUIZ}${motivo}`.slice(0, 160);
}

export function destinosDosPontos(
  pareceres: readonly Parecer[],
  vereditos: readonly VereditoDoJuiz[] | undefined,
  personas: readonly Persona[] = PERSONAS,
): Result<ReadonlyMap<string, DestinoDoPonto>, ErroDoJuiz[]> {
  const obrigatorios = pontosObrigatorios(pareceres, personas);
  const doJuiz = new Map((vereditos ?? []).map((v) => [chaveDoPontoDoJuiz(v.persona, v.pontoId), v]));
  const destinos = new Map<string, DestinoDoPonto>();
  const erros: ErroDoJuiz[] = [];
  for (const parecer of pareceres) {
    for (const ponto of parecer.pontos) {
      const chave = chaveDoPontoDoJuiz(parecer.persona, ponto.id);
      if (obrigatorios.has(chave)) {
        destinos.set(chave, { decisao: 'acatado', origem: 'obrigatoria' });
        continue;
      }
      const veredito = doJuiz.get(chave);
      if (veredito === undefined) {
        erros.push({ codigo: 'ponto_sem_veredito', persona: parecer.persona, pontoId: ponto.id });
        continue;
      }
      destinos.set(
        chave,
        veredito.veredito === 'aceito'
          ? { decisao: 'acatado', origem: 'juiz' }
          : { decisao: 'nao_acatado', origem: 'juiz', motivo: motivoDoJuiz(veredito.motivo) },
      );
    }
  }
  return erros.length > 0 ? err(erros) : ok(destinos);
}

export function argumentosParaAplicar(argumentos: readonly Argumento[], destinos: ReadonlyMap<string, DestinoDoPonto>): Argumento[] {
  return argumentos.flatMap((argumento) => {
    const indices = argumento.pontos.map((p, i) => (destinos.get(chaveDoPontoDoJuiz(p.persona, p.pontoId))?.decisao === 'acatado' ? i : -1)).filter((i) => i >= 0);
    if (indices.length === 0) return [];
    return [
      {
        ...argumento,
        pontos: indices.map((i) => argumento.pontos[i]!),
        problemas: indices.map((i) => argumento.problemas[i]!),
        personas: [...new Set(indices.map((i) => argumento.pontos[i]!.persona))].sort(),
      },
    ];
  });
}

export function respostasDeRecusaDoJuiz(destinos: ReadonlyMap<string, DestinoDoPonto>): RespostaDoAjuste[] {
  return [...destinos.entries()]
    .filter(([, destino]) => destino.decisao === 'nao_acatado')
    .map(([chave, destino]) => {
      const [persona = '', pontoId = ''] = chave.split('/');
      return { persona, pontoId, decisao: 'nao_acatado' as const, motivo: destino.motivo ?? motivoDoJuiz('rejeitado') };
    });
}

export type ErroDeAjusteContraOJuiz = {
  readonly codigo: 'juiz_sem_veredito' | 'aceito_nao_acatado' | 'rejeitado_acatado';
  readonly persona: string;
  readonly pontoId: string;
};

export function conferirAjusteContraOJuiz(
  pareceres: readonly Parecer[],
  ajuste: Ajuste,
  vereditos: readonly VereditoDoJuiz[] | undefined,
  personas: readonly Persona[] = PERSONAS,
): ErroDeAjusteContraOJuiz[] {
  const destinos = destinosDosPontos(pareceres, vereditos, personas);
  if (!destinos.ok) return destinos.error.map((erro) => ({ codigo: 'juiz_sem_veredito', persona: erro.persona, pontoId: erro.pontoId }));
  const respostas = new Map(ajuste.respostas.map((r) => [chaveDoPontoDoJuiz(r.persona, r.pontoId), r]));
  const erros: ErroDeAjusteContraOJuiz[] = [];
  for (const [chave, destino] of destinos.value) {
    const resposta = respostas.get(chave);
    if (resposta === undefined) continue;
    const [persona = '', pontoId = ''] = chave.split('/');
    if (destino.decisao === 'acatado' && resposta.decisao !== 'acatado') erros.push({ codigo: 'aceito_nao_acatado', persona, pontoId });
    if (destino.decisao === 'nao_acatado' && resposta.decisao !== 'nao_acatado') erros.push({ codigo: 'rejeitado_acatado', persona, pontoId });
  }
  return erros;
}

export function vereditosDoEvento(payload: unknown): VereditoDoJuiz[] | undefined {
  const lido = esquemaSaidaDoJuiz.safeParse(payload);
  return lido.success ? lido.data.vereditos : undefined;
}
