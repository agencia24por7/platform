'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { CopyButton } from '@/../app/_components/CopyButton';
import { criarLinkDeContexto, type LinkGerado } from '@/../app/clientes/[id]/(painel)/acessos/acoes';
import {
  mensagemProntaDoLink,
  minutosEstimados,
  secoesDoPreset,
  type PresetDeSecoes,
} from '@/modules/clients/domain/painel/mensagem';

type SecaoResumida = { readonly key: string; readonly letra: string; readonly titulo: string; readonly descricao: string };
type ConvitePendente = { readonly id: string; readonly rotulo: string };

type Props = {
  readonly clienteId: string;
  readonly clienteNome: string;
  readonly organizacao: string;
  readonly secoes: readonly SecaoResumida[];
  readonly convites: readonly ConvitePendente[];
  readonly abrirAoCarregar: boolean;
};

const PRAZOS = [7, 15, 30, 60, 90] as const;
const ROTULO_DO_PRESET: Record<PresetDeSecoes, { readonly titulo: string; readonly texto: string }> = {
  essencial: { titulo: 'Essencial', texto: 'Empresa, produtos, público, presença digital e objetivos' },
  completo: { titulo: 'Completo', texto: 'Todas as seções, de A a K' },
  personalizado: { titulo: 'Personalizado', texto: 'Você escolhe as seções' },
};

export function EnviarMapaDeContexto({ clienteId, clienteNome, organizacao, secoes, convites, abrirAoCarregar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const idBase = useId();
  const todas = secoes.map((s) => s.key);
  const [preset, setPreset] = useState<PresetDeSecoes>('essencial');
  const [escolhidas, setEscolhidas] = useState<string[]>(() => secoesDoPreset('essencial', todas, []));
  const [prazo, setPrazo] = useState(30);
  const [nota, setNota] = useState('');
  const [convite, setConvite] = useState('');
  const [resultado, setResultado] = useState<LinkGerado | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    if (abrirAoCarregar) dialogo.current?.showModal();
  }, [abrirAoCarregar]);

  function escolherPreset(novo: PresetDeSecoes) {
    setPreset(novo);
    if (novo !== 'personalizado') setEscolhidas(secoesDoPreset(novo, todas, []));
  }

  function alternar(chave: string) {
    setPreset('personalizado');
    setEscolhidas((atual) => (atual.includes(chave) ? atual.filter((c) => c !== chave) : todas.filter((c) => c === chave || atual.includes(c))));
  }

  function abrir() {
    setResultado(null);
    dialogo.current?.showModal();
  }

  function fechar() {
    dialogo.current?.close();
    if (resultado?.ok) router.refresh();
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    iniciar(async () => {
      setResultado(
        await criarLinkDeContexto(clienteId, {
          secoes: escolhidas,
          expiraEmDias: prazo,
          nota,
          conviteDeIntegracaoId: convite || null,
        }),
      );
    });
  }

  const titulosEscolhidos = secoes.filter((s) => escolhidas.includes(s.key)).map((s) => `${s.letra} · ${s.titulo}`);
  const mensagem =
    resultado?.ok
      ? mensagemProntaDoLink({
          cliente: clienteNome,
          organizacao,
          link: resultado.url,
          expiraEm: new Date(resultado.expiraEm),
          secoes: secoes.filter((s) => resultado.secoes.includes(s.key)).map((s) => s.titulo),
          minutosEstimados: minutosEstimados(resultado.secoes.length),
          conviteDeIntegracao: resultado.conviteUrl,
        })
      : '';

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={abrir}>
        Enviar mapa de contexto
      </button>
      <dialog ref={dialogo} className="painel-lateral" aria-labelledby={`${idBase}-t`} onClose={() => resultado?.ok && router.refresh()}>
        <div className="painel-lateral__topo">
          <h2 className="modal__titulo" id={`${idBase}-t`}>
            {resultado?.ok ? 'Link pronto' : 'Enviar mapa de contexto'}
          </h2>
          <button type="button" className="menu-botao painel-lateral__fechar" aria-label="Fechar" onClick={fechar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {resultado?.ok ? (
          <div className="painel-lateral__corpo">
            <p className="alert alert--warn" role="status">
              Este endereço aparece só agora. Copie e envie ao cliente; depois, só dá para revogar ou gerar outro.
            </p>
            <div className="link-unico">
              <code className="link-unico__url">{resultado.conviteUrl ?? resultado.url}</code>
              <CopyButton texto={resultado.conviteUrl ?? resultado.url} className="btn btn--primary" />
            </div>
            {resultado.conviteUrl ? (
              <p className="subtle small">
                Enviamos o convite de integração: ele abre os dois passos, conectar contas e preencher o mapa. O link direto do
                mapa também funciona: <span className="mono">{resultado.url}</span>
              </p>
            ) : null}
            <div className="field">
              <span className="field__label">Mensagem pronta</span>
              <pre className="mensagem-pronta">{mensagem}</pre>
              <CopyButton texto={mensagem} rotulo="Copiar mensagem pronta" />
            </div>
            <div className="modal__acoes">
              <button type="button" className="btn" onClick={fechar}>
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form className="painel-lateral__corpo" onSubmit={enviar}>
            <fieldset className="grupo">
              <legend className="field__label">O que o cliente vai preencher</legend>
              <div className="presets" role="radiogroup">
                {(['essencial', 'completo', 'personalizado'] as const).map((p) => (
                  <label key={p} className="preset">
                    <input type="radio" name="preset" value={p} checked={preset === p} onChange={() => escolherPreset(p)} />
                    <span className="preset__titulo">{ROTULO_DO_PRESET[p].titulo}</span>
                    <span className="preset__texto">{ROTULO_DO_PRESET[p].texto}</span>
                  </label>
                ))}
              </div>
              <details className="disclosure" open={preset === 'personalizado'}>
                <summary>{escolhidas.length} de {secoes.length} seções · ~{minutosEstimados(escolhidas.length)} min</summary>
                <div className="secoes-escolha">
                  {secoes.map((s) => (
                    <label key={s.key} className="checkline secao-escolha">
                      <input type="checkbox" checked={escolhidas.includes(s.key)} onChange={() => alternar(s.key)} />
                      <span>
                        <strong>{s.letra} · {s.titulo}</strong>
                        <span className="subtle xsmall"> {s.descricao}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            </fieldset>

            <div className="grade-auto grade-auto--estreita">
              <label className="field">
                <span className="field__label">Vale por</span>
                <select className="select" value={prazo} onChange={(e) => setPrazo(Number(e.target.value))}>
                  {PRAZOS.map((d) => (
                    <option key={d} value={d}>{d} dias</option>
                  ))}
                </select>
              </label>
              {convites.length > 0 ? (
                <label className="field">
                  <span className="field__label">Enviar junto com o convite de integração</span>
                  <select className="select" value={convite} onChange={(e) => setConvite(e.target.value)}>
                    <option value="">Não, só o mapa</option>
                    {convites.map((c) => (
                      <option key={c.id} value={c.id}>{c.rotulo}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <label className="field">
              <span className="field__label">Recado para o cliente (opcional)</span>
              <textarea className="input textarea" rows={3} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: comece pelos produtos, é o que mais nos ajuda agora." />
              <span className="field__hint">{nota.length}/500 · aparece no topo do formulário</span>
            </label>

            {resultado && !resultado.ok ? (
              <p className="alert alert--error" role="alert">{resultado.erro}</p>
            ) : null}

            <p className="subtle small">
              O cliente vê só: {titulosEscolhidos.length ? titulosEscolhidos.join(', ') : 'nenhuma seção'}. Notas internas e hipóteses da equipe nunca aparecem.
            </p>

            <div className="modal__acoes">
              <button type="button" className="btn" onClick={fechar}>Cancelar</button>
              <button type="submit" className="btn btn--primary" disabled={pendente || escolhidas.length === 0} aria-busy={pendente}>
                {pendente ? 'Gerando…' : 'Gerar link'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
