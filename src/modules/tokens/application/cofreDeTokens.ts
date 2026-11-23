import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@/shared/result/result';
import type { Platform } from '@/modules/connections/domain/connection';
import {
  ANTECEDENCIA_DA_RENOVACAO_META_MS,
  PRAZO_DA_RENOVACAO_MS,
  aindaValido,
  formaDoAcesso,
  margemDoAcesso,
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
  Concessao,
  Espera,
  FabricaDeProvedores,
  MarcadorDeReautorizacao,
  NaturezaDaFalha,
  NovoSegredo,
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

export type Revogacao = ResultadoDaRevogacao | 'sem_token' | 'nao_tentada';

export type ResumoDaVarredura = {
  readonly avaliadas: number;
  readonly renovadas: number;
  readonly reautorizar: number;
  readonly falhas: number;
};

export type ResumoDaRecifragem = {
  readonly versaoPrimaria: string | null;
  readonly avaliadas: number;
  readonly recifradas: number;
  readonly falhas: number;
};

export type NovoSegredoEmClaro = {
  readonly tipo: TipoDeSegredo;
  readonly segredo: string;
  readonly expiraEm?: Date | null;
};

export type DestinoDoSegredo = {
  readonly connectionId: string;
  readonly platform: Platform;
};

export type OpcoesDaRemocao = {
  readonly revogarNoProvedor?: boolean;
  readonly apagar?: (versaoLida: number | null) => Promise<boolean>;
};

export type CofreDeTokens = {
  selar(destino: DestinoDoSegredo, novo: NovoSegredoEmClaro): Promise<Result<NovoSegredo, FalhaDoCofre>>;
  guardar(alvo: Alvo, novo: NovoSegredoEmClaro): Promise<Result<void, FalhaDoCofre>>;
  obterAcesso(alvo: Alvo): Promise<Result<Acesso, FalhaDoCofre>>;
  revogarEApagar(alvo: Alvo, opcoes?: OpcoesDaRemocao): Promise<{ readonly revogacao: Revogacao; readonly apagado: boolean }>;
  renovarProativamente(limite?: number): Promise<ResumoDaVarredura>;
  recifrarProativamente(limite?: number): Promise<ResumoDaRecifragem>;
  esquecer(connectionId: string): void;
};

export type DependenciasDoCofre = {
  readonly repositorio: RepositorioDeTokens;
  readonly cifra: CifraDeTokens;
  readonly provedores: FabricaDeProvedores;
  readonly marcador: MarcadorDeReautorizacao;
  readonly registro: Registro;
  readonly relogio?: Relogio;
  readonly esperar?: Espera;
  readonly intervaloDeEsperaMs?: number;
};

const TAMANHO_MAXIMO_DO_SEGREDO = 8192;
const SONDA_DA_CHAVE = '00000000-0000-4000-8000-000000000000';
const VALIDADE_PADRAO_DO_ACESSO_MS = 3_600_000;
const INTERVALO_DE_ESPERA_MS = 250;

class CifraInvalida extends Error {}

type Lembranca = { readonly acesso: Acesso; readonly ate: number };

type Desfecho<T> = { readonly tipo: 'feito'; readonly valor: T } | { readonly tipo: 'ocupado' };

const esperaPadrao: Espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export function createCofreDeTokens(deps: DependenciasDoCofre): CofreDeTokens {
  const relogio = deps.relogio ?? (() => new Date());
  const esperar = deps.esperar ?? esperaPadrao;
  const intervalo = deps.intervaloDeEsperaMs ?? INTERVALO_DE_ESPERA_MS;
  const tentativasDeEspera = Math.max(1, Math.ceil(PRAZO_DA_RENOVACAO_MS / intervalo));
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

  function lembrar(connectionId: string, acesso: Acesso, tipo: TipoDeSegredo): Acesso {
    const agora = relogio();
    const ate = validadeDoCache(acesso.expiraEm, agora, margemDoAcesso(tipo));
    if (ate > agora.getTime()) lembrancas.set(connectionId, { acesso, ate });
    return acesso;
  }

  async function marcarReautorizacao(alvo: Alvo, motivo: string, versaoLida: number): Promise<void> {
    lembrancas.delete(alvo.connectionId);
    try {
      await deps.marcador.marcar(alvo, motivo, versaoLida);
    } catch {
      deps.registro.erro('tokens.reautorizacao.nao_marcada', { connectionId: alvo.connectionId, motivo });
    }
  }

  async function acessoEmCache(registro: RegistroDeToken): Promise<Acesso | null> {
    if (!registro.acesso || !aindaValido(registro.acessoExpiraEm, relogio(), margemDoAcesso(registro.tipo))) return null;
    const token = await decifrar(registro.acesso, contexto(registro, 'acesso'));
    return { token, tipo: 'bearer', expiraEm: registro.acessoExpiraEm };
  }

  async function liberar(alvo: Alvo, concessao: Concessao, falha?: string | null): Promise<void> {
    try {
      await deps.repositorio.liberarRenovacao(alvo, concessao, falha);
    } catch {
      deps.registro.erro('tokens.renovacao.nao_liberada', { connectionId: alvo.connectionId });
    }
  }

  async function comConcessao<T>(
    alvo: Alvo,
    trabalho: (registro: RegistroDeToken, concessao: Concessao) => Promise<T>,
  ): Promise<Desfecho<T> | null> {
    const concessao = randomUUID();
    const { registro, dono } = await deps.repositorio.reivindicarRenovacao(alvo, PRAZO_DA_RENOVACAO_MS, concessao);
    if (!registro) return null;
    if (!dono) return { tipo: 'ocupado' };
    try {
      return { tipo: 'feito', valor: await trabalho(registro, concessao) };
    } catch (erro) {
      await liberar(alvo, concessao);
      throw erro;
    }
  }

  async function registrarFalha(
    alvo: Alvo,
    registro: RegistroDeToken,
    concessao: Concessao,
    natureza: NaturezaDaFalha,
    codigo: string,
  ): Promise<FalhaDoCofre> {
    await liberar(alvo, concessao, codigo);
    deps.registro.aviso('tokens.renovacao.falhou', { connectionId: alvo.connectionId, natureza, codigo });
    if (natureza === 'reautorizar') {
      await marcarReautorizacao(alvo, codigo, registro.versao);
      return 'reautorizar';
    }
    return natureza === 'configuracao' ? 'sem_provedor' : 'indisponivel';
  }

  async function renovarComoDono(alvo: Alvo, registro: RegistroDeToken, concessao: Concessao): Promise<Result<Acesso, FalhaDoCofre>> {
    const jaRenovado = await acessoEmCache(registro);
    if (jaRenovado) {
      await liberar(alvo, concessao);
      return ok(lembrar(alvo.connectionId, jaRenovado, registro.tipo));
    }

    const provedor = deps.provedores(registro.platform, registro.tipo);
    if (!provedor) {
      await liberar(alvo, concessao);
      return err('sem_provedor');
    }

    const segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
    const renovacao = await provedor.renovar(segredo);
    if (!renovacao.ok) return err(await registrarFalha(alvo, registro, concessao, renovacao.error.natureza, renovacao.error.codigo));

    const agora = relogio();
    const expiraEm = renovacao.value.expiraEm ?? new Date(agora.getTime() + VALIDADE_PADRAO_DO_ACESSO_MS);
    const acessoCifrado = await deps.cifra.cifrar(renovacao.value.accessToken, contexto(registro, 'acesso'));
    const novoSegredo = renovacao.value.novoSegredo
      ? {
          cifrado: await deps.cifra.cifrar(renovacao.value.novoSegredo, contexto(registro, 'segredo')),
          expiraEm: renovacao.value.segredoExpiraEm ?? registro.segredoExpiraEm,
        }
      : undefined;

    const gravou = await deps.repositorio.concluirRenovacao(alvo, registro.versao, concessao, {
      acesso: { cifrado: acessoCifrado, expiraEm },
      ...(novoSegredo ? { segredo: novoSegredo } : {}),
      falha: null,
      renovadoEm: agora,
    });
    if (!gravou) deps.registro.aviso('tokens.gravacao.concorrente', { connectionId: alvo.connectionId });

    deps.registro.info('tokens.acesso.renovado', { connectionId: alvo.connectionId, plataforma: registro.platform });
    return ok(lembrar(alvo.connectionId, { token: renovacao.value.accessToken, tipo: 'bearer', expiraEm }, registro.tipo));
  }

  async function renovarUnico(alvo: Alvo): Promise<Result<Acesso, FalhaDoCofre>> {
    for (let tentativa = 0; tentativa < tentativasDeEspera; tentativa++) {
      const desfecho = await comConcessao(alvo, (registro, concessao) => renovarComoDono(alvo, registro, concessao));
      if (!desfecho) return err('sem_token');
      if (desfecho.tipo === 'feito') return desfecho.valor;

      await esperar(intervalo);
      const atual = await deps.repositorio.carregar(alvo);
      if (!atual) return err('sem_token');
      const renovadoPorOutro = await acessoEmCache(atual);
      if (renovadoPorOutro) return ok(lembrar(alvo.connectionId, renovadoPorOutro, atual.tipo));
    }
    deps.registro.aviso('tokens.renovacao.espera_esgotada', { connectionId: alvo.connectionId });
    return err('indisponivel');
  }

  async function resolverAcesso(alvo: Alvo): Promise<Result<Acesso, FalhaDoCofre>> {
    try {
      const registro = await deps.repositorio.carregar(alvo);
      if (!registro) return err('sem_token');

      if (registro.tipo === 'api_key') {
        const chave = await decifrar(registro.segredo, contexto(registro, 'segredo'));
        return ok(lembrar(alvo.connectionId, { token: chave, tipo: formaDoAcesso('api_key', registro.platform), expiraEm: null }, registro.tipo));
      }

      if (registro.tipo === 'oauth_long_lived') {
        if (!aindaValido(registro.segredoExpiraEm, relogio(), 0)) {
          await marcarReautorizacao(alvo, 'segredo_expirado', registro.versao);
          return err('reautorizar');
        }
        const token = await decifrar(registro.segredo, contexto(registro, 'segredo'));
        return ok(lembrar(alvo.connectionId, { token, tipo: 'bearer', expiraEm: registro.segredoExpiraEm }, registro.tipo));
      }

      const emCache = await acessoEmCache(registro);
      if (emCache) return ok(lembrar(alvo.connectionId, emCache, registro.tipo));
      return await renovarUnico(alvo);
    } catch (erro) {
      if (erro instanceof CifraInvalida) return err('cifra_invalida');
      deps.registro.erro('tokens.acesso.falhou', { connectionId: alvo.connectionId });
      return err('indisponivel');
    }
  }

  async function renovarUmComoDono(
    alvo: Alvo,
    registro: RegistroDeToken,
    concessao: Concessao,
  ): Promise<'renovada' | 'reautorizar' | 'falhou' | 'ignorada'> {
    const agora = relogio();
    if (registro.tipo !== 'oauth_long_lived' || !precisaRenovarProativamente(registro.segredoExpiraEm, agora)) {
      await liberar(alvo, concessao);
      return 'ignorada';
    }
    if (!aindaValido(registro.segredoExpiraEm, agora, 0)) {
      await liberar(alvo, concessao);
      await marcarReautorizacao(alvo, 'segredo_expirado', registro.versao);
      return 'reautorizar';
    }

    const provedor = deps.provedores(registro.platform, registro.tipo);
    if (!provedor) {
      await liberar(alvo, concessao);
      return 'falhou';
    }

    const segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
    const renovacao = await provedor.renovar(segredo);
    if (!renovacao.ok) {
      const falha = await registrarFalha(alvo, registro, concessao, renovacao.error.natureza, renovacao.error.codigo);
      return falha === 'reautorizar' ? 'reautorizar' : 'falhou';
    }

    const novo = renovacao.value.novoSegredo ?? renovacao.value.accessToken;
    const cifrado = await deps.cifra.cifrar(novo, contexto(registro, 'segredo'));
    const gravou = await deps.repositorio.concluirRenovacao(alvo, registro.versao, concessao, {
      segredo: { cifrado, expiraEm: renovacao.value.segredoExpiraEm ?? renovacao.value.expiraEm },
      falha: null,
      renovadoEm: agora,
    });
    lembrancas.delete(alvo.connectionId);
    if (!gravou) {
      deps.registro.aviso('tokens.gravacao.concorrente', { connectionId: alvo.connectionId });
      return 'ignorada';
    }
    return 'renovada';
  }

  async function renovarUm(alvo: Alvo): Promise<'renovada' | 'reautorizar' | 'falhou' | 'ignorada'> {
    const desfecho = await comConcessao(alvo, (registro, concessao) => renovarUmComoDono(alvo, registro, concessao));
    if (!desfecho || desfecho.tipo === 'ocupado') return 'ignorada';
    return desfecho.valor;
  }

  async function recifrarUmComoDono(alvo: Alvo, registro: RegistroDeToken, concessao: Concessao): Promise<'recifrada' | 'ignorada'> {
    const segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
    const cifrado = await deps.cifra.cifrar(segredo, contexto(registro, 'segredo'));
    const gravou = await deps.repositorio.concluirRenovacao(alvo, registro.versao, concessao, {
      segredo: { cifrado, expiraEm: registro.segredoExpiraEm },
      acesso: null,
    });
    lembrancas.delete(alvo.connectionId);
    if (!gravou) {
      deps.registro.aviso('tokens.gravacao.concorrente', { connectionId: alvo.connectionId });
      return 'ignorada';
    }
    return 'recifrada';
  }

  async function recifrarUm(alvo: Alvo): Promise<'recifrada' | 'ignorada'> {
    const desfecho = await comConcessao(alvo, (registro, concessao) => recifrarUmComoDono(alvo, registro, concessao));
    if (!desfecho || desfecho.tipo === 'ocupado') return 'ignorada';
    return desfecho.valor;
  }

  async function versaoPrimariaDaChave(): Promise<string | null> {
    try {
      const sonda = await deps.cifra.cifrar('sonda', { connectionId: SONDA_DA_CHAVE, platform: 'meta', finalidade: 'segredo' });
      return sonda.versaoDaChave;
    } catch {
      deps.registro.erro('tokens.recifragem.sem_chave', {});
      return null;
    }
  }

  async function selar(destino: DestinoDoSegredo, novo: NovoSegredoEmClaro): Promise<Result<NovoSegredo, FalhaDoCofre>> {
    if (novo.segredo.length === 0 || novo.segredo.length > TAMANHO_MAXIMO_DO_SEGREDO) return err('segredo_invalido');
    try {
      const cifrado = await deps.cifra.cifrar(novo.segredo, { connectionId: destino.connectionId, platform: destino.platform, finalidade: 'segredo' });
      return ok({ tipo: novo.tipo, cifrado, expiraEm: novo.expiraEm ?? null });
    } catch {
      deps.registro.erro('tokens.cifra.falhou', { connectionId: destino.connectionId, finalidade: 'segredo' });
      return err('indisponivel');
    }
  }

  return {
    selar,

    async guardar(alvo, novo) {
      const platform = await deps.repositorio.plataformaDa(alvo);
      if (!platform) return err('conexao_inexistente');

      const selado = await selar({ connectionId: alvo.connectionId, platform }, novo);
      if (!selado.ok) return selado;
      await deps.repositorio.guardar(alvo, selado.value);
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

    async revogarEApagar(alvo, opcoes = {}) {
      lembrancas.delete(alvo.connectionId);
      const registro = await deps.repositorio.carregar(alvo).catch(() => null);
      const tentar = registro !== null && opcoes.revogarNoProvedor !== false;

      let provedor: ReturnType<FabricaDeProvedores> = null;
      let segredo: string | null = null;
      let revogacao: Revogacao = registro ? 'nao_tentada' : 'sem_token';
      if (tentar) {
        provedor = deps.provedores(registro.platform, registro.tipo);
        if (!provedor) revogacao = 'sem_suporte';
        else {
          try {
            segredo = await decifrar(registro.segredo, contexto(registro, 'segredo'));
          } catch {
            revogacao = 'falhou';
          }
        }
      }

      const apagar = opcoes.apagar ?? (() => deps.repositorio.apagar(alvo));
      const apagado = await apagar(registro?.versao ?? null);
      lembrancas.delete(alvo.connectionId);
      if (!apagado) return { revogacao: registro ? 'nao_tentada' : 'sem_token', apagado };

      if (provedor && segredo !== null) {
        try {
          const resultado = await provedor.revogar(segredo);
          revogacao = resultado.ok ? resultado.value : 'falhou';
        } catch {
          revogacao = 'falhou';
        }
      }
      if (revogacao === 'falhou') deps.registro.aviso('tokens.revogacao.falhou', { connectionId: alvo.connectionId });
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

    async recifrarProativamente(limite = 50) {
      const versaoPrimaria = await versaoPrimariaDaChave();
      if (!versaoPrimaria) return { versaoPrimaria: null, avaliadas: 0, recifradas: 0, falhas: 1 };

      const alvos = await deps.repositorio.comChaveAntiga(versaoPrimaria, limite);
      const resumo = { versaoPrimaria, avaliadas: alvos.length, recifradas: 0, falhas: 0 };
      for (const alvo of alvos) {
        const desfecho = await recifrarUm(alvo).catch((erro: unknown) => {
          deps.registro.aviso('tokens.recifragem.falhou', {
            connectionId: alvo.connectionId,
            erro: erro instanceof Error ? erro.name : 'desconhecido',
          });
          return 'falhou' as const;
        });
        if (desfecho === 'recifrada') resumo.recifradas += 1;
        else if (desfecho === 'falhou') resumo.falhas += 1;
      }
      return resumo;
    },

    esquecer(connectionId) {
      lembrancas.delete(connectionId);
    },
  };
}
