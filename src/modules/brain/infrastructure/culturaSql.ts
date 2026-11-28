import type { SinalDeCultura } from '../domain/cultura.ts';

export const LIMITE_DE_SINAIS_LIDOS = 100;

export type LinhaDeSinal = {
  id: string;
  kind: SinalDeCultura['tipo'];
  titulo: string;
  resumo: string;
  fonte_url: string;
  fonte_nome: string;
  plataforma: string | null;
  observado_em: string;
  valido_ate: string;
  nota_evidencia: SinalDeCultura['nota'];
  origem: SinalDeCultura['origem'];
  criado_em: Date;
};

export const paraSinalDeCultura = (linha: LinhaDeSinal): SinalDeCultura => ({
  id: linha.id,
  tipo: linha.kind,
  titulo: linha.titulo,
  resumo: linha.resumo,
  fonteUrl: linha.fonte_url,
  fonteNome: linha.fonte_nome,
  plataforma: linha.plataforma,
  observadoEm: linha.observado_em,
  validoAte: linha.valido_ate,
  nota: linha.nota_evidencia,
  origem: linha.origem,
  criadoEm: linha.criado_em,
});
