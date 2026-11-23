'use server';

import { headers } from 'next/headers';
import { modules } from '@/composition';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import type {
  AcessoPublico,
  AlteracaoPeloLink,
  CredencialPublica,
  FormularioPublico,
  SalvoPeloLink,
} from '@/modules/clients/application/contextoService';
import { requestId } from '@/shared/http/actions';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';
import { comoPublico } from '@/shared/db/client';

export type RespostaPublica<T> =
  | { readonly ok: true; readonly valor: T }
  | {
      readonly ok: false;
      readonly erro: string;
      readonly codigo: string;
      readonly versaoAtual: number | null;
      readonly campos: Readonly<Record<string, string>> | null;
    };

function credencialValida(bruta: CredencialPublica): CredencialPublica | null {
  if (!bruta || (bruta.tipo !== 'link' && bruta.tipo !== 'convite')) return null;
  if (typeof bruta.token !== 'string' || bruta.token.length < 16 || bruta.token.length > 64) return null;
  return { tipo: bruta.tipo, token: bruta.token };
}

async function acesso(credencial: CredencialPublica): Promise<AcessoPublico | null> {
  const valida = credencialValida(credencial);
  if (!valida) return null;
  return {
    credencial: valida,
    ip: enderecoConfiavel((await headers()).get('x-forwarded-for')),
    requestId: await requestId(),
  };
}

const INVALIDO: RespostaPublica<never> = {
  ok: false,
  erro: 'Este link não vale mais. Peça um novo à equipe.',
  codigo: 'not_found',
  versaoAtual: null,
  campos: null,
};

function responder<T>(r: Result<T, Failure>): RespostaPublica<T> {
  if (r.ok) return { ok: true, valor: r.value };
  const versao = r.error.details?.['versaoAtual'];
  return {
    ok: false,
    erro: r.error.message,
    codigo: r.error.code,
    versaoAtual: versao !== undefined ? Number(versao) : null,
    campos: r.error.code === 'validation' ? (r.error.details ?? null) : null,
  };
}

export async function salvarPeloLinkAcao(credencial: CredencialPublica, alteracao: AlteracaoPeloLink): Promise<RespostaPublica<SalvoPeloLink>> {
  const a = await acesso(credencial);
  if (!a) return INVALIDO;
  return responder(await comoPublico(() => modules().contexto.salvarPeloLink(a, alteracao)));
}

export async function concluirPeloLinkAcao(credencial: CredencialPublica): Promise<RespostaPublica<{ readonly concluidoEm: Date }>> {
  const a = await acesso(credencial);
  if (!a) return INVALIDO;
  return responder(await comoPublico(() => modules().contexto.concluirPeloLink(a)));
}

export async function recarregarPeloLinkAcao(credencial: CredencialPublica): Promise<RespostaPublica<FormularioPublico>> {
  const a = await acesso(credencial);
  if (!a) return INVALIDO;
  return responder(await comoPublico(() => modules().contexto.carregarPeloLink(a)));
}
