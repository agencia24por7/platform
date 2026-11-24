import { createBrainRepository } from '@/modules/brain/infrastructure/brainRepository';
import type { RegrasService } from '@/modules/clients/application/regrasService';
import type { PortaDeRegrasDoWorker } from '@/modules/clients/interface/regrasDoWorker';

let repositorioDoBrain: ReturnType<typeof createBrainRepository> | null = null;

export function portaDeRegrasDoWorker(regras: RegrasService): PortaDeRegrasDoWorker {
  repositorioDoBrain ??= createBrainRepository();
  const repositorio = repositorioDoBrain;
  return { regras, resolverCliente: (clienteId) => repositorio.resolverCliente(clienteId) };
}
