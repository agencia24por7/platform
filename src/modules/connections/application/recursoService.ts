import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { ClienteAvaliado, Recusa } from '@/modules/connections/domain/recurso';
import { recusaParaDesvincular, recusaParaMover, recusaParaVincular } from '@/modules/connections/domain/recurso';
import type {
  DiscoveredAccountRepository,
  StoredDiscovery,
} from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type DonoDoRecurso = {
  findById(organizationId: string, id: string): Promise<(ClienteAvaliado & { readonly name: string }) | null>;
};

type Pedido = {
  readonly organizationId: string;
  readonly papelDeQuemAge: MemberRole;
  readonly recursoId: string;
};

export type RecursoService = {
  listarPorCliente(organizationId: string, clientId: string): Promise<readonly StoredDiscovery[]>;
  vincular(input: Pedido & { readonly clientId: string }, ator: Ator): Promise<Result<StoredDiscovery, Failure>>;
  mover(input: Pedido & { readonly clientId: string }, ator: Ator): Promise<Result<StoredDiscovery, Failure>>;
  desvincular(input: Pedido, ator: Ator): Promise<Result<StoredDiscovery, Failure>>;
};

const recusar = (recusa: Recusa) => err(failure(recusa.codigo, recusa.mensagem));

export function createRecursoService(
  recursos: DiscoveredAccountRepository,
  clientes: DonoDoRecurso,
  audit: AuditRecorder,
): RecursoService {
  async function auditar(
    organizationId: string,
    ator: Ator,
    recurso: StoredDiscovery,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await audit.record({
      organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action,
      targetType: 'connection_account',
      targetId: recurso.id,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata: { platform: recurso.platform, externalId: recurso.externalId, connectionId: recurso.connectionId, ...metadata },
    });
  }

  return {
    listarPorCliente: (organizationId, clientId) => recursos.listByClient(organizationId, clientId),

    async vincular(input, ator) {
      const [recurso, cliente] = await Promise.all([
        recursos.findById(input.organizationId, input.recursoId),
        clientes.findById(input.organizationId, input.clientId),
      ]);
      const recusa = recusaParaVincular(input.papelDeQuemAge, recurso, cliente);
      if (recusa) return recusar(recusa);

      await recursos.markLinkedToClient(input.organizationId, recurso!.id, cliente!.id);
      const vinculado = { ...recurso!, state: 'linked' as const, clientId: cliente!.id };
      await auditar(input.organizationId, ator, vinculado, 'connection_account.link', { clientId: cliente!.id, cliente: cliente!.name });
      return ok(vinculado);
    },

    async mover(input, ator) {
      const [recurso, destino] = await Promise.all([
        recursos.findById(input.organizationId, input.recursoId),
        clientes.findById(input.organizationId, input.clientId),
      ]);
      const recusa = recusaParaMover(input.papelDeQuemAge, recurso, destino);
      if (recusa) return recusar(recusa);
      if (recurso!.clientId === destino!.id) return ok(recurso!);

      const origem = await clientes.findById(input.organizationId, recurso!.clientId!);
      const movido = await recursos.reassignClient(input.organizationId, recurso!.id, destino!.id);
      if (!movido) return err(failure('conflict', 'O recurso mudou enquanto você movia. Recarregue a página.'));

      await auditar(input.organizationId, ator, movido, 'connection_account.reassigned', {
        de: origem?.name ?? recurso!.clientId,
        para: destino!.name,
        historicoSegue: true,
      });
      return ok(movido);
    },

    async desvincular(input, ator) {
      const recurso = await recursos.findById(input.organizationId, input.recursoId);
      const recusa = recusaParaDesvincular(input.papelDeQuemAge, recurso);
      if (recusa) return recusar(recusa);

      const origem = await clientes.findById(input.organizationId, recurso!.clientId!);
      const solto = await recursos.unlinkFromClient(input.organizationId, recurso!.id);
      if (!solto) return err(failure('conflict', 'O recurso mudou enquanto você desvinculava. Recarregue a página.'));

      await auditar(input.organizationId, ator, solto, 'connection_account.unlink', { de: origem?.name ?? recurso!.clientId });
      return ok(solto);
    },
  };
}
