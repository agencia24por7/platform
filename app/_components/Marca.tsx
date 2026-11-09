import {
  MARCA_DA_PLATAFORMA,
  ROTULO_DA_PLATAFORMA,
  type Platform,
} from '@/modules/connections/domain/connection';

type Props = { readonly platform: Platform; readonly tamanho?: number };

export function Marca({ platform, tamanho = 40 }: Props) {
  const arquivo = MARCA_DA_PLATAFORMA[platform];
  const nome = ROTULO_DA_PLATAFORMA[platform];

  if (arquivo) {
    return <img src={arquivo} alt="" width={tamanho} height={tamanho} decoding="async" />;
  }

  return (
    <span className="marca-inicial" style={{ width: tamanho, height: tamanho }} aria-hidden="true">
      {nome.charAt(0)}
    </span>
  );
}
