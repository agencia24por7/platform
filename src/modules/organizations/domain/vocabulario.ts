import type { OrganizationType } from './organization.ts';

export type Vocabulario = {
  readonly cliente: string;
  readonly clientes: string;
  readonly resumoDoCliente: string;
  readonly descricaoDoCliente: string;
  readonly rotuloDePedir: string;
  readonly rotuloDaAcaoDeContexto: string;
  readonly rotuloDaAcaoDeConexao: string;
  readonly textoDeFontesVazio: string;
  readonly descricaoDoPapelLeitor: string;
  readonly descricaoDoCicloDeVida: string;
  readonly nomeDaOrganizacao: string;
  readonly enviarMapaNoPerfil: boolean;
};

const AGENCIA: Vocabulario = {
  cliente: 'cliente',
  clientes: 'Clientes',
  resumoDoCliente: 'Resumo do cliente',
  descricaoDoCliente: 'Descrição do cliente',
  rotuloDePedir: 'Pedir ao cliente',
  rotuloDaAcaoDeContexto: 'Enviar mapa',
  rotuloDaAcaoDeConexao: 'Conectar conta',
  textoDeFontesVazio: 'Sem conta vinculada o cliente não entra na coleta.',
  descricaoDoPapelLeitor: 'Só lê. É o papel certo para o próprio cliente acompanhar os dados da conta.',
  descricaoDoCicloDeVida: 'Cuida da equipe, das conexões e do ciclo de vida dos clientes.',
  nomeDaOrganizacao: 'Nome da agência',
  enviarMapaNoPerfil: true,
};

const ANUNCIANTE: Vocabulario = {
  cliente: 'negócio',
  clientes: 'Negócios',
  resumoDoCliente: 'Resumo do negócio',
  descricaoDoCliente: 'Descrição do negócio',
  rotuloDePedir: 'Convidar',
  rotuloDaAcaoDeContexto: 'Preencher contexto',
  rotuloDaAcaoDeConexao: 'Conectar conta',
  textoDeFontesVazio: 'Sem conta vinculada o negócio não entra na coleta.',
  descricaoDoPapelLeitor: 'Só lê. É o papel certo para um colega ou consultor acompanhar os dados.',
  descricaoDoCicloDeVida: 'Cuida da equipe, das conexões e do ciclo de vida dos negócios.',
  nomeDaOrganizacao: 'Nome da empresa',
  enviarMapaNoPerfil: false,
};

export function vocabularioDe(tipo: OrganizationType): Vocabulario {
  return tipo === 'advertiser' ? ANUNCIANTE : AGENCIA;
}

export function noVocabularioDe(tipo: OrganizationType, texto: string): string {
  if (tipo !== 'advertiser') return texto;
  return texto.replace(/\bclientes\b/g, 'negócios').replace(/\bcliente\b/g, 'negócio').replace(/\bClientes\b/g, 'Negócios').replace(/\bCliente\b/g, 'Negócio');
}
