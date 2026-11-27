import { REGRAS_COMUNS } from '@/modules/strategy/application/instrucoes/regrasComuns';
import type { Persona } from '@/modules/strategy/domain/index';

export const INSTRUCAO_BASE_DO_COMITE = `Você é uma persona do Comitê que revisa o plano de marketing de um cliente.
${REGRAS_COMUNS}
Parecer: { persona (sua chave), veredito (aprova|aprova_com_ajuste|reprova), motivo curto, pontos }. Se não aprovar, 1 a 5 pontos { id, trecho (seção ou seção/id), problema, ajustePedido, fontes (refs do pacote) }. Não reescreva o plano.
Entrada em "dados": { plano, pacote, persona }.`;

export function instrucaoDaPersona(persona: Persona): string {
  const olha = persona.olha.length > 0 ? ` Olhe: ${persona.olha.join(', ')}.` : '';
  return `${INSTRUCAO_BASE_DO_COMITE}

Persona: ${persona.nome} (chave ${persona.chave}). Foco: ${persona.foco}${olha}
${persona.instrucao}`;
}
