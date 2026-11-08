export function resumirFalha(status: number, motivo: string): string {
  const codigo = /"(requestError|authorizationError|authenticationError)"\s*:\s*"([A-Z_]+)"/.exec(motivo);
  if (codigo) return `${codigo[2]} (HTTP ${status})`;

  const mensagem = /"message"\s*:\s*"([^"]{0,160})"/.exec(motivo);
  if (mensagem) return `${mensagem[1]} (HTTP ${status})`;

  return `HTTP ${status}`;
}
