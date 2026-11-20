import { carregarContas, carregarContexto } from '@/../app/clientes/[id]/_dados';
import type { AdaptadorDoBrain } from '@/../app/clientes/[id]/_brain/fonte';
import { CATALOGO } from '@/modules/clients/domain/contexto/catalogo';
import { montarBrainDeExemplo } from '@/modules/clients/domain/painel/brain/exemplo';

export const adaptadorDeExemplo: AdaptadorDoBrain = async ({ organizationId, clientId, clienteNome }) => {
  const [contexto, [contas, fontes]] = await Promise.all([
    carregarContexto(organizationId, clientId),
    carregarContas(organizationId, clientId),
  ]);
  const percentual = new Map(contexto?.completude.secoes.map((s) => [s.secao, s.percentual]) ?? []);

  return montarBrainDeExemplo({
    clienteId: clientId,
    clienteNome,
    agora: new Date(),
    contas: contas.map((c) => ({
      platform: c.platform,
      nome: c.name,
      externalId: c.externalId,
      ultimaColeta: c.lastSyncAt,
      coletaLigada: c.syncEnabled,
    })),
    fontes: fontes.map((f) => ({ platform: f.platform, nome: f.name, externalId: f.externalId })),
    completudeGeral: contexto?.completude.geral ?? 0,
    secoes: CATALOGO.map((s) => ({ secao: s.key, letra: s.letra, titulo: s.titulo, percentual: percentual.get(s.key) ?? 0 })),
    arquivos: (contexto?.arquivos ?? []).map((a) => ({
      id: a.id,
      nome: a.nome,
      mime: a.mime,
      tamanhoBytes: a.tamanhoBytes,
      fieldKey: a.fieldKey,
      criadoEm: a.criadoEm,
    })),
  });
};
