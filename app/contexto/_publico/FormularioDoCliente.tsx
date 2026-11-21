'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CampoAutosalvo, type EstadoDoSalvar, type ResultadoDoSalvar } from '@/../app/_components/contexto/CampoAutosalvo';
import { EnvioDeArquivo, type ArquivoEnviado } from '@/../app/_components/contexto/EnvioDeArquivo';
import { ListaEditavel, type ItemDaLista } from '@/../app/_components/contexto/ListaEditavel';
import { concluirPeloLinkAcao, recarregarPeloLinkAcao, salvarPeloLinkAcao } from '@/../app/contexto/_publico/acoes';
import type { CredencialPublica, FormularioPublico } from '@/modules/clients/application/contextoService';
import type { Campo, CampoSimples } from '@/modules/clients/domain/contexto/catalogo';
import { valorPreenchido } from '@/modules/clients/domain/contexto/valores';
import { minutosEstimados } from '@/modules/clients/domain/painel/mensagem';

type Props = {
  readonly credencial: CredencialPublica;
  readonly formulario: FormularioPublico;
  readonly voltarPara: string | null;
};

type ItemPublico = ItemDaLista;

function itensIniciais(formulario: FormularioPublico): Record<string, ItemPublico[]> {
  return Object.fromEntries(
    Object.entries(formulario.listas).map(([chave, itens]) => [
      chave,
      itens.map((i) => ({ id: i.id, dados: i.dados, versao: i.versao, editavel: i.editavelPeloCliente, removivel: i.removivelPeloCliente })),
    ]),
  );
}

function dataLonga(data: Date): string {
  return new Date(data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function FormularioDoCliente({ credencial, formulario, voltarPara }: Props) {
  const secoes = formulario.secoes;
  const chaveDoPasso = `orla-contexto-passo-${credencial.token.slice(0, 8)}`;
  const [passo, setPasso] = useState(0);
  const [versoes, setVersoes] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.entries(formulario.campos).map(([k, v]) => [k, v.versao])),
  );
  const [preenchidos, setPreenchidos] = useState<Set<string>>(
    () => new Set(Object.entries(formulario.campos).filter(([, v]) => valorPreenchido(v.valor)).map(([k]) => k)),
  );
  const [listas, setListas] = useState<Record<string, ItemPublico[]>>(() => itensIniciais(formulario));
  const [arquivos, setArquivos] = useState(formulario.arquivos);
  const [estados, setEstados] = useState<Record<string, EstadoDoSalvar>>({});
  const [concluido, setConcluido] = useState<Date | null>(formulario.concluidoEm);
  const [enviando, setEnviando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const total = secoes.length + 2;

  useEffect(() => {
    try {
      const salvo = Number(sessionStorage.getItem(chaveDoPasso));
      if (Number.isInteger(salvo) && salvo > 0 && salvo < total) setPasso(salvo);
    } catch {
      return;
    }
  }, [chaveDoPasso, total]);

  useEffect(() => {
    try {
      sessionStorage.setItem(chaveDoPasso, String(passo));
    } catch {
      return;
    }
    titulo.current?.focus();
  }, [passo, chaveDoPasso]);

  const aoEstado = useCallback((chave: string, estado: EstadoDoSalvar) => {
    setEstados((a) => (a[chave] === estado ? a : { ...a, [chave]: estado }));
  }, []);

  const progressoPorSecao = useMemo(
    () =>
      secoes.map((s) => {
        const campos = s.campos.filter((c) => c.contaNaCompletude);
        const feitos = campos.filter((c) =>
          c.tipo === 'lista' ? (listas[c.key]?.length ?? 0) > 0 : c.tipo === 'arquivo' ? arquivos.some((a) => a.fieldKey === c.key) : preenchidos.has(c.key),
        ).length;
        return { secao: s.key, feitos, total: campos.length, pct: campos.length ? Math.round((feitos / campos.length) * 100) : 100 };
      }),
    [secoes, listas, arquivos, preenchidos],
  );
  const geral = Math.round(progressoPorSecao.reduce((s, p) => s + p.pct, 0) / Math.max(progressoPorSecao.length, 1));
  const salvando = Object.values(estados).some((e) => e === 'salvando' || e === 'pendente');
  const comErro = Object.values(estados).some((e) => e === 'erro' || e === 'conflito');

  async function salvarCampo(campo: CampoSimples, valor: unknown, versaoEsperada: number): Promise<ResultadoDoSalvar> {
    const r = await salvarPeloLinkAcao(credencial, { tipo: 'campo', fieldKey: campo.key, valor, versaoEsperada });
    if (!r.ok) return { ok: false, erro: r.erro, conflito: r.codigo === 'conflict', versaoAtual: r.versaoAtual };
    setVersoes((v) => ({ ...v, [campo.key]: r.valor.versao }));
    setPreenchidos((p) => {
      const n = new Set(p);
      if (valorPreenchido(valor)) n.add(campo.key);
      else n.delete(campo.key);
      return n;
    });
    return { ok: true, versao: r.valor.versao };
  }

  async function recarregarCampo(chave: string) {
    const r = await recarregarPeloLinkAcao(credencial);
    if (!r.ok) return null;
    const c = r.valor.campos[chave];
    return { valor: c?.valor ?? null, versao: c?.versao ?? 0 };
  }

  function arquivosDe(campo: CampoSimples & { tipo: 'arquivo' }, listKey: string | null, itemId: string | null) {
    return (
      <EnvioDeArquivo
        id={`pub-envio-${campo.key}-${itemId ?? 'campo'}`}
        endpoint={`/api/contexto/publico/${encodeURIComponent(credencial.token)}/arquivos`}
        cabecalhos={{ 'x-credencial': credencial.tipo }}
        fieldKey={campo.key}
        listKey={listKey}
        itemId={itemId}
        categorias={campo.categorias}
        maxArquivos={campo.maxArquivos}
        arquivos={arquivos.filter((a) => a.fieldKey === campo.key && a.itemId === itemId)}
        indisponivel={formulario.armazenamentoConfigurado ? null : 'O envio de arquivos ainda não está disponível. Se tiver links (Drive, Dropbox), cole-os nos campos de texto.'}
        aoEnviar={(a: ArquivoEnviado) => setArquivos((x) => [...x, { ...a, fieldKey: campo.key, itemId }])}
      />
    );
  }

  function renderizar(campo: Campo, secaoKey: string) {
    if (campo.tipo === 'lista') {
      return (
        <ListaEditavel
          key={campo.key}
          lista={campo}
          idBase={`pub-${secaoKey}`}
          itens={listas[campo.key] ?? []}
          adicionar={async (dados) => {
            const r = await salvarPeloLinkAcao(credencial, { tipo: 'item', listKey: campo.key, itemId: null, dados, versaoEsperada: 0 });
            if (!r.ok) return { ok: false, erro: r.erro, campos: r.campos };
            return { ok: true, valor: { id: r.valor.itemId ?? crypto.randomUUID(), dados, versao: r.valor.versao, editavel: true, removivel: true } };
          }}
          alterar={async (item, dados) => {
            const r = await salvarPeloLinkAcao(credencial, { tipo: 'item', listKey: campo.key, itemId: item.id, dados, versaoEsperada: item.versao });
            if (!r.ok) return { ok: false, erro: r.erro, campos: r.campos };
            return { ok: true, valor: { ...item, dados, versao: r.valor.versao } };
          }}
          remover={async (item) => {
            const r = await salvarPeloLinkAcao(credencial, { tipo: 'remover_item', itemId: item.id, versaoEsperada: item.versao });
            return r.ok ? { ok: true, valor: null } : { ok: false, erro: r.erro };
          }}
          aoMudarItens={(novos) => setListas((a) => ({ ...a, [campo.key]: [...novos] }))}
          arquivosDoItem={(item, sub) => (sub.tipo === 'arquivo' ? arquivosDe(sub, campo.key, item.id) : null)}
        />
      );
    }
    if (campo.tipo === 'arquivo') {
      return (
        <div key={campo.key} className="campo campo--arquivo">
          <div className="campo__cabeca">
            <span className="campo__rotulo">{campo.rotulo}</span>
          </div>
          {campo.ajuda ? <p className="field__hint">{campo.ajuda}</p> : null}
          {arquivosDe(campo, null, null)}
        </div>
      );
    }
    return (
      <CampoAutosalvo
        key={campo.key}
        campo={campo}
        idBase={`pub-${secaoKey}`}
        valorInicial={formulario.campos[campo.key]?.valor ?? null}
        versaoInicial={formulario.campos[campo.key]?.versao ?? 0}
        versao={versoes[campo.key] ?? 0}
        salvar={(v, versao) => salvarCampo(campo, v, versao)}
        recarregar={() => recarregarCampo(campo.key)}
        aoEstado={aoEstado}
      />
    );
  }

  async function concluir() {
    setEnviando(true);
    setErroGeral(null);
    const r = await concluirPeloLinkAcao(credencial);
    setEnviando(false);
    if (!r.ok) {
      setErroGeral(r.erro);
      return;
    }
    setConcluido(new Date(r.valor.concluidoEm));
    setPasso(total - 1);
  }

  const secaoAtual = passo >= 1 && passo <= secoes.length ? secoes[passo - 1]! : null;

  return (
    <div className="formulario-publico">
      <div className="formulario-publico__progresso">
        <div className="formulario-publico__progresso-texto">
          <span className="small strong">
            {passo === 0 ? 'Boas-vindas' : secaoAtual ? `Seção ${passo} de ${secoes.length}` : 'Revisar e enviar'}
          </span>
          <span className="xsmall subtle" role="status" aria-live="polite">
            {comErro ? 'Há algo para revisar' : salvando ? 'Salvando…' : 'Rascunho salvo automaticamente'}
          </span>
        </div>
        <progress className="formulario-publico__barra" max={total - 1} value={passo} aria-label="Progresso no formulário" />
      </div>

      {passo === 0 ? (
        <section className="boas-vindas" aria-labelledby="t-passo">
          <span className="eyebrow">Mapa de contexto · {formulario.cliente}</span>
          <h1 className="publico__titulo" id="t-passo" tabIndex={-1} ref={titulo}>
            Conte para a {formulario.organizacao} como o seu negócio funciona
          </h1>
          <p className="publico__texto">
            São {secoes.length} seções curtas, cerca de {minutosEstimados(secoes.length)} minutos no total. Tudo salva sozinho: dá para
            parar e voltar pelo mesmo link até {dataLonga(formulario.expiraEm)}.
          </p>
          {formulario.nota ? (
            <blockquote className="recado">
              <span className="recado__de">Recado da equipe</span>
              {formulario.nota}
            </blockquote>
          ) : null}
          <ul className="boas-vindas__beneficios">
            <li>Campanhas que falam como a sua marca, para quem compra de você.</li>
            <li>Menos reunião de alinhamento: a equipe começa sabendo o essencial.</li>
            <li>Responda o que souber. “Não sei” também é resposta.</li>
          </ul>
          <ol className="boas-vindas__secoes">
            {secoes.map((s, i) => (
              <li key={s.key}>
                <button type="button" className="linkish" onClick={() => setPasso(i + 1)}>
                  {s.letra} · {s.titulo}
                </button>
                <span className="xsmall subtle"> {progressoPorSecao[i]?.pct ?? 0}%</span>
              </li>
            ))}
          </ol>
          {concluido ? <p className="alert alert--ok">Você já enviou em {dataLonga(concluido)}. Ainda dá para ajustar o que quiser.</p> : null}
          <div className="formulario-publico__acoes">
            <button type="button" className="btn btn--primary btn--grande" onClick={() => setPasso(1)}>
              {geral > 0 ? 'Continuar de onde parei' : 'Começar'}
            </button>
          </div>
        </section>
      ) : secaoAtual ? (
        <section className="secao-publica" aria-labelledby="t-passo">
          <span className="eyebrow">{secaoAtual.letra} · {progressoPorSecao[passo - 1]?.pct ?? 0}% respondido</span>
          <h1 className="publico__titulo" id="t-passo" tabIndex={-1} ref={titulo}>{secaoAtual.titulo}</h1>
          <p className="publico__texto">{secaoAtual.descricao}</p>
          <div className="secao-publica__campos">
            {secaoAtual.campos.filter((c) => c.nivel === 'essencial').map((c) => renderizar(c, secaoAtual.key))}
          </div>
          {secaoAtual.campos.some((c) => c.nivel === 'aprofundar') ? (
            <details className="nivel nivel--aprofundar">
              <summary className="nivel__titulo">Se tiver mais tempo <span className="subtle xsmall">opcional</span></summary>
              <div className="secao-publica__campos">
                {secaoAtual.campos.filter((c) => c.nivel === 'aprofundar').map((c) => renderizar(c, secaoAtual.key))}
              </div>
            </details>
          ) : null}
          <div className="formulario-publico__acoes">
            <button type="button" className="btn btn--grande" onClick={() => setPasso(passo - 1)}>← Voltar</button>
            <button type="button" className="btn btn--primary btn--grande" onClick={() => setPasso(passo + 1)}>
              {passo === secoes.length ? 'Revisar e enviar' : 'Próxima seção'} →
            </button>
          </div>
        </section>
      ) : passo === secoes.length + 1 ? (
        <section className="secao-publica" aria-labelledby="t-passo">
          {concluido ? (
            <div className="concluido">
              <svg className="concluido__icone" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <circle cx="24" cy="24" r="21" />
                <path d="M15 24.5l6 6 12-13" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h1 className="publico__titulo" id="t-passo" tabIndex={-1} ref={titulo}>Obrigado! A equipe já recebeu.</h1>
              <p className="publico__texto">
                Enviado em {dataLonga(concluido)}. Se lembrar de algo, volte pelo mesmo link até {dataLonga(formulario.expiraEm)}: as
                mudanças chegam direto.
              </p>
              <div className="formulario-publico__acoes">
                <button type="button" className="btn btn--grande" onClick={() => setPasso(1)}>Revisar respostas</button>
                {voltarPara ? <a className="btn btn--primary btn--grande" href={voltarPara}>Voltar ao convite</a> : null}
              </div>
            </div>
          ) : (
            <>
              <span className="eyebrow">Último passo</span>
              <h1 className="publico__titulo" id="t-passo" tabIndex={-1} ref={titulo}>Revisar e enviar</h1>
              <p className="publico__texto">Pode enviar mesmo com seções em aberto: a equipe completa com você depois.</p>
              <ul className="revisao-publica">
                {secoes.map((s, i) => (
                  <li key={s.key}>
                    <button type="button" className="revisao-publica__linha" onClick={() => setPasso(i + 1)}>
                      <span>{s.letra} · {s.titulo}</span>
                      <span className={`pill ${(progressoPorSecao[i]?.pct ?? 0) >= 50 ? 'pill--ok' : ''}`}>{progressoPorSecao[i]?.pct ?? 0}%</span>
                    </button>
                  </li>
                ))}
              </ul>
              {erroGeral ? <p className="alert alert--error" role="alert">{erroGeral}</p> : null}
              {salvando ? <p className="subtle small" role="status">Esperando terminar de salvar…</p> : null}
              <div className="formulario-publico__acoes">
                <button type="button" className="btn btn--grande" onClick={() => setPasso(secoes.length)}>← Voltar</button>
                <button type="button" className="btn btn--primary btn--grande" disabled={enviando || salvando} aria-busy={enviando} onClick={() => void concluir()}>
                  {enviando ? 'Enviando…' : 'Enviar para a equipe'}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
