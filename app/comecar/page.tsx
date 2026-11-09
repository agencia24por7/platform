import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProviderCard } from '@/../app/_components/ProviderCard';
import { Wizard } from '@/../app/_components/Wizard';
import { modules } from '@/composition';
import { env } from '@/shared/config/env';
import { isConfigured } from '@/modules/connections/domain/oauth';

export const dynamic = 'force-dynamic';

const ERROS: Record<string, string> = {
  app_indisponivel: 'O aplicativo da plataforma não está habilitado neste ambiente.',
  autorizacao_recusada: 'A autorização foi recusada: ou faltaram permissões mínimas de leitura, ou o fluxo não indicou a qual organização pertence. Recomece a partir desta tela.',
  falha_autorizacao: 'Não foi possível concluir a autorização. Nada foi gravado.',
  estado_invalido: 'A autorização não pôde ser validada e foi descartada. Tente de novo.',
  autorizacao_negada: 'Você cancelou no consentimento da plataforma. Nada foi conectado.',
  sem_codigo: 'A plataforma não devolveu o código de autorização.',
  plataforma_desconhecida: 'Plataforma não reconhecida.',
};

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{
    passo?: string;
    erro?: string;
    indisponivel?: string;
    autorizado?: string;
    descobertas?: string;
    organizacao?: string;
  }>;
}) {
  const params = await searchParams;
  if (params.passo === 'operacao') redirect('/organizacoes/nova');

  const hasOrganization = await modules().organizations.exists();
  if (hasOrganization && !params.passo) redirect('/clientes');

  const config = env();
  const available = {
    google: isConfigured(
      { clientId: config.GOOGLE_OAUTH_CLIENT_ID, clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET },
      'google',
    ),
    meta: isConfigured(
      {
        clientId: config.META_APP_ID,
        clientSecret: config.META_APP_SECRET,
        configId: config.META_LOGIN_CONFIG_ID,
      },
      'meta',
    ),
  };

  const unavailable = params.indisponivel === 'google' || params.indisponivel === 'meta' ? params.indisponivel : null;

  return (
    <Wizard current="conectar">
      <div>
        <div className="wizard__eyebrow">Passo 1 de 3 · Conectar</div>
        <h1 className="wizard__heading">Conecte sua primeira conta de anúncios</h1>
        <p className="wizard__sub">
          A autorização acontece no site da própria plataforma. A Orla recebe permissão de leitura e gestão,
          nunca a sua senha, e você revoga quando quiser.
        </p>
      </div>

      {params.organizacao === 'criada' ? (
        <div className="alert alert--ok">
          Organização criada. Agora conecte uma plataforma, ou vá direto ao painel e cadastre as contas na
          mão.
        </div>
      ) : null}

      {params.erro && ERROS[params.erro] ? <div className="alert alert--error">{ERROS[params.erro]}</div> : null}

      {unavailable ? (
        <div className="alert alert--error">
          <div>
            <div className="strong">
              O aplicativo da Orla para {unavailable === 'google' ? 'Google Ads' : 'Meta Ads'} ainda não está
              habilitado neste ambiente.
            </div>
            <div>
              Nada foi enviado para a plataforma. Enquanto a verificação do aplicativo não sai, dá para
              cadastrar a conta informando os dados manualmente.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid--2">
        <ProviderCard platform="google" available={available.google} authorized={params.autorizado === 'google'} />
        <ProviderCard platform="meta" available={available.meta} authorized={params.autorizado === 'meta'} />
      </div>

      <div className="note">
        <div className="note__title">Por que preciso conectar minha conta?</div>
        <div>
          Sem acesso aos dados da conta não há diagnóstico: todo número que a plataforma mostra vem da API
          oficial. Nenhuma alteração é feita sem a sua autorização, e a conexão não aparece para quem olha a
          conta de anúncios.
        </div>
        <div style={{ marginTop: 8 }}>
          O token fica cifrado no cofre do n8n. A aplicação guarda apenas uma referência a ele.
        </div>
      </div>

      {params.autorizado ? (
        <div className="alert alert--ok">
          <div>
            <div className="strong">
              {params.autorizado === 'google' ? 'Google Ads' : 'Meta Ads'} autorizado
              {params.descobertas ? ` · ${params.descobertas} conta(s) encontradas` : ''}.
            </div>
            <Link className="btn btn--primary btn--pill" href="/comecar/contas" style={{ marginTop: 8 }}>
              Escolher contas →
            </Link>
          </div>
        </div>
      ) : null}

      <div className="quiet-link">
        {hasOrganization ? (
          <>
            Prefere cadastrar sem conectar agora? <Link href="/clientes">Ir para o painel →</Link>
          </>
        ) : (
          <>
            Sem acesso agora? <Link href="/organizacoes/nova">Cadastrar manualmente →</Link>
          </>
        )}
      </div>
    </Wizard>
  );
}
