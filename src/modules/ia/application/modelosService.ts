import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Ator } from '@/modules/audit/domain/actor';
import { canAdminister, type MemberRole } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import {
  MENSAGEM_DA_CHAVE,
  MENSAGEM_DO_BLOQUEIO,
  PADRAO_DO_MODELO,
  aadDaChave,
  estadoDaTarefa,
  fornecedorConhecido,
  modelosDeTexto,
  rotuloDaChaveDeFornecedor,
  tetosDeIa,
  validarChaveDeFornecedor,
  type ChaveGuardada,
  type ConfiguracaoDeIa,
  type EscolhaDeModelo,
  type EstadoDaTarefa,
  type MotivoDoBloqueio,
  type UsoDoDia,
} from '../domain/modelos.ts';
import type { ClasseDeCapacidade, Fornecedor } from '../domain/tarefa.ts';
import { SEM_MODELO_CONFIGURADO, type Desfecho, type LivroDeUso, type Reserva, type ResolvedorDeModelo } from './execucao.ts';

export type Selado = { readonly bytes: Buffer; readonly versaoDaChave: string; readonly algoritmo: string };

export type SeladorDeChave = {
  selar(texto: string, aad: Buffer): Promise<Selado>;
  abrir(bytes: Buffer, aad: Buffer): Promise<string>;
};

export type CatalogoDeModelos = {
  listar(fornecedor: Fornecedor, chave: string): Promise<Result<readonly string[], Failure>>;
};

export type ChaveSelada = { readonly bytes: Buffer; readonly versaoDaChave: string };

export type ModelosRepository = {
  chaves(organizationId: string): Promise<readonly ChaveGuardada[]>;
  selada(organizationId: string, fornecedor: Fornecedor): Promise<ChaveSelada | null>;
  guardarChave(nova: {
    readonly organizationId: string;
    readonly fornecedor: Fornecedor;
    readonly selado: Selado;
    readonly rotulo: string;
    readonly modelos: readonly string[];
    readonly userId: string | null;
  }): Promise<void>;
  atualizarModelos(organizationId: string, fornecedor: Fornecedor, modelos: readonly string[]): Promise<void>;
  removerChave(organizationId: string, fornecedor: Fornecedor): Promise<boolean>;
  regravarChave(organizationId: string, fornecedor: Fornecedor, selado: Selado, lida: ChaveSelada): Promise<boolean>;
  comVersaoAntiga(versaoPrimaria: string, limite: number): Promise<readonly { readonly organizationId: string; readonly fornecedor: Fornecedor }[]>;
  escolhas(organizationId: string): Promise<readonly EscolhaDeModelo[]>;
  escolher(organizationId: string, escolha: EscolhaDeModelo, userId: string | null): Promise<void>;
  configuracao(organizationId: string): Promise<ConfiguracaoDeIa>;
  salvarLigada(organizationId: string, ligada: boolean, userId: string | null): Promise<void>;
  salvarTetos(organizationId: string, tetos: Pick<ConfiguracaoDeIa, 'chamadasPorDia' | 'tokensPorDia'>, userId: string | null): Promise<void>;
  usoDeHoje(organizationId: string): Promise<UsoDoDia>;
  reservar(reserva: Reserva): Promise<{ readonly id: string } | { readonly bloqueio: MotivoDoBloqueio }>;
  concluir(organizationId: string, reservaId: string, desfecho: Desfecho): Promise<void>;
};

export type TarefaConfiguravel = { readonly chave: string; readonly titulo: string; readonly classe: ClasseDeCapacidade };

export type QuemConfigura = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

export type PainelDeIa = {
  readonly configuracao: ConfiguracaoDeIa;
  readonly usoDeHoje: UsoDoDia;
  readonly fornecedores: readonly { readonly fornecedor: Fornecedor; readonly chave: ChaveGuardada | null }[];
  readonly tarefas: readonly (TarefaConfiguravel & { readonly escolha: EscolhaDeModelo | null; readonly estado: EstadoDaTarefa })[];
};

export type ContagemDeRecifragem = { readonly avaliadas: number; readonly recifradas: number; readonly falhas: number };

export type ModelosService = {
  painel(quem: QuemConfigura): Promise<Result<PainelDeIa, Failure>>;
  guardarChave(quem: QuemConfigura, fornecedor: string, chaveBruta: string, ator: Ator): Promise<Result<ChaveGuardada, Failure>>;
  removerChave(quem: QuemConfigura, fornecedor: string, ator: Ator): Promise<Result<void, Failure>>;
  atualizarModelos(quem: QuemConfigura, fornecedor: string, ator: Ator): Promise<Result<number, Failure>>;
  escolherModelo(quem: QuemConfigura, tarefa: string, fornecedor: string, modelo: string, ator: Ator): Promise<Result<void, Failure>>;
  ligarOuDesligar(quem: QuemConfigura, ligada: boolean, ator: Ator): Promise<Result<void, Failure>>;
  definirTetos(quem: QuemConfigura, tetos: unknown, ator: Ator): Promise<Result<void, Failure>>;
  readonly resolver: ResolvedorDeModelo;
  readonly livro: LivroDeUso;
  recifrar(versaoPrimaria: string, limite: number): Promise<ContagemDeRecifragem>;
};

export type DependenciasDosModelos = {
  readonly repositorio: ModelosRepository;
  readonly selador: SeladorDeChave;
  readonly catalogo: CatalogoDeModelos;
  readonly audit: AuditRecorder;
  readonly fornecedores: readonly Fornecedor[];
  readonly tarefas: readonly TarefaConfiguravel[];
  readonly avisar?: (evento: string, dados: Record<string, unknown>) => void;
  readonly permitirTentativa?: (organizationId: string) => boolean;
};

const MUITAS_TENTATIVAS = failure('rate_limited', 'Muitas tentativas de guardar chave. Aguarde alguns minutos.');
const SEM_PERMISSAO = failure('forbidden', 'Só quem administra a organização configura a IA.');
const SO_RESPONSAVEL = failure('forbidden', 'Só quem responde pela organização muda os tetos de uso.');
const FORNECEDOR_INVALIDO = failure('validation', 'Fornecedor de modelo desconhecido ou não habilitado.');
const COFRE_INDISPONIVEL = failure('unavailable', 'O cofre não respondeu. Sem ele a chave não tem onde morar em segurança.');
const CHAVE_ILEGIVEL = failure('unavailable', 'A chave guardada do fornecedor não pôde ser lida. Guarde a chave de novo.');
const SEM_CHAVE = failure('not_found', 'Não há chave guardada para este fornecedor.');

export function createModelosService(deps: DependenciasDosModelos): ModelosService {
  const avisar = deps.avisar ?? (() => undefined);
  const habilitado = (candidato: string): Fornecedor | null => deps.fornecedores.find((fornecedor) => fornecedor === candidato) ?? null;

  const auditar = (quem: QuemConfigura, ator: Ator, action: string, metadata: Record<string, unknown>) =>
    deps.audit.record({
      organizationId: quem.organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action,
      targetType: 'organization',
      targetId: quem.organizationId,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata,
    });

  async function abrir(organizationId: string, fornecedor: Fornecedor): Promise<Result<string, Failure>> {
    try {
      const selada = await deps.repositorio.selada(organizationId, fornecedor);
      if (!selada) return err(SEM_CHAVE);
      return ok(await deps.selador.abrir(selada.bytes, aadDaChave(organizationId, fornecedor)));
    } catch (erro) {
      avisar('ia.chave.ilegivel', { organizationId, fornecedor, erro: erro instanceof Error ? erro.name : 'desconhecido' });
      return err(CHAVE_ILEGIVEL);
    }
  }

  async function recifrarUma(organizationId: string, fornecedor: Fornecedor): Promise<'recifrada' | 'ignorada'> {
    const selada = await deps.repositorio.selada(organizationId, fornecedor);
    if (!selada) return 'ignorada';
    const aad = aadDaChave(organizationId, fornecedor);
    const novo = await deps.selador.selar(await deps.selador.abrir(selada.bytes, aad), aad);
    return (await deps.repositorio.regravarChave(organizationId, fornecedor, novo, selada)) ? 'recifrada' : 'ignorada';
  }

  return {
    async painel(quem) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const [chaves, escolhas, configuracao, usoDeHoje] = await Promise.all([
        deps.repositorio.chaves(quem.organizationId),
        deps.repositorio.escolhas(quem.organizationId),
        deps.repositorio.configuracao(quem.organizationId),
        deps.repositorio.usoDeHoje(quem.organizationId),
      ]);
      const vivas = chaves.filter((chave) => deps.fornecedores.includes(chave.fornecedor));
      return ok({
        configuracao,
        usoDeHoje,
        fornecedores: deps.fornecedores.map((fornecedor) => ({
          fornecedor,
          chave: vivas.find((chave) => chave.fornecedor === fornecedor) ?? null,
        })),
        tarefas: deps.tarefas.map((tarefa) => {
          const escolha = escolhas.find((candidata) => candidata.tarefa === tarefa.chave);
          return { ...tarefa, escolha: escolha ?? null, estado: estadoDaTarefa(escolha, vivas) };
        }),
      });
    },

    async guardarChave(quem, fornecedorPedido, chaveBruta, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const fornecedor = habilitado(fornecedorPedido);
      if (!fornecedor) return err(FORNECEDOR_INVALIDO);
      const motivo = validarChaveDeFornecedor(chaveBruta);
      if (motivo) return err(failure('validation', MENSAGEM_DA_CHAVE[motivo]));
      const chave = chaveBruta.trim();
      if (deps.permitirTentativa && !deps.permitirTentativa(quem.organizationId)) return err(MUITAS_TENTATIVAS);

      const listados = await deps.catalogo.listar(fornecedor, chave);
      if (!listados.ok) return listados;
      const modelos = modelosDeTexto(listados.value);

      let selado: Selado;
      try {
        selado = await deps.selador.selar(chave, aadDaChave(quem.organizationId, fornecedor));
      } catch (erro) {
        avisar('ia.chave.cofre_indisponivel', { fornecedor, erro: erro instanceof Error ? erro.name : 'desconhecido' });
        return err(COFRE_INDISPONIVEL);
      }

      const rotulo = rotuloDaChaveDeFornecedor(chave);
      await deps.repositorio.guardarChave({ organizationId: quem.organizationId, fornecedor, selado, rotulo, modelos, userId: ator.userId });
      await auditar(quem, ator, 'ia.chave_guardada', { fornecedor, modelos: modelos.length });
      const agora = new Date();
      return ok({ fornecedor, rotulo, modelos, modelosListadosEm: agora, atualizadaEm: agora });
    },

    async removerChave(quem, fornecedorPedido, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const fornecedor = fornecedorConhecido(fornecedorPedido);
      if (!fornecedor) return err(FORNECEDOR_INVALIDO);
      if (!(await deps.repositorio.removerChave(quem.organizationId, fornecedor))) return err(SEM_CHAVE);
      await auditar(quem, ator, 'ia.chave_removida', { fornecedor });
      return ok(undefined);
    },

    async atualizarModelos(quem, fornecedorPedido, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const fornecedor = habilitado(fornecedorPedido);
      if (!fornecedor) return err(FORNECEDOR_INVALIDO);
      const chave = await abrir(quem.organizationId, fornecedor);
      if (!chave.ok) return chave;
      const listados = await deps.catalogo.listar(fornecedor, chave.value);
      if (!listados.ok) return listados;
      const modelos = modelosDeTexto(listados.value);
      await deps.repositorio.atualizarModelos(quem.organizationId, fornecedor, modelos);
      await auditar(quem, ator, 'ia.modelos_atualizados', { fornecedor, modelos: modelos.length });
      return ok(modelos.length);
    },

    async escolherModelo(quem, tarefa, fornecedorPedido, modelo, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const fornecedor = habilitado(fornecedorPedido);
      if (!fornecedor) return err(FORNECEDOR_INVALIDO);
      if (!deps.tarefas.some((candidata) => candidata.chave === tarefa)) return err(failure('validation', 'Tarefa de IA desconhecida.'));
      if (!PADRAO_DO_MODELO.test(modelo)) return err(failure('validation', 'Modelo inválido.'));
      const chaves = await deps.repositorio.chaves(quem.organizationId);
      const chave = chaves.find((candidata) => candidata.fornecedor === fornecedor);
      if (!chave) return err(SEM_CHAVE);
      if (!chave.modelos.includes(modelo)) return err(failure('validation', 'Este modelo não está na lista que a chave alcança.'));
      await deps.repositorio.escolher(quem.organizationId, { tarefa, fornecedor, modelo }, ator.userId);
      await auditar(quem, ator, 'ia.modelo_definido', { tarefa, fornecedor, modelo });
      return ok(undefined);
    },

    async ligarOuDesligar(quem, ligada, ator) {
      if (!canAdminister(quem.papelDeQuemAge)) return err(SEM_PERMISSAO);
      await deps.repositorio.salvarLigada(quem.organizationId, ligada, ator.userId);
      await auditar(quem, ator, ligada ? 'ia.ligada' : 'ia.desligada', {});
      return ok(undefined);
    },

    async definirTetos(quem, tetos, ator) {
      if (quem.papelDeQuemAge !== 'owner') return err(SO_RESPONSAVEL);
      const lidos = tetosDeIa.safeParse(tetos);
      if (!lidos.success) return err(failure('validation', 'Tetos fora do intervalo permitido.'));
      await deps.repositorio.salvarTetos(quem.organizationId, lidos.data, ator.userId);
      await auditar(quem, ator, 'ia.tetos_definidos', lidos.data);
      return ok(undefined);
    },

    async resolver(organizationId, tarefa) {
      const escolhas = await deps.repositorio.escolhas(organizationId);
      const escolha = escolhas.find((candidata) => candidata.tarefa === tarefa);
      if (!escolha) return err(SEM_MODELO_CONFIGURADO);
      return ok({ fornecedor: escolha.fornecedor, modelo: escolha.modelo, abrirChave: () => abrir(organizationId, escolha.fornecedor) });
    },

    livro: {
      async reservar(reserva) {
        const desfecho = await deps.repositorio.reservar(reserva);
        if ('bloqueio' in desfecho) {
          const codigo = desfecho.bloqueio === 'desligada' ? 'forbidden' : 'rate_limited';
          return err(failure(codigo, MENSAGEM_DO_BLOQUEIO[desfecho.bloqueio]));
        }
        return ok(desfecho.id);
      },
      concluir: (organizationId, reservaId, desfecho) => deps.repositorio.concluir(organizationId, reservaId, desfecho),
    },

    async recifrar(versaoPrimaria, limite) {
      const alvos = await deps.repositorio.comVersaoAntiga(versaoPrimaria, limite);
      const resumo = { avaliadas: alvos.length, recifradas: 0, falhas: 0 };
      for (const alvo of alvos) {
        try {
          if ((await recifrarUma(alvo.organizationId, alvo.fornecedor)) === 'recifrada') resumo.recifradas += 1;
        } catch (erro) {
          resumo.falhas += 1;
          avisar('ia.chave.recifragem_falhou', {
            organizationId: alvo.organizationId,
            fornecedor: alvo.fornecedor,
            erro: erro instanceof Error ? erro.name : 'desconhecido',
          });
        }
      }
      return resumo;
    },
  };
}
