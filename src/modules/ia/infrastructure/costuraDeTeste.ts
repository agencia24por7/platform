import { MockLanguageModelV4 } from 'ai/test';
import { PREFIXO_DE_TESTE, costuraDeTestePermitida, type AmbienteDaCostura } from '@/modules/tokens/infrastructure/provedorDeTeste';
import { failure } from '@/shared/result/failure';
import { err, ok } from '@/shared/result/result';
import type { CatalogoDeModelos } from '../application/modelosService.ts';
import type { FabricaDeModelo } from './portaAiSdk.ts';

export const CHAVE_DE_TESTE_RECUSADA = `${PREFIXO_DE_TESTE}chave-recusada-pelo-fornecedor`;
export const MODELOS_DE_TESTE = ['modelo-de-teste-a', 'modelo-de-teste-b'] as const;
const RESPOSTA_DE_TESTE = JSON.stringify({ funcionando: true, saudacao: 'Olá do modelo de teste.' });

const permitidaAgora = () => costuraDeTestePermitida(process.env);
const chaveDeTeste = (chave: string) => permitidaAgora() && chave.startsWith(PREFIXO_DE_TESTE);

export function comCatalogoDeTeste(real: CatalogoDeModelos, ambiente: AmbienteDaCostura): CatalogoDeModelos {
  if (!costuraDeTestePermitida(ambiente)) return real;
  return {
    async listar(fornecedor, chave) {
      if (!chaveDeTeste(chave)) return real.listar(fornecedor, chave);
      if (chave === CHAVE_DE_TESTE_RECUSADA) return err(failure('validation', 'O fornecedor recusou essa chave. Confira se está correta e ativa.'));
      return ok([...MODELOS_DE_TESTE]);
    },
  };
}

function modeloDeTeste(): ReturnType<FabricaDeModelo> {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: RESPOSTA_DE_TESTE }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 8, text: 8, reasoning: 0 } },
      warnings: [],
    }),
  });
}

export function comModeloDeTeste(real: FabricaDeModelo, ambiente: AmbienteDaCostura): FabricaDeModelo {
  if (!costuraDeTestePermitida(ambiente)) return real;
  return (modelo) => (chaveDeTeste(modelo.chave) ? modeloDeTeste() : real(modelo));
}
