import { comoPublico } from '@/shared/db/client';

export function entradaPublica<A extends unknown[], R>(tratar: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => comoPublico(() => tratar(...args));
}
