import { createHash } from 'node:crypto';
import { err, ok } from '@/shared/result/result';
import type { FabricaDeProvedores, ProvedorDeToken } from '@/modules/tokens/application/portas';

export const PREFIXO_DE_TESTE = 'orla-teste:';
export const SEGREDO_DE_TESTE_REVOGADO = `${PREFIXO_DE_TESTE}invalid_grant`;

export type AmbienteDaCostura = {
  readonly NODE_ENV?: string | undefined;
  readonly TOKENS_KMS_KEY?: string | undefined;
  readonly TRIA_APP_BASE_URL?: string | undefined;
};

const LOOPBACK_IPV4 = /^127(\.\d{1,3}){3}$/;

function enderecoLocal(base: string | undefined): boolean {
  if (!base) return true;
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:') return false;
    return !url.hostname.includes('.') || LOOPBACK_IPV4.test(url.hostname);
  } catch {
    return false;
  }
}

export function costuraDeTestePermitida(ambiente: AmbienteDaCostura): boolean {
  if (ambiente.NODE_ENV === 'production') return false;
  if (ambiente.TOKENS_KMS_KEY && ambiente.TOKENS_KMS_KEY.length > 0) return false;
  return enderecoLocal(ambiente.TRIA_APP_BASE_URL);
}

export function acessoDeTeste(segredo: string): string {
  return `teste-acesso-${createHash('sha256').update(segredo).digest('hex').slice(0, 24)}`;
}

const permitidaAgora = () => costuraDeTestePermitida(process.env);

function provedorDeTeste(real: ProvedorDeToken | null): ProvedorDeToken | null {
  if (!real) return null;
  return {
    async renovar(segredo) {
      if (!permitidaAgora() || !segredo.startsWith(PREFIXO_DE_TESTE)) return real.renovar(segredo);
      if (segredo === SEGREDO_DE_TESTE_REVOGADO) return err({ natureza: 'reautorizar', codigo: 'invalid_grant' });
      return ok({ accessToken: acessoDeTeste(segredo), expiraEm: new Date(Date.now() + 3_600_000) });
    },
    async revogar(segredo) {
      if (!permitidaAgora() || !segredo.startsWith(PREFIXO_DE_TESTE)) return real.revogar(segredo);
      return ok('revogado');
    },
  };
}

export function comProvedorDeTeste(real: FabricaDeProvedores, ambiente: AmbienteDaCostura): FabricaDeProvedores {
  if (!costuraDeTestePermitida(ambiente)) return real;
  return (platform, tipo) => provedorDeTeste(real(platform, tipo));
}
