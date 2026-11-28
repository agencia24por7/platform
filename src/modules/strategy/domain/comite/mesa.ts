import { z } from 'zod';
import { err, ok, type Result } from '../../../../shared/result/result.ts';
import { esquemaId } from '../plano.ts';
import type { Comite } from './comites.ts';
import {
  MAXIMO_DE_PONTOS_POR_PARECER,
  TAMANHO_MAXIMO_DO_PARECER_BYTES,
  VEREDITOS,
  esquemaParecer,
  tamanhoDoParecer,
  type Parecer,
  type PontoDoParecer,
  type Veredito,
} from './parecer.ts';
import { PADRAO_DA_CHAVE_DA_PERSONA } from './personas.ts';

export const esquemaParecerDeMembro = esquemaParecer;
export type ParecerDeMembro = Parecer;

export const REAGE_AO_COMITE = 'comite';
export const NUMEROS_DA_RODADA = [1, 2] as const;
export type NumeroDaRodada = (typeof NUMEROS_DA_RODADA)[number];
export const MAXIMO_DE_FALAS_POR_RODADA = 12;
export const MAXIMO_DE_CONSENSOS_POR_RODADA = 5;
export const MAXIMO_DE_DIVERGENCIAS_POR_RODADA = 5;
export const TAMANHO_MAXIMO_DA_POSICAO = 400;
export const TAMANHO_MAXIMO_DO_RESUMO_DA_DIVERGENCIA = 300;
export const TAMANHO_MAXIMO_DA_RODADA_BYTES = 16384;
const TAMANHO_MAXIMO_DO_MOTIVO = 800;

const texto = (maximo: number) => z.string().min(1).max(maximo).regex(/\S/, 'Texto não pode ser vazio.');
const chave = z.string().regex(PADRAO_DA_CHAVE_DA_PERSONA);

export const esquemaFalaDaMesa = z.strictObject({
  membro: chave,
  reageA: chave,
  posicao: texto(TAMANHO_MAXIMO_DA_POSICAO),
  mudouDeOpiniao: z.boolean(),
});
export type FalaDaMesa = z.infer<typeof esquemaFalaDaMesa>;

export const esquemaDivergenciaDaMesa = z
  .strictObject({
    pontoId: esquemaId.optional(),
    membros: z.array(chave).min(2).max(3),
    resumo: texto(TAMANHO_MAXIMO_DO_RESUMO_DA_DIVERGENCIA),
  })
  .superRefine((divergencia, contexto) => {
    if (new Set(divergencia.membros).size !== divergencia.membros.length) {
      contexto.addIssue({ code: 'custom', path: ['membros'], message: 'Membros repetidos na divergência.' });
    }
  });
export type DivergenciaDaMesa = z.infer<typeof esquemaDivergenciaDaMesa>;

export const esquemaRodadaDaMesa = z
  .strictObject({
    comite: chave,
    rodada: z.union([z.literal(1), z.literal(2)]),
    debate: z.array(esquemaFalaDaMesa).min(1).max(MAXIMO_DE_FALAS_POR_RODADA),
    consensos: z.array(texto(TAMANHO_MAXIMO_DO_RESUMO_DA_DIVERGENCIA)).max(MAXIMO_DE_CONSENSOS_POR_RODADA),
    divergencias: z.array(esquemaDivergenciaDaMesa).max(MAXIMO_DE_DIVERGENCIAS_POR_RODADA),
  })
  .superRefine((rodada, contexto) => {
    if (tamanhoDoParecer(rodada) > TAMANHO_MAXIMO_DA_RODADA_BYTES) {
      contexto.addIssue({ code: 'custom', message: `Rodada acima de ${TAMANHO_MAXIMO_DA_RODADA_BYTES} bytes.` });
    }
  });
export type RodadaDaMesa = z.infer<typeof esquemaRodadaDaMesa>;

export type ErroDaRodada = {
  readonly codigo: 'rodada_invalida';
  readonly problemas: readonly { readonly caminho: string; readonly mensagem: string }[];
};

export function lerRodadaDaMesa(json: unknown): Result<RodadaDaMesa, ErroDaRodada> {
  const resultado = esquemaRodadaDaMesa.safeParse(json);
  if (resultado.success) return ok(resultado.data);
  return err({
    codigo: 'rodada_invalida',
    problemas: resultado.error.issues.slice(0, 30).map((p) => ({ caminho: p.path.join('.'), mensagem: p.message })),
  });
}

export type CodigoDoProblemaDaMesa =
  | 'comite_divergente'
  | 'membro_desconhecido'
  | 'membro_ausente'
  | 'parecer_repetido'
  | 'rodada_fora_de_ordem'
  | 'reage_a_si_mesmo'
  | 'ponto_desconhecido'
  | 'parecer_invalido';

export type ProblemaDaMesa = { readonly codigo: CodigoDoProblemaDaMesa; readonly detalhe: string };

export type ErroDaMesa = { readonly codigo: 'mesa_invalida'; readonly problemas: readonly ProblemaDaMesa[] };

function chavesDosMembros(comite: Comite): ReadonlySet<string> {
  return new Set(comite.membros.map((membro) => membro.chave));
}

function problemasDosPareceres(comite: Comite, pareceres: readonly ParecerDeMembro[]): ProblemaDaMesa[] {
  const membros = chavesDosMembros(comite);
  const vistos = new Set<string>();
  const problemas: ProblemaDaMesa[] = [];
  for (const parecer of pareceres) {
    if (!membros.has(parecer.persona)) problemas.push({ codigo: 'membro_desconhecido', detalhe: `parecer:${parecer.persona}` });
    else if (vistos.has(parecer.persona)) problemas.push({ codigo: 'parecer_repetido', detalhe: `parecer:${parecer.persona}` });
    vistos.add(parecer.persona);
  }
  for (const membro of comite.membros) {
    if (!vistos.has(membro.chave)) problemas.push({ codigo: 'membro_ausente', detalhe: `parecer:${membro.chave}` });
  }
  return problemas;
}

function problemasDaRodada(
  comite: Comite,
  rodada: RodadaDaMesa,
  esperada: number,
  pareceres: readonly ParecerDeMembro[],
): ProblemaDaMesa[] {
  const membros = chavesDosMembros(comite);
  const prefixo = `rodada${rodada.rodada}`;
  const problemas: ProblemaDaMesa[] = [];
  if (rodada.comite !== comite.chave) problemas.push({ codigo: 'comite_divergente', detalhe: `${prefixo}:${rodada.comite}` });
  if (rodada.rodada !== esperada) problemas.push({ codigo: 'rodada_fora_de_ordem', detalhe: `${prefixo}:esperada${esperada}` });

  const falaram = new Set<string>();
  for (const fala of rodada.debate) {
    if (!membros.has(fala.membro)) problemas.push({ codigo: 'membro_desconhecido', detalhe: `${prefixo}:membro:${fala.membro}` });
    else falaram.add(fala.membro);
    if (fala.reageA !== REAGE_AO_COMITE && !membros.has(fala.reageA)) {
      problemas.push({ codigo: 'membro_desconhecido', detalhe: `${prefixo}:reageA:${fala.reageA}` });
    }
    if (fala.reageA === fala.membro) problemas.push({ codigo: 'reage_a_si_mesmo', detalhe: `${prefixo}:${fala.membro}` });
  }
  for (const membro of comite.membros) {
    if (!falaram.has(membro.chave)) problemas.push({ codigo: 'membro_ausente', detalhe: `${prefixo}:${membro.chave}` });
  }

  for (const divergencia of rodada.divergencias) {
    const desconhecidos = divergencia.membros.filter((membro) => !membros.has(membro));
    for (const membro of desconhecidos) problemas.push({ codigo: 'membro_desconhecido', detalhe: `${prefixo}:divergencia:${membro}` });
    if (divergencia.pontoId === undefined) continue;
    const citado = pareceres
      .filter((parecer) => divergencia.membros.includes(parecer.persona))
      .some((parecer) => parecer.pontos.some((ponto) => ponto.id === divergencia.pontoId));
    if (!citado) problemas.push({ codigo: 'ponto_desconhecido', detalhe: `${prefixo}:divergencia:${divergencia.pontoId}` });
  }
  return problemas;
}

export function conferirMesa(
  comite: Comite,
  pareceresDosMembros: readonly ParecerDeMembro[],
  rodadas: readonly RodadaDaMesa[],
): Result<void, ErroDaMesa> {
  const problemas = problemasDosPareceres(comite, pareceresDosMembros);
  if (rodadas.length > NUMEROS_DA_RODADA.length) {
    problemas.push({ codigo: 'rodada_fora_de_ordem', detalhe: `rodadas:${rodadas.length}` });
  }
  rodadas.forEach((rodada, indice) => problemas.push(...problemasDaRodada(comite, rodada, indice + 1, pareceresDosMembros)));
  return problemas.length === 0 ? ok(undefined) : err({ codigo: 'mesa_invalida', problemas });
}

export type OrigemDoPontoDoComite = {
  readonly pontoId: string;
  readonly membro: string;
  readonly pontoIdDoMembro: string;
  readonly ecos: readonly { readonly membro: string; readonly pontoId: string }[];
};

export type SinteseDoComite = {
  readonly parecer: Parecer;
  readonly origens: readonly OrigemDoPontoDoComite[];
  readonly pontosPedidos: number;
};

type Candidato = {
  readonly membro: string;
  readonly ponto: PontoDoParecer;
  readonly mudou: boolean;
  readonly severidade: number;
  readonly ordem: number;
};

const severidadeDe = (veredito: Veredito) => VEREDITOS.indexOf(veredito);

function compararCandidatos(a: Candidato, b: Candidato): number {
  return Number(a.mudou) - Number(b.mudou) || b.severidade - a.severidade || a.ordem - b.ordem;
}

function chaveDoPonto(membro: string, ponto: PontoDoParecer): string {
  const fontes = [...new Set(ponto.fontes)].sort();
  if (fontes.length === 0) return `sem_fonte|${membro}|${ponto.id}`;
  return `${ponto.trecho}|${fontes.join(',')}`;
}

function cortar(textoOriginal: string, maximo: number): string {
  let saida = '';
  for (const caractere of textoOriginal) {
    if (saida.length + caractere.length > maximo) break;
    saida += caractere;
  }
  return saida.trimEnd();
}

function idLivre(desejado: string, usados: Set<string>): string {
  if (!usados.has(desejado)) return desejado;
  for (let n = 2; ; n += 1) {
    const candidato = `${desejado.slice(0, 28)}_${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

export function sintetizarParecerDoComite(
  comite: Comite,
  pareceresDosMembros: readonly ParecerDeMembro[],
  mesa2: RodadaDaMesa,
  cota: number = MAXIMO_DE_PONTOS_POR_PARECER,
): Result<SinteseDoComite, ErroDaMesa> {
  const limiteDePontos = Math.max(1, Math.min(cota, MAXIMO_DE_PONTOS_POR_PARECER));
  const problemas = [
    ...problemasDosPareceres(comite, pareceresDosMembros),
    ...problemasDaRodada(comite, mesa2, 2, pareceresDosMembros),
  ];
  if (problemas.length > 0) return err({ codigo: 'mesa_invalida', problemas });

  const ordemDoMembro = new Map(
    [...comite.membros]
      .sort((a, b) => Number(b.relatora) - Number(a.relatora))
      .map((membro, indice) => [membro.chave, indice] as const),
  );
  const mudaram = new Set(mesa2.debate.filter((fala) => fala.mudouDeOpiniao).map((fala) => fala.membro));
  const pareceres = [...pareceresDosMembros].sort((a, b) => (ordemDoMembro.get(a.persona) ?? 0) - (ordemDoMembro.get(b.persona) ?? 0));

  const veredito = VEREDITOS[Math.max(...pareceres.map((p) => severidadeDe(p.veredito)))]!;
  const severo = pareceres
    .filter((p) => p.veredito === veredito)
    .sort((a, b) => Number(mudaram.has(a.persona)) - Number(mudaram.has(b.persona)) || (ordemDoMembro.get(a.persona) ?? 0) - (ordemDoMembro.get(b.persona) ?? 0))[0]!;

  const grupos = new Map<string, Candidato[]>();
  for (const parecer of pareceres) {
    for (const ponto of parecer.pontos) {
      const chaveDoGrupo = chaveDoPonto(parecer.persona, ponto);
      const grupo = grupos.get(chaveDoGrupo) ?? [];
      grupo.push({
        membro: parecer.persona,
        ponto,
        mudou: mudaram.has(parecer.persona),
        severidade: severidadeDe(parecer.veredito),
        ordem: ordemDoMembro.get(parecer.persona) ?? 0,
      });
      grupos.set(chaveDoGrupo, grupo);
    }
  }
  const ordenados = [...grupos.values()]
    .map((grupo) => [...grupo].sort(compararCandidatos))
    .sort((a, b) => compararCandidatos(a[0]!, b[0]!));
  const pontosPedidos = Math.min(ordenados.length, MAXIMO_DE_PONTOS_POR_PARECER);
  const escolhidos = ordenados.slice(0, limiteDePontos);

  const usados = new Set<string>();
  const origens: OrigemDoPontoDoComite[] = [];
  const pontos: PontoDoParecer[] = [];
  for (const [representante, ...ecos] of escolhidos) {
    const id = idLivre(representante!.ponto.id, usados);
    usados.add(id);
    pontos.push({ ...representante!.ponto, id, fontes: [...new Set(representante!.ponto.fontes)] });
    origens.push({
      pontoId: id,
      membro: representante!.membro,
      pontoIdDoMembro: representante!.ponto.id,
      ecos: ecos.map((eco) => ({ membro: eco.membro, pontoId: eco.ponto.id })),
    });
  }

  const divergencia = mesa2.divergencias[0];
  const motivo = cortar(divergencia ? `${severo.motivo} Divergência registrada: ${divergencia.resumo}` : severo.motivo, TAMANHO_MAXIMO_DO_MOTIVO);
  const parecer: Parecer = { persona: comite.chave, veredito, motivo, pontos };
  while (pontos.length > 1 && tamanhoDoParecer(parecer) > TAMANHO_MAXIMO_DO_PARECER_BYTES) {
    pontos.pop();
    origens.pop();
  }

  const lido = esquemaParecer.safeParse(parecer);
  if (!lido.success) {
    return err({
      codigo: 'mesa_invalida',
      problemas: lido.error.issues.slice(0, 10).map((p) => ({ codigo: 'parecer_invalido' as const, detalhe: `${p.path.join('.')}:${p.message}` })),
    });
  }
  return ok({ parecer: lido.data, origens, pontosPedidos });
}
