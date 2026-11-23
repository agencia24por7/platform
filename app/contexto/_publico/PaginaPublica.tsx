import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/../app/_components/ThemeToggle';
import { FormularioDoCliente } from '@/../app/contexto/_publico/FormularioDoCliente';
import { modules } from '@/composition';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import type { CredencialPublica } from '@/modules/clients/application/contextoService';
import { requestId } from '@/shared/http/actions';
import { comoPublico } from '@/shared/db/client';

export function MolduraPublica({ organizacao, children }: { readonly organizacao?: string; readonly children: ReactNode }) {
  return (
    <div className="publico">
      <header className="publico__topo">
        <span className="publico__marca">
          <img src="/orla/logo.png" alt="orla" className="publico__logo" />
          {organizacao ? <span className="publico__org">para {organizacao}</span> : null}
        </span>
        <ThemeToggle />
      </header>
      <main className="publico__corpo" id="conteudo">
        {children}
      </main>
      <footer className="publico__rodape">
        Seus dados ficam com {organizacao ?? 'a agência'} e são tratados conforme a{' '}
        <Link href="/privacidade">Política de Privacidade</Link>. Este link é pessoal: não compartilhe.
      </footer>
    </div>
  );
}

export function EstadoDoLink({ titulo, texto, organizacao }: { readonly titulo: string; readonly texto: string; readonly organizacao?: string }) {
  return (
    <MolduraPublica organizacao={organizacao}>
      <div className="publico__estado" role="alert">
        <svg className="publico__estado-icone" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="24" cy="24" r="20" />
          <path d="M16 26c3-5 6-5 8-2s5 3 8-2" strokeLinecap="round" />
        </svg>
        <h1 className="publico__titulo">{titulo}</h1>
        <p className="publico__texto">{texto}</p>
      </div>
    </MolduraPublica>
  );
}

export async function PaginaPublica({ credencial, voltarPara }: { readonly credencial: CredencialPublica; readonly voltarPara?: string }) {
  const pedido = {
    credencial,
    ip: enderecoConfiavel((await headers()).get('x-forwarded-for')),
    requestId: await requestId(),
  };
  const resultado = await comoPublico(() => modules().contexto.carregarPeloLink(pedido));

  if (!resultado.ok) {
    if (resultado.error.code === 'rate_limited') {
      return <EstadoDoLink titulo="Muitas tentativas" texto="Por segurança, espere um minuto e abra o link de novo. O que você já preencheu está salvo." />;
    }
    return (
      <EstadoDoLink
        titulo="Este link não vale mais"
        texto="Ele pode ter expirado, sido trocado por um novo ou revogado pela equipe. Peça um novo link a quem enviou; tudo o que você já respondeu continua guardado."
      />
    );
  }

  const formulario = resultado.value;
  return (
    <MolduraPublica organizacao={formulario.organizacao}>
      <FormularioDoCliente credencial={credencial} formulario={formulario} voltarPara={voltarPara ?? null} />
    </MolduraPublica>
  );
}
