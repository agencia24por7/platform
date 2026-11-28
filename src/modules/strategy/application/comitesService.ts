import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Ator } from '@/modules/audit/domain/actor';
import { canAdminister, type MemberRole } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import { COMITES, chamadasPorRodadaDoComite, comitePorChave, podeDesligarComite, type Comite } from '@/modules/strategy/domain/index';
import type { ConfiguracaoDoComite, RepositorioDosComites } from '@/modules/strategy/application/portas';

export type QuemConfiguraOsComites = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

export type ComiteConfigurado = {
  readonly comite: Comite;
  readonly ligado: boolean;
  readonly obrigatorio: boolean;
  readonly chamadasPorRodada: number;
  readonly atualizadoEm: Date | null;
};

export type ComitesService = {
  listar(quem: QuemConfiguraOsComites): Promise<Result<readonly ComiteConfigurado[], Failure>>;
  definirLigado(quem: QuemConfiguraOsComites, comite: string, ligado: boolean, ator: Ator): Promise<Result<void, Failure>>;
};

export type DependenciasDosComites = {
  readonly repositorio: RepositorioDosComites;
  readonly audit: AuditRecorder;
  readonly comites?: readonly Comite[];
};

const SEM_PERMISSAO = failure('forbidden', 'Só quem administra a organização liga ou desliga comitês.');
const COMITE_DESCONHECIDO = failure('validation', 'Comitê desconhecido.');
const OBRIGATORIO = failure('validation', 'O Comitê de risco e legal não pode ser desligado: a reprovação dele obriga ajuste no plano.');

export function configuracaoDosComites(comites: readonly Comite[], linhas: readonly ConfiguracaoDoComite[]): readonly ComiteConfigurado[] {
  return comites.map((comite) => {
    const linha = linhas.find((candidata) => candidata.comite === comite.chave);
    const obrigatorio = !podeDesligarComite(comite.chave, comites);
    return {
      comite,
      ligado: obrigatorio || (linha?.ligado ?? true),
      obrigatorio,
      chamadasPorRodada: chamadasPorRodadaDoComite(comite),
      atualizadoEm: linha?.atualizadoEm ?? null,
    };
  });
}

export function createComitesService(deps: DependenciasDosComites): ComitesService {
  const comites = deps.comites ?? COMITES;
  return {
    async listar(quem) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      return ok(configuracaoDosComites(comites, await deps.repositorio.listar(quem.organizationId)));
    },

    async definirLigado(quem, chave, ligado, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      if (comitePorChave(chave, comites) === undefined) return err(COMITE_DESCONHECIDO);
      if (!ligado && !podeDesligarComite(chave, comites)) return err(OBRIGATORIO);
      await deps.repositorio.definir(quem.organizationId, chave, ligado);
      await deps.audit.record({
        organizationId: quem.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: ligado ? 'strategy.comite.ligado' : 'strategy.comite.desligado',
        targetType: 'organization',
        targetId: quem.organizationId,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { comite: chave },
      });
      return ok(undefined);
    },
  };
}
