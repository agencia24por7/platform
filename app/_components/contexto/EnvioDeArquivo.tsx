'use client';

import { useRef, useState, type DragEvent } from 'react';
import type { CategoriaDeArquivo } from '@/modules/clients/domain/contexto/catalogo';
import { tamanhoLegivel } from '@/modules/clients/domain/painel/formato';
import { ROTULO_DA_CATEGORIA, aceiteDasCategorias } from '@/../app/_components/contexto/valoresDaUi';

export const LIMITE_DO_ARQUIVO = 25 * 1024 * 1024;

export type ArquivoEnviado = {
  readonly id: string;
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoBytes: number;
};

type Envio = { readonly chave: string; readonly nome: string; progresso: number; erro: string | null };

type Props = {
  readonly id: string;
  readonly endpoint: string;
  readonly cabecalhos?: Readonly<Record<string, string>>;
  readonly fieldKey: string;
  readonly listKey?: string | null;
  readonly itemId?: string | null;
  readonly categorias: readonly CategoriaDeArquivo[];
  readonly maxArquivos: number;
  readonly arquivos: readonly ArquivoEnviado[];
  readonly aoEnviar: (arquivo: ArquivoEnviado) => void;
  readonly aoRemover?: (id: string) => Promise<void> | void;
  readonly desabilitado?: boolean;
  readonly indisponivel?: string | null;
};

function enviar(
  endpoint: string,
  arquivo: File,
  cabecalhos: Record<string, string>,
  progresso: (pct: number) => void,
): Promise<{ ok: true; arquivo: ArquivoEnviado } | { ok: false; erro: string }> {
  return new Promise((resolver) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    for (const [nome, valor] of Object.entries(cabecalhos)) xhr.setRequestHeader(nome, valor);
    xhr.setRequestHeader('Content-Type', arquivo.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const corpo = JSON.parse(xhr.responseText) as { ok: boolean; erro?: string; arquivo?: ArquivoEnviado };
        if (xhr.status < 300 && corpo.ok && corpo.arquivo) resolver({ ok: true, arquivo: corpo.arquivo });
        else resolver({ ok: false, erro: corpo.erro ?? 'Não foi possível enviar o arquivo.' });
      } catch {
        resolver({ ok: false, erro: xhr.status === 413 ? 'O arquivo passa do limite de 25 MB.' : 'Não foi possível enviar o arquivo.' });
      }
    };
    xhr.onerror = () => resolver({ ok: false, erro: 'A conexão caiu durante o envio. Tente de novo.' });
    xhr.send(arquivo);
  });
}

export function EnvioDeArquivo(props: Props) {
  const { id, endpoint, fieldKey, listKey, itemId, categorias, maxArquivos, arquivos, aoEnviar, aoRemover, desabilitado, indisponivel } = props;
  const entrada = useRef<HTMLInputElement>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const restantes = maxArquivos - arquivos.length;
  const bloqueado = Boolean(desabilitado || indisponivel) || restantes <= 0;

  async function receber(lista: FileList | null) {
    if (!lista || bloqueado) return;
    const escolhidos = [...lista].slice(0, restantes);
    for (const arquivo of escolhidos) {
      const chave = `${arquivo.name}-${arquivo.size}-${Math.random().toString(36).slice(2, 8)}`;
      if (arquivo.size > LIMITE_DO_ARQUIVO) {
        setEnvios((e) => [...e, { chave, nome: arquivo.name, progresso: 0, erro: `Passa de 25 MB (${tamanhoLegivel(arquivo.size)}).` }]);
        continue;
      }
      setEnvios((e) => [...e, { chave, nome: arquivo.name, progresso: 0, erro: null }]);
      const cabecalhos: Record<string, string> = {
        ...(props.cabecalhos ?? {}),
        'x-campo': encodeURIComponent(fieldKey),
        'x-nome': encodeURIComponent(arquivo.name),
      };
      if (listKey) cabecalhos['x-lista'] = encodeURIComponent(listKey);
      if (itemId) cabecalhos['x-item'] = encodeURIComponent(itemId);
      const resultado = await enviar(endpoint, arquivo, cabecalhos, (pct) =>
        setEnvios((e) => e.map((x) => (x.chave === chave ? { ...x, progresso: pct } : x))),
      );
      if (resultado.ok) {
        setEnvios((e) => e.filter((x) => x.chave !== chave));
        aoEnviar(resultado.arquivo);
      } else {
        setEnvios((e) => e.map((x) => (x.chave === chave ? { ...x, erro: resultado.erro } : x)));
      }
    }
    if (entrada.current) entrada.current.value = '';
  }

  function soltar(evento: DragEvent) {
    evento.preventDefault();
    setArrastando(false);
    void receber(evento.dataTransfer.files);
  }

  return (
    <div className="envio">
      {arquivos.length > 0 ? (
        <ul className="envio__lista">
          {arquivos.map((a) => (
            <li key={a.id} className="envio__arquivo">
              <span className="envio__icone" aria-hidden="true">{(a.nome.split('.').pop() ?? 'arq').slice(0, 4).toUpperCase()}</span>
              <span className="envio__nome">{a.nome}</span>
              <span className="subtle xsmall">{tamanhoLegivel(a.tamanhoBytes)}</span>
              {aoRemover && !desabilitado ? (
                <button type="button" className="btn btn--compacto btn--perigo" onClick={() => void aoRemover(a.id)} aria-label={`Remover ${a.nome}`}>
                  Remover
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {envios.length > 0 ? (
        <ul className="envio__lista" aria-live="polite">
          {envios.map((e) => (
            <li key={e.chave} className={`envio__arquivo${e.erro ? ' envio__arquivo--erro' : ''}`}>
              <span className="envio__nome">{e.nome}</span>
              {e.erro ? (
                <>
                  <span className="envio__erro" role="alert">{e.erro}</span>
                  <button type="button" className="btn btn--compacto" onClick={() => setEnvios((x) => x.filter((y) => y.chave !== e.chave))}>
                    Dispensar
                  </button>
                </>
              ) : (
                <progress className="envio__progresso" max={100} value={e.progresso} aria-label={`Enviando ${e.nome}`}>
                  {e.progresso}%
                </progress>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {indisponivel ? (
        <p className="subtle small">{indisponivel}</p>
      ) : restantes > 0 ? (
        <label
          htmlFor={id}
          className={`envio__zona${arrastando ? ' envio__zona--ativa' : ''}${bloqueado ? ' envio__zona--bloqueada' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={soltar}
        >
          <span className="strong small">Arraste ou escolha {restantes > 1 ? 'arquivos' : 'um arquivo'}</span>
          <span className="subtle xsmall">
            {categorias.map((c) => ROTULO_DA_CATEGORIA[c]).join(' · ')} · até 25 MB cada · faltam {restantes}
          </span>
          <input
            ref={entrada}
            id={id}
            className="visualmente-oculto"
            type="file"
            multiple={restantes > 1}
            accept={aceiteDasCategorias(categorias)}
            disabled={bloqueado}
            onChange={(e) => void receber(e.target.files)}
          />
        </label>
      ) : (
        <p className="subtle small">Limite de {maxArquivos} arquivo(s) atingido.</p>
      )}
    </div>
  );
}
