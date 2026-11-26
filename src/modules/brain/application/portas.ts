import type { InventarioDoCliente } from '../domain/inventario.ts';

export type ClienteResolvido = { readonly organizationId: string; readonly clienteId: string };

export type EstadoDaPublicacao = {
  readonly publicadoEm: Date | null;
  readonly ultimoHash: string | null;
  readonly pendente: boolean;
  readonly ultimaTentativaEm: Date | null;
  readonly ultimoErro: string | null;
  readonly tentativas: number;
};

export type MedidaNova = {
  readonly tabela: string;
  readonly desde: string | null;
  readonly ate: string | null;
  readonly linhas: number;
  readonly diasComDado: number | null;
};

export type ClienteParaMedir = ClienteResolvido & { readonly plataformas: readonly string[] };

export type BrainRepository = {
  resolverCliente(clienteId: string): Promise<ClienteResolvido | null>;
  clienteVivo(cliente: ClienteResolvido): Promise<boolean>;
  carregarInventario(cliente: ClienteResolvido): Promise<InventarioDoCliente | null>;
  estado(cliente: ClienteResolvido): Promise<EstadoDaPublicacao | null>;
  registrarPublicacao(cliente: ClienteResolvido, publicacao: { readonly hash: string; readonly entradas: number }): Promise<void>;
  registrarFalha(cliente: ClienteResolvido, erro: string): Promise<void>;
  marcarPendente(cliente: ClienteResolvido, motivo: string): Promise<void>;
  clientesParaPublicar(limite: number): Promise<readonly ClienteResolvido[]>;
  clientesExcluidosPublicados(limite: number): Promise<readonly ClienteResolvido[]>;
  marcarDespublicado(clienteId: string): Promise<void>;
  clientesParaMedir(limite: number): Promise<readonly ClienteParaMedir[]>;
  gravarCobertura(cliente: ClienteResolvido, medidas: readonly MedidaNova[]): Promise<void>;
};

export type ObjetoDeMedicao = {
  readonly tabela: string;
  readonly view: string;
  readonly colunaDeData: string | null;
  readonly dimensao: boolean;
};

export type MedidorDeCobertura = {
  readonly disponivel: boolean;
  medir(cliente: ClienteResolvido, objetos: readonly ObjetoDeMedicao[], desde: string, ate: string): Promise<readonly MedidaNova[]>;
};

export type IdentidadeDoWorker = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type AgenteLeitor = {
  readonly credencialId: string;
  readonly organizationId: string;
  readonly clienteIds: readonly string[] | null;
  readonly requestId: string;
  readonly sourceIp: string | null;
};
