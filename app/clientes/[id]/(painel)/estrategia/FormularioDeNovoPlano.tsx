'use client';

import Link from 'next/link';
import { useActionState, useId, type ReactNode } from 'react';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { novoPlanoAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import type { FormularioDeNovoPlano as Modelo, OpcaoDoFormulario } from '@/modules/strategy/interface/formularioDeNovoPlano';

const ESTADO_INICIAL: EstadoDoFormulario = {};

function Campo({ id, rotulo, erro, dica, children }: { readonly id: string; readonly rotulo: string; readonly erro?: string | undefined; readonly dica?: string; readonly children: ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {rotulo}
      </label>
      {children}
      {dica ? (
        <span className="field__hint" id={`${id}-dica`}>
          {dica}
        </span>
      ) : null}
      {erro ? (
        <span className="field__erro" id={`${id}-erro`} role="alert">
          <Icone nome="erro" tamanho={14} /> {erro}
        </span>
      ) : null}
    </div>
  );
}

function Opcoes({ opcoes }: { readonly opcoes: readonly OpcaoDoFormulario[] }) {
  return (
    <>
      {opcoes.map((opcao) => (
        <option key={opcao.valor} value={opcao.valor}>
          {opcao.rotulo}
        </option>
      ))}
    </>
  );
}

function Aviso({ texto, link }: { readonly texto: string; readonly link: { readonly rotulo: string; readonly href: string } | null }) {
  return (
    <p className="alert alert--warn" role="status">
      <Icone nome="atencao" />
      <span>
        {texto} {link ? <Link href={link.href}>{link.rotulo}</Link> : null}
      </span>
    </p>
  );
}

export function FormularioDeNovoPlano({ clienteId, voltarPara, inicial }: { readonly clienteId: string; readonly voltarPara: string; readonly inicial: Modelo }) {
  const base = useId();
  const [estado, enviar, pendente] = useActionState(novoPlanoAcao, ESTADO_INICIAL);
  const modelo = estado.formulario ?? inicial;
  const erros = estado.campos ?? {};
  const id = (campo: string) => `${base}-${campo}`;
  const ligacao = (campo: string) => ({
    id: id(campo),
    'aria-invalid': erros[campo] ? true : undefined,
    'aria-describedby': erros[campo] ? `${id(campo)}-erro` : undefined,
  });

  return (
    <form className="card estrategia-form" action={enviar} noValidate>
      <div className="card__body">
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="chaveDeIdempotencia" value={modelo.chaveDeIdempotencia} />
        {estado.erro ? (
          <div className="alert alert--error" role="alert">
            <Icone nome="erro" />
            <span>{estado.erro}</span>
          </div>
        ) : null}
        <Campo id={id('tipoDePlano')} rotulo="Tipo de plano" erro={erros['tipoDePlano']}>
          <select key={modelo.selecionados.tipo} className="select" name="tipoDePlano" defaultValue={modelo.selecionados.tipo} {...ligacao('tipoDePlano')}>
            <Opcoes opcoes={modelo.tipos} />
          </select>
        </Campo>

        <fieldset className="estrategia-form__grupo" aria-describedby={erros['plataformas'] ? id('plataformas-erro') : undefined}>
          <legend className="field__label">Plataformas</legend>
          <div className="estrategia-form__opcoes">
            {modelo.plataformas.map((opcao) => (
              <label key={opcao.valor} className="estrategia-form__opcao">
                <input type="checkbox" name="plataformas" value={opcao.valor} defaultChecked={opcao.marcada} />
                {opcao.rotulo}
              </label>
            ))}
          </div>
          {erros['plataformas'] ? (
            <span className="field__erro" id={id('plataformas-erro')} role="alert">
              <Icone nome="erro" tamanho={14} /> {erros['plataformas']}
            </span>
          ) : null}
        </fieldset>

        {modelo.semLandingPage ? (
          <Aviso texto={modelo.semLandingPage.texto} link={modelo.semLandingPage.link} />
        ) : (
          <Campo id={id('landingPageId')} rotulo="Landing page" erro={erros['landingPageId']}>
            <select key={modelo.selecionados.landingPage} className="select" name="landingPageId" defaultValue={modelo.selecionados.landingPage} {...ligacao('landingPageId')}>
              <option value="" disabled>
                Escolha a página
              </option>
              <Opcoes opcoes={modelo.landingPages} />
            </select>
          </Campo>
        )}

        {modelo.whatsapp.ausente ? (
          <Aviso texto={modelo.whatsapp.texto} link={modelo.whatsapp.link} />
        ) : (
          <p className="field__hint">
            WhatsApp do cliente: <strong>{modelo.whatsapp.texto}</strong>
          </p>
        )}

        <Campo id={id('objetivo')} rotulo="Objetivo" erro={erros['objetivo']} dica="O que o plano precisa alcançar, em uma ou duas frases.">
          <textarea className="input textarea" name="objetivo" defaultValue={modelo.valores.objetivo} maxLength={600} {...ligacao('objetivo')} />
        </Campo>
        <div className="estrategia-form__linha">
          <Campo id={id('inicio')} rotulo="Início do horizonte" erro={erros['inicio']}>
            <input className="input" type="date" name="inicio" defaultValue={modelo.valores.inicio} {...ligacao('inicio')} />
          </Campo>
          <Campo id={id('fim')} rotulo="Fim do horizonte" erro={erros['fim']}>
            <input className="input" type="date" name="fim" defaultValue={modelo.valores.fim} {...ligacao('fim')} />
          </Campo>
        </div>
        <div className="estrategia-form__linha">
          <Campo id={id('ousadia')} rotulo="Ousadia" erro={erros['ousadia']}>
            <select key={modelo.selecionados.ousadia} className="select" name="ousadia" defaultValue={modelo.selecionados.ousadia} {...ligacao('ousadia')}>
              <Opcoes opcoes={modelo.ousadias} />
            </select>
          </Campo>
          <Campo id={id('verba')} rotulo="Verba do horizonte (R$)" erro={erros['verba']} dica="Por exemplo 15.000,00.">
            <input className="input" name="verba" defaultValue={modelo.valores.verba} inputMode="decimal" autoComplete="off" {...ligacao('verba')} />
          </Campo>
        </div>
        <Campo id={id('retorno')} rotulo="Retorno esperado" erro={erros['retorno']} dica="Por exemplo: 300 leads qualificados por mês.">
          <input className="input" name="retorno" defaultValue={modelo.valores.retorno} maxLength={400} {...ligacao('retorno')} />
        </Campo>

        <section className="estrategia-previa" aria-labelledby={id('previa')} aria-live="polite">
          <div className="estrategia-previa__topo">
            <h3 className="estrategia-previa__titulo" id={id('previa')}>
              Links com UTM
            </h3>
            <button type="submit" className="btn btn--compacto" name="acao" value="previa" disabled={pendente}>
              Ver links
            </button>
          </div>
          {estado.previa ? (
            <ul className="estrategia-previa__lista">
              {estado.previa.itens.map((item) => (
                <li key={item.plataforma}>
                  <strong>{item.rotulo}</strong>
                  <code className="estrategia-previa__url">{item.url}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field__hint">Mostra o link de cada plataforma antes de pedir o plano.</p>
          )}
        </section>

        <div className="estrategia-form__rodape">
          <button type="submit" className="btn btn--primary" name="acao" value="criar" disabled={pendente || !modelo.podeCriar} aria-busy={pendente}>
            {pendente ? 'Enviando…' : 'Pedir o plano'}
          </button>
          <Link className="btn" href={voltarPara}>
            Voltar
          </Link>
        </div>
      </div>
    </form>
  );
}
