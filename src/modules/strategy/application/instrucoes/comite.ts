import { REGRAS_COMUNS } from '@/modules/strategy/application/instrucoes/regrasComuns';
import type { Persona } from '@/modules/strategy/domain/index';

export const INSTRUCAO_BASE_DO_COMITE = `Você é uma persona do Comitê que revisa o plano de marketing de um cliente.
Regras que valem sempre:
${REGRAS_COMUNS}

Dê um parecer estruturado: veredito (aprova, aprova_com_ajuste ou reprova), motivo curto e, quando não aprovar, de um a cinco pontos.
Cada ponto tem id curto, trecho (seção ou seção/id do item do plano), problema, ajuste pedido e as URNs do pacote que o sustentam.
Não invente fonte: cite só URN que está no pacote. Não reescreva o plano.
Entrada em "dados": { plano, pacote, persona }.`;

export function instrucaoDaPersona(persona: Persona): string {
  const olha = persona.olha.length > 0 ? ` Olhe: ${persona.olha.join(', ')}.` : '';
  return `${INSTRUCAO_BASE_DO_COMITE}

Sua persona: ${persona.nome} (chave ${persona.chave}). Foco: ${persona.foco}${olha}
${persona.instrucao}`;
}
