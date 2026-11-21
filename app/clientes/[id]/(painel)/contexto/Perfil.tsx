import { carregarContexto, carregarPainel } from '@/../app/clientes/[id]/_dados';
import { EditorDeContexto } from '@/../app/clientes/[id]/(painel)/contexto/EditorDeContexto';
import { modules } from '@/composition';
import { tempoRelativo } from '@/modules/clients/domain/painel/resumo';

const ROTULO_DA_OPERACAO: Record<string, string> = { criar: 'preencheu', alterar: 'alterou', status: 'marcou', remover: 'removeu' };

export async function Perfil({ clienteId, secaoInicial, campoInicial }: { readonly clienteId: string; readonly secaoInicial: string | null; readonly campoInicial: string | null }) {
  const { ctx, cliente, podeEditar } = await carregarPainel(clienteId);
  const [contexto, revisoes] = await Promise.all([
    carregarContexto(ctx.organization.id, cliente.id),
    modules().contexto.listarRevisoes({ organizationId: ctx.organization.id, clientId: cliente.id, limite: 8 }),
  ]);

  if (!contexto) {
    return <div className="alert alert--error">Não foi possível carregar o contexto agora.</div>;
  }

  const { catalogo: _catalogo, ...dados } = contexto;
  const agora = new Date();
  const advertiser = ctx.organization.type === 'advertiser';

  return (
    <div className="pilha">
      <EditorDeContexto clienteId={cliente.id} dados={dados} podeEditar={podeEditar} secaoInicial={secaoInicial} campoInicial={campoInicial} />
      {revisoes.ok && revisoes.value.length > 0 ? (
        <details className="recolhivel">
          <summary className="recolhivel__resumo">
            <span className="recolhivel__titulo">Atividade recente</span>
          </summary>
          <div className="recolhivel__corpo">
            <ol className="linha-do-tempo">
              {revisoes.value.map((r) => (
                <li key={r.id} className="linha-do-tempo__item">
                  <span className={`linha-do-tempo__ponto${r.viaLink ? ' linha-do-tempo__ponto--cliente' : ''}`} aria-hidden="true" />
                  <span>
                    <strong>{r.viaLink ? (advertiser ? 'Um convidado' : 'O cliente') : 'A equipe'}</strong> {ROTULO_DA_OPERACAO[r.operacao] ?? r.operacao}{' '}
                    <span className="mono">{r.chave}</span>
                  </span>
                  <time className="subtle xsmall" dateTime={r.em.toISOString()}>
                    {tempoRelativo(r.em, agora)}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        </details>
      ) : null}
    </div>
  );
}
