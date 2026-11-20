import { err, ok, type Result } from '@/shared/result/result';
import {
  ANTECEDENCIA_DA_RENOVACAO_META_MS,
  aindaValido,
  formaDoAcesso,
  precisaRenovarProativamente,
  validadeDoCache,
  type Acesso,
  type Alvo,
  type ContextoDeCifra,
  type Finalidade,
  type TipoDeSegredo,
} from '@/modules/tokens/domain/token';
import type {
  CifraDeTokens,
  FabricaDeProvedores,
  Gravar,
  MarcadorDeReautorizacao,
  RegistroDeToken,
  Registro,
  Relogio,
  RepositorioDeTokens,
  ResultadoDaRevogacao,
} from '@/modules/tokens/application/portas';

export type FalhaDoCofre =
  | 'sem_token'
  | 'conexao_inexistente'
  | 'segredo_invalido'
  | 'reautorizar'
  | 'indisponivel'
  | 'sem_provedor'
  | 'cifra_invalida';

export type Revogacao = ResultadoDaRevogacao | 'sem_token';

export type ResumoDaVarredura = {
  readonly avaliadas: number;
  readonly renovadas: number;
  readonly reautorizar: number;
  readonly falhas: number;
};

export type NovoSegredoEmClaro = {
  readonly tipo: TipoDeSegredo;
  readonly segredo: string;
  readonly expiraEm?: Date | null;
};

export type CofreDeTokens = {
  guardar(alvo: Alvo, novo: NovoSegredoEmClaro): Promise<Result<void, FalhaDoCofre>>;
  obterAcesso(alvo: Alvo): Promise<Result<Acesso, FalhaDoCofre>>;
  revogarEApagar(alvo: Alvo): Promise<{ readonly revogacao: Revogacao; readonly apagado: boolean }>;
  renovarProativamente(limite?: number): Promise<ResumoDaVarredura>;
  esquecer(connectionId: string): void;
};

export type DependenciasDoCofre = {
  readonly repositorio: RepositorioDeTokens;
  readonly cifra: CifraDeTokens;
  readonly provedores: FabricaDeProvedores;
  readonly marcador: MarcadorDeReautorizacao;
  readonly registro: Registro;
  readonly relogio?: Relogio;
};

const TAMANHO_MAXIMO_DO_SEGREDO = 8192;
const VALIDADE_PADRAO_DO_ACESSO_MS = 3_600_000;

class CifraInvalida extends Error {}

type Lembranca = { readonly acesso: Acesso; readonly ate: number };

export function createCofreDeTokens(deps: DependenciasDoCofre): CofreDeTokens {
  const relogio = deps.relogio ?? (() => new Date());
  const lembrancas = new Map<string, Lembranca>();
  const emVoo = new Map<string, Promise<Result<Acesso, FalhaDoCofre>>>();

  const contexto = (registro: Pick<RegistroDeToken, 'connectionId' | 'platform'>, finalidade: Finalidade): ContextoDeCifra => ({
    connectionId: registro.connectionId,
    platform: registro.platform,
    finalidade,
  });

  async function decifrar(bytes: Buffer, ctx: ContextoDeCifra): Promise<string> {
    try {
      return await deps.cifra.decifrar(bytes, ctx);
    } catch {
      deps.registro.erro('tokens.cifra.falhou', { connectionId: ctx.connectionId, finalidade: ctx.finalidade });
      throw new CifraInvalida();
    }
  }

  function lembrar(connectionId: string, acesso: Acesso): Acesso {
    const agora = relogio();
    const ate = validadeDoCache(acesso.expiraEm, agora);
    if (ate > agora.getTime()) lembrancas.set(connectionId, { acesso, ate });
    return acesso;
  }

  async function marcarReautorizacao(alvo: Alvo, motivo: string): Promise<void> {
    lembrancas.delete(alvo.connectionId);
    try {
      await deps.marcador.marcar(alvo, motivo);
    } catch {
      deps.registro.erro('tokens.reautorizacao.nao_marcada', { connectionId: alvo.connectionId, motivo });
    }
  }

  async function acessoEmCache(registro: RegistroDeToken): Promise<Acesso | null> {
    if (!registro.acesso || !aindaValido(registro.acessoExpiraEm, relogio())) return null;
    const token = await decifrar(registro.acesso, contexto(registro, 'acesso'));
    return { token, tipo: 'bearer', expiraEm: registro.acessoExpiraEm };
  }

  async function renovarSobTrava(alvo: Alvo): Promise<Result<Acesso, FalhaDoCofre>> {
    return deps.repositorio.comTrava(alvo, async (registro, gravar) => {
      if (!registro) return err('sem_token' as const);

      const jaRenovado = await acessoEmCache(registro);
      if (jaRenovado) return ok(lembrar(alvo.connectionId, jaRenovado));

      const provedor = deps.provedores(registro.platform, registro.tipo);
      if (!provedor) return err('sem_provedor' as const);

      const segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
      const renovacao = await provedor.renovar(segredo);
      if (!renovacao.ok) return registrarFalha(alvo, gravar, renovacao.error.natureza, renovacao.error.codigo);

      const agora = relogio();
      const expiraEm = renovacao.value.expiraEm ?? new Date(agora.getTime() + VALIDADE_PADRAO_DO_ACESSO_MS);
      const acessoCifrado = await deps.cifra.cifrar(renovacao.value.accessToken, contexto(registro, 'acesso'));
      const novoSegredo = renovacao.value.novoSegredo
        ? {
            cifrado: await deps.cifra.cifrar(renovacao.value.novoSegredo, contexto(registro, 'segredo')),
            expiraEm: renovacao.value.segredoExpiraEm ?? registro.segredoExpiraEm,
          }
        : undefined;

      const gravou = await gravar({
        acesso: { cifrado: acessoCifrado, expiraEm },
        ...(novoSegredo ? { segredo: novoSegredo } : {}),
        falha: null,
        renovadoEm: agora,
      });
      if (!gravou) deps.registro.aviso('tokens.gravacao.concorrente', { connectionId: alvo.connectionId });

      deps.registro.info('tokens.acesso.renovado', { connectionId: alvo.connectionId, plataforma: registro.platform });
      return ok(lembrar(alvo.connectionId, { token: renovacao.value.accessToken, tipo: 'bearer', expiraEm }));
    });
  }

  async function registrarFalha(
    alvo: Alvo,
    gravar: Gravar,
    natureza: 'reautorizar' | 'transitoria' | 'configuracao',
    codigo: string,
  ): Promise<Result<never, FalhaDoCofre>> {
    await gravar({ falha: codigo });
    deps.registro.aviso('tokens.renovacao.falhou', { connectionId: alvo.connectionId, natureza, codigo });
    if (natureza === 'reautorizar') {
      await marcarReautorizacao(alvo, codigo);
      return err('reautorizar');
    }
    return err(natureza === 'configuracao' ? 'sem_provedor' : 'indisponivel');
  }

  async function resolverAcesso(alvo: Alvo): Promise<Result<Acesso, FalhaDoCofre>> {
    try {
      const registro = await deps.repositorio.carregar(alvo);
      if (!registro) return err('sem_token');

      if (registro.tipo === 'api_key') {
        const chave = await decifrar(registro.segredo, contexto(registro, 'segredo'));
        return ok(lembrar(alvo.connectionId, { token: chave, tipo: formaDoAcesso('api_key', registro.platform), expiraEm: null }));
      }

      if (registro.tipo === 'oauth_long_lived') {
        if (!aindaValido(registro.segredoExpiraEm, relogio(), 0)) {
          await marcarReautorizacao(alvo, 'segredo_expirado');
          return err('reautorizar');
        }
        const token = await decifrar(registro.segredo, contexto(registro, 'segredo'));
        return ok(lembrar(alvo.connectionId, { token, tipo: 'bearer', expiraEm: registro.segredoExpiraEm }));
      }

      const emCache = await acessoEmCache(registro);
      if (emCache) return ok(lembrar(alvo.connectionId, emCache));
      return await renovarSobTrava(alvo);
    } catch (erro) {
      if (erro instanceof CifraInvalida) return err('cifra_invalida');
      deps.registro.erro('tokens.acesso.falhou', { connectionId: alvo.connectionId });
      return err('indisponivel');
    }
  }

  async function renovarUm(alvo: Alvo): Promise<'renovada' | 'reautorizar' | 'falhou' | 'ignorada'> {
    return deps.repositorio.comTrava(alvo, async (registro, gravar) => {
      const agora = relogio();
      if (!registro || registro.tipo !== 'oauth_long_lived') return 'ignorada';
      if (!precisaRenovarProativamente(registro.segredoExpiraEm, agora)) return 'ignorada';
      if (!aindaValido(registro.segredoExpiraEm, agora, 0)) {
        await marcarReautorizacao(alvo, 'segredo_expirado');
        return 'reautorizar';
      }

      const provedor = deps.provedores(registro.platform, registro.tipo);
      if (!provedor) return 'falhou';

      const segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
      const renovacao = await provedor.renovar(segredo);
      if (!renovacao.ok) {
        const falha = await registrarFalha(alvo, gravar, renovacao.error.natureza, renovacao.error.codigo);
        return !falha.ok && falha.error === 'reautorizar' ? 'reautorizar' : 'falhou';
      }

      const novo = renovacao.value.novoSegredo ?? renovacao.value.accessToken;
      const cifrado = await deps.cifra.cifrar(novo, contexto(registro, 'segredo'));
      await gravar({
        segredo: { cifrado, expiraEm: renovacao.value.segredoExpiraEm ?? renovacao.value.expiraEm },
        falha: null,
        renovadoEm: agora,
      });
      lembrancas.delete(alvo.connectionId);
      return 'renovada';
    });
  }

  return {
    async guardar(alvo, novo) {
      if (novo.segredo.length === 0 || novo.segredo.length > TAMANHO_MAXIMO_DO_SEGREDO) return err('segredo_invalido');
      const platform = await deps.repositorio.plataformaDa(alvo);
      if (!platform) return err('conexao_inexistente');

      const cifrado = await deps.cifra.cifrar(novo.segredo, { connectionId: alvo.connectionId, platform, finalidade: 'segredo' });
      await deps.repositorio.guardar(alvo, { tipo: novo.tipo, cifrado, expiraEm: novo.expiraEm ?? null });
      lembrancas.delete(alvo.connectionId);
      return ok(undefined);
    },

    obterAcesso(alvo) {
      const lembrado = lembrancas.get(alvo.connectionId);
      if (lembrado && lembrado.ate > relogio().getTime()) return Promise.resolve(ok(lembrado.acesso));
      if (lembrado) lembrancas.delete(alvo.connectionId);

      const pendente = emVoo.get(alvo.connectionId);
      if (pendente) return pendente;

      const promessa = resolverAcesso(alvo).finally(() => emVoo.delete(alvo.connectionId));
      emVoo.set(alvo.connectionId, promessa);
      return promessa;
    },

    async revogarEApagar(alvo) {
      lembrancas.delete(alvo.connectionId);
      let revogacao: Revogacao = 'sem_token';

      const registro = await deps.repositorio.carregar(alvo).catch(() => null);
      if (registro) {
        try {
          const provedor = deps.provedores(registro.platform, registro.tipo);
          if (!provedor) revogacao = 'sem_suporte';
          else {
            const segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
            const resultado = await provedor.revogar(segredo);
            revogacao = resultado.ok ? resultado.value : 'falhou';
          }
        } catch {
          revogacao = 'falhou';
        }
        if (revogacao === 'falhou') deps.registro.aviso('tokens.revogacao.falhou', { connectionId: alvo.connectionId });
      }

      const apagado = await deps.repositorio.apagar(alvo);
      lembrancas.delete(alvo.connectionId);
      return { revogacao, apagado };
    },

    async renovarProativamente(limite = 50) {
      const antes = new Date(relogio().getTime() + ANTECEDENCIA_DA_RENOVACAO_META_MS);
      const alvos = await deps.repositorio.aRenovar(antes, limite);
      const resumo = { avaliadas: alvos.length, renovadas: 0, reautorizar: 0, falhas: 0 };

      for (const alvo of alvos) {
        const desfecho = await renovarUm(alvo).catch(() => 'falhou' as const);
        if (desfecho === 'renovada') resumo.renovadas += 1;
        else if (desfecho === 'reautorizar') resumo.reautorizar += 1;
        else if (desfecho === 'falhou') resumo.falhas += 1;
      }
      return resumo;
    },

    esquecer(connectionId) {
      lembrancas.delete(connectionId);
    },
  };
}
