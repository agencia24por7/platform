import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { modules } from '@/composition';
import { consume } from '@/shared/security/rateLimit';
import { MARCA_DA_PLATAFORMA, ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';

export const dynamic = 'force-dynamic';

const LIMITE_POR_JANELA = 30;
const JANELA_MS = 10 * 60 * 1000;

const ROTULO_DO_ESTADO: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Conectado',
  expired: 'Expirado',
  revoked: 'Revogado',
};

export default async function PaginaDoConvite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const sourceIp = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconhecido';
  const verdict = consume(`convite:view:${sourceIp}`, LIMITE_POR_JANELA, JANELA_MS);
  if (!verdict.allowed) {
    return (
      <div className="portao">
        <main className="portao__acesso">
          <div className="portao__caixa">
            <h1 className="portao__titulo">Muitas tentativas</h1>
            <p className="portao__apoio">Espere um pouco e tente de novo.</p>
          </div>
        </main>
      </div>
    );
  }

  const convite = await modules().connectionInvites.forDisplay(token);
  if (!convite) notFound();

  const agora = new Date();
  const expirado = convite.status === 'pending' && convite.expiresAt <= agora;
  const ativo = convite.status === 'pending' && !expirado;

  return (
    <div className="portao">
      <main className="portao__acesso">
        <div className="portao__caixa">
          <h1 className="portao__titulo">Convite de {convite.organizationName}</h1>
          <p className="portao__apoio">
            Conecte cada plataforma com a sua própria conta. Nenhuma senha sua passa pela orla.
          </p>

          {!ativo ? (
            <p className="portao__aviso" role="alert">
              {convite.status === 'revoked'
                ? 'Este convite foi revogado.'
                : expirado || convite.status === 'expired'
                  ? 'Este convite expirou. Peça um novo link.'
                  : 'Este convite já foi usado.'}
            </p>
          ) : null}

          <div className="contas" style={{ marginTop: 16 }}>
            {convite.items.map((item) => {
              const concluido = item.status === 'completed';
              return (
                <div key={item.platform} className="conta">
                  <img src={MARCA_DA_PLATAFORMA[item.platform] ?? ''} alt="" width={22} height={22} />
                  <span className="conta__corpo">
                    <span className="conta__nome">{ROTULO_DA_PLATAFORMA[item.platform]}</span>
                    <span className="conta__meta">{ROTULO_DO_ESTADO[item.status] ?? item.status}</span>
                  </span>
                  {ativo && !concluido ? (
                    <a
                      className="btn btn--primary btn--compacto"
                      href={`/api/convite/${token}/oauth/${item.platform}/start`}
                    >
                      Conectar
                    </a>
                  ) : concluido ? (
                    <span className="pill pill--ok">conectado</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
