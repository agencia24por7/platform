import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { currentUser } from '@/shared/http/currentUser';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await currentUser();
  if (!session) redirect('/entrar');
  if (session.memberships.length > 0) redirect('/clientes');

  redirect((await modules().organizations.exists()) ? '/organizacoes/nova' : '/comecar');
}
