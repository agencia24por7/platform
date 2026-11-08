import { redirect } from 'next/navigation';
import { env } from '@/shared/config/env';
import { currentUser } from '@/shared/http/currentUser';

export const dynamic = 'force-dynamic';

const MOTIVOS: Record<string, string> = {
  indisponivel: 'O login com Google ainda não está configurado nesta instalação.',
  recusado: 'Você cancelou a autorização no Google.',
  origem: 'A resposta não veio do endereço esperado.',
  estado: 'A sessão de login expirou. Tente novamente.',
  codigo: 'A resposta do Google veio incompleta.',
  troca: 'O Google recusou a troca do código de autorização.',
  sem_identidade: 'O Google não devolveu uma identidade.',
  identidade_ilegivel: 'Não foi possível ler a identidade devolvida.',
  identidade_invalida: 'A identidade devolvida não passou na verificação.',
  sem_acesso: 'Esta conta não tem acesso liberado.',
};

type Props = { readonly searchParams: Promise<Record<string, string | undefined>> };

export default async function Entrar({ searchParams }: Props) {
  if (await currentUser()) redirect('/');

  const params = await searchParams;
  const motivo = params['erro'] ? MOTIVOS[params['erro']] : null;
  const disponivel = Boolean(env().GOOGLE_OAUTH_CLIENT_ID);

  return (
    <main className="entrada">
      <div className="entrada__cartao">
        <p className="entrada__marca">tria</p>
        <h1 className="entrada__titulo">Entrar na plataforma</h1>
        <p className="entrada__apoio">
          Use a mesma conta Google com que você administra as contas de anúncio.
        </p>

        {motivo ? <p className="entrada__erro">{motivo}</p> : null}

        {disponivel ? (
          <a className="btn btn--primary btn--pill entrada__acao" href="/api/auth/google/start">
            Entrar com Google
          </a>
        ) : (
          <p className="entrada__erro">
            Esta instalação ainda não tem credencial de login. Configure o segredo
            <code> google-oauth-client-id </code> antes de liberar o acesso.
          </p>
        )}

        <p className="entrada__rodape">
          A tria não guarda sua senha. A autenticação acontece no Google.
        </p>
      </div>
    </main>
  );
}
