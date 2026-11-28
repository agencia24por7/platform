import { z } from 'zod';
import { err, ok, type Result } from '../../../../shared/result/result.ts';
import { esquemaId } from '../plano.ts';
import { consolidarPareceres } from './consolidacao.ts';
import type { Parecer } from './parecer.ts';
import { PERSONAS_DOS_COMITES } from './comites.ts';
import { PADRAO_DA_CHAVE_DA_PERSONA, type Persona } from './personas.ts';

export const DECISOES_DO_AJUSTE = ['acatado', 'nao_acatado'] as const;
export const TAMANHO_MAXIMO_DO_AJUSTE_BYTES = 16384;

export function tamanhoDoAjuste(ajuste: unknown): number {
  return new TextEncoder().encode(JSON.stringify(ajuste)).length;
}

export const esquemaRespostaDoAjuste = z.strictObject({
  pontoId: esquemaId,
  persona: z.string().regex(PADRAO_DA_CHAVE_DA_PERSONA),
  decisao: z.enum(DECISOES_DO_AJUSTE),
  motivo: z.string().min(1).max(160).regex(/\S/, 'Motivo não pode ser vazio.'),
});
export type RespostaDoAjuste = z.infer<typeof esquemaRespostaDoAjuste>;

export const esquemaAjuste = z
  .strictObject({ responde_a: z.string().uuid(), respostas: z.array(esquemaRespostaDoAjuste).max(80) })
  .refine((ajuste) => tamanhoDoAjuste(ajuste) <= TAMANHO_MAXIMO_DO_AJUSTE_BYTES, `Ajuste acima de ${TAMANHO_MAXIMO_DO_AJUSTE_BYTES} bytes.`);
export type Ajuste = z.infer<typeof esquemaAjuste>;

export type ErroDeAjuste = {
  readonly codigo: 'ponto_sem_resposta' | 'resposta_duplicada' | 'resposta_sem_ponto' | 'pendencia_obrigatoria_nao_acatada';
  readonly persona: string;
  readonly pontoId: string;
  readonly mensagem: string;
};

const chaveDoPonto = (persona: string, pontoId: string) => `${persona}/${pontoId}`;

export function validarAjuste(
  pareceres: readonly Parecer[],
  ajuste: Ajuste,
  personas: readonly Persona[] = PERSONAS_DOS_COMITES,
): Result<Ajuste, ErroDeAjuste[]> {
  const erros: ErroDeAjuste[] = [];
  const pontos = new Set(pareceres.flatMap((p) => p.pontos.map((ponto) => chaveDoPonto(p.persona, ponto.id))));
  const respostas = new Map<string, RespostaDoAjuste>();

  for (const resposta of ajuste.respostas) {
    const chave = chaveDoPonto(resposta.persona, resposta.pontoId);
    if (respostas.has(chave)) {
      erros.push({ codigo: 'resposta_duplicada', persona: resposta.persona, pontoId: resposta.pontoId, mensagem: 'Ponto respondido mais de uma vez.' });
      continue;
    }
    respostas.set(chave, resposta);
    if (!pontos.has(chave)) {
      erros.push({ codigo: 'resposta_sem_ponto', persona: resposta.persona, pontoId: resposta.pontoId, mensagem: 'Resposta a ponto que não existe nos pareceres.' });
    }
  }

  for (const parecer of pareceres) {
    for (const ponto of parecer.pontos) {
      if (!respostas.has(chaveDoPonto(parecer.persona, ponto.id))) {
        erros.push({ codigo: 'ponto_sem_resposta', persona: parecer.persona, pontoId: ponto.id, mensagem: 'Ponto do parecer sem resposta.' });
      }
    }
  }

  for (const pendencia of consolidarPareceres(pareceres, personas).pendenciasObrigatorias) {
    if (respostas.get(chaveDoPonto(pendencia.persona, pendencia.pontoId))?.decisao === 'nao_acatado') {
      erros.push({
        codigo: 'pendencia_obrigatoria_nao_acatada',
        persona: pendencia.persona,
        pontoId: pendencia.pontoId,
        mensagem: 'Reprovação obrigatória não pode ser recusada pelo ajuste.',
      });
    }
  }

  return erros.length > 0 ? err(erros) : ok(ajuste);
}

const bytesDoTexto = (texto: string) => new TextEncoder().encode(texto).length;

function cortarEmBytes(texto: string, maximo: number): string {
  let saida = '';
  let bytes = 0;
  for (const caractere of texto) {
    const tamanho = bytesDoTexto(caractere);
    if (bytes + tamanho > maximo) break;
    saida += caractere;
    bytes += tamanho;
  }
  return saida.trimEnd();
}

export function ajustarRespostasAoTamanho(respondeA: string, respostas: readonly RespostaDoAjuste[]): RespostaDoAjuste[] {
  const montar = (limite: number) => respostas.map((resposta) => ({ ...resposta, motivo: cortarEmBytes(resposta.motivo, limite) || resposta.motivo.slice(0, 1) }));
  const maiorMotivo = Math.max(0, ...respostas.map((resposta) => bytesDoTexto(resposta.motivo)));
  for (let limite = maiorMotivo; limite >= 1; limite -= 1) {
    const candidatas = montar(limite);
    if (tamanhoDoAjuste({ responde_a: respondeA, respostas: candidatas }) <= TAMANHO_MAXIMO_DO_AJUSTE_BYTES) return candidatas;
  }
  return montar(1);
}
