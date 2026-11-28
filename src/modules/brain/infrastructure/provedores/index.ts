import type { ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { provedorDeArquivos } from './arquivos.ts';
import { provedorDeCapacidades } from './capacidades.ts';
import { provedorDeConexoes } from './conexoes.ts';
import { provedorDeConhecimento } from './conhecimento.ts';
import { provedorDeContexto } from './contexto.ts';
import { provedorDeCultura } from './cultura.ts';
import { provedorDeDados } from './dados.ts';
import { provedorDeDesempenho } from './desempenho.ts';
import { provedorDeRegras } from './regras.ts';

export const PROVEDORES: readonly ProvedorDeCatalogo[] = [
  provedorDeConexoes,
  provedorDeDados,
  provedorDeContexto,
  provedorDeRegras,
  provedorDeArquivos,
  provedorDeConhecimento,
  provedorDeDesempenho,
  provedorDeCultura,
  provedorDeCapacidades,
];
