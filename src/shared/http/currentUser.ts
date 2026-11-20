import { cookies } from 'next/headers';
import { modules } from '@/composition';
import { SESSION_COOKIE, readSession } from '@/modules/identity/domain/session';
import type { SignedInUser } from '@/modules/identity/application/identityService';
import { env } from '@/shared/config/env';

export async function currentUser(): Promise<SignedInUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = readSession(token, env().TRIA_SESSION_SECRET, Date.now());
  if (!session) return null;

  return modules().identity.resolve(session.userId, session.issuedAt);
}
