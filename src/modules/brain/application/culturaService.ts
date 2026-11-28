import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import { canOperate, type MemberRole } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import { SinalRecusadoPeloBanco, chaveDeIdempotencia, normalizarLote, normalizarSinal, semRepetidosNoLote, type SinalDeCultura } from '../domain/cultura.ts';
import type { CulturaRepository, EscopoDeCultura, ItemDoLote } from '../infrastructure/culturaRepository.ts';
import type { ClienteResolvido, IdentidadeDoWorker } from './portas.ts';

export type ComandoDeCultura = EscopoDeCultura & { readonly papelDeQuemAge: MemberRole };

export type ResultadoDoLote = {
  readonly criados: number;
  readonly repetidos: number;
  readonly itens: readonly ItemDoLote[];
};

export type CulturaService = {
  criar(comando: ComandoDeCultura & { readonly dados: unknown }, ator: Ator): Promise<Result<SinalDeCultura, Failure>>;
  listar(escopo: EscopoDeCultura): Promise<Result<readonly SinalDeCultura[], Failure>>;
  arquivar(comando: ComandoDeCultura & { readonly sinalId: unknown }, ator: Ator): Promise<Result<SinalDeCultura, Failure>>;
  ingerirDoColetor(clienteId: string | null, lote: unknown, worker: IdentidadeDoWorker): Promise<Result<ResultadoDoLote, Failure>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const semPermissao = (): Failure => failure('forbidden', 'Seu papel não permite alterar os sinais de cultura deste cliente.');
const clienteAusente = (): Failure => failure('not_found', 'Cliente não encontrado.');

function validarEscopo(escopo: EscopoDeCultura): Failure | null {
  if (typeof escopo.organizationId !== 'string' || !UUID.test(escopo.organizationId)) return failure('validation', 'Organização inválida.');
  if (typeof escopo.clientId !== 'string' || !UUID.test(escopo.clientId)) return failure('validation', 'Cliente inválido.');
  return null;
}

export type DependenciasDeCultura = {
  readonly resolverCliente: (clienteId: string) => Promise<ClienteResolvido | null>;
  readonly relogio?: () => Date;
};

export function createCulturaService(repositorio: CulturaRepository, audit: AuditRecorder, dependencias: DependenciasDeCultura): CulturaService {
  const relogio = dependencias.relogio ?? (() => new Date());
  const auditar = (evento: AuditEvent) => registrarSemFalhar(audit, { targetType: 'client_culture_signal', ...evento });

  function barrar(comando: ComandoDeCultura): Failure | null {
    const invalido = validarEscopo(comando);
    if (invalido) return invalido;
    return canOperate(comando.papelDeQuemAge) ? null : semPermissao();
  }

  return {
    async criar(comando, ator) {
      const barreira = barrar(comando);
      if (barreira) return err(barreira);
      const novo = normalizarSinal(comando.dados, relogio());
      if (!novo.ok) return novo;
      const inserido = await repositorio.inserir(comando, novo.value);
      if (!inserido.ok) {
        if (inserido.motivo === 'sinal_invalido') return err(failure('validation', 'Sinal inválido.'));
        return err(
          inserido.motivo === 'duplicado' ? failure('conflict', 'Já existe um sinal deste cliente com a mesma fonte e a mesma data de observação.') : clienteAusente(),
        );
      }
      await auditar({
        organizationId: comando.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'client.culture_signal.create',
        targetId: inserido.valor.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { clientId: comando.clientId, tipo: inserido.valor.tipo, nota: inserido.valor.nota },
      });
      return ok(inserido.valor);
    },

    async listar(escopo) {
      const invalido = validarEscopo(escopo);
      if (invalido) return err(invalido);
      return ok(await repositorio.listar(escopo));
    },

    async arquivar(comando, ator) {
      const barreira = barrar(comando);
      if (barreira) return err(barreira);
      if (typeof comando.sinalId !== 'string' || !UUID.test(comando.sinalId)) return err(failure('validation', 'Sinal inválido.'));
      const arquivado = await repositorio.arquivar(comando, comando.sinalId);
      if (!arquivado) return err(failure('not_found', 'Sinal não encontrado ou já arquivado.'));
      await auditar({
        organizationId: comando.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'client.culture_signal.archive',
        targetId: arquivado.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { clientId: comando.clientId },
      });
      return ok(arquivado);
    },

    async ingerirDoColetor(clienteId, lote, worker) {
      if (clienteId === null || !UUID.test(clienteId)) return err(clienteAusente());
      const cliente = await dependencias.resolverCliente(clienteId);
      if (!cliente) return err(clienteAusente());
      const escopo = { organizationId: cliente.organizationId, clientId: cliente.clienteId };
      const normalizado = normalizarLote(lote, relogio());
      if (!normalizado.ok) return normalizado;
      const unicos = semRepetidosNoLote(normalizado.value);
      let itens: readonly ItemDoLote[];
      try {
        itens = await repositorio.inserirLote(escopo, unicos);
      } catch (falha) {
        if (!(falha instanceof SinalRecusadoPeloBanco)) throw falha;
        const recusado = unicos[falha.indice];
        const indice = recusado === undefined ? falha.indice : normalizado.value.findIndex((sinal) => chaveDeIdempotencia(sinal) === chaveDeIdempotencia(recusado));
        return err(failure('validation', 'Lote inválido.', { [`sinais.${indice}`]: 'Sinal inválido.' }));
      }
      const resultado: ResultadoDoLote = {
        criados: itens.filter((item) => !item.repetido).length,
        repetidos: itens.filter((item) => item.repetido).length,
        itens,
      };
      await auditar({
        organizationId: escopo.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'brain.cultura.ingestao',
        targetId: escopo.clientId,
        targetType: 'client',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { enviados: normalizado.value.length, criados: resultado.criados, repetidos: resultado.repetidos },
      });
      return ok(resultado);
    },
  };
}
