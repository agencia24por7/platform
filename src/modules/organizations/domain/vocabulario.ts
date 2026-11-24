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
  readonly rotuloDeCompartilhar: string;
  readonly dicaDeCompartilhar: string;
  readonly seloDoCompartilhado: string;
  readonly dicaDoSelo: string;
  readonly seloInterno: string;
  readonly avisoDeCompartilhou: string;
  readonly avisoDeDescompartilhou: string;
  readonly origemCliente: string;
  readonly origemEquipe: string;
  readonly semConfirmacaoDoAnunciante: string;
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
  rotuloDeCompartilhar: 'Compartilhável com o cliente',
  dicaDeCompartilhar: 'Mostra ao cliente, no formulário enviado por link, o que a equipe já preencheu nesta seção',
  seloDoCompartilhado: 'cliente vê',
  dicaDoSelo: 'O cliente vê esta informação no formulário',
  seloInterno: 'só a equipe vê',
  avisoDeCompartilhou: 'O que já está preenchido nesta seção passa a aparecer para o cliente.',
  avisoDeDescompartilhou: 'Esta seção deixa de mostrar as respostas da equipe ao cliente.',
  origemCliente: 'Cliente',
  origemEquipe: 'Agência',
  semConfirmacaoDoAnunciante: 'Sem confirmação do anunciante',
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
  rotuloDeCompartilhar: 'Visível a quem eu convidar',
  dicaDeCompartilhar: 'Mostra a quem você convidar, no formulário enviado por link, o que já está preenchido nesta seção',
  seloDoCompartilhado: 'convidado vê',
  dicaDoSelo: 'Quem você convidar vê esta informação no formulário',
  seloInterno: 'só você vê',
  avisoDeCompartilhou: 'O que já está preenchido nesta seção passa a aparecer para quem você convidar.',
  avisoDeDescompartilhou: 'Esta seção deixa de mostrar o que já está preenchido a quem você convidar.',
  origemCliente: 'Empresa',
  origemEquipe: 'Equipe',
  semConfirmacaoDoAnunciante: 'Sem confirmação do responsável pelo negócio',
};

export function vocabularioDe(tipo: OrganizationType): Vocabulario {
  return tipo === 'advertiser' ? ANUNCIANTE : AGENCIA;
}

export function noVocabularioDe(tipo: OrganizationType, texto: string): string {
  if (tipo !== 'advertiser') return texto;
  return texto.replace(/\bclientes\b/g, 'negócios').replace(/\bcliente\b/g, 'negócio').replace(/\bClientes\b/g, 'Negócios').replace(/\bCliente\b/g, 'Negócio');
}
