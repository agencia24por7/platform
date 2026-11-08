import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupe,
  formatGoogleCustomerId,
  parseAccessibleCustomers,
  parseGoogleCustomerClients,
  parseMetaAdAccounts,
  sortForSelection,
} from './discovery.ts';

describe('parseAccessibleCustomers', () => {
  it('extrai os ids do formato resourceNames', () => {
    assert.deepEqual(
      parseAccessibleCustomers({ resourceNames: ['customers/1234567890', 'customers/9876543210'] }),
      ['1234567890', '9876543210'],
    );
  });

  it('ignora entradas fora do formato', () => {
    assert.deepEqual(
      parseAccessibleCustomers({ resourceNames: ['lixo', 'customers/abc', 'customers/12'] }),
      [],
    );
  });

  it('não quebra com resposta vazia ou inesperada', () => {
    assert.deepEqual(parseAccessibleCustomers({}), []);
    assert.deepEqual(parseAccessibleCustomers(null), []);
    assert.deepEqual(parseAccessibleCustomers('texto'), []);
  });
});

describe('formatGoogleCustomerId', () => {
  it('formata dez dígitos', () => {
    assert.equal(formatGoogleCustomerId('1234567890'), '123-456-7890');
    assert.equal(formatGoogleCustomerId('123-456-7890'), '123-456-7890');
  });
});

describe('parseGoogleCustomerClients', () => {
  const payload = {
    results: [
      {
        customerClient: {
          id: '1234567890',
          descriptiveName: 'Cliente Um',
          currencyCode: 'BRL',
          timeZone: 'America/Sao_Paulo',
          manager: false,
          status: 'ENABLED',
        },
      },
      { customerClient: { id: '5555555555', descriptiveName: 'Administradora', manager: true } },
      { customerClient: { id: '2222222222', status: 'CANCELED' } },
    ],
  };

  it('descarta contas administradoras', () => {
    const accounts = parseGoogleCustomerClients(payload, '9999999999');
    assert.ok(!accounts.some((account) => account.name === 'Administradora'));
  });

  it('marca conta não habilitada como inativa', () => {
    const accounts = parseGoogleCustomerClients(payload, null);
    const cancelled = accounts.find((account) => account.externalId === '222-222-2222');
    assert.equal(cancelled?.inactive, true);
  });

  it('guarda a administradora de origem formatada', () => {
    const accounts = parseGoogleCustomerClients(payload, '9999999999');
    assert.equal(accounts[0]?.managerExternalId, '999-999-9999');
  });

  it('usa o id como nome quando não há nome', () => {
    const accounts = parseGoogleCustomerClients(payload, null);
    assert.equal(accounts.find((a) => a.externalId === '222-222-2222')?.name, '222-222-2222');
  });
});

describe('parseMetaAdAccounts', () => {
  const payload = {
    data: [
      {
        id: 'act_1234567890',
        name: 'Conta Principal',
        currency: 'BRL',
        timezone_name: 'America/Sao_Paulo',
        account_status: 1,
        amount_spent: '125000',
        business: { id: '1094887233' },
      },
      { account_id: '9988776655', name: 'Sem prefixo', account_status: 2 },
    ],
  };

  it('normaliza o prefixo act_', () => {
    const accounts = parseMetaAdAccounts(payload);
    assert.equal(accounts[1]?.externalId, 'act_9988776655');
  });

  it('converte o gasto de centavos', () => {
    assert.equal(parseMetaAdAccounts(payload)[0]?.spendingLast30Days, 1250);
  });

  it('marca conta com status diferente de ativo', () => {
    assert.equal(parseMetaAdAccounts(payload)[1]?.inactive, true);
  });

  it('guarda o Business Manager de origem', () => {
    assert.equal(parseMetaAdAccounts(payload)[0]?.managerExternalId, '1094887233');
  });

  it('não quebra com resposta vazia', () => {
    assert.deepEqual(parseMetaAdAccounts({ data: [] }), []);
    assert.deepEqual(parseMetaAdAccounts(null), []);
  });
});

describe('dedupe e ordenação', () => {
  const base = {
    platform: 'meta' as const,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    managerExternalId: null,
    spendingLast30Days: null,
  };

  it('remove duplicadas pela chave plataforma + id', () => {
    const accounts = dedupe([
      { ...base, externalId: 'act_1', name: 'A', inactive: false },
      { ...base, externalId: 'act_1', name: 'A duplicada', inactive: false },
      { ...base, externalId: 'act_2', name: 'B', inactive: false },
    ]);
    assert.equal(accounts.length, 2);
  });

  it('põe inativas no fim e ordena por nome', () => {
    const accounts = sortForSelection([
      { ...base, externalId: 'act_1', name: 'Zebra', inactive: false },
      { ...base, externalId: 'act_2', name: 'Alfa', inactive: true },
      { ...base, externalId: 'act_3', name: 'Beta', inactive: false },
    ]);
    assert.deepEqual(accounts.map((account) => account.name), ['Beta', 'Zebra', 'Alfa']);
  });
});
