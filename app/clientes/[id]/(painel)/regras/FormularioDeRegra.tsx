'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { alterarAcao, registrarAcao, type EstadoDoFormulario } from '@/../app/clientes/[id]/(painel)/regras/acoes';
import {
  EXPLICACAO_DA_FORCA,
  PLATAFORMAS_DE_ESCOPO,
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_FORCA,
  ROTULO_DA_NATUREZA,
  ROTULO_DA_UNIDADE,
  ROTULO_DO_PERIODO,
  ROTULO_DO_SENTIDO,
  escopoDaPlataforma,
  faixaLegivel,
  rotuloDoEscopo,
  valorDoCampo,
} from '@/modules/clients/domain/painel/regras';
import { CATEGORIAS, FORCAS, formatarValor, type Forca, type Natureza, type Periodo, type Sentido, type Unidade } from '@/modules/clients/domain/regras/index';

export type DefinicaoDoFormulario = {
  readonly key: string;
  readonly nome: string;
  readonly descricao: string;
  readonly categoria: 'investimento' | 'eficiencia';
  readonly unidade: Unidade;
  readonly periodo: Periodo;
  readonly sentido: Sentido;
  readonly faixaMin: string;
  readonly faixaMax: string;
  readonly tiposDeEscopo: readonly ('cliente' | 'plataforma')[];
};

export type ValoresIniciais = {
  readonly natureza?: Natureza;
  readonly definicao?: string;
  readonly categoria?: string;
  readonly escopo?: string;
  readonly valor?: string;
  readonly titulo?: string;
  readonly texto?: string;
  readonly contexto?: string;
  readonly forca?: Forca;
  readonly vigenciaFim?: string;
};

type Props = {
  readonly modo: 'registrar' | 'alterar';
  readonly clienteId: string;
  readonly voltarPara: string;
  readonly definicoes: readonly DefinicaoDoFormulario[];
  readonly podeLimite: boolean;
  readonly inicial: ValoresIniciais;
  readonly decisaoId?: string;
  readonly avisoDoVocabulario: string;
};

const ESTADO_INICIAL: EstadoDoFormulario = {};
const CATEGORIAS_DE_REGRA = CATEGORIAS.filter((c) => c !== 'processo');

function Campo({
  id,
  rotulo,
  erro,
  dica,
  children,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly erro?: string;
  readonly dica?: string;
  readonly children: ReactNode;
}) {
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

export function FormularioDeRegra({ modo, clienteId, voltarPara, definicoes, podeLimite, inicial, decisaoId, avisoDoVocabulario }: Props) {
  const base = useId();
  const [estado, enviar] = useActionState(modo === 'registrar' ? registrarAcao : alterarAcao, ESTADO_INICIAL);
  const resumo = useRef<HTMLDivElement>(null);
  const [natureza, setNatureza] = useState<Natureza>(inicial.natureza ?? (podeLimite ? 'limite' : 'regra'));
  const [definicaoKey, setDefinicaoKey] = useState(inicial.definicao ?? definicoes[0]?.key ?? '');
  const [valor, setValor] = useState(inicial.valor ?? '');
  const [escopo, setEscopo] = useState(inicial.escopo ?? 'cliente');
  const editando = modo === 'alterar';
  const definicao = definicoes.find((d) => d.key === definicaoKey) ?? null;
  const erros = estado.campos ?? {};
  const id = (campo: string) => `${base}-${campo}`;
  const ligacao = (campo: string, comDica: boolean) => ({
    id: id(campo),
    'aria-invalid': erros[campo] ? true : undefined,
    'aria-describedby': [comDica ? `${id(campo)}-dica` : null, erros[campo] ? `${id(campo)}-erro` : null].filter(Boolean).join(' ') || undefined,
  });

  useEffect(() => {
    if (estado.erro) resumo.current?.focus();
  }, [estado]);

  useEffect(() => {
    const campos = estado.campos ?? {};
    if (['contexto', 'emNomeDe', 'evidencia', 'vigenciaInicio', 'vigenciaFim'].some((campo) => campos[campo])) setRecolhidoAberto(true);
  }, [estado]);

  const lido = definicao ? valorDoCampo(definicao.unidade, valor) : null;
  const opcoesDeEscopo = definicao
    ? [
        ...(definicao.tiposDeEscopo.includes('cliente') ? ['cliente'] : []),
        ...(definicao.tiposDeEscopo.includes('plataforma') ? Object.keys(PLATAFORMAS_DE_ESCOPO).map(escopoDaPlataforma) : []),
      ]
    : ['cliente'];
  const escopoEfetivo = opcoesDeEscopo.includes(escopo) ? escopo : (opcoesDeEscopo[0] ?? 'cliente');
  const campoDeValor = natureza === 'limite' && (!editando || definicao !== null);
  const naturezaDisponivel: readonly Natureza[] = podeLimite ? ['limite', 'regra', 'decisao'] : ['regra', 'decisao'];
  const CAMPOS_RECOLHIDOS = ['contexto', 'emNomeDe', 'evidencia', 'vigenciaInicio', 'vigenciaFim'];
  const algumRecolhidoPreenchido = Boolean(inicial.contexto || inicial.vigenciaFim) || CAMPOS_RECOLHIDOS.some((campo) => erros[campo]);
  const [recolhidoAberto, setRecolhidoAberto] = useState(algumRecolhidoPreenchido);

  const campoDeValorJsx = campoDeValor ? (
    <Campo
      id={id('valor')}
      rotulo={editando ? 'Novo valor' : 'Valor'}
      erro={erros['valor']}
      dica={
        definicao
          ? definicao.unidade === 'brl_centavos'
            ? 'Em reais, com vírgula nos centavos. Exemplo: 10.000,00'
            : 'Use vírgula ou ponto para decimais.'
          : undefined
      }
    >
      <div className="regra-form__valor">
        {definicao?.unidade === 'brl_centavos' ? <span aria-hidden="true">R$</span> : null}
        <input
          className="input"
          name="valor"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          {...ligacao('valor', true)}
        />
        {definicao?.unidade === 'percentual' ? <span aria-hidden="true">%</span> : null}
        {definicao?.unidade === 'razao' ? <span aria-hidden="true">x</span> : null}
      </div>
      <span className="regra-form__previa" aria-live="polite">
        {valor.trim() === '' ? '' : lido ? `Será registrado como ${formatarValor(lido)}.` : 'Valor ainda não reconhecido.'}
      </span>
    </Campo>
  ) : null;

  const avisoDeDadoPessoal = (
    <p className="aviso regra-form__lgpd">
      <Icone nome="atencao" tamanho={14} /> Não escreva dado pessoal de terceiros (nome, CPF, telefone ou e-mail de pessoas). Registros não se apagam: a correção é uma nova decisão.
    </p>
  );

  return (
    <form className="regra-form card" action={enviar} noValidate aria-label={editando ? 'Alterar decisão' : 'Registrar limite, regra ou decisão'}>
      <div className="card__body">
        <div ref={resumo} tabIndex={-1} role={estado.erro ? 'alert' : undefined} className={estado.erro ? 'alert alert--error' : 'sr-only'}>
          {estado.erro ? (
            <span>
              <Icone nome="erro" tamanho={14} /> {estado.erro}
              {Object.values(erros).length > 0 ? (
                <ul>
                  {Object.entries(erros).map(([campo, mensagem]) => (
                    <li key={campo}>{mensagem}</li>
                  ))}
                </ul>
              ) : null}
            </span>
          ) : null}
        </div>

        <input type="hidden" name="clienteId" value={clienteId} />
        {decisaoId ? <input type="hidden" name="decisaoId" value={decisaoId} /> : null}

        {!editando ? (
          <fieldset className="regra-form__natureza" aria-describedby={erros['natureza'] ? id('natureza-erro') : undefined}>
            <legend className="field__label">O que você vai registrar</legend>
            <div className="opcoes-segmentadas">
              {naturezaDisponivel.map((n) => (
                <label key={n} className="opcoes-segmentadas__opcao">
                  <input type="radio" name="natureza" value={n} checked={natureza === n} onChange={() => setNatureza(n)} aria-invalid={erros['natureza'] ? true : undefined} />
                  <span>{ROTULO_DA_NATUREZA[n]}</span>
                </label>
              ))}
            </div>
            {erros['natureza'] ? (
              <span className="field__erro" id={id('natureza-erro')}>
                <Icone nome="erro" tamanho={14} /> {erros['natureza']}
              </span>
            ) : null}
            {!podeLimite ? <span className="field__hint">Limite só quem administra registra.</span> : null}
          </fieldset>
        ) : null}

        {natureza === 'limite' && !editando ? (
          <>
            <Campo id={id('definicao')} rotulo="Tipo de limite" erro={erros['definicao']}>
              <select className="select" name="definicao" value={definicaoKey} onChange={(e) => setDefinicaoKey(e.target.value)} {...ligacao('definicao', false)}>
                {definicoes.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.nome}
                  </option>
                ))}
              </select>
            </Campo>
            {definicao ? (
              <dl className="regra-form__definicao" aria-label="Sobre este tipo de limite">
                <div>
                  <dt>O que é</dt>
                  <dd>{definicao.descricao}</dd>
                </div>
                <div>
                  <dt>Unidade</dt>
                  <dd>{ROTULO_DA_UNIDADE[definicao.unidade]}</dd>
                </div>
                <div>
                  <dt>Período</dt>
                  <dd>
                    {ROTULO_DO_SENTIDO[definicao.sentido]} {ROTULO_DO_PERIODO[definicao.periodo]}
                  </dd>
                </div>
                <div>
                  <dt>Faixa permitida</dt>
                  <dd>{faixaLegivel(definicao, formatarValor) ?? 'Sem faixa'}</dd>
                </div>
              </dl>
            ) : (
              <p className="alert alert--warn">Nenhum tipo de limite disponível.</p>
            )}
            <div className="regra-form__linha">
              {campoDeValorJsx}
              <Campo id={id('escopo')} rotulo="Vale para" erro={erros['escopo']}>
                <select className="select" name="escopo" value={escopoEfetivo} onChange={(e) => setEscopo(e.target.value)} {...ligacao('escopo', false)}>
                  {opcoesDeEscopo.map((o) => (
                    <option key={o} value={o}>
                      {rotuloDoEscopo(o)}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
          </>
        ) : (
          campoDeValorJsx
        )}

        {natureza === 'regra' && !editando ? (
          <Campo id={id('categoria')} rotulo="Categoria" erro={erros['categoria']}>
            <select className="select" name="categoria" defaultValue={inicial.categoria ?? CATEGORIAS_DE_REGRA[0]} {...ligacao('categoria', false)}>
              {CATEGORIAS_DE_REGRA.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_DA_CATEGORIA[c]}
                </option>
              ))}
            </select>
          </Campo>
        ) : null}

        {natureza !== 'limite' || editando ? avisoDeDadoPessoal : null}

        {natureza !== 'limite' || editando ? (
          <Campo id={id('titulo')} rotulo="Título" erro={erros['titulo']} dica="Curto e específico. Em regra, o título identifica a regra.">
            <input className="input" name="titulo" type="text" maxLength={120} defaultValue={inicial.titulo ?? ''} {...ligacao('titulo', true)} />
          </Campo>
        ) : null}

        {natureza !== 'limite' ? (
          <Campo id={id('texto')} rotulo={natureza === 'regra' ? 'Regra' : 'Detalhe'} erro={erros['texto']}>
            <textarea className="input textarea" name="texto" maxLength={4000} defaultValue={inicial.texto ?? ''} {...ligacao('texto', false)} />
          </Campo>
        ) : null}

        {natureza !== 'decisao' ? (
          <Campo id={id('forca')} rotulo="Força" erro={erros['forca']} dica={`${EXPLICACAO_DA_FORCA.dura} ${EXPLICACAO_DA_FORCA.orientacao}`}>
            <select className="select" name="forca" defaultValue={inicial.forca ?? 'dura'} {...ligacao('forca', true)}>
              {FORCAS.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_DA_FORCA[f]}
                </option>
              ))}
            </select>
          </Campo>
        ) : null}

        {editando ? (
          <Campo id={id('motivo')} rotulo="Por que está mudando?" erro={erros['motivo']} dica="Obrigatório. Fica registrado junto da nova versão.">
            <textarea className="input textarea" name="motivo" required maxLength={500} {...ligacao('motivo', true)} />
          </Campo>
        ) : null}

        <details className="regra-form__opcionais" open={recolhidoAberto} onToggle={(e) => setRecolhidoAberto(e.currentTarget.open)}>
          <summary className="regra-form__opcionais-resumo">Detalhes opcionais</summary>
          <div className="regra-form__opcionais-corpo">
            {natureza === 'limite' && !editando ? avisoDeDadoPessoal : null}
            {!editando ? (
              <Campo id={id('contexto')} rotulo="Por quê" erro={erros['contexto']} dica="O contexto da decisão, para quem ler depois.">
                <textarea className="input textarea" name="contexto" maxLength={2000} defaultValue={inicial.contexto ?? ''} {...ligacao('contexto', true)} />
              </Campo>
            ) : null}
            <Campo id={id('evidencia')} rotulo="Evidência" erro={erros['evidencia']} dica={`Link ou texto curto. Limite sem evidência fica marcado: ${avisoDoVocabulario.toLowerCase()}.`}>
              <input className="input" name="evidencia" type="text" maxLength={500} autoComplete="off" {...ligacao('evidencia', true)} />
            </Campo>
            <Campo id={id('emNomeDe')} rotulo="Em nome de" erro={erros['emNomeDe']} dica="Quem decidiu fora da plataforma, quando não foi você.">
              <input className="input" name="emNomeDe" type="text" maxLength={120} autoComplete="off" {...ligacao('emNomeDe', true)} />
            </Campo>
            <div className="regra-form__linha">
              {!editando ? (
                <Campo id={id('vigenciaInicio')} rotulo="Vale a partir de" erro={erros['vigenciaInicio']}>
                  <input className="input" name="vigenciaInicio" type="date" {...ligacao('vigenciaInicio', false)} />
                </Campo>
              ) : null}
              <Campo id={id('vigenciaFim')} rotulo="Vale até" erro={erros['vigenciaFim']}>
                <input className="input" name="vigenciaFim" type="date" defaultValue={inicial.vigenciaFim ?? ''} {...ligacao('vigenciaFim', false)} />
              </Campo>
            </div>
          </div>
        </details>
      </div>
      <div className="card__foot regra-form__rodape">
        <BotaoDeEnvio className="btn btn--primary" pendente="Salvando…">
          {editando ? 'Salvar alteração' : 'Registrar'}
        </BotaoDeEnvio>
        <Link className="btn" href={voltarPara}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
