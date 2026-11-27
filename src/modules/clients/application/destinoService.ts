import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import { TAMANHO_MAXIMO_DO_ROTULO, type LandingPage } from '@/modules/clients/domain/destino/tipos';
import { validarUrlDeDestino } from '@/modules/clients/domain/destino/urlDeDestino';
import { normalizarWhatsapp } from '@/modules/clients/domain/destino/whatsapp';
import type { DestinoRepository } from '@/modules/clients/infrastructure/destinoRepository';
import { canOperate, type MemberRole } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type EscopoDoDestino = {
  readonly organizationId: string;
  readonly clientId: string;
};

export type ComandoDeDestino = EscopoDoDestino & { readonly papelDeQuemAge: MemberRole };

export type DestinoService = {
  criarLandingPage(comando: ComandoDeDestino & { readonly url: unknown; readonly rotulo: unknown }, ator: Ator): Promise<Result<LandingPage, Failure>>;
  listarLandingPages(escopo: EscopoDoDestino, opcoes?: { readonly incluirArquivadas?: boolean }): Promise<Result<readonly LandingPage[], Failure>>;
  arquivarLandingPage(comando: ComandoDeDestino & { readonly landingPageId: unknown }, ator: Ator): Promise<Result<LandingPage, Failure>>;
  lerWhatsapp(escopo: EscopoDoDestino): Promise<Result<string | null, Failure>>;
  gravarWhatsapp(comando: ComandoDeDestino & { readonly whatsapp: unknown }, ator: Ator): Promise<Result<string, Failure>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const semPermissao = (): Failure => failure('forbidden', 'Seu papel não permite alterar o destino deste cliente.');
const clienteAusente = (): Failure => failure('not_found', 'Cliente não encontrado.');

function validarEscopo(escopo: EscopoDoDestino): Failure | null {
  if (typeof escopo.organizationId !== 'string' || !UUID.test(escopo.organizationId)) return failure('validation', 'Organização inválida.');
  if (typeof escopo.clientId !== 'string' || !UUID.test(escopo.clientId)) return failure('validation', 'Cliente inválido.');
  return null;
}

function validarRotulo(entrada: unknown): Result<string, Failure> {
  if (typeof entrada !== 'string') return err(failure('validation', 'Informe o rótulo da página.'));
  const rotulo = entrada.trim().replace(/\s+/g, ' ');
  if (rotulo.length === 0) return err(failure('validation', 'Informe o rótulo da página.'));
  if (rotulo.length > TAMANHO_MAXIMO_DO_ROTULO) return err(failure('validation', `Rótulo maior que ${TAMANHO_MAXIMO_DO_ROTULO} caracteres.`));
  return ok(rotulo);
}

export function createDestinoService(repository: DestinoRepository, audit: AuditRecorder): DestinoService {
  const auditar = (escopo: EscopoDoDestino, ator: Ator, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) =>
    registrarSemFalhar(audit, {
      organizationId: escopo.organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action,
      targetType,
      targetId,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata: { clientId: escopo.clientId, ...metadata },
    } satisfies AuditEvent);

  function barrar(comando: ComandoDeDestino): Failure | null {
    const invalido = validarEscopo(comando);
    if (invalido) return invalido;
    return canOperate(comando.papelDeQuemAge) ? null : semPermissao();
  }

  return {
    async criarLandingPage(comando, ator) {
      const barreira = barrar(comando);
      if (barreira) return err(barreira);
      const url = validarUrlDeDestino(comando.url);
      if (!url.ok) return url;
      const rotulo = validarRotulo(comando.rotulo);
      if (!rotulo.ok) return rotulo;

      const inserida = await repository.inserirLandingPage(comando, { url: url.value, rotulo: rotulo.value });
      if (!inserida.ok) {
        return err(inserida.motivo === 'url_duplicada' ? failure('conflict', 'Já existe uma página ativa com essa URL neste cliente.') : clienteAusente());
      }
      await auditar(comando, ator, 'client.landing_page.create', 'client_landing_page', inserida.valor.id, {});
      return ok(inserida.valor);
    },

    async listarLandingPages(escopo, opcoes) {
      const invalido = validarEscopo(escopo);
      if (invalido) return err(invalido);
      return ok(await repository.listarLandingPages(escopo, opcoes?.incluirArquivadas === true));
    },

    async arquivarLandingPage(comando, ator) {
      const barreira = barrar(comando);
      if (barreira) return err(barreira);
      if (typeof comando.landingPageId !== 'string' || !UUID.test(comando.landingPageId)) return err(failure('validation', 'Página inválida.'));

      const arquivada = await repository.arquivarLandingPage(comando, comando.landingPageId);
      if (!arquivada) return err(failure('not_found', 'Página não encontrada ou já arquivada.'));
      await auditar(comando, ator, 'client.landing_page.archive', 'client_landing_page', arquivada.id, {});
      return ok(arquivada);
    },

    async lerWhatsapp(escopo) {
      const invalido = validarEscopo(escopo);
      if (invalido) return err(invalido);
      const lido = await repository.lerWhatsapp(escopo);
      return lido.existe ? ok(lido.whatsapp) : err(clienteAusente());
    },

    async gravarWhatsapp(comando, ator) {
      const barreira = barrar(comando);
      if (barreira) return err(barreira);
      const whatsapp = normalizarWhatsapp(comando.whatsapp);
      if (!whatsapp.ok) return whatsapp;

      const gravado = await repository.gravarWhatsapp(comando, whatsapp.value);
      if (!gravado) return err(clienteAusente());
      await auditar(comando, ator, 'client.whatsapp.set', 'client', comando.clientId, {});
      return ok(whatsapp.value);
    },
  };
}
