export type LandingPage = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly url: string;
  readonly rotulo: string;
  readonly criadaEm: Date;
  readonly arquivadaEm: Date | null;
};

export const TAMANHO_MAXIMO_DO_ROTULO = 120;
