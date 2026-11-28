import type { CampoSimples, Opcao } from './catalogo.ts';

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function rotuloDaOpcao(opcoes: readonly Opcao[], valor: unknown): string {
  const texto = String(valor);
  return opcoes.find((opcao) => opcao.valor === texto)?.rotulo ?? texto;
}

function vazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  if (Array.isArray(valor)) return valor.length === 0;
  return false;
}

export function textoDoValor(campo: CampoSimples, valor: unknown): string | null {
  if (vazio(valor)) return null;
  switch (campo.tipo) {
    case 'selecao':
      return rotuloDaOpcao(campo.opcoes, valor);
    case 'multipla':
      return (Array.isArray(valor) ? valor : [valor]).map((item) => rotuloDaOpcao(campo.opcoes, item)).join(', ');
    case 'numero': {
      const numero = typeof valor === 'number' ? NUMERO.format(valor) : String(valor);
      return campo.unidade ? `${numero} ${campo.unidade}` : numero;
    }
    case 'dinheiro':
      return typeof valor === 'number' ? REAIS.format(valor / 100) : String(valor);
    case 'escala':
      return typeof valor === 'number' ? `${valor} de ${campo.max} · ${campo.extremos[0]} ↔ ${campo.extremos[1]}` : String(valor);
    case 'booleano':
      return valor === true ? 'Sim' : valor === false ? 'Não' : String(valor);
    case 'arquivo':
      return null;
    default:
      return typeof valor === 'string' ? valor : String(valor);
  }
}
