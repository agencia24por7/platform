import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import {
  aplicarAcao,
  apagarPlanoAcao,
  autorizarAcao,
  cancelarExecucaoAcao,
  cancelarRascunhoAcao,
  pedirRevisaoAcao,
  rejeitarAcao,
  revogarAcao,
  tentarDeNovoAcao,
} from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import { FormularioDeMudanca } from '@/../app/clientes/[id]/(painel)/estrategia/FormularioDeMudanca';
import type { AcaoDaVisao, ChaveDeAcao, VisaoDoPlano } from '@/modules/strategy/interface/visaoDoPlano';

type Props = { readonly clienteId: string; readonly visao: VisaoDoPlano };

function Motivos({ id, acao }: { readonly id: string; readonly acao: AcaoDaVisao }) {
  if (acao.habilitada || acao.motivos.length === 0) return null;
  return (
    <ul className="estrategia-acao__motivos" id={id}>
      {acao.motivos.map((motivo) => (
        <li key={motivo}>{motivo}</li>
      ))}
    </ul>
  );
}

function BotaoDesabilitado({ acao, descricao }: { readonly acao: AcaoDaVisao; readonly descricao: string }) {
  return (
    <button type="button" className="btn" disabled aria-describedby={descricao}>
      {acao.rotulo}
    </button>
  );
}

export function AcoesDoPlano({ clienteId, visao }: Props) {
  const porChave = new Map<ChaveDeAcao, AcaoDaVisao>(visao.acoes.map((acao) => [acao.chave, acao]));
  const versaoId = visao.versao?.id ?? '';
  const planoId = visao.planoId ?? '';
  const ocultos = new Set<ChaveDeAcao>(['novo_plano', 'editar_secao']);
  const simples = visao.acoes.filter((acao) => !ocultos.has(acao.chave) && acao.chave !== 'pedir_mudanca');
  const mudanca = porChave.get('pedir_mudanca');

  if (simples.length === 0 && !mudanca) return null;

  const campos = (
    <>
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="planoId" value={planoId} />
      <input type="hidden" name="versaoId" value={versaoId} />
    </>
  );

  function renderizar(acao: AcaoDaVisao) {
    const idMotivos = `motivos-${acao.chave}`;
    if (!acao.habilitada) {
      return (
        <div className="estrategia-acao" key={acao.chave}>
          <BotaoDesabilitado acao={acao} descricao={idMotivos} />
          <Motivos id={idMotivos} acao={acao} />
        </div>
      );
    }
    if (acao.chave === 'aplicar' || acao.chave === 'autorizar') {
      return (
        <form className="estrategia-acao" key={acao.chave} action={acao.chave === 'aplicar' ? aplicarAcao : autorizarAcao}>
          {campos}
          <BotaoDeEnvio className="btn btn--primary" pendente={acao.chave === 'aplicar' ? 'Aplicando…' : 'Autorizando…'}>
            {acao.rotulo}
          </BotaoDeEnvio>
        </form>
      );
    }
    if (acao.chave === 'tentar_de_novo') {
      return (
        <form className="estrategia-acao" key={acao.chave} action={tentarDeNovoAcao}>
          <input type="hidden" name="clienteId" value={clienteId} />
          <input type="hidden" name="planoId" value={planoId} />
          <BotaoDeEnvio className="btn btn--primary" pendente="Pedindo…">
            {acao.rotulo}
          </BotaoDeEnvio>
        </form>
      );
    }
    if (acao.chave === 'pedir_revisao') {
      return (
        <form className="estrategia-acao" key={acao.chave} action={pedirRevisaoAcao}>
          <input type="hidden" name="clienteId" value={clienteId} />
          <input type="hidden" name="planoId" value={planoId} />
          <BotaoDeEnvio className="btn btn--primary" pendente="Pedindo…">
            {acao.rotulo}
          </BotaoDeEnvio>
        </form>
      );
    }
    const confirmacoes: Partial<Record<ChaveDeAcao, { readonly titulo: string; readonly descricao: string; readonly pendente: string; readonly action: (dados: FormData) => Promise<void> }>> = {
      rejeitar: { titulo: 'Rejeitar o plano?', descricao: 'O plano em autorização é recusado e não volta a valer. Um ajuste nasce como plano novo.', pendente: 'Rejeitando…', action: rejeitarAcao },
      revogar: { titulo: 'Revogar o plano autorizado?', descricao: 'O plano deixa de valer. Revogar não apaga o plano.', pendente: 'Revogando…', action: revogarAcao },
      cancelar_execucao: { titulo: 'Cancelar a execução?', descricao: 'O agente para de trabalhar neste plano. Você pode pedir de novo depois.', pendente: 'Cancelando…', action: cancelarExecucaoAcao },
      cancelar_rascunho: { titulo: 'Cancelar o rascunho?', descricao: 'O rascunho é descartado.', pendente: 'Cancelando…', action: cancelarRascunhoAcao },
      apagar_plano: { titulo: 'Apagar o plano?', descricao: 'O plano sai da lista e não pode ser recuperado por aqui. O histórico fica guardado para auditoria.', pendente: 'Apagando…', action: apagarPlanoAcao },
    };
    const confirmacao = confirmacoes[acao.chave];
    if (!confirmacao) return null;
    return (
      <div className="estrategia-acao" key={acao.chave}>
        <ConfirmarAcao
          gatilho={acao.rotulo}
          titulo={confirmacao.titulo}
          descricao={confirmacao.descricao}
          confirmar={acao.rotulo}
          pendente={confirmacao.pendente}
          action={confirmacao.action}
          gatilhoClasse="btn btn--perigo"
        >
          {campos}
          {acao.chave === 'cancelar_execucao' ? <input type="hidden" name="execucaoId" value={visao.execucao?.id ?? ''} /> : null}
        </ConfirmarAcao>
      </div>
    );
  }

  return (
    <section className="estrategia-acoes" aria-label="Ações do plano">
      <div className="estrategia-acoes__linha">{simples.map(renderizar)}</div>
      {mudanca ? (
        <div className="estrategia-acao estrategia-acao--mudanca">
          {mudanca.habilitada ? (
            <details className="editor-secao">
              <summary className="btn">{mudanca.rotulo}</summary>
              <FormularioDeMudanca clienteId={clienteId} planoId={planoId} versaoId={versaoId} />
            </details>
          ) : (
            <>
              <BotaoDesabilitado acao={mudanca} descricao="motivos-pedir_mudanca" />
              <Motivos id="motivos-pedir_mudanca" acao={mudanca} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
