import type { ArquivoDeContexto } from './tipos.ts';

export const CAMPO_DA_LOGO = 'logo';
export const SECAO_DA_LOGO = 'marca';
export const TAMANHO_MAXIMO_DA_LOGO_BYTES = 5 * 1024 * 1024;
export const TIPOS_DA_LOGO: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type LogoDoCliente = Pick<ArquivoDeContexto, 'id' | 'caminho' | 'mime' | 'tamanhoBytes' | 'sha256'>;

const SHA256 = /^[0-9a-f]{64}$/;

export function logoDoCliente(arquivos: readonly ArquivoDeContexto[]): LogoDoCliente | null {
  const candidatas = arquivos
    .filter((a) => a.fieldKey === CAMPO_DA_LOGO && a.itemId === null && TIPOS_DA_LOGO.has(a.mime) && a.tamanhoBytes > 0 && a.tamanhoBytes <= TAMANHO_MAXIMO_DA_LOGO_BYTES && SHA256.test(a.sha256))
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  const escolhida = candidatas[0];
  return escolhida ? { id: escolhida.id, caminho: escolhida.caminho, mime: escolhida.mime, tamanhoBytes: escolhida.tamanhoBytes, sha256: escolhida.sha256 } : null;
}

export function hashDaLogo(arquivos: readonly ArquivoDeContexto[], armazenamentoConfigurado: boolean): string | null {
  return armazenamentoConfigurado ? (logoDoCliente(arquivos)?.sha256 ?? null) : null;
}
