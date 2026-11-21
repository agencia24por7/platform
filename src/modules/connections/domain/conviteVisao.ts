export type SituacaoDoItem = { readonly rotulo: string; readonly classe: string; readonly icone: 'ok' | 'atencao' | 'vazio' | 'pausada' | 'erro' };

export function situacaoDoItem(status: string, dispensada: boolean): SituacaoDoItem {
  if (status === 'completed') return { rotulo: 'Conectada', classe: 'pill--ok', icone: 'ok' };
  if (dispensada) return { rotulo: 'Dispensada', classe: 'pill--info', icone: 'pausada' };
  if (status === 'expired') return { rotulo: 'Expirada', classe: 'pill--warn', icone: 'atencao' };
  if (status === 'revoked') return { rotulo: 'Revogada', classe: 'pill--danger', icone: 'erro' };
  return { rotulo: 'Pendente', classe: '', icone: 'vazio' };
}

export function plataformasQueNaoUso(bruto: string | undefined, validas: readonly string[]): string[] {
  if (!bruto) return [];
  return [...new Set(bruto.split(',').map((p) => p.trim()))].filter((p) => validas.includes(p));
}

export type AvisoDoConvite = { readonly texto: string; readonly podeTentarDeNovo: boolean; readonly plataforma: string | null };

const AVISOS: Readonly<Record<string, { readonly texto: string; readonly podeTentarDeNovo: boolean }>> = {
  autorizacao_recusada: { texto: 'Faltou permissão: a plataforma não liberou a leitura mínima.', podeTentarDeNovo: true },
  autorizacao_negada: { texto: 'Você cancelou na tela da plataforma. Nada foi conectado.', podeTentarDeNovo: true },
  falha_autorizacao: { texto: 'Não foi possível concluir a conexão. Nada foi gravado.', podeTentarDeNovo: true },
  estado_invalido: { texto: 'A autorização expirou ou foi feita em outra aba.', podeTentarDeNovo: true },
  sem_codigo: { texto: 'A plataforma não devolveu a autorização.', podeTentarDeNovo: true },
  indisponivel: { texto: 'Esta plataforma está indisponível agora.', podeTentarDeNovo: true },
  muitas_tentativas: { texto: 'Muitas tentativas. Espere um pouco.', podeTentarDeNovo: true },
  plataforma_desconhecida: { texto: 'Plataforma não reconhecida.', podeTentarDeNovo: false },
  app_indisponivel: { texto: 'O aplicativo desta plataforma não está habilitado agora.', podeTentarDeNovo: false },
  sessao_expirada: { texto: 'A sessão expirou durante a autorização.', podeTentarDeNovo: true },
  sessao_trocada: { texto: 'A autorização começou em outra sessão.', podeTentarDeNovo: true },
  convite_invalido: { texto: 'Este convite expirou ou foi revogado.', podeTentarDeNovo: false },
};

export function avisoDoConvite(codigo: string | undefined, plataforma: string | undefined): AvisoDoConvite | null {
  if (!codigo) return null;
  const conhecido = AVISOS[codigo] ?? { texto: 'Não foi possível concluir a conexão.', podeTentarDeNovo: true };
  return { ...conhecido, plataforma: plataforma ?? null };
}
