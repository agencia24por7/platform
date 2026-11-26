'use client';

import Link from 'next/link';
import { useActionState, useId, type ReactNode } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { novoPlanoAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import { ROTULO_DO_TIPO_DE_PLANO, TIPOS_DE_PLANO } from '@/modules/strategy/domain/tipoDePlano';
import { ROTULO_DA_OUSADIA } from '@/modules/strategy/interface/rotulosDoPlano';

const ESTADO_INICIAL: EstadoDoFormulario = {};
const OUSADIAS = ['conservador', 'moderado', 'ousado'] as const;

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
        <span className="field__erro" id={`${id}-erro`}>
          <Icone nome="erro" tamanho={14} /> {erro}
        </span>
      ) : null}
    </div>
  );
}

export function FormularioDeIntencao({ clienteId, voltarPara, tipoInicial, tiposDisponiveis }: { readonly clienteId: string; readonly voltarPara: string; readonly tipoInicial: string; readonly tiposDisponiveis: readonly string[] }) {
  const base = useId();
  const [estado, enviar] = useActionState(novoPlanoAcao, ESTADO_INICIAL);
  const erros = estado.campos ?? {};
  const valor = (campo: string, padrao = '') => estado.valores?.[campo] ?? padrao;
  const id = (campo: string) => `${base}-${campo}`;
  const ligacao = (campo: string, comDica: boolean) => ({
    id: id(campo),
    'aria-invalid': erros[campo] ? true : undefined,
    'aria-describedby': [comDica ? `${id(campo)}-dica` : null, erros[campo] ? `${id(campo)}-erro` : null].filter(Boolean).join(' ') || undefined,
  });

  return (
    <form className="card estrategia-form estrategia-form--intencao" action={enviar}>
      <div className="card__body">
        <input type="hidden" name="clienteId" value={clienteId} />
        {estado.erro ? (
          <div className="alert alert--error" role="alert">
            <Icone nome="erro" />
            <span>{estado.erro}</span>
          </div>
        ) : null}
        <p className="field__hint">Você informa só a intenção. O agente lê o Brain, redige o plano, o Comitê opina e os Gates conferem. Leva alguns minutos.</p>
        <div className="estrategia-form__linha">
          <Campo id={id('tipo')} rotulo="Tipo de plano" erro={erros['tipoDePlano']}>
            <select className="select" name="tipoDePlano" defaultValue={valor('tipoDePlano', tipoInicial)} required {...ligacao('tipoDePlano', false)} id={id('tipo')}>
              {TIPOS_DE_PLANO.filter((tipo) => tiposDisponiveis.includes(tipo)).map((tipo) => (
                <option key={tipo} value={tipo}>
                  {ROTULO_DO_TIPO_DE_PLANO[tipo]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id={id('ousadia')} rotulo="Ousadia" erro={erros['ousadia']} dica="Quanto risco o plano pode assumir.">
            <select className="select" name="ousadia" defaultValue={valor('ousadia', 'moderado')} required {...ligacao('ousadia', true)}>
              {OUSADIAS.map((nivel) => (
                <option key={nivel} value={nivel}>
                  {ROTULO_DA_OUSADIA[nivel]}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo id={id('objetivo')} rotulo="Objetivo" erro={erros['objetivo']} dica="O que o plano precisa alcançar, em uma ou duas frases.">
          <textarea className="input textarea" name="objetivo" defaultValue={valor('objetivo')} required minLength={3} maxLength={600} {...ligacao('objetivo', true)} />
        </Campo>
        <div className="estrategia-form__linha">
          <Campo id={id('inicio')} rotulo="Início do horizonte" erro={erros['inicio']}>
            <input className="input" type="date" name="inicio" defaultValue={valor('inicio')} required {...ligacao('inicio', false)} />
          </Campo>
          <Campo id={id('fim')} rotulo="Fim do horizonte" erro={erros['fim']}>
            <input className="input" type="date" name="fim" defaultValue={valor('fim')} required {...ligacao('fim', false)} />
          </Campo>
        </div>
        <Campo id={id('retorno')} rotulo="Retorno esperado" erro={erros['retorno']} dica="Por exemplo: 300 leads qualificados por mês.">
          <input className="input" name="retorno" defaultValue={valor('retorno')} required minLength={3} maxLength={400} {...ligacao('retorno', true)} />
        </Campo>
        <Campo id={id('verba')} rotulo="Verba disponível (R$)" erro={erros['verba']} dica="Valor total do horizonte, por exemplo 15.000,00.">
          <input className="input" name="verba" defaultValue={valor('verba')} inputMode="decimal" autoComplete="off" required {...ligacao('verba', true)} />
        </Campo>
        <div className="estrategia-form__rodape">
          <BotaoDeEnvio className="btn btn--primary" pendente="Enviando…">
            Pedir o plano
          </BotaoDeEnvio>
          <Link className="btn" href={voltarPara}>
            Voltar
          </Link>
        </div>
      </div>
    </form>
  );
}
