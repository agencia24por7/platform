import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIM_DOS_TEMPOS,
  INICIO_DOS_TEMPOS,
  STATUS_DE_CLIENTE_EXCLUIDO,
  chaveDaFonte,
  hashDaFonte,
  hashDoCliente,
  planejarClientes,
  planejarFontes,
  reconstruirPosse,
  statusDoClienteNaDimensao,
  type EstadoDaFonte,
  type EstadoDoCliente,
  type MudancaDePosse,
  type VersaoExistente,
} from './dimensoes.ts';

const agora = new Date('2026-11-20T12:00:00.000Z');

const fonte = (sobrescrever: Partial<EstadoDaFonte> = {}): EstadoDaFonte => ({
  organizationId: 'org-1',
  platform: 'meta',
  externalId: 'act_1',
  origem: 'ad_account',
  clientId: 'cli-a',
  status: 'linked',
  nome: 'Conta 1',
  ...sobrescrever,
});

const existente = (estado: EstadoDaFonte, abertas = 1): VersaoExistente => ({
  chave: chaveDaFonte(estado),
  abertas,
  hashAberta: abertas > 0 ? hashDaFonte(estado) : null,
});

const mudanca = (em: string, antes: MudancaDePosse['antes']): MudancaDePosse => ({
  organizationId: 'org-1',
  platform: 'meta',
  externalId: 'act_1',
  em: new Date(em),
  antes,
});

describe('planejarFontes', () => {
  it('chave nova sem histórico vira uma versão atual desde o início dos tempos', () => {
    const plano = planejarFontes([fonte()], [], [], agora);
    assert.equal(plano.fechar.length, 0);
    assert.equal(plano.inserir.length, 1);
    const [versao] = plano.inserir;
    assert.equal(versao!.validoDe.getTime(), INICIO_DOS_TEMPOS.getTime());
    assert.equal(versao!.validoAte.getTime(), FIM_DOS_TEMPOS.getTime());
    assert.equal(versao!.atual, true);
    assert.equal(versao!.atributos.clientId, 'cli-a');
    assert.equal(plano.resumo.novas, 1);
  });

  it('chave sem mudança não gera operação', () => {
    const plano = planejarFontes([fonte()], [existente(fonte())], [], agora);
    assert.deepEqual(plano.fechar, []);
    assert.deepEqual(plano.inserir, []);
    assert.equal(plano.resumo.inalteradas, 1);
  });

  it('troca de cliente fecha a versão aberta e abre outra a partir de agora', () => {
    const plano = planejarFontes([fonte({ clientId: 'cli-b' })], [existente(fonte())], [], agora);
    assert.deepEqual(plano.fechar, ['org-1|meta|act_1']);
    assert.equal(plano.inserir.length, 1);
    assert.equal(plano.inserir[0]!.atributos.clientId, 'cli-b');
    assert.equal(plano.inserir[0]!.validoDe.getTime(), agora.getTime());
    assert.equal(plano.inserir[0]!.atual, true);
    assert.equal(plano.resumo.alteradas, 1);
  });

  it('desvincular gera versão sem cliente', () => {
    const solta = fonte({ clientId: null, status: 'unlinked' });
    const plano = planejarFontes([solta], [existente(fonte())], [], agora);
    assert.deepEqual(plano.fechar, ['org-1|meta|act_1']);
    assert.equal(plano.inserir[0]!.atributos.clientId, null);
    assert.equal(plano.inserir[0]!.atributos.status, 'unlinked');
  });

  it('chave que sumiu do Postgres só tem a versão aberta encerrada', () => {
    const plano = planejarFontes([], [existente(fonte())], [], agora);
    assert.deepEqual(plano.fechar, ['org-1|meta|act_1']);
    assert.deepEqual(plano.inserir, []);
    assert.equal(plano.resumo.encerradas, 1);
  });

  it('chave que reapareceu ganha versão nova a partir de agora, sem fechar nada', () => {
    const plano = planejarFontes([fonte()], [existente(fonte(), 0)], [], agora);
    assert.deepEqual(plano.fechar, []);
    assert.equal(plano.inserir.length, 1);
    assert.equal(plano.inserir[0]!.validoDe.getTime(), agora.getTime());
    assert.equal(plano.resumo.reabertas, 1);
  });

  it('chave já encerrada que continua ausente não gera operação', () => {
    const plano = planejarFontes([], [existente(fonte(), 0)], [], agora);
    assert.deepEqual(plano.fechar, []);
    assert.equal(plano.resumo.encerradas, 0);
  });

  it('duas versões abertas para a mesma chave são consertadas fechando e reabrindo', () => {
    const plano = planejarFontes([fonte()], [existente(fonte(), 2)], [], agora);
    assert.deepEqual(plano.fechar, ['org-1|meta|act_1']);
    assert.equal(plano.inserir.length, 1);
  });

  it('chave repetida no estado atual vale pela primeira ocorrência', () => {
    const plano = planejarFontes([fonte(), fonte({ clientId: 'cli-z' })], [], [], agora);
    assert.equal(plano.inserir.length, 1);
    assert.equal(plano.inserir[0]!.atributos.clientId, 'cli-a');
  });

  it('chave nova usa o histórico da auditoria quando há mudanças de posse', () => {
    const solta = fonte({ clientId: null, status: 'unlinked' });
    const plano = planejarFontes([solta], [], [mudanca('2026-11-10T15:00:00.000Z', { clientId: 'cli-a', status: 'linked' })], agora);
    assert.equal(plano.inserir.length, 2);
    const [antiga, atual] = plano.inserir;
    assert.equal(antiga!.atributos.clientId, 'cli-a');
    assert.equal(antiga!.validoDe.getTime(), INICIO_DOS_TEMPOS.getTime());
    assert.equal(antiga!.validoAte.toISOString(), '2026-11-10T15:00:00.000Z');
    assert.equal(antiga!.atual, false);
    assert.equal(atual!.atributos.clientId, null);
    assert.equal(atual!.validoDe.toISOString(), '2026-11-10T15:00:00.000Z');
    assert.equal(atual!.atual, true);
    assert.notEqual(antiga!.sk, atual!.sk);
  });

  it('o sk é determinístico para a mesma chave e início', () => {
    const a = planejarFontes([fonte()], [], [], agora);
    const b = planejarFontes([fonte()], [], [], new Date('2027-01-01T00:00:00.000Z'));
    assert.equal(a.inserir[0]!.sk, b.inserir[0]!.sk);
  });
});

describe('reconstruirPosse', () => {
  it('encadeia mover e desvincular na ordem do tempo', () => {
    const segmentos = reconstruirPosse(
      fonte({ clientId: null, status: 'unlinked' }),
      [
        mudanca('2026-11-15T00:00:00.000Z', { clientId: 'cli-b', status: 'linked' }),
        mudanca('2026-10-01T00:00:00.000Z', { clientId: 'cli-a', status: 'linked' }),
      ],
      agora,
    );
    assert.deepEqual(
      segmentos.map((s) => [s.validoDe.toISOString(), s.atributos.clientId]),
      [
        [INICIO_DOS_TEMPOS.toISOString(), 'cli-a'],
        ['2026-10-01T00:00:00.000Z', 'cli-b'],
        ['2026-11-15T00:00:00.000Z', null],
      ],
    );
  });

  it('para no evento cujo dono anterior é desconhecido e estende o período seguinte ao início', () => {
    const segmentos = reconstruirPosse(
      fonte({ clientId: 'cli-c' }),
      [mudanca('2026-09-01T00:00:00.000Z', null), mudanca('2026-10-01T00:00:00.000Z', { clientId: 'cli-b', status: 'linked' })],
      agora,
    );
    assert.deepEqual(
      segmentos.map((s) => [s.validoDe.toISOString(), s.atributos.clientId]),
      [
        [INICIO_DOS_TEMPOS.toISOString(), 'cli-b'],
        ['2026-10-01T00:00:00.000Z', 'cli-c'],
      ],
    );
  });

  it('período inicial sem dono é absorvido pelo primeiro dono, para o backfill não ficar órfão', () => {
    const segmentos = reconstruirPosse(
      fonte({ origem: 'connection_account', platform: 'ga4' }),
      [mudanca('2026-11-01T00:00:00.000Z', { clientId: null, status: 'discovered' })],
      agora,
    );
    assert.equal(segmentos.length, 1);
    assert.equal(segmentos[0]!.validoDe.getTime(), INICIO_DOS_TEMPOS.getTime());
    assert.equal(segmentos[0]!.atributos.clientId, 'cli-a');
  });

  it('mudanças que não mudam o dono não criam versões', () => {
    const segmentos = reconstruirPosse(fonte(), [mudanca('2026-11-01T00:00:00.000Z', { clientId: 'cli-a', status: 'linked' })], agora);
    assert.equal(segmentos.length, 1);
  });

  it('ignora mudança no futuro', () => {
    const segmentos = reconstruirPosse(fonte(), [mudanca('2027-01-01T00:00:00.000Z', { clientId: 'cli-b', status: 'linked' })], agora);
    assert.equal(segmentos.length, 1);
    assert.equal(segmentos[0]!.atributos.clientId, 'cli-a');
  });
});

describe('planejarClientes', () => {
  const cliente = (sobrescrever: Partial<EstadoDoCliente> = {}): EstadoDoCliente => ({
    organizationId: 'org-1',
    clientId: 'cli-a',
    nome: 'Cliente A',
    status: 'active',
    parentClientId: null,
    businessModel: 'leads',
    ...sobrescrever,
  });

  it('renomear cliente abre versão nova; cliente expurgado do Postgres é encerrado', () => {
    const plano = planejarClientes(
      [cliente({ nome: 'Cliente A Ltda' })],
      [
        { chave: 'org-1|cli-a', abertas: 1, hashAberta: hashDoCliente(cliente()) },
        { chave: 'org-1|cli-x', abertas: 1, hashAberta: 'qualquer' },
      ],
      agora,
    );
    assert.deepEqual([...plano.fechar].sort(), ['org-1|cli-a', 'org-1|cli-x']);
    assert.equal(plano.inserir.length, 1);
    assert.equal(plano.inserir[0]!.atributos.nome, 'Cliente A Ltda');
    assert.equal(plano.resumo.alteradas, 1);
    assert.equal(plano.resumo.encerradas, 1);
  });

  it('exclusão lógica vira versão nova com status excluido, sem encerrar a chave', () => {
    const excluido = cliente({ status: statusDoClienteNaDimensao('archived', new Date('2026-11-19T10:00:00.000Z')) });
    const plano = planejarClientes([excluido], [{ chave: 'org-1|cli-a', abertas: 1, hashAberta: hashDoCliente(cliente()) }], agora);
    assert.deepEqual(plano.fechar, ['org-1|cli-a']);
    assert.equal(plano.inserir.length, 1);
    assert.equal(plano.inserir[0]!.atributos.status, STATUS_DE_CLIENTE_EXCLUIDO);
    assert.equal(plano.inserir[0]!.atual, true);
    assert.equal(plano.inserir[0]!.validoDe.getTime(), agora.getTime());
    assert.equal(plano.resumo.encerradas, 0);
  });

  it('restaurar devolve o status do Postgres e abre outra versão', () => {
    assert.equal(statusDoClienteNaDimensao('paused', null), 'paused');
    const plano = planejarClientes(
      [cliente({ status: 'paused' })],
      [{ chave: 'org-1|cli-a', abertas: 1, hashAberta: hashDoCliente(cliente({ status: STATUS_DE_CLIENTE_EXCLUIDO })) }],
      agora,
    );
    assert.equal(plano.inserir[0]!.atributos.status, 'paused');
    assert.equal(plano.resumo.alteradas, 1);
  });

  it('cliente novo começa no início dos tempos', () => {
    const plano = planejarClientes([cliente()], [], agora);
    assert.equal(plano.inserir[0]!.validoDe.getTime(), INICIO_DOS_TEMPOS.getTime());
  });
});
