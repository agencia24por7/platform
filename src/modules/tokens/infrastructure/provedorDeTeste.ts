import { createHash } from 'node:crypto';
import { err, ok } from '@/shared/result/result';
import type { FabricaDeProvedores, ProvedorDeToken } from '@/modules/tokens/application/portas';

export const PREFIXO_DE_TESTE = 'orla-teste:';
export const SEGREDO_DE_TESTE_REVOGADO = `${PREFIXO_DE_TESTE}invalid_grant`;

const emProducao = (ambiente: string | undefined) => ambiente === 'production';

export function acessoDeTeste(segredo: string): string {
  return `teste-acesso-${createHash('sha256').update(segredo).digest('hex').slice(0, 24)}`;
}

function provedorDeTeste(real: ProvedorDeToken | null): ProvedorDeToken | null {
  if (!real) return null;
  return {
    async renovar(segredo) {
      if (emProducao(process.env.NODE_ENV) || !segredo.startsWith(PREFIXO_DE_TESTE)) return real.renovar(segredo);
      if (segredo === SEGREDO_DE_TESTE_REVOGADO) return err({ natureza: 'reautorizar', codigo: 'invalid_grant' });
      return ok({ accessToken: acessoDeTeste(segredo), expiraEm: new Date(Date.now() + 3_600_000) });
    },
    async revogar(segredo) {
      if (emProducao(process.env.NODE_ENV) || !segredo.startsWith(PREFIXO_DE_TESTE)) return real.revogar(segredo);
      return ok('revogado');
    },
  };
}

export function comProvedorDeTeste(real: FabricaDeProvedores, ambiente: string): FabricaDeProvedores {
  if (emProducao(ambiente)) return real;
  return (platform, tipo) => provedorDeTeste(real(platform, tipo));
}
