import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { PAPEIS_CONVIDAVEIS, conviteVivo } from '@/modules/team/domain/convite';
import { podeMexerNaEquipe } from '@/modules/team/domain/membro';
import type { MemberRole } from '@/modules/identity/domain/user';
import { atorAtual } from '@/shared/http/ator';
import { list, text, toActionState } from '@/shared/http/actions';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const ROTULO_DO_PAPEL: Record<MemberRole, string> = {
  owner: 'Responsável',
  admin: 'Administra',
  operator: 'Opera',
  viewer: 'Enxerga',
};

const EFEITO_DO_PAPEL: Record<MemberRole, string> = {
  owner: 'Decide tudo, inclusive quem mais responde pela organização.',
  admin: 'Cuida da equipe, das conexões e do ciclo de vida dos clientes.',
  operator: 'Trabalha no dia a dia: vincula contas, pausa e retoma coletas.',
  viewer: 'Só lê. É o papel certo para o próprio cliente acompanhar os dados dele.',
};

function voltar(mensagem: string, tom: 'erro' | 'feito'): never {
  redirect(`/equipe?${tom}=${encodeURIComponent(mensagem)}`);
}

async function contexto() {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  if (!podeMexerNaEquipe(ctx.role)) redirect('/clientes');
  return ctx;
}

async function convidar(formData: FormData): Promise<void> {
  'use server';
  const ctx = await contexto();

  const resultado = await modules().team.convidar(
    {
      organizationId: ctx.organization.id,
      papelDeQuemConvida: ctx.role,
      email: text(formData, 'email'),
      role: text(formData, 'role'),
      clientIds: list(formData, 'clientIds'),
    },
    await atorAtual(),
  );

  if (!resultado.ok) voltar(toActionState(resultado.error).error ?? 'Não deu para convidar.', 'erro');
  voltar(`Convite aberto para ${resultado.value.email}. Basta entrar com esse e-mail no Google.`, 'feito');
}

async function revogarConvite(formData: FormData): Promise<void> {
  'use server';
  const ctx = await contexto();

  const resultado = await modules().team.revogarConvite(
    ctx.organization.id,
    ctx.role,
    text(formData, 'invitationId'),
    await atorAtual(),
  );

  if (!resultado.ok) voltar(toActionState(resultado.error).error ?? 'Não deu para revogar.', 'erro');
  voltar('Convite revogado.', 'feito');
}

async function revogarMembro(formData: FormData): Promise<void> {
  'use server';
  const ctx = await contexto();

  const resultado = await modules().team.revogarMembro(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, memberId: text(formData, 'memberId') },
    await atorAtual(),
  );

  if (!resultado.ok) voltar(toActionState(resultado.error).error ?? 'Não deu para revogar.', 'erro');
  voltar('Acesso revogado. O histórico desta pessoa continua na auditoria.', 'feito');
}

async function trocarPapel(formData: FormData): Promise<void> {
  'use server';
  const ctx = await contexto();

  const resultado = await modules().team.trocarPapel(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      memberId: text(formData, 'memberId'),
      novoPapel: text(formData, 'role'),
    },
    await atorAtual(),
  );

  if (!resultado.ok) voltar(toActionState(resultado.error).error ?? 'Não deu para trocar o papel.', 'erro');
  voltar('Papel atualizado.', 'feito');
}

async function definirEscopo(formData: FormData): Promise<void> {
  'use server';
  const ctx = await contexto();

  const clientIds = list(formData, 'clientIds');
  const resultado = await modules().team.definirEscopo(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      memberId: text(formData, 'memberId'),
      clientIds,
    },
    await atorAtual(),
  );

  if (!resultado.ok) voltar(toActionState(resultado.error).error ?? 'Não deu para mudar o acesso.', 'erro');
  voltar(
    clientIds.length === 0
      ? 'Acesso aberto para a organização inteira.'
      : `Acesso restrito a ${clientIds.length} cliente(s).`,
    'feito',
  );
}

export default async function EquipePage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; feito?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  if (!podeMexerNaEquipe(ctx.role)) redirect('/clientes');

  const [params, equipe, clientes] = await Promise.all([
    searchParams,
    modules().team.equipe(ctx.organization.id),
    modules().clients.list(ctx.organization.id),
  ]);

  const agora = new Date();
  const convitesAbertos = equipe.convites.filter((convite) => conviteVivo(convite, agora));
  const papeisQuePossoDar: readonly MemberRole[] =
    ctx.role === 'owner' ? ['owner', 'admin', 'operator', 'viewer'] : ['admin', 'operator', 'viewer'];

  return (
    <Shell title="Equipe" organization={ctx.organization} active="/equipe">
      <div className="page__head">
        <div>
          <div className="page__title">Quem tem acesso</div>
          <div className="page__sub">
            Vínculos não são apagados: são revogados, e a trilha continua lendo o passado. Um acesso
            restrito a clientes específicos é como o próprio cliente entra para ver só o que é dele.
          </div>
        </div>
      </div>

      <Feedback message={params.erro} tone="error" />
      <Feedback message={params.feito} tone="ok" />

      <div className="card">
        <div className="card__head">Convidar</div>
        <form className="form form--linha" action={convidar}>
          <label className="field">
            <span className="field__label">E-mail</span>
            <input className="input" type="email" name="email" required placeholder="pessoa@empresa.com" />
            <span className="field__hint">
              O convite vale 7 dias e se resolve sozinho quando essa pessoa entrar com o Google.
            </span>
          </label>
          <label className="field">
            <span className="field__label">Papel</span>
            <select className="select" name="role" defaultValue="operator">
              {PAPEIS_CONVIDAVEIS.map((papel) => (
                <option key={papel} value={papel}>
                  {ROTULO_DO_PAPEL[papel]}
                </option>
              ))}
            </select>
            <span className="field__hint">{EFEITO_DO_PAPEL.operator}</span>
          </label>
          <label className="field">
            <span className="field__label">Enxerga</span>
            <select
              className="select"
              name="clientIds"
              multiple
              size={Math.min(Math.max(clientes.length, 2), 5)}
              aria-label="Clientes que a pessoa convidada poderá enxergar"
            >
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.name}
                </option>
              ))}
            </select>
            <span className="field__hint">
              Sem seleção, enxerga a organização inteira. Selecione clientes para abrir o acesso só a
              eles — o recorte já vale no momento em que a pessoa entra.
            </span>
          </label>
          <button className="btn btn--primary" type="submit">
            Convidar
          </button>
        </form>
      </div>

      {convitesAbertos.length > 0 ? (
        <div className="card">
          <div className="card__head">Convites abertos</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Vence em</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {convitesAbertos.map((convite) => (
                  <tr key={convite.id}>
                    <td className="strong">{convite.email}</td>
                    <td>{ROTULO_DO_PAPEL[convite.role]}</td>
                    <td className="muted">{convite.expiresAt.toLocaleDateString('pt-BR')}</td>
                    <td>
                      <form action={revogarConvite}>
                        <input type="hidden" name="invitationId" value={convite.id} />
                        <button className="btn" type="submit">
                          Revogar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card__head">Vínculos</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Papel</th>
                <th>Enxerga</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {equipe.membros.map((membro) => {
                const vivo = membro.revokedAt === null;
                return (
                  <tr key={membro.memberId}>
                    <td>
                      <span className="strong">{membro.name}</span>
                      <div className="muted small">{membro.email}</div>
                      {vivo ? null : (
                        <span className="pill">
                          revogado em {membro.revokedAt!.toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </td>
                    <td>
                      {vivo ? (
                        <form className="form--inline" action={trocarPapel}>
                          <input type="hidden" name="memberId" value={membro.memberId} />
                          <select className="select select--compacto" name="role" defaultValue={membro.role}>
                            {papeisQuePossoDar.map((papel) => (
                              <option key={papel} value={papel}>
                                {ROTULO_DO_PAPEL[papel]}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn--compacto" type="submit">
                            Aplicar
                          </button>
                        </form>
                      ) : (
                        <span className="muted">{ROTULO_DO_PAPEL[membro.role]}</span>
                      )}
                    </td>
                    <td>
                      {vivo ? (
                        <form className="form--inline" action={definirEscopo}>
                          <input type="hidden" name="memberId" value={membro.memberId} />
                          <select
                            className="select select--compacto"
                            name="clientIds"
                            multiple
                            size={Math.min(Math.max(clientes.length, 2), 5)}
                            defaultValue={membro.clientIds as string[]}
                            aria-label={`Clientes visíveis para ${membro.name}`}
                          >
                            {clientes.map((cliente) => (
                              <option key={cliente.id} value={cliente.id}>
                                {cliente.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn--compacto" type="submit">
                            Aplicar
                          </button>
                          <span className="field__hint">
                            {membro.clientIds.length === 0
                              ? 'Organização inteira'
                              : `${membro.clientIds.length} cliente(s)`}
                            . Sem nenhum selecionado, enxerga tudo.
                          </span>
                        </form>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {vivo ? (
                        <form action={revogarMembro}>
                          <input type="hidden" name="memberId" value={membro.memberId} />
                          <button className="btn" type="submit">
                            Revogar acesso
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card__head">O que cada papel pode</div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {(['owner', 'admin', 'operator', 'viewer'] as const).map((papel) => (
                <tr key={papel}>
                  <td className="strong">{ROTULO_DO_PAPEL[papel]}</td>
                  <td className="muted">{EFEITO_DO_PAPEL[papel]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
