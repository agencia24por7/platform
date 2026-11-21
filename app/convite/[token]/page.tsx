import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { EstadoDoLink, MolduraPublica } from '@/../app/contexto/_publico/PaginaPublica';
import { modules } from '@/composition';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { consume } from '@/shared/security/rateLimit';
import { requestId } from '@/shared/http/actions';
import { MARCA_DA_PLATAFORMA, ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { Icone, type NomeDoIcone } from '@/../app/clientes/[id]/_componentes/Icones';
import { FocoNaConta } from '@/../app/convite/[token]/FocoNaConta';
import { avisoDoConvite, plataformasQueNaoUso, situacaoDoItem } from '@/modules/connections/domain/conviteVisao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Convite',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, busca] = await Promise.all([params, searchParams]);
  const unico = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const sourceIp = enderecoConfiavel((await headers()).get('x-forwarded-for'));
  const verdict = consume(`convite:view:${sourceIp ?? 'desconhecido'}`, LIMITE_POR_JANELA, JANELA_MS);
  if (!verdict.allowed) {
    return <EstadoDoLink titulo="Muitas tentativas" texto="Espere um pouco e tente de novo." />;
  }

  const convite = await modules().connectionInvites.forDisplay(token);
  if (!convite) notFound();

  const agora = new Date();
  const expirado = convite.status === 'pending' && convite.expiresAt <= agora;
  const ativo = convite.status === 'pending' && !expirado;

  const mapa = ativo
    ? await modules().contexto.carregarPeloLink({ credencial: { tipo: 'convite', token }, ip: sourceIp, requestId: requestId() })
    : null;
  const comMapa = mapa?.ok ? mapa.value : null;
  const naoUso = plataformasQueNaoUso(unico(busca['nao']), convite.items.map((i) => i.platform));
  const conectadas = convite.items.filter((i) => i.status === 'completed').length;
  const resolvidas = convite.items.filter((i) => i.status === 'completed' || naoUso.includes(i.platform)).length;
  const todasResolvidas = resolvidas === convite.items.length;
  const autorizada = unico(busca['autorizado']);
  const aviso = avisoDoConvite(unico(busca['erroConexao']) ?? unico(busca['erro']), unico(busca['plataforma']));
  const linkNao = (lista: readonly string[]) => (lista.length > 0 ? `/convite/${token}?nao=${lista.join(',')}` : `/convite/${token}`);
  const progressoDoMapa = comMapa
    ? Math.round(comMapa.completude.secoes.reduce((s, x) => s + x.percentual, 0) / Math.max(comMapa.completude.secoes.length, 1))
    : 0;

  return (
    <MolduraPublica organizacao={convite.organizationName}>
      <div className="convite">
        <span className="eyebrow">Convite de {convite.organizationName}</span>
        <h1 className="publico__titulo">
          {comMapa ? 'Dois passos rápidos para começarmos' : 'Conectar contas'}
        </h1>
        <p className="publico__texto">
          Conecte cada plataforma com a sua própria conta. Nenhuma senha sua passa pela orla.
        </p>

        {aviso ? (
          <p className="alert alert--warn" role="alert">
            {aviso.texto}
            {aviso.podeTentarDeNovo ? ' Use o botão da plataforma para tentar de novo.' : ' Peça um novo link a quem enviou.'}
          </p>
        ) : null}

        {autorizada ? (
          <p className="alert alert--ok" role="status">
            {ROTULO_DA_PLATAFORMA[autorizada as keyof typeof ROTULO_DA_PLATAFORMA] ?? 'Conta'} conectada.
          </p>
        ) : null}

        {!ativo ? (
          <p className="alert alert--warn" role="alert">
            {convite.status === 'revoked'
              ? 'Este convite foi revogado.'
              : expirado || convite.status === 'expired'
                ? 'Este convite expirou. Peça um novo link.'
                : 'Este convite já foi usado.'}
          </p>
        ) : null}

        <ol className="etapas-do-convite">
          <li className={`etapa${todasResolvidas ? ' etapa--feita' : ''}`}>
            <div className="etapa__topo">
              <span className="etapa__numero" aria-hidden="true">1</span>
              <h2 className="etapa__titulo">Conectar contas</h2>
              <span className="etapa__progresso">{resolvidas} de {convite.items.length}</span>
            </div>
            <div className="contas">
              {convite.items.map((item) => {
                const concluido = item.status === 'completed';
                const dispensada = !concluido && naoUso.includes(item.platform);
                const situacao = situacaoDoItem(item.status, dispensada);
                const doErro = aviso && aviso.plataforma === item.platform ? aviso : null;
                const destacada = autorizada === item.platform;
                return (
                  <div key={item.platform} id={`conta-${item.platform}`} tabIndex={-1} className={`conta${destacada ? ' conta--destaque' : ''}`}>
                    <img src={MARCA_DA_PLATAFORMA[item.platform] ?? ''} alt="" width={22} height={22} />
                    <span className="conta__corpo">
                      <span className="conta__nome">{ROTULO_DA_PLATAFORMA[item.platform]}</span>
                      <span className="conta__meta">
                        <span className={`pill ${situacao.classe}`}>
                          <Icone nome={situacao.icone as NomeDoIcone} tamanho={14} />
                          {situacao.rotulo}
                        </span>
                        {doErro ? <span className="small"> {doErro.texto}</span> : null}
                      </span>
                    </span>
                    {ativo && !concluido && !dispensada ? (
                      <span className="conta__acao">
                        <a className="btn btn--primary btn--compacto" href={`/api/convite/${token}/oauth/${item.platform}/start`}>
                          {doErro?.podeTentarDeNovo ? 'Tentar de novo' : 'Conectar'}
                        </a>{' '}
                        <a className="quiet-link small" href={linkNao([...naoUso, item.platform])}>
                          Não uso esta plataforma
                        </a>
                      </span>
                    ) : dispensada && ativo ? (
                      <a className="quiet-link small conta__acao" href={linkNao(naoUso.filter((p) => p !== item.platform))}>
                        Desfazer
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </li>
          {comMapa ? (
            <li className={`etapa${comMapa.concluidoEm ? ' etapa--feita' : ''}`}>
              <div className="etapa__topo">
                <span className="etapa__numero" aria-hidden="true">2</span>
                <h2 className="etapa__titulo">Contexto</h2>
                <span className="etapa__progresso">{comMapa.concluidoEm ? 'enviado' : `${progressoDoMapa}%`}</span>
              </div>
              <p className="subtle small">
                {comMapa.secoes.length} seções sobre o seu negócio, cerca de {Math.max(4, comMapa.secoes.length * 4)} minutos. Salva sozinho.
              </p>
              <progress className="formulario-publico__barra" max={100} value={comMapa.concluidoEm ? 100 : progressoDoMapa} aria-label="Progresso do mapa de contexto" />
              <Link className="btn btn--primary btn--grande" href={`/convite/${token}/contexto`}>
                {progressoDoMapa > 0 ? 'Continuar o mapa' : 'Preencher o mapa'} →
              </Link>
            </li>
          ) : null}
        </ol>

        {ativo && todasResolvidas && (!comMapa || comMapa.concluidoEm) ? (
          <div className="alert alert--ok" role="status">
            <strong>Tudo pronto.</strong> {conectadas > 0 ? `${conectadas} conta(s) conectada(s). ` : ''}Você já pode fechar esta página; {convite.organizationName} segue daqui.
          </div>
        ) : null}

        {autorizada ? <FocoNaConta id={`conta-${autorizada}`} /> : null}

        <p className="portao__nota">
          Ao conectar, você autoriza {convite.organizationName} a acessar, pela orla, os dados descritos na{' '}
          <Link href="/privacidade">Política de Privacidade</Link>, conforme os{' '}
          <Link href="/termos">Termos de Serviço</Link>. Você pode revogar o acesso a qualquer momento na sua conta
          Google ou Meta.
        </p>
      </div>
    </MolduraPublica>
  );
}
