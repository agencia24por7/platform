import { CaminhoInvalidoError } from './tipos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFIXO_DO_CLIENTE = /^orgs\/([0-9a-f-]{36})\/clientes\/([0-9a-f-]{36})\/(.*)$/;
const SEGMENTO = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const TAMANHO_MAXIMO_DO_CAMINHO = 900;
const TAMANHO_MAXIMO_DO_NOME = 80;
const TAMANHO_MAXIMO_DA_EXTENSAO = 8;
const NOME_PADRAO = 'arquivo';

export function nomeSeguro(nomeOriginal: string): string {
  const normalizado = (nomeOriginal.split(/[\\/]/).pop() ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

  const ultimoPonto = normalizado.lastIndexOf('.');
  const temExtensao = ultimoPonto > 0;
  const baseBruta = temExtensao ? normalizado.slice(0, ultimoPonto) : normalizado;
  const extensaoBruta = temExtensao ? normalizado.slice(ultimoPonto + 1) : '';

  const base = baseBruta
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, TAMANHO_MAXIMO_DO_NOME)
    .replace(/[-_]+$/g, '');
  const extensao = extensaoBruta.replace(/[^a-z0-9]/g, '').slice(0, TAMANHO_MAXIMO_DA_EXTENSAO);

  const baseFinal = base === '' ? NOME_PADRAO : base;
  return extensao === '' ? baseFinal : `${baseFinal}.${extensao}`;
}

function exigirUuid(valor: string, rotulo: string): void {
  if (!UUID.test(valor)) throw new CaminhoInvalidoError(`${rotulo} não é um UUID em minúsculas`);
}

export function prefixoDoCliente(orgId: string, clientId: string): string {
  exigirUuid(orgId, 'orgId');
  exigirUuid(clientId, 'clientId');
  return `orgs/${orgId}/clientes/${clientId}/`;
}

export function caminhoDoArquivo(orgId: string, clientId: string, fileId: string, nome: string): string {
  exigirUuid(fileId, 'fileId');
  return `${prefixoDoCliente(orgId, clientId)}arquivos/${fileId}-${nomeSeguro(nome)}`;
}

export function caminhoDoContexto(orgId: string, clientId: string, ...segmentos: string[]): string {
  if (segmentos.length === 0) throw new CaminhoInvalidoError('contexto sem nome de objeto');
  const caminho = `${prefixoDoCliente(orgId, clientId)}contexto/${segmentos.join('/')}`;
  validarCaminho(caminho);
  return caminho;
}

function validarRestante(restante: string): void {
  if (restante === '') return;
  const segmentos = restante.split('/');
  const ultimo = segmentos.length - 1;
  segmentos.forEach((segmento, indice) => {
    if (segmento === '' && indice === ultimo) return;
    if (segmento === '' || segmento === '.' || segmento === '..') {
      throw new CaminhoInvalidoError('segmento vazio, "." ou ".."');
    }
    if (!SEGMENTO.test(segmento)) {
      throw new CaminhoInvalidoError('caractere fora de [A-Za-z0-9._-] ou segmento começando com ponto');
    }
  });
}

function validarBase(caminho: string): { restante: string } {
  if (caminho.length === 0 || caminho.length > TAMANHO_MAXIMO_DO_CAMINHO) {
    throw new CaminhoInvalidoError('tamanho fora do limite');
  }
  const encontrado = PREFIXO_DO_CLIENTE.exec(caminho);
  if (!encontrado) throw new CaminhoInvalidoError('fora de orgs/{orgId}/clientes/{clientId}/');
  exigirUuid(encontrado[1] ?? '', 'orgId');
  exigirUuid(encontrado[2] ?? '', 'clientId');
  const restante = encontrado[3] ?? '';
  validarRestante(restante);
  return { restante };
}

export function validarCaminho(caminho: string, prefixoEsperado?: string): string {
  const { restante } = validarBase(caminho);
  if (restante === '' || restante.endsWith('/')) throw new CaminhoInvalidoError('objeto sem nome');
  if (prefixoEsperado !== undefined && !caminho.startsWith(prefixoEsperado)) {
    throw new CaminhoInvalidoError('fora do prefixo esperado');
  }
  return caminho;
}

export function validarPrefixo(prefixo: string, opcoes: { exigirBarraFinal?: boolean } = {}): string {
  const { restante } = validarBase(prefixo);
  if (opcoes.exigirBarraFinal && restante !== '' && !restante.endsWith('/')) {
    throw new CaminhoInvalidoError('prefixo precisa terminar em "/"');
  }
  return prefixo;
}
