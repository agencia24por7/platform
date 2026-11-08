import { redirect } from 'next/navigation';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const organizations = await modules().organizations.list();
  redirect(organizations.length === 0 ? '/comecar' : '/clientes');
}
