import Link from 'next/link';
import { Icone, type NomeDoIcone } from '@/../app/clientes/[id]/_componentes/Icones';
import { aceitarPropostaAcao, rejeitarPropostaAcao, revogarAcao } from '@/../app/clientes/[id]/(painel)/regras/acoes';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import type { DefinicaoDoBanco } from '@/modules/clients/infrastructure/regrasRepository';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import {
  EXPLICACAO_DA_FORCA,
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_FORCA,
  ROTULO_DA_NATUREZA,
  ROTULO_DO_PERIODO,
  ROTULO_DO_SENTIDO,
  ROTULO_DO_STATUS,
  VOLTAR_PARA_ATIVIDADE,
  dataCurta,
  fimInclusivo,
  podeRegistrarOuMexer,
  rotuloDaOrigem,
  rotuloDoEscopo,
} from '@/modules/clients/domain/painel/regras';
import { formatarValor, type Decisao, type Origem, type Status } from '@/modules/clients/domain/regras/index';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { Vocabulario } from '@/modules/organizations/domain/vocabulario';

const ICONE_DA_ORIGEM: Record<Origem, NomeDoIcone> = { cliente: 'cliente', agencia: 'pessoa', agente: 'agente' };
const ICONE_DO_STATUS: Record<Status, NomeDoIcone> = { proposta: 'atencao', vigente: 'ok', superada: 'pausada', revogada: 'nao', rejeitada: 'erro' };
const CLASSE_DO_STATUS: Record<Status, string> = { proposta: 'pill--warn', vigente: 'pill--ok', superada: '', revogada: '', rejeitada: 'pill--danger' };

export type ModoDoCartao = 'vigente' | 'linha' | 'proposta' | 'revisar' | 'historico';

type Props = {
  readonly clienteId: string;
  readonly decisao: Decisao;
  readonly definicao: DefinicaoDoBanco | null;
  readonly nomes: ReadonlyMap<string, string>;
  readonly vocabulario: Vocabulario;
  readonly papel: MemberRole;
  readonly modo: ModoDoCartao;
  readonly nivelDoTitulo?: 'h3' | 'h4';
};

export function CartaoDeRegra({ clienteId, decisao, definicao, nomes, vocabulario, papel, modo, nivelDoTitulo = 'h3' }: Props) {
  const Titulo = nivelDoTitulo;
  const idDoTitulo = `regra-${decisao.id}`;
  const pode = podeRegistrarOuMexer(papel, decisao.natureza);
  const quem =
    decisao.origem === 'agente'
      ? `Agente ${decisao.agentId ?? ''}`.trim()
      : decisao.decididoPor
        ? (nomes.get(decisao.decididoPor) ?? 'Membro da equipe')
        : null;
  const comHistorico = decisao.chave !== null;
  const acoesDeCiclo = modo === 'vigente' || modo === 'revisar' || (modo === 'linha' && decisao.status === 'vigente');
  const mostrarAlterar = acoesDeCiclo && pode && decisao.status === 'vigente' && comHistorico;
  const mostrarRevogar = acoesDeCiclo && pode && decisao.status === 'vigente';
  const mostrarProposta = (modo === 'proposta' || (modo === 'linha' && decisao.status === 'proposta')) && decisao.status === 'proposta' && pode;

  const vigencia = decisao.vigenciaFim
    ? `${dataCurta(decisao.vigenciaInicio)} a ${dataCurta(fimInclusivo(decisao.vigenciaFim))}`
    : `Desde ${dataCurta(decisao.vigenciaInicio)}`;
  const resumoDoValor = decisao.valor
    ? `${formatarValor(decisao.valor)}${decisao.chave ? ` · ${rotuloDoEscopo(decisao.escopo)}` : ''}`
    : ROTULO_DA_CATEGORIA[decisao.categoria];
  const podeConverter = modo === 'revisar' && papel !== 'viewer' && podeRegistrarOuMexer(papel, 'limite');
  const idDoMotivo = `motivo-${decisao.id}`;

  return (
    <article className={`regra regra--${decisao.status}`} aria-labelledby={idDoTitulo}>
      <details className="regra__detalhes" open={modo === 'historico'}>
        <summary className="regra__resumo">
          <span className="regra__numero">#{decisao.numero}</span>
          <Titulo id={idDoTitulo} className="regra__titulo">
            {decisao.titulo}
          </Titulo>
          <span className="regra__meta">
            <span className="regra__valor">{resumoDoValor}</span>
            <span className="pill" title={EXPLICACAO_DA_FORCA[decisao.forca]}>
              <Icone nome={decisao.forca === 'dura' ? 'bloqueia' : 'orienta'} tamanho={14} />
              {ROTULO_DA_FORCA[decisao.forca]}
            </span>
            {modo !== 'vigente' ? (
              <span className={`pill ${CLASSE_DO_STATUS[decisao.status]}`}>
                <Icone nome={ICONE_DO_STATUS[decisao.status]} tamanho={14} />
                {ROTULO_DO_STATUS[decisao.status]}
              </span>
            ) : null}
            <span className="regra__vigencia">{vigencia}</span>
          </span>
        </summary>

        <div className="regra__corpo">
          {decisao.valor && definicao ? (
            <p className="regra__porque">
              {ROTULO_DO_PERIODO[definicao.periodo]} · {ROTULO_DO_SENTIDO[definicao.sentido]}
            </p>
          ) : null}
          {decisao.texto ? <p className="regra__texto">{decisao.texto}</p> : null}
          {decisao.contexto ? (
            <p className="regra__porque">
              <span className="regra__rotulo">Por quê:</span> {decisao.contexto}
            </p>
          ) : null}
          {decisao.motivoDaRevogacao ? (
            <p className="regra__porque">
              <span className="regra__rotulo">Motivo da revogação:</span> {decisao.motivoDaRevogacao}
            </p>
          ) : null}

          <dl className="regra__fatos">
            <div>
              <dt>Tipo</dt>
              <dd>{ROTULO_DA_NATUREZA[decisao.natureza]}</dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{ROTULO_DA_CATEGORIA[decisao.categoria]}</dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd className="regra__origem">
                <Icone nome={ICONE_DA_ORIGEM[decisao.origem]} tamanho={14} />
                {rotuloDaOrigem(decisao.origem, vocabulario)}
              </dd>
            </div>
            <div>
              <dt>Desde</dt>
              <dd>
                <time dateTime={decisao.vigenciaInicio.toISOString()}>{dataCurta(decisao.vigenciaInicio)}</time>
              </dd>
            </div>
            {decisao.vigenciaFim ? (
              <div>
                <dt>Até</dt>
                <dd>
                  <time dateTime={fimInclusivo(decisao.vigenciaFim).toISOString()}>{dataCurta(fimInclusivo(decisao.vigenciaFim))}</time>
                </dd>
              </div>
            ) : null}
            {quem ? (
              <div>
                <dt>{decisao.origem === 'agente' ? 'Registrado por' : 'Decidido por'}</dt>
                <dd>{quem}</dd>
              </div>
            ) : null}
            {decisao.emNomeDe ? (
              <div>
                <dt>Em nome de</dt>
                <dd>{decisao.emNomeDe}</dd>
              </div>
            ) : null}
            {decisao.evidencia ? (
              <div>
                <dt>Evidência</dt>
                <dd>{decisao.evidencia}</dd>
              </div>
            ) : null}
            {decisao.revisarEConverterEmLimite ? (
              <div>
                <dt>Revisão</dt>
                <dd>Tem número: avaliar se vira limite</dd>
              </div>
            ) : null}
          </dl>

          <div className="regra__acoes">
            {comHistorico ? (
              <Link className="btn btn--compacto" href={rotaDoCliente(clienteId, 'regras', { secao: 'historico', chave: decisao.chave, escopo: decisao.escopo })}>
                Ver histórico
              </Link>
            ) : null}
            {mostrarAlterar ? (
              <Link className="btn btn--compacto" href={rotaDoCliente(clienteId, 'regras', { secao: 'alterar', id: decisao.id })}>
                Alterar
              </Link>
            ) : null}
            {mostrarRevogar ? (
              <ConfirmarAcao
                gatilho="Revogar"
                rotuloDoGatilho={`Revogar a decisão #${decisao.numero}`}
                titulo={`Revogar a decisão #${decisao.numero}?`}
                descricao="Revogar não apaga: o registro continua na linha do tempo."
                confirmar="Revogar"
                pendente="Revogando…"
                action={revogarAcao}
              >
                <input type="hidden" name="clienteId" value={clienteId} />
                <input type="hidden" name="decisaoId" value={decisao.id} />
                {modo === 'linha' ? <input type="hidden" name="voltar" value={VOLTAR_PARA_ATIVIDADE} /> : null}
                <label className="field" htmlFor={idDoMotivo}>
                  <span className="field__label">Motivo da revogação</span>
                  <textarea id={idDoMotivo} className="input textarea" name="motivo" required minLength={3} maxLength={500} />
                </label>
              </ConfirmarAcao>
            ) : null}
          </div>
        </div>
      </details>

      {decisao.semConfirmacaoDoAnunciante ? (
        <p className="aviso regra__aviso">
          <Icone nome="atencao" tamanho={14} /> {vocabulario.semConfirmacaoDoAnunciante}
        </p>
      ) : null}

      {mostrarProposta || podeConverter ? (
        <div className="regra__acoes regra__acoes--linha">
          {podeConverter ? (
            <Link className="btn btn--compacto btn--primary" href={rotaDoCliente(clienteId, 'regras', { secao: 'registrar', natureza: 'limite', origem: decisao.id })}>
              Converter em limite
            </Link>
          ) : null}
          {mostrarProposta ? (
            <>
              <form className={decisao.natureza === 'limite' ? 'regra__form' : 'regra__aceitar'} action={aceitarPropostaAcao}>
                <input type="hidden" name="clienteId" value={clienteId} />
                <input type="hidden" name="decisaoId" value={decisao.id} />
                {modo === 'linha' ? <input type="hidden" name="voltar" value={VOLTAR_PARA_ATIVIDADE} /> : null}
                {decisao.natureza === 'limite' ? (
                  <label className="field">
                    <span className="field__label">Motivo da aceitação (opcional)</span>
                    <textarea className="input textarea" name="motivo" maxLength={500} />
                    <span className="field__hint">Obrigatório quando a proposta afrouxa o limite vigente sem evidência.</span>
                  </label>
                ) : null}
                <BotaoDeEnvio className="btn btn--compacto btn--primary" pendente="Aceitando…">
                  Aceitar
                </BotaoDeEnvio>
              </form>
              <ConfirmarAcao
                gatilho="Rejeitar"
                rotuloDoGatilho={`Rejeitar a proposta #${decisao.numero}`}
                titulo={`Rejeitar a proposta #${decisao.numero}?`}
                descricao="A proposta deixa de esperar decisão; o registro continua na linha do tempo."
                confirmar="Rejeitar"
                pendente="Rejeitando…"
                action={rejeitarPropostaAcao}
              >
                <input type="hidden" name="clienteId" value={clienteId} />
                <input type="hidden" name="decisaoId" value={decisao.id} />
                {modo === 'linha' ? <input type="hidden" name="voltar" value={VOLTAR_PARA_ATIVIDADE} /> : null}
                <label className="field" htmlFor={idDoMotivo}>
                  <span className="field__label">Motivo da rejeição</span>
                  <textarea id={idDoMotivo} className="input textarea" name="motivo" required minLength={3} maxLength={500} />
                </label>
              </ConfirmarAcao>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
