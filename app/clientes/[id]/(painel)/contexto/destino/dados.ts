import { cache } from 'react';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { modules } from '@/composition';
import { visaoDoDestino, type VisaoDoDestino } from '@/modules/clients/domain/painel/visaoDoDestino';

export const carregarDestino = cache(async (clienteId: string): Promise<VisaoDoDestino | null> => {
  const { ctx, cliente, podeEditar } = await carregarPainel(clienteId);
  const escopo = { organizationId: ctx.organization.id, clientId: cliente.id };
  const [paginas, whatsapp] = await Promise.all([modules().destino.listarLandingPages(escopo), modules().destino.lerWhatsapp(escopo)]);
  if (!paginas.ok || !whatsapp.ok) return null;
  return visaoDoDestino({ whatsapp: whatsapp.value, paginas: paginas.value, podeEditar });
});
