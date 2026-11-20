import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupe,
  formatGoogleCustomerId,
  parseAccessibleCustomers,
  parseGbpAccounts,
  parseGbpLocations,
  urlDosLocaisDoGbp,
  parseGa4Properties,
  parseGoogleCustomerClients,
  parseGtmAccountIds,
  parseGtmContainers,
  parseMetaAdAccounts,
  parseSearchConsoleSites,
  parseYoutubeChannels,
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

describe('parseGa4Properties', () => {
  it('extrai as propriedades de dentro de cada conta', () => {
    const propriedades = parseGa4Properties({
      accountSummaries: [
        {
          propertySummaries: [
            { property: 'properties/111', displayName: 'Site A' },
            { property: 'properties/222', displayName: 'Site B' },
          ],
        },
      ],
    });
    assert.deepEqual(
      propriedades.map((p) => [p.externalId, p.name]),
      [
        ['111', 'Site A'],
        ['222', 'Site B'],
      ],
    );
  });

  it('payload vazio ou fora do formato devolve lista vazia', () => {
    assert.deepEqual(parseGa4Properties({}), []);
    assert.deepEqual(parseGa4Properties(null), []);
  });
});

describe('parseGtmAccountIds e parseGtmContainers', () => {
  it('lista os ids de conta', () => {
    assert.deepEqual(parseGtmAccountIds({ account: [{ accountId: '1' }, { accountId: '2' }] }), [
      '1',
      '2',
    ]);
  });

  it('prefere o publicId (GTM-XXXX) como identificador do contêiner', () => {
    const containers = parseGtmContainers({
      container: [{ containerId: '999', publicId: 'GTM-ABC123', name: 'Site principal' }],
    });
    assert.deepEqual(containers[0]?.externalId, 'GTM-ABC123');
  });

  it('cai para o containerId quando não há publicId', () => {
    const containers = parseGtmContainers({ container: [{ containerId: '999', name: 'Sem publicId' }] });
    assert.deepEqual(containers[0]?.externalId, '999');
  });
});

describe('parseSearchConsoleSites', () => {
  it('marca como inativo o site com acesso ainda não verificado', () => {
    const sites = parseSearchConsoleSites({
      siteEntry: [
        { siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://b.com/', permissionLevel: 'siteUnverifiedUser' },
      ],
    });
    assert.deepEqual(
      sites.map((s) => [s.externalId, s.inactive]),
      [
        ['https://a.com/', false],
        ['https://b.com/', true],
      ],
    );
  });
});

describe('parseYoutubeChannels', () => {
  it('usa o título do snippet como nome', () => {
    const canais = parseYoutubeChannels({
      items: [{ id: 'UC123', snippet: { title: 'Meu Canal' } }],
    });
    assert.deepEqual(canais, [
      {
        platform: 'youtube',
        externalId: 'UC123',
        name: 'Meu Canal',
        currency: '',
        timezone: '',
        managerExternalId: null,
        spendingLast30Days: null,
        inactive: false,
      },
    ]);
  });
});

describe('parseGbpAccounts e parseGbpLocations', () => {
  it('pede o name de cada local, sem o qual o parser não reconhece nenhum', () => {
    const url = new URL(urlDosLocaisDoGbp('109942550426920194824'));
    assert.equal(url.pathname, '/v1/accounts/109942550426920194824/locations');
    assert.deepEqual(url.searchParams.get('readMask')?.split(','), ['name', 'title']);
  });

  it('extrai o id numérico do nome da conta', () => {
    assert.deepEqual(parseGbpAccounts({ accounts: [{ name: 'accounts/555' }] }), ['555']);
  });

  it('extrai o id numérico do nome do local, usando o title como nome', () => {
    const locais = parseGbpLocations({ locations: [{ name: 'locations/777', title: 'Loja Centro' }] });
    assert.deepEqual(
      locais.map((l) => [l.externalId, l.name]),
      [['777', 'Loja Centro']],
    );
  });

  it('ignora entradas sem o prefixo esperado', () => {
    assert.deepEqual(parseGbpAccounts({ accounts: [{ name: 'algo-estranho' }] }), []);
    assert.deepEqual(parseGbpLocations({ locations: [{ name: 'algo-estranho' }] }), []);
  });
});
