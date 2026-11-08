import Link from 'next/link';
import { connectionReadiness } from '@/modules/organizations/domain/organization';

type Props = {
  readonly connections: number;
  readonly linkedAccounts: number;
};

const COPY: Record<string, { title: string; body: string; action: string; href: string }> = {
  sem_conexao: {
    title: 'Nenhuma conta conectada ainda',
    body: 'A coleta começa depois que você autorizar uma plataforma. A autorização acontece no site dela e pode ser revogada quando quiser.',
    action: 'Conectar uma plataforma',
    href: '/comecar?passo=conectar',
  },
  sem_conta: {
    title: 'Autorização feita, nenhuma conta escolhida',
    body: 'A autorização alcançou contas, mas nenhuma foi marcada para entrar na plataforma. Sem isso, não há o que coletar.',
    action: 'Escolher contas',
    href: '/comecar/contas',
  },
};

export function Readiness({ connections, linkedAccounts }: Props) {
  const gaps = connectionReadiness({ connections, linkedAccounts });
  const gap = gaps[0];
  if (!gap) return null;

  const copy = COPY[gap]!;

  return (
    <div className="alert alert--info">
      <div>
        <div className="strong">{copy.title}</div>
        <div>{copy.body}</div>
        <Link className="btn" href={copy.href} style={{ marginTop: 8 }}>
          {copy.action}
        </Link>
      </div>
    </div>
  );
}
