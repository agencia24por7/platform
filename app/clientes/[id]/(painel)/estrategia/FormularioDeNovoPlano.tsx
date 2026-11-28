'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { novoPlanoAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import { GrupoDoFoco } from '@/../app/clientes/[id]/(painel)/estrategia/GrupoDoFoco';
import { IndicadorDePassos } from '@/../app/clientes/[id]/(painel)/estrategia/IndicadorDePassos';
import { RevisaoDoNovoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/RevisaoDoNovoPlano';
import type { FormularioDeNovoPlano as Modelo, OpcaoDoFormulario } from '@/modules/strategy/interface/formularioDeNovoPlano';
import { camposBrutosDasEntradas, type CamposBrutos } from '@/modules/strategy/interface/formulariosDaEstrategia';
import { PASSOS_DO_NOVO_PLANO, SEM_CORRECOES, corrigirCampo, errosAposCorrecoes, indicadorDePassos, limitarPasso, navegacaoDoPasso, primeiroPassoComErro } from '@/modules/strategy/interface/passosDoNovoPlano';
import { revisaoDoNovoPlano } from '@/modules/strategy/interface/revisaoDoNovoPlano';

const ESTADO_INICIAL: EstadoDoFormulario = {};
const SEM_CAMPOS: CamposBrutos = {};

type Posicao = { readonly passo: number; readonly campos: CamposBrutos };

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

type PropsDoPasso = { readonly indice: number; readonly atual: number; readonly id: string; readonly tituloRef: RefObject<HTMLHeadingElement | null>; readonly children: ReactNode };

function Passo({ indice, atual, id, tituloRef, children }: PropsDoPasso) {
  const passo = PASSOS_DO_NOVO_PLANO[indice];
  if (!passo) return null;
  const ativo = indice === atual;
  return (
    <section className="plano-passo" hidden={!ativo} aria-labelledby={`${id}-titulo`}>
      <header className="plano-passo__cabecalho">
        <h3 className="plano-passo__titulo" id={`${id}-titulo`} tabIndex={-1} ref={ativo ? tituloRef : undefined}>
          {passo.titulo}
        </h3>
        <p className="field__hint">{passo.descricao}</p>
      </header>
      <div className="plano-passo__corpo">{children}</div>
    </section>
  );
}

export function FormularioDeNovoPlano({ clienteId, voltarPara, inicial }: { readonly clienteId: string; readonly voltarPara: string; readonly inicial: Modelo }) {
  const base = useId();
  const [estado, enviar, pendente] = useActionState(novoPlanoAcao, ESTADO_INICIAL);
  const [posicao, definirPosicao] = useState<Posicao>({ passo: 0, campos: SEM_CAMPOS });
  const formulario = useRef<HTMLFormElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const passoAnterior = useRef(posicao.passo);
  const modelo = estado.formulario ?? inicial;
  const [correcoes, definirCorrecoes] = useState(SEM_CORRECOES);
  const erros = errosAposCorrecoes(estado.campos, correcoes);
  const navegacao = navegacaoDoPasso(posicao.passo);
  const id = (campo: string) => `${base}-${campo}`;
  const ligacao = (campo: string) => ({
    id: id(campo),
    'aria-invalid': erros[campo] ? true : undefined,
    'aria-describedby': erros[campo] ? `${id(campo)}-erro` : undefined,
  });

  const irPara = useCallback((indice: number) => {
    const campos = formulario.current ? camposBrutosDasEntradas(new FormData(formulario.current).entries()) : SEM_CAMPOS;
    definirPosicao({ passo: limitarPasso(indice), campos });
  }, []);

  useEffect(() => {
    const comErro = primeiroPassoComErro(estado.campos);
    if (comErro !== null) irPara(comErro);
  }, [estado.campos, irPara]);

  useEffect(() => {
    if (passoAnterior.current === posicao.passo) return;
    passoAnterior.current = posicao.passo;
    titulo.current?.focus();
  }, [posicao.passo]);

  const aoMudar = (evento: FormEvent<HTMLFormElement>) => {
    const alvo = evento.target;
    if (!(alvo instanceof HTMLInputElement || alvo instanceof HTMLSelectElement || alvo instanceof HTMLTextAreaElement)) return;
    const nome = alvo.name;
    definirCorrecoes((atual) => corrigirCampo(atual, estado.campos, nome));
  };

  const aoTeclar = (evento: KeyboardEvent<HTMLFormElement>) => {
    if (evento.key !== 'Enter' || !(evento.target instanceof HTMLInputElement)) return;
    evento.preventDefault();
    if (navegacao.proximo !== null) irPara(navegacao.proximo);
  };

  return (
    <form ref={formulario} className="card estrategia-form" action={enviar} onChange={aoMudar} onKeyDown={aoTeclar} noValidate>
      <div className="card__body">
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="chaveDeIdempotencia" value={modelo.chaveDeIdempotencia} />
        <IndicadorDePassos itens={indicadorDePassos(posicao.passo, erros)} progresso={navegacao.progresso} aoEscolher={irPara} />
        {estado.erro ? (
          <div className="alert alert--error" role="alert">
            <Icone nome="erro" />
            <span>{estado.erro}</span>
          </div>
        ) : null}

        <Passo indice={0} atual={posicao.passo} id={id('passo-0')} tituloRef={titulo}>
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
        </Passo>

        <Passo indice={1} atual={posicao.passo} id={id('passo-1')} tituloRef={titulo}>
          <GrupoDoFoco key={modelo.foco.chave} foco={modelo.foco} idDoErro={id('foco-erro')} erro={erros['foco']} />
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
        </Passo>

        <Passo indice={2} atual={posicao.passo} id={id('passo-2')} tituloRef={titulo}>
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
          <Campo id={id('ousadia')} rotulo="Ousadia" erro={erros['ousadia']}>
            <select key={modelo.selecionados.ousadia} className="select" name="ousadia" defaultValue={modelo.selecionados.ousadia} {...ligacao('ousadia')}>
              <Opcoes opcoes={modelo.ousadias} />
            </select>
          </Campo>
        </Passo>

        <Passo indice={3} atual={posicao.passo} id={id('passo-3')} tituloRef={titulo}>
          <fieldset className="estrategia-form__grupo">
            <legend className="field__label">A verba é informada</legend>
            <div className="segmentado" key={modelo.valores.modoDaVerba}>
              {modelo.modosDaVerba.map((modo) => (
                <label key={modo.valor} className="segmentado__opcao">
                  <input type="radio" name="modoDaVerba" value={modo.valor} defaultChecked={modo.marcada} />
                  <span>{modo.rotulo}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Campo id={id('verba')} rotulo="Verba (R$)" erro={erros['verba']} dica="Valor conforme a opção acima. Por exemplo 15.000,00. Por mês, o total do horizonte é calculado pelos dias do período.">
            <input className="input" name="verba" defaultValue={modelo.valores.verba} inputMode="decimal" autoComplete="off" {...ligacao('verba')} />
          </Campo>
          <Campo id={id('retorno')} rotulo="Retorno esperado" erro={erros['retorno']} dica="Por exemplo: 300 leads qualificados por mês.">
            <input className="input" name="retorno" defaultValue={modelo.valores.retorno} maxLength={400} {...ligacao('retorno')} />
          </Campo>
        </Passo>

        <Passo indice={4} atual={posicao.passo} id={id('passo-4')} tituloRef={titulo}>
          <RevisaoDoNovoPlano revisao={revisaoDoNovoPlano(modelo, posicao.campos)} aoEditar={irPara} />
          <section className="estrategia-previa" aria-labelledby={id('previa')} aria-live="polite">
            <div className="estrategia-previa__topo">
              <h4 className="estrategia-previa__titulo" id={id('previa')}>
                Links com UTM
              </h4>
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
        </Passo>

        <div className="estrategia-form__rodape">
          <button type="button" className="btn" hidden={navegacao.anterior === null} onClick={() => irPara(navegacao.anterior ?? navegacao.indice)}>
            Voltar
          </button>
          <button type="button" className="btn btn--primary" hidden={navegacao.proximo === null} onClick={() => irPara(navegacao.proximo ?? navegacao.indice)}>
            Continuar
          </button>
          <button type="submit" className="btn btn--primary" name="acao" value="criar" hidden={!navegacao.ultimo} disabled={pendente || !modelo.podeCriar} aria-busy={pendente}>
            {pendente ? 'Enviando…' : 'Pedir o plano'}
          </button>
          <Link className="btn estrategia-form__cancelar" href={voltarPara}>
            Cancelar
          </Link>
        </div>
      </div>
    </form>
  );
}
