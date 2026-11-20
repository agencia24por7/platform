export const MENSAGEM_DO_ERRO_DE_AUTORIZACAO: Readonly<Record<string, string>> = {
  app_indisponivel: 'O aplicativo da plataforma não está habilitado neste ambiente.',
  autorizacao_recusada:
    'A autorização foi recusada: faltaram permissões mínimas de leitura ou o fluxo não indicou a qual organização pertence.',
  falha_autorizacao: 'Não foi possível concluir a autorização. Nada foi gravado.',
  estado_invalido:
    'A autorização expirou ou foi concluída em outra aba, então foi descartada por segurança. Clique em conectar de novo e conclua na mesma aba.',
  autorizacao_negada: 'Você cancelou no consentimento da plataforma. Nada foi conectado.',
  sem_codigo: 'A plataforma não devolveu o código de autorização.',
  plataforma_desconhecida: 'Plataforma não reconhecida.',
  sessao_expirada: 'Sua sessão na orla expirou durante a autorização. Entre de novo e conecte outra vez.',
  sessao_trocada: 'A autorização começou com outra conta da orla. Conecte de novo com a conta atual.',
  convite_invalido: 'O convite usado nesta autorização não é mais válido.',
};

const GENERICA = 'Não foi possível concluir a autorização. Tente de novo.';

export function mensagemDoErroDeAutorizacao(codigo: string): string {
  return MENSAGEM_DO_ERRO_DE_AUTORIZACAO[codigo] ?? GENERICA;
}

export function destinoDoErroDeAutorizacao(origem: string | null, codigo: string, plataforma: string): string {
  const url = new URL(origem ?? '/integracoes', 'http://orla.local');
  for (const chave of ['erroConexao', 'plataforma', 'autorizado', 'descobertas', 'aviso']) url.searchParams.delete(chave);
  url.searchParams.set('erroConexao', codigo);
  url.searchParams.set('plataforma', plataforma);
  return `${url.pathname}${url.search}`;
}
