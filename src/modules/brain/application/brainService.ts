import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { ArmazenamentoDeContexto } from '@/shared/storage/tipos';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { DefinicaoDeCapacidade } from '../domain/capacidades.ts';
import { filtrarCatalogo, paginar, type FiltrosDoCatalogo } from '../domain/consulta.ts';
import type { CarregadorDeContexto, ContextoParaCatalogo } from '../domain/contexto.ts';
import type { ConectorDoDiagnostico } from '../domain/diagnostico.ts';
import { VERSAO_DO_ESQUEMA_DO_CATALOGO, type EntradaDoCatalogo } from '../domain/entrada.ts';
import { hashEstavel } from '../domain/jsonEstavel.ts';
import type { ProvedorDeCatalogo } from '../domain/provedor.ts';
import { hojeEmSaoPaulo, somarDias } from '../domain/tempo.ts';
import { urnDoCliente } from '../domain/urn.ts';
import { construirCatalogo, type Snapshot } from './construirCatalogo.ts';
import type {
  BrainRepository,
  ClienteResolvido,
  IdentidadeDoWorker,
  MedidorDeCobertura,
  ObjetoDeMedicao,
} from './portas.ts';
import { artefatosDoCatalogo, manifestoDe, PASTA_DAS_ENTRADAS, prefixoDoCatalogo, type ManifestoDoCatalogo } from './publicacao.ts';

export type Configuracao = {
  readonly conjuntoDeDados: string;
  readonly bytesMaximosPorConsulta: number;
  readonly diasDeMedicao: number;
};

export type DependenciasDoBrain = {
  readonly repositorio: BrainRepository;
  readonly contexto: CarregadorDeContexto;
  readonly armazenamento: ArmazenamentoDeContexto;
  readonly medidor: MedidorDeCobertura;
  readonly audit: AuditRecorder;
  readonly provedores: readonly ProvedorDeCatalogo[];
  readonly capacidades: readonly DefinicaoDeCapacidade[];
  readonly conectores: readonly ConectorDoDiagnostico[];
  readonly plataformasDaTabela: (tabela: string) => readonly string[];
  readonly objetosDeMedicao: (plataformas: readonly string[]) => readonly ObjetoDeMedicao[];
  readonly configuracao: Configuracao;
  readonly relogio?: () => Date;
  readonly registrarAviso?: (evento: string, dados: Record<string, unknown>) => void;
};

export type Resposta<T> = { readonly corpo: T; readonly etag: string };

export type PaginaDeEntradas = {
  readonly schemaVersion: number;
  readonly clienteId: string;
  readonly catalogHash: string;
  readonly total: number;
  readonly proximoCursor: string | null;
  readonly entradas: readonly EntradaDoCatalogo[];
};

export type SituacaoDaPublicacao = 'publicado' | 'inalterado' | 'sem_armazenamento';

export type ResumoDaVarredura = {
  readonly publicados: number;
  readonly inalterados: number;
  readonly semArmazenamento: number;
  readonly falhas: number;
  readonly despublicados: number;
};

export type ResumoDaMedicao = { readonly clientes: number; readonly tabelas: number; readonly falhas: number };

export type BrainService = {
  montar(clienteId: string): Promise<Result<Snapshot, Failure>>;
  montarNaOrganizacao(organizationId: string, clienteId: string): Promise<Result<Snapshot, Failure>>;
  catalogo(
    clienteId: string,
    consulta: FiltrosDoCatalogo & { readonly limite: number; readonly cursor: string | null },
    worker: IdentidadeDoWorker,
  ): Promise<Result<Resposta<PaginaDeEntradas>, Failure>>;
  entrada(clienteId: string, urn: string, worker: IdentidadeDoWorker): Promise<Result<Resposta<EntradaDoCatalogo>, Failure>>;
  capacidades(clienteId: string, worker: IdentidadeDoWorker): Promise<Result<Resposta<Pick<Snapshot, 'schemaVersion' | 'capacidades' | 'catalogHash'>>, Failure>>;
  diagnostico(clienteId: string, worker: IdentidadeDoWorker): Promise<Result<Resposta<Snapshot['diagnostico'] & { readonly catalogHash: string }>, Failure>>;
  manifest(clienteId: string, worker: IdentidadeDoWorker): Promise<Result<Resposta<ManifestoDoCatalogo>, Failure>>;
  publicar(cliente: ClienteResolvido): Promise<SituacaoDaPublicacao>;
  publicarPendentes(worker: IdentidadeDoWorker, limite: number): Promise<Result<ResumoDaVarredura, Failure>>;
  medirCobertura(worker: IdentidadeDoWorker, limite: number): Promise<Result<ResumoDaMedicao, Failure>>;
  marcarPendente(cliente: ClienteResolvido, motivo: string): Promise<void>;
};

const NAO_ENCONTRADO = failure('not_found', 'Cliente não encontrado.');
const ENTRADA_NAO_ENCONTRADA = failure('not_found', 'Entrada não encontrada no catálogo deste cliente.');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mensagem(erro: unknown): string {
  return (erro instanceof Error ? erro.message : 'erro desconhecido').slice(0, 500);
}

function etag(valor: unknown): string {
  return `"${hashEstavel(valor).slice(0, 32)}"`;
}

export function createBrainService(deps: DependenciasDoBrain): BrainService {
  const agora = deps.relogio ?? (() => new Date());
  const aviso = deps.registrarAviso ?? (() => undefined);

  async function carregarContexto(cliente: ClienteResolvido): Promise<ContextoParaCatalogo | null> {
    if (!deps.contexto.disponivel) return null;
    try {
      return await deps.contexto.carregar({ organizationId: cliente.organizationId, clientId: cliente.clienteId });
    } catch (erro) {
      aviso('brain.contexto_indisponivel', { clienteId: cliente.clienteId, erro: mensagem(erro) });
      return null;
    }
  }

  async function montarResolvido(cliente: ClienteResolvido): Promise<Snapshot | null> {
    const [inventario, contexto] = await Promise.all([deps.repositorio.carregarInventario(cliente), carregarContexto(cliente)]);
    if (!inventario) return null;
    return construirCatalogo(
      {
        provedores: deps.provedores,
        capacidades: deps.capacidades,
        conectores: deps.conectores,
        plataformasDaTabela: deps.plataformasDaTabela,
        aoDescartar: (provedor, motivo) => aviso('brain.entrada_descartada', { clienteId: cliente.clienteId, provedor, motivo }),
      },
      {
        organizationId: cliente.organizationId,
        clienteId: cliente.clienteId,
        agora: agora(),
        conjuntoDeDados: deps.configuracao.conjuntoDeDados,
        bytesMaximosPorConsulta: deps.configuracao.bytesMaximosPorConsulta,
        inventario,
        contexto,
      },
    );
  }

  async function montar(clienteId: string): Promise<Result<Snapshot, Failure>> {
    if (!UUID.test(clienteId)) return err(NAO_ENCONTRADO);
    const cliente = await deps.repositorio.resolverCliente(clienteId);
    if (!cliente) return err(NAO_ENCONTRADO);
    const snapshot = await montarResolvido(cliente);
    return snapshot ? ok(snapshot) : err(NAO_ENCONTRADO);
  }

  async function montarNaOrganizacao(organizationId: string, clienteId: string): Promise<Result<Snapshot, Failure>> {
    if (!UUID.test(clienteId) || !UUID.test(organizationId)) return err(NAO_ENCONTRADO);
    const snapshot = await montarResolvido({ organizationId, clienteId });
    return snapshot && snapshot.organizationId === organizationId ? ok(snapshot) : err(NAO_ENCONTRADO);
  }

  async function auditar(worker: IdentidadeDoWorker, snapshot: Snapshot, rota: string, devolvidas: number): Promise<void> {
    await deps.audit.record({
      organizationId: snapshot.organizationId,
      actorType: 'worker',
      actorId: worker.callerFingerprint,
      action: 'brain.consulta',
      targetType: 'client',
      targetId: snapshot.clienteId,
      requestId: worker.requestId,
      sourceIp: worker.sourceIp,
      metadata: {
        rota,
        devolvidas,
        total: snapshot.entradas.length,
        omitidas: snapshot.omitidasPelaPolitica,
        restritas: snapshot.restritasPelaPolitica,
      },
    });
  }

  async function consultar<T>(
    clienteId: string,
    worker: IdentidadeDoWorker,
    rota: string,
    projetar: (snapshot: Snapshot) => Result<{ corpo: T; devolvidas: number }, Failure>,
  ): Promise<Result<Resposta<T>, Failure>> {
    const montado = await montar(clienteId);
    if (!montado.ok) return montado;
    const projetado = projetar(montado.value);
    if (!projetado.ok) return projetado;
    await auditar(worker, montado.value, rota, projetado.value.devolvidas);
    return ok({ corpo: projetado.value.corpo, etag: etag({ catalogHash: montado.value.catalogHash, rota, corpo: projetado.value.corpo }) });
  }

  async function publicar(cliente: ClienteResolvido): Promise<SituacaoDaPublicacao> {
    const snapshot = await montarResolvido(cliente);
    if (!snapshot) return 'inalterado';
    const estado = await deps.repositorio.estado(cliente);
    if (estado && estado.ultimoHash === snapshot.catalogHash && estado.publicadoEm) {
      if (estado.pendente) await deps.repositorio.registrarPublicacao(cliente, { hash: snapshot.catalogHash, entradas: snapshot.entradas.length });
      return 'inalterado';
    }
    if (!deps.armazenamento.disponivel) return 'sem_armazenamento';

    const prefixo = prefixoDoCatalogo(cliente.organizationId, cliente.clienteId);
    const artefatos = artefatosDoCatalogo(snapshot);
    const manifesto = artefatos.find((a) => a.nome === 'manifest.json')!;
    for (const artefato of artefatos.filter((a) => a !== manifesto)) {
      await deps.armazenamento.put(`${prefixo}${artefato.nome}`, Buffer.from(artefato.conteudo, 'utf8'), {
        contentType: artefato.contentType,
        metadata: { catalogHash: snapshot.catalogHash },
      });
    }
    await apagarEntradasVelhas(prefixo, new Set(artefatos.map((a) => `${prefixo}${a.nome}`)));
    await deps.armazenamento.put(`${prefixo}${manifesto.nome}`, Buffer.from(manifesto.conteudo, 'utf8'), {
      contentType: manifesto.contentType,
      metadata: { catalogHash: snapshot.catalogHash },
    });
    await deps.repositorio.registrarPublicacao(cliente, { hash: snapshot.catalogHash, entradas: snapshot.entradas.length });
    return 'publicado';
  }

  async function apagarEntradasVelhas(prefixo: string, atuais: ReadonlySet<string>): Promise<void> {
    let pagina: string | undefined;
    do {
      const lista = await deps.armazenamento.list(`${prefixo}${PASTA_DAS_ENTRADAS}`, pagina ? { maxResults: 1000, pageToken: pagina } : { maxResults: 1000 });
      for (const item of lista.items) if (!atuais.has(item.path)) await deps.armazenamento.delete(item.path);
      pagina = lista.nextPageToken;
    } while (pagina);
  }

  async function despublicarExcluidos(limite: number): Promise<number> {
    const excluidos = await deps.repositorio.clientesExcluidosPublicados(limite);
    let total = 0;
    for (const cliente of excluidos) {
      try {
        if (deps.armazenamento.disponivel) await deps.armazenamento.deletePrefix(prefixoDoCatalogo(cliente.organizationId, cliente.clienteId));
        await deps.repositorio.marcarDespublicado(cliente.clienteId);
        total += 1;
      } catch (erro) {
        aviso('brain.despublicar_falhou', { clienteId: cliente.clienteId, erro: mensagem(erro) });
      }
    }
    return total;
  }

  return {
    montar,
    montarNaOrganizacao,

    catalogo(clienteId, consulta, worker) {
      return consultar(clienteId, worker, 'catalogo', (snapshot) => {
        const filtradas = filtrarCatalogo(snapshot.entradas, consulta);
        const pagina = paginar(filtradas, consulta.limite, consulta.cursor);
        return ok({
          corpo: {
            schemaVersion: VERSAO_DO_ESQUEMA_DO_CATALOGO,
            clienteId: snapshot.clienteId,
            catalogHash: snapshot.catalogHash,
            total: pagina.total,
            proximoCursor: pagina.proximoCursor,
            entradas: pagina.entradas,
          },
          devolvidas: pagina.entradas.length,
        });
      });
    },

    entrada(clienteId, urn, worker) {
      return consultar(clienteId, worker, 'entrada', (snapshot) => {
        if (!urnDoCliente(urn, snapshot.organizationId, snapshot.clienteId)) return err(ENTRADA_NAO_ENCONTRADA);
        const achada = snapshot.entradas.find((e) => e.urn === urn);
        return achada ? ok({ corpo: achada, devolvidas: 1 }) : err(ENTRADA_NAO_ENCONTRADA);
      });
    },

    capacidades(clienteId, worker) {
      return consultar(clienteId, worker, 'capacidades', (snapshot) =>
        ok({
          corpo: { schemaVersion: snapshot.schemaVersion, catalogHash: snapshot.catalogHash, capacidades: snapshot.capacidades },
          devolvidas: snapshot.capacidades.length,
        }),
      );
    },

    diagnostico(clienteId, worker) {
      return consultar(clienteId, worker, 'diagnostico', (snapshot) =>
        ok({ corpo: { ...snapshot.diagnostico, catalogHash: snapshot.catalogHash }, devolvidas: snapshot.diagnostico.acoes.length }),
      );
    },

    manifest(clienteId, worker) {
      return consultar(clienteId, worker, 'manifest', (snapshot) => ok({ corpo: manifestoDe(snapshot), devolvidas: snapshot.entradas.length }));
    },

    publicar,

    async publicarPendentes(worker, limite) {
      const despublicados = await despublicarExcluidos(limite);
      const pendentes = await deps.repositorio.clientesParaPublicar(limite);
      const contagem = { publicados: 0, inalterados: 0, semArmazenamento: 0, falhas: 0 };
      for (const cliente of pendentes) {
        try {
          const situacao = await publicar(cliente);
          if (situacao === 'publicado') contagem.publicados += 1;
          if (situacao === 'inalterado') contagem.inalterados += 1;
          if (situacao === 'sem_armazenamento') contagem.semArmazenamento += 1;
        } catch (erro) {
          contagem.falhas += 1;
          await deps.repositorio.registrarFalha(cliente, mensagem(erro)).catch(() => undefined);
          aviso('brain.publicacao_falhou', { clienteId: cliente.clienteId, erro: mensagem(erro) });
        }
      }
      const resumo = { ...contagem, despublicados };
      await deps.audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'brain.catalogo_publicado',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: resumo,
      });
      return ok(resumo);
    },

    async medirCobertura(worker, limite) {
      if (!deps.medidor.disponivel) return err(failure('unavailable', 'BigQuery não configurado (BQ_PROJECT_ID).'));
      const clientes = await deps.repositorio.clientesParaMedir(limite);
      const ate = somarDias(hojeEmSaoPaulo(agora()), -1);
      const desde = somarDias(ate, -(deps.configuracao.diasDeMedicao - 1));
      let tabelas = 0;
      let falhas = 0;
      for (const cliente of clientes) {
        const objetos = deps.objetosDeMedicao(cliente.plataformas);
        if (objetos.length === 0) continue;
        try {
          const medidas = await deps.medidor.medir(cliente, objetos, desde, ate);
          await deps.repositorio.gravarCobertura(cliente, medidas);
          await deps.repositorio.marcarPendente(cliente, 'cobertura_medida');
          tabelas += medidas.length;
        } catch (erro) {
          falhas += 1;
          aviso('brain.cobertura_falhou', { clienteId: cliente.clienteId, erro: mensagem(erro) });
        }
      }
      const resumo = { clientes: clientes.length, tabelas, falhas };
      await deps.audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'brain.cobertura_medida',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: resumo,
      });
      return ok(resumo);
    },

    async marcarPendente(cliente, motivo) {
      try {
        await deps.repositorio.marcarPendente(cliente, motivo);
      } catch (erro) {
        aviso('brain.marcar_pendente_falhou', { clienteId: cliente.clienteId, erro: mensagem(erro) });
      }
    },
  };
}
