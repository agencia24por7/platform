'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import type { FormularioDeNovoPlano } from '@/modules/strategy/interface/formularioDeNovoPlano';

type Props = { readonly foco: FormularioDeNovoPlano['foco']; readonly idDoErro: string; readonly erro: string | undefined };

export function GrupoDoFoco({ foco, idDoErro, erro }: Props) {
  const [marca, definirMarca] = useState(foco.marca.marcada);
  return (
    <fieldset className="estrategia-form__grupo" aria-describedby={erro ? idDoErro : undefined}>
      <legend className="field__label">Foco do plano</legend>
      <label className="estrategia-form__opcao">
        <input type="checkbox" name="focoMarca" value="1" checked={marca} onChange={(evento) => definirMarca(evento.target.checked)} />
        {foco.marca.rotulo}
      </label>
      {foco.semProdutos ? (
        <p className="alert alert--warn" role="status">
          <Icone nome="atencao" />
          <span>
            {foco.semProdutos.texto} {foco.semProdutos.link ? <Link href={foco.semProdutos.link.href}>{foco.semProdutos.link.rotulo}</Link> : null}
          </span>
        </p>
      ) : (
        <div className="estrategia-form__opcoes" role="group" aria-label="Produtos do cliente">
          {foco.produtos.map((produto) => (
            <label key={produto.valor} className="estrategia-form__opcao">
              <input type="checkbox" name="produtos" value={produto.valor} defaultChecked={produto.marcada} disabled={marca} />
              {produto.rotulo}
            </label>
          ))}
        </div>
      )}
      {erro ? (
        <span className="field__erro" id={idDoErro} role="alert">
          <Icone nome="erro" tamanho={14} /> {erro}
        </span>
      ) : null}
    </fieldset>
  );
}
