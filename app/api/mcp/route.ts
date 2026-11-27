import { modules } from '@/composition';
import { entradaPublica } from '@/shared/http/entradaPublica';

export const dynamic = 'force-dynamic';

export const POST = entradaPublica((request: Request) => modules().ia.mcp(request));
