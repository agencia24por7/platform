import { hkdfSync } from 'node:crypto';
import { abrir, selar } from '@/modules/tokens/infrastructure/envelope';
import type { ChaveMestra } from '@/modules/tokens/application/portas';

export const SAL_DA_CHAVE_LOCAL = 'orla.tokens.local';
export const INFO_DA_CHAVE_LOCAL = 'chave-mestra-local:v1';
export const VERSAO_DA_CHAVE_LOCAL = 'local:v1';

export class CofreIndisponivel extends Error {
  constructor(motivo: string) {
    super(`Cofre de tokens indisponível: ${motivo}`);
  }
}

export function derivarChaveLocal(segredoDeSessao: string): Buffer {
  return Buffer.from(hkdfSync('sha256', segredoDeSessao, SAL_DA_CHAVE_LOCAL, INFO_DA_CHAVE_LOCAL, 32));
}

export function createChaveMestraLocal(segredoDeSessao: string): ChaveMestra {
  const chave = derivarChaveLocal(segredoDeSessao);
  return {
    algoritmo: 'aes-256-gcm+local',
    async embrulhar(chaveDeDados, aad) {
      return { embrulhada: selar(chave, chaveDeDados, aad), versao: VERSAO_DA_CHAVE_LOCAL };
    },
    async desembrulhar(embrulhada, aad) {
      return abrir(chave, embrulhada, aad);
    },
  };
}

export function createChaveMestraFechada(motivo: string): ChaveMestra {
  const recusar = () => Promise.reject(new CofreIndisponivel(motivo));
  return { algoritmo: 'aes-256-gcm+kms', embrulhar: recusar, desembrulhar: recusar };
}

type ClienteKms = {
  encrypt(pedido: { name: string; plaintext: Buffer; additionalAuthenticatedData: Buffer }): Promise<
    [{ ciphertext?: Uint8Array | string | null; name?: string | null }, ...unknown[]]
  >;
  decrypt(pedido: { name: string; ciphertext: Buffer; additionalAuthenticatedData: Buffer }): Promise<
    [{ plaintext?: Uint8Array | string | null }, ...unknown[]]
  >;
};

export type FabricaDeClienteKms = () => Promise<ClienteKms>;

const clienteKmsPadrao: FabricaDeClienteKms = async () => {
  const { KeyManagementServiceClient } = await import('@google-cloud/kms');
  return new KeyManagementServiceClient() as unknown as ClienteKms;
};

function comoBuffer(valor: Uint8Array | string | null | undefined): Buffer | null {
  if (valor === null || valor === undefined) return null;
  return typeof valor === 'string' ? Buffer.from(valor, 'base64') : Buffer.from(valor);
}

export function createChaveMestraKms(nomeDaChave: string, fabrica: FabricaDeClienteKms = clienteKmsPadrao): ChaveMestra {
  let cliente: Promise<ClienteKms> | undefined;
  const obterCliente = () => {
    cliente ??= fabrica();
    return cliente;
  };

  return {
    algoritmo: 'aes-256-gcm+kms',
    async embrulhar(chaveDeDados, aad) {
      const [resposta] = await (await obterCliente()).encrypt({
        name: nomeDaChave,
        plaintext: chaveDeDados,
        additionalAuthenticatedData: aad,
      });
      const embrulhada = comoBuffer(resposta.ciphertext);
      if (!embrulhada || !resposta.name) throw new CofreIndisponivel('o KMS não devolveu o embrulho');
      return { embrulhada, versao: resposta.name };
    },
    async desembrulhar(embrulhada, aad) {
      const [resposta] = await (await obterCliente()).decrypt({
        name: nomeDaChave,
        ciphertext: embrulhada,
        additionalAuthenticatedData: aad,
      });
      const chave = comoBuffer(resposta.plaintext);
      if (!chave) throw new CofreIndisponivel('o KMS não devolveu a chave de dados');
      return chave;
    },
  };
}

export type ConfiguracaoDoCofre = {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly TOKENS_KMS_KEY?: string | undefined;
  readonly TRIA_SESSION_SECRET: string;
};

export function escolherChaveMestra(config: ConfiguracaoDoCofre, fabrica?: FabricaDeClienteKms): ChaveMestra {
  if (config.TOKENS_KMS_KEY) return createChaveMestraKms(config.TOKENS_KMS_KEY, fabrica);
  if (config.NODE_ENV === 'production') return createChaveMestraFechada('TOKENS_KMS_KEY ausente em produção');
  return createChaveMestraLocal(config.TRIA_SESSION_SECRET);
}
