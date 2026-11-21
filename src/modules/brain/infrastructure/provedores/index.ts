import type { ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { provedorDeArquivos } from './arquivos.ts';
import { provedorDeCapacidades } from './capacidades.ts';
import { provedorDeConexoes } from './conexoes.ts';
import { provedorDeContexto } from './contexto.ts';
import { provedorDeDados } from './dados.ts';

export const PROVEDORES: readonly ProvedorDeCatalogo[] = [
  provedorDeConexoes,
  provedorDeDados,
  provedorDeContexto,
  provedorDeArquivos,
  provedorDeCapacidades,
];
