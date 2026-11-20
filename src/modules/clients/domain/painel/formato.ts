export function formatarCentavos(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return '';
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mascararDinheiro(digitado: string): { readonly texto: string; readonly centavos: number | null } {
  const digitos = digitado.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
  if (digitos.length === 0) return { texto: '', centavos: null };
  const centavos = Number(digitos);
  return { texto: formatarCentavos(centavos), centavos };
}

export function formatarNumero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '';
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function numeroDeTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/\s|%/g, '');
  if (limpo.length === 0) return null;
  const normal = /,/.test(limpo) ? limpo.replace(/[.]/g, '').replace(',', '.') : /^\d{1,3}([.]\d{3})+$/.test(limpo) ? limpo.replace(/[.]/g, '') : limpo;
  const valor = Number(normal);
  return Number.isFinite(valor) ? valor : null;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function normalizarArrobaDigitado(texto: string): string {
  const limpo = texto.trim();
  if (limpo.length === 0 || limpo.startsWith('@') || /[/]|^(https?:|www[.])/i.test(limpo) || /\s/.test(limpo)) return limpo;
  return `@${limpo}`;
}
