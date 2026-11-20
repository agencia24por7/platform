'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { mensagemDoErroDeAutorizacao } from '@/modules/connections/domain/erroDeAutorizacao';

const PLATAFORMA = /^[a-z0-9]{2,20}$/;

export function ErroDeAutorizacao() {
  const busca = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const dialogo = useRef<HTMLDialogElement>(null);

  const erro = busca.get('erroConexao');
  const plataforma = busca.get('plataforma');

  useEffect(() => {
    if (erro && dialogo.current && !dialogo.current.open) dialogo.current.showModal();
  }, [erro]);

  if (!erro) return null;

  const fechar = () => {
    const restante = new URLSearchParams(busca.toString());
    restante.delete('erroConexao');
    restante.delete('plataforma');
    const query = restante.toString();
    router.replace(query ? `${caminho}?${query}` : caminho, { scroll: false });
  };

  const tentarDeNovo =
    plataforma && PLATAFORMA.test(plataforma)
      ? `/api/oauth/${plataforma}/start?returnTo=${encodeURIComponent(caminho)}`
      : null;

  return (
    <dialog ref={dialogo} className="modal" aria-labelledby="erro-autorizacao-titulo" onClose={fechar}>
      <h2 id="erro-autorizacao-titulo" className="modal__titulo">
        A conexão não foi concluída
      </h2>
      <p className="modal__texto">{mensagemDoErroDeAutorizacao(erro)}</p>
      <div className="modal__acoes">
        <button className="btn" type="button" onClick={() => dialogo.current?.close()}>
          Fechar
        </button>
        {tentarDeNovo ? (
          <a className="btn btn--primary" href={tentarDeNovo}>
            Tentar de novo
          </a>
        ) : null}
      </div>
    </dialog>
  );
}
