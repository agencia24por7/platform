import { randomUUID } from 'node:crypto';
import { err, ok } from '@/shared/result/result';
import type { RegistroDeProducao, RepositorioDeProducao } from '@/modules/strategy/application/portasDaProducao';
import { MAXIMO_DE_RESERVAS_DA_PRODUCAO } from '@/modules/strategy/application/portasDaProducao';

export type ProducaoEmMemoria = RepositorioDeProducao & {
  readonly registros: Map<string, RegistroDeProducao>;
  vencerLease(id: string): void;
};

export function criarProducaoEmMemoria(relogio: { agora(): Date } = { agora: () => new Date() }): ProducaoEmMemoria {
  const registros = new Map<string, RegistroDeProducao>();
  const trocar = (registro: RegistroDeProducao, mudanca: Partial<RegistroDeProducao>) => {
    const novo = { ...registro, ...mudanca, atualizadoEm: relogio.agora() };
    registros.set(registro.id, novo);
    return novo;
  };
  const leaseVigente = (registro: RegistroDeProducao) => registro.leaseAte !== null && registro.leaseAte.getTime() > relogio.agora().getTime();

  return {
    registros,
    vencerLease(id) {
      const registro = registros.get(id);
      if (registro) registros.set(id, { ...registro, leaseAte: new Date(relogio.agora().getTime() - 1) });
    },
    async pedir(organizationId, novo) {
      const doPlano = [...registros.values()].filter((registro) => registro.planoId === novo.planoId);
      if (doPlano.some((registro) => registro.status === 'pendente')) return err({ codigo: 'execucao_ativa', mensagem: 'Já há geração pendente.' });
      const numero = doPlano.filter((registro) => registro.versaoId === novo.versaoId).length + 1;
      const agora = relogio.agora();
      const registro: RegistroDeProducao = {
        id: randomUUID(),
        organizationId,
        clientId: novo.clientId,
        planoId: novo.planoId,
        versaoId: novo.versaoId,
        numero,
        status: 'pendente',
        conteudo: null,
        progresso: {},
        erroCodigo: null,
        motivo: null,
        tentativas: 0,
        falhas: 0,
        leaseAte: null,
        agentRunId: novo.agentRunId,
        solicitadoPor: novo.solicitadoPor,
        criadoEm: agora,
        atualizadoEm: agora,
        concluidoEm: null,
        redigidoEm: null,
      };
      registros.set(registro.id, registro);
      return ok(registro);
    },
    async listarDoPlano(organizationId, planoId, limite) {
      return [...registros.values()]
        .filter((registro) => registro.organizationId === organizationId && registro.planoId === planoId)
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime() || b.numero - a.numero)
        .slice(0, limite);
    },
    async ler(organizationId, id) {
      const registro = registros.get(id);
      return registro && registro.organizationId === organizationId ? registro : null;
    },
    async descobrirPendentes(limite) {
      return [...registros.values()]
        .filter((registro) => registro.status === 'pendente' && !leaseVigente(registro))
        .slice(0, limite)
        .map((registro) => ({ organizationId: registro.organizationId, clientId: registro.clientId, id: registro.id }));
    },
    async reservar(organizationId, id, leaseMs) {
      const registro = registros.get(id);
      if (!registro || registro.organizationId !== organizationId || registro.status !== 'pendente' || leaseVigente(registro)) return null;
      const tentativas = registro.tentativas + 1;
      if (tentativas > MAXIMO_DE_RESERVAS_DA_PRODUCAO) {
        return trocar(registro, { tentativas, status: 'falhou', erroCodigo: 'interno', motivo: 'teto_de_reservas', leaseAte: null, progresso: {}, concluidoEm: relogio.agora() });
      }
      return trocar(registro, { tentativas, leaseAte: new Date(relogio.agora().getTime() + leaseMs) });
    },
    async atualizar(organizationId, id, ficha, mudanca) {
      const registro = registros.get(id);
      if (!registro || registro.organizationId !== organizationId || registro.status !== 'pendente' || registro.tentativas !== ficha || !leaseVigente(registro)) {
        return err({ codigo: 'execucao_perdida', mensagem: 'A geração não é mais deste worker.' });
      }
      const final = mudanca.status === 'pronto' || mudanca.status === 'falhou';
      return ok(
        trocar(registro, {
          ...(mudanca.status === undefined ? {} : { status: mudanca.status }),
          ...(mudanca.conteudo === undefined ? {} : { conteudo: mudanca.conteudo }),
          ...(mudanca.progresso === undefined ? {} : { progresso: mudanca.progresso }),
          ...(mudanca.erroCodigo === undefined ? {} : { erroCodigo: mudanca.erroCodigo }),
          ...(mudanca.motivo === undefined ? {} : { motivo: mudanca.motivo }),
          ...(mudanca.falhas === undefined ? {} : { falhas: mudanca.falhas }),
          ...(mudanca.leaseAte === undefined ? {} : { leaseAte: mudanca.leaseAte }),
          ...(final ? { concluidoEm: relogio.agora(), leaseAte: null, ...(mudanca.status === 'falhou' ? { progresso: {} } : {}) } : {}),
        }),
      );
    },
  };
}
