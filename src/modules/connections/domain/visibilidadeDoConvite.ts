export function podeVerConviteDeIntegracao(administra: boolean, clientIds: readonly string[] | null): boolean {
  return administra && clientIds === null;
}
