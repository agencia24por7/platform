'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { noVocabularioDe } from '@/modules/organizations/domain/vocabulario';
import type { OrganizationType } from '@/modules/organizations/domain/organization';
import { CopyButton } from '@/../app/_components/CopyButton';
import { criarPedidoAoCliente, type LinkGerado } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/acoes';
import {
  mensagemProntaDoLink,
  minutosEstimados,
  secoesDoPreset,
  type PresetDeSecoes,
} from '@/modules/clients/domain/painel/mensagem';

type SecaoResumida = { readonly key: string; readonly letra: string; readonly titulo: string; readonly descricao: string };
type ConvitePendente = { readonly id: string; readonly rotulo: string };
type PlataformaConvidavel = { readonly platform: string; readonly rotulo: string };

type Props = {
  readonly rotulo: string;
  readonly tipo: OrganizationType;
  readonly clienteId: string;
  readonly clienteNome: string;
  readonly organizacao: string;
  readonly secoes: readonly SecaoResumida[];
  readonly convites: readonly ConvitePendente[];
  readonly plataformas: readonly PlataformaConvidavel[];
  readonly abrirAoCarregar: boolean;
};

const PRAZOS = [7, 15, 30, 60, 90] as const;
const ROTULO_DO_PRESET: Record<PresetDeSecoes, { readonly titulo: string; readonly texto: string }> = {
  essencial: { titulo: 'Essencial', texto: 'Empresa, produtos, público, presença digital e objetivos' },
  completo: { titulo: 'Completo', texto: 'Todas as seções, de A a K' },
  personalizado: { titulo: 'Personalizado', texto: 'Você escolhe as seções' },
};

export function PedirAoCliente({ rotulo, tipo, clienteId, clienteNome, organizacao, secoes, convites, plataformas, abrirAoCarregar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const idBase = useId();
  const todas = secoes.map((s) => s.key);
  const [preset, setPreset] = useState<PresetDeSecoes>('essencial');
  const [escolhidas, setEscolhidas] = useState<string[]>(() => secoesDoPreset('essencial', todas, []));
  const [prazo, setPrazo] = useState(30);
  const [nota, setNota] = useState('');
  const [convite, setConvite] = useState('');
  const [plataformasEscolhidas, setPlataformasEscolhidas] = useState<string[]>([]);
  const [incluirMapa, setIncluirMapa] = useState(true);
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
        await criarPedidoAoCliente(clienteId, {
          plataformas: plataformasEscolhidas,
          incluirMapa,
          secoes: escolhidas,
          expiraEmDias: prazo,
          nota,
          conviteDeIntegracaoId: plataformasEscolhidas.length === 0 ? convite || null : null,
        }),
      );
    });
  }

  const titulosEscolhidos = secoes.filter((s) => escolhidas.includes(s.key)).map((s) => `${s.letra} · ${s.titulo}`);
  const mensagem =
    resultado?.ok && resultado.secoes.length > 0
      ? mensagemProntaDoLink({
          cliente: clienteNome,
          organizacao,
          link: resultado.url,
          expiraEm: new Date(resultado.expiraEm),
          secoes: secoes.filter((s) => resultado.secoes.includes(s.key)).map((s) => s.titulo),
          minutosEstimados: minutosEstimados(resultado.secoes.length),
          conviteDeIntegracao: resultado.conviteUrl,
          tipo,
        })
      : '';

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={abrir}>
        {rotulo}
      </button>
      <dialog ref={dialogo} className="painel-lateral" aria-labelledby={`${idBase}-t`} onClose={() => resultado?.ok && router.refresh()}>
        <div className="painel-lateral__topo">
          <h2 className="modal__titulo" id={`${idBase}-t`}>
            {resultado?.ok ? 'Link pronto' : rotulo}
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
            {resultado.conviteUrl && resultado.secoes.length > 0 ? (
              <p className="subtle small">
                Um link só: o cliente conecta as contas e depois preenche o contexto. O link direto do contexto também vale:{' '}
                <span className="mono">{resultado.url}</span>
              </p>
            ) : null}
            {mensagem ? (
              <div className="field">
                <span className="field__label">Mensagem pronta</span>
                <pre className="mensagem-pronta">{mensagem}</pre>
                <CopyButton texto={mensagem} rotulo="Copiar mensagem pronta" />
              </div>
            ) : null}
            <div className="modal__acoes">
              <button type="button" className="btn" onClick={fechar}>
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form className="painel-lateral__corpo" onSubmit={enviar}>
            {plataformas.length > 0 ? (
              <fieldset className="grupo">
                <legend className="field__label">Conectar contas</legend>
                <div className="secoes-escolha">
                  {plataformas.map((p) => (
                    <label key={p.platform} className="checkline secao-escolha">
                      <input
                        type="checkbox"
                        checked={plataformasEscolhidas.includes(p.platform)}
                        onChange={() =>
                          setPlataformasEscolhidas((atual) => (atual.includes(p.platform) ? atual.filter((x) => x !== p.platform) : [...atual, p.platform]))
                        }
                      />
                      <span>
                        <strong>{p.rotulo}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <label className="checkline">
              <input type="checkbox" checked={incluirMapa} onChange={(e) => setIncluirMapa(e.target.checked)} />
              <span>
                <strong>Contexto</strong>
                <span className="subtle xsmall"> Incluir o mapa de contexto no mesmo link</span>
              </span>
            </label>
            {incluirMapa ? (
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
            ) : null}

            <div className="grade-auto grade-auto--estreita">
              <label className="field">
                <span className="field__label">Vale por</span>
                <select className="select" value={prazo} onChange={(e) => setPrazo(Number(e.target.value))}>
                  {PRAZOS.map((d) => (
                    <option key={d} value={d}>{d} dias</option>
                  ))}
                </select>
              </label>
              {convites.length > 0 && plataformasEscolhidas.length === 0 && incluirMapa ? (
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
              <span className="field__label">{noVocabularioDe(tipo, 'Recado para o cliente (opcional)')}</span>
              <textarea className="input textarea" rows={3} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: comece pelos produtos, é o que mais nos ajuda agora." />
              <span className="field__hint">{nota.length}/500 · aparece no topo do formulário</span>
            </label>

            {resultado && !resultado.ok ? (
              <p className="alert alert--error" role="alert">{resultado.erro}</p>
            ) : null}

            {incluirMapa ? (
              <p className="subtle small">
                {noVocabularioDe(tipo, 'Quem recebe vê só')}: {titulosEscolhidos.length ? titulosEscolhidos.join(', ') : 'nenhuma seção'}. Notas internas e hipóteses da equipe nunca aparecem.
              </p>
            ) : null}

            <div className="modal__acoes">
              <button type="button" className="btn" onClick={fechar}>Cancelar</button>
              <button type="submit" className="btn btn--primary" disabled={pendente || (incluirMapa ? escolhidas.length === 0 : plataformasEscolhidas.length === 0)} aria-busy={pendente}>
                {pendente ? 'Gerando…' : 'Gerar link'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
