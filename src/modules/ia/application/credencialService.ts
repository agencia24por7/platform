import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Ator } from '@/modules/audit/domain/actor';
import { canAdminister, type MemberRole } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import {
  MAXIMO_DE_CREDENCIAIS_VIVAS,
  formatoDeCredencial,
  gerarCredencial,
  hashDaCredencial,
  pedidoDeCredencial,
  rotuloDaCredencial,
  type CredencialDeAgente,
} from '../domain/credencial.ts';
import type { EscopoDoAgente, RegistroDeFerramentas } from '../domain/ferramenta.ts';

export type CredencialNova = {
  readonly organizationId: string;
  readonly nome: string;
  readonly tokenHash: string;
  readonly rotulo: string;
  readonly clienteIds: readonly string[] | null;
  readonly ferramentas: readonly string[];
  readonly validadeEmDias: number;
  readonly criadaPor: string;
};

export type EscopoResolvido = {
  readonly credencialId: string;
  readonly organizationId: string;
  readonly clienteIds: readonly string[] | null;
  readonly ferramentas: readonly string[];
};

export type CredencialRepository = {
  inserirSeCouber(nova: CredencialNova, tetoDeVivas: number): Promise<CredencialDeAgente | null>;
  listar(organizationId: string): Promise<readonly CredencialDeAgente[]>;
  clientesVivos(organizationId: string, clienteIds: readonly string[]): Promise<readonly string[]>;
  revogar(organizationId: string, credencialId: string): Promise<CredencialDeAgente | null>;
  resolver(tokenHash: string): Promise<EscopoResolvido | null>;
};

export type QuemAdministra = {
  readonly organizationId: string;
  readonly papelDeQuemAge: MemberRole;
};

export type CredencialCriada = { readonly credencial: CredencialDeAgente; readonly segredo: string };

export type CredencialService = {
  criar(quem: QuemAdministra, pedido: unknown, ator: Ator): Promise<Result<CredencialCriada, Failure>>;
  listar(quem: QuemAdministra): Promise<Result<readonly CredencialDeAgente[], Failure>>;
  revogar(quem: QuemAdministra, credencialId: string, ator: Ator): Promise<Result<CredencialDeAgente, Failure>>;
  autenticar(candidata: string, origem: Pick<EscopoDoAgente, 'requestId' | 'sourceIp'>): Promise<EscopoDoAgente | null>;
};

const SEM_PERMISSAO = failure('forbidden', 'Só quem administra a organização gerencia credenciais de agente.');
const NAO_ENCONTRADA = failure('not_found', 'Credencial não encontrada.');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createCredencialService(
  repositorio: CredencialRepository,
  registro: Pick<RegistroDeFerramentas, 'nomes'>,
  audit: AuditRecorder,
): CredencialService {
  return {
    async criar(quem, pedido, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      if (!ator.userId) return err(SEM_PERMISSAO);

      const lido = pedidoDeCredencial.safeParse(pedido);
      if (!lido.success) return err(failure('validation', 'Pedido de credencial inválido.'));
      const { nome, validadeEmDias } = lido.data;
      const ferramentas = [...new Set(lido.data.ferramentas)].sort();
      const clienteIds = lido.data.clienteIds ? [...new Set(lido.data.clienteIds)].sort() : null;

      const conhecidas = registro.nomes();
      if (ferramentas.some((ferramenta) => !conhecidas.includes(ferramenta))) {
        return err(failure('validation', 'Ferramenta desconhecida no pedido.'));
      }
      if (clienteIds) {
        const vivos = await repositorio.clientesVivos(quem.organizationId, clienteIds);
        if (vivos.length !== clienteIds.length) return err(failure('validation', 'Cliente fora desta organização no pedido.'));
      }
      const segredo = gerarCredencial();
      const credencial = await repositorio.inserirSeCouber(
        {
          organizationId: quem.organizationId,
          nome,
          tokenHash: hashDaCredencial(segredo),
          rotulo: rotuloDaCredencial(segredo),
          clienteIds,
          ferramentas,
          validadeEmDias,
          criadaPor: ator.userId,
        },
        MAXIMO_DE_CREDENCIAIS_VIVAS,
      );
      if (!credencial) {
        return err(failure('conflict', `A organização já tem ${MAXIMO_DE_CREDENCIAIS_VIVAS} credenciais ativas. Revogue uma antes de criar outra.`));
      }

      await audit.record({
        organizationId: quem.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'ia.credencial_criada',
        targetType: 'agent_credential',
        targetId: credencial.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          ferramentas,
          clientes: clienteIds ? clienteIds.length : 'todos',
          validadeEmDias,
        },
      });
      return ok({ credencial, segredo });
    },

    async listar(quem) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      return ok(await repositorio.listar(quem.organizationId));
    },

    async revogar(quem, credencialId, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      if (!UUID.test(credencialId)) return err(NAO_ENCONTRADA);
      const revogada = await repositorio.revogar(quem.organizationId, credencialId);
      if (!revogada) return err(NAO_ENCONTRADA);
      await audit.record({
        organizationId: quem.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'ia.credencial_revogada',
        targetType: 'agent_credential',
        targetId: revogada.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
      });
      return ok(revogada);
    },

    async autenticar(candidata, origem) {
      if (!formatoDeCredencial(candidata)) return null;
      const resolvido = await repositorio.resolver(hashDaCredencial(candidata));
      if (!resolvido) return null;
      const conhecidas = registro.nomes();
      return {
        credencialId: resolvido.credencialId,
        organizationId: resolvido.organizationId,
        clienteIds: resolvido.clienteIds,
        ferramentas: resolvido.ferramentas.filter((ferramenta) => conhecidas.includes(ferramenta)),
        requestId: origem.requestId,
        sourceIp: origem.sourceIp,
      };
    },
  };
}
