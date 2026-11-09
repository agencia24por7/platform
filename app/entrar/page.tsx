import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/../app/_components/ThemeToggle';
import { env } from '@/shared/config/env';
import { currentUser } from '@/shared/http/currentUser';

export const dynamic = 'force-dynamic';

const MOTIVOS: Record<string, string> = {
  indisponivel: 'Esta instalação ainda não tem credencial de login configurada.',
  recusado: 'Você cancelou a autorização no Google.',
  origem: 'A resposta não veio do endereço esperado.',
  estado: 'A sessão de login expirou. Tente de novo.',
  codigo: 'A resposta do Google veio incompleta.',
  troca: 'O Google recusou a troca do código de autorização.',
  sem_identidade: 'O Google não devolveu uma identidade.',
  identidade_ilegivel: 'Não foi possível ler a identidade devolvida.',
  identidade_invalida: 'A identidade devolvida não passou na verificação.',
  sem_acesso: 'Esta conta não tem acesso liberado.',
};

const GOOGLE_G = (
  <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.8-2 5.1-4.4 6.7v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.4z"
    />
    <path
      fill="#34A853"
      d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z"
    />
    <path fill="#FBBC05" d="M11.7 28.1a13.2 13.2 0 0 1 0-8.2v-5.7H4.3a22 22 0 0 0 0 19.6l7.4-5.7z" />
    <path
      fill="#EA4335"
      d="M24 9.5c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 2.9 30 1 24 1 15.4 1 7.9 5.9 4.3 13.1l7.4 5.7C13.4 13.4 18.3 9.5 24 9.5z"
    />
  </svg>
);

const ONDA_PATH = 'M-160 40 C-110 -50 -40 -60 5 0 S120 65 160 -40';
const ONDA_COLUNAS = 12;
const ONDA_LINHAS = 10;
const ONDA_CICLO_S = 6.3;
const ONDA_PASSO_S = ONDA_CICLO_S / (ONDA_COLUNAS * ONDA_LINHAS);

function corDaOnda(indice: number): string {
  if (indice % 23 === 9) return 'var(--tide-500)';
  if (indice % 11 === 4) return 'var(--ocean-500)';
  return 'var(--onda-neutra)';
}

function Ondas() {
  return (
    <div className="vitrine__ondas" aria-hidden="true">
      {Array.from({ length: ONDA_LINHAS }, (_, linha) => (
        <div key={linha} className="vitrine__onda-linha" style={{ paddingLeft: linha % 2 ? 55 : 0 }}>
          {Array.from({ length: ONDA_COLUNAS }, (_, coluna) => {
            const indice = linha * ONDA_COLUNAS + coluna;
            return (
              <svg
                key={coluna}
                className="orla-onda"
                width="56"
                height="28"
                viewBox="-215 -110 430 220"
                style={{ animationDelay: `${(-indice * ONDA_PASSO_S).toFixed(2)}s`, color: corDaOnda(indice) }}
              >
                <path d={ONDA_PATH} fill="none" stroke="currentColor" strokeWidth={85} strokeLinecap="round" />
              </svg>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type Props = { readonly searchParams: Promise<Record<string, string | undefined>> };

export default async function Entrar({ searchParams }: Props) {
  if (await currentUser()) redirect('/');

  const params = await searchParams;
  const disponivel = Boolean(env().GOOGLE_OAUTH_CLIENT_ID);
  const codigo = params['erro'];
  const motivo = codigo && !(codigo === 'indisponivel' && disponivel) ? MOTIVOS[codigo] : null;

  return (
    <div className="portao">
      <div className="portao__tema">
        <ThemeToggle />
      </div>

      <section className="portao__vitrine">
        <Ondas />
        <span className="malha__azulejo" aria-hidden="true" />

        <div className="vitrine__cartao">
          <img className="vitrine__logo vitrine__logo--padrao" src="/orla/logo.png" alt="orla" />
          <img className="vitrine__logo vitrine__logo--reversa" src="/orla/logo-reversa.png" alt="orla" />
          <span className="vitrine__legenda">Um oceano azul para seus anúncios.</span>
        </div>
      </section>

      <main className="portao__acesso">
        <div className="portao__caixa">
          <img className="portao__icone portao__icone--padrao" src="/orla/icone.png" alt="" width={56} height={56} />
          <img className="portao__icone portao__icone--reversa" src="/orla/icone-reversa.png" alt="" width={56} height={56} />
          <h1 className="portao__titulo">Boas-vindas à orla</h1>
          <p className="portao__apoio">Use sua conta Google.</p>

          {motivo ? (
            <p className="portao__aviso" role="alert">
              {motivo}
            </p>
          ) : null}

          {disponivel ? (
            <a className="portao__botao" href="/api/auth/google/start">
              <span className="portao__g">{GOOGLE_G}</span>
              Continuar com Google
            </a>
          ) : (
            <p className="portao__aviso" role="alert">
              Falta a credencial de login. Configure o segredo{' '}
              <code>google-oauth-client-id</code> antes de liberar o acesso.
            </p>
          )}

          <p className="portao__nota">Ao continuar, você aceita os Termos e a Privacidade.</p>
        </div>
      </main>
    </div>
  );
}
