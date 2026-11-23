import type { Platform } from '@/modules/connections/domain/connection';
import type { Result } from '@/shared/result/result';
import type { Alvo, ContextoDeCifra, TipoDeSegredo } from '@/modules/tokens/domain/token';

export type Embrulho = { readonly embrulhada: Buffer; readonly versao: string };

export type ChaveMestra = {
  readonly algoritmo: 'aes-256-gcm+kms' | 'aes-256-gcm+local';
  embrulhar(chaveDeDados: Buffer, aad: Buffer): Promise<Embrulho>;
  desembrulhar(embrulhada: Buffer, aad: Buffer): Promise<Buffer>;
};

export type Cifrado = {
  readonly bytes: Buffer;
  readonly versaoDaChave: string;
  readonly algoritmo: ChaveMestra['algoritmo'];
};

export type CifraDeTokens = {
  cifrar(texto: string, contexto: ContextoDeCifra): Promise<Cifrado>;
  decifrar(bytes: Buffer, contexto: ContextoDeCifra): Promise<string>;
};

export type Renovacao = {
  readonly accessToken: string;
  readonly expiraEm: Date | null;
  readonly novoSegredo?: string;
  readonly segredoExpiraEm?: Date | null;
};

export type NaturezaDaFalha = 'reautorizar' | 'transitoria' | 'configuracao';

export type FalhaDoProvedor = {
  readonly natureza: NaturezaDaFalha;
  readonly codigo: string;
};

export type ResultadoDaRevogacao = 'revogado' | 'sem_suporte' | 'falhou';

export type ProvedorDeToken = {
  renovar(segredo: string): Promise<Result<Renovacao, FalhaDoProvedor>>;
  revogar(segredo: string): Promise<Result<ResultadoDaRevogacao, FalhaDoProvedor>>;
};

export type FabricaDeProvedores = (platform: Platform, tipo: TipoDeSegredo) => ProvedorDeToken | null;

export type RegistroDeToken = {
  readonly connectionId: string;
  readonly organizationId: string;
  readonly platform: Platform;
  readonly tipo: TipoDeSegredo;
  readonly segredo: Buffer;
  readonly segredoExpiraEm: Date | null;
  readonly acesso: Buffer | null;
  readonly acessoExpiraEm: Date | null;
  readonly renovadoEm: Date | null;
  readonly versao: number;
};

export type Reivindicacao = {
  readonly registro: RegistroDeToken | null;
  readonly dono: boolean;
};

export type Concessao = string;

export type MudancaDeToken = {
  readonly acesso?: { readonly cifrado: Cifrado; readonly expiraEm: Date } | null;
  readonly segredo?: { readonly cifrado: Cifrado; readonly expiraEm: Date | null };
  readonly falha?: string | null;
  readonly renovadoEm?: Date;
};

export type NovoSegredo = {
  readonly tipo: TipoDeSegredo;
  readonly cifrado: Cifrado;
  readonly expiraEm: Date | null;
};

export type RepositorioDeTokens = {
  plataformaDa(alvo: Alvo): Promise<Platform | null>;
  carregar(alvo: Alvo): Promise<RegistroDeToken | null>;
  guardar(alvo: Alvo, novo: NovoSegredo): Promise<void>;
  reivindicarRenovacao(alvo: Alvo, prazoMs: number, concessao: Concessao): Promise<Reivindicacao>;
  concluirRenovacao(alvo: Alvo, versaoLida: number, concessao: Concessao, mudanca: MudancaDeToken): Promise<boolean>;
  liberarRenovacao(alvo: Alvo, concessao: Concessao, falha?: string | null): Promise<void>;
  apagar(alvo: Alvo): Promise<boolean>;
  aRenovar(antes: Date, limite: number): Promise<readonly Alvo[]>;
  comChaveAntiga(versaoPrimaria: string, limite: number): Promise<readonly Alvo[]>;
};

export type MarcadorDeReautorizacao = {
  marcar(alvo: Alvo, motivo: string, versaoLida: number): Promise<void>;
};

export type Registro = {
  info(mensagem: string, contexto: Record<string, unknown>): void;
  aviso(mensagem: string, contexto: Record<string, unknown>): void;
  erro(mensagem: string, contexto: Record<string, unknown>): void;
};

export type Relogio = () => Date;

export type Espera = (ms: number) => Promise<void>;
