import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { Platform } from '@/modules/connections/domain/connection';
import type { Alvo } from '@/modules/tokens/domain/token';
import type {
  FabricaDeProvedores,
  FalhaDoProvedor,
  Gravar,
  ProvedorDeToken,
  Registro,
  RegistroDeToken,
  Renovacao,
  RepositorioDeTokens,
} from '@/modules/tokens/application/portas';
import type { Result } from '@/shared/result/result';

const { createCofreDeTokens } = await import('./cofreDeTokens.ts');
const { createCifraEnvelope } = await import('@/modules/tokens/infrastructure/envelope.ts');
const { createChaveMestraLocal } = await import('@/modules/tokens/infrastructure/chavesMestras.ts');

const DIA = 86_400_000;
const AGORA = new Date('2026-11-20T12:00:00Z');
const REFRESH = '1//refresh-token-do-google-super-secreto';
const ACESSO = 'ya29.acesso-curto-do-google-super-secreto';
const TOKEN_META = 'EAAGtoken-longo-da-meta-super-secreto';

type Linha = {
  organizationId: string;
  platform: Platform;
  registro: RegistroDeToken | null;
};

function criarRepositorio(conexoes: Record<string, { organizationId: string; platform: Platform }>) {
  const linhas = new Map<string, Linha>();
  for (const [id, conexao] of Object.entries(conexoes)) linhas.set(id, { ...conexao, registro: null });
  const filas = new Map<string, Promise<unknown>>();

  const repositorio: RepositorioDeTokens = {
    async plataformaDa(alvo) {
      const linha = linhas.get(alvo.connectionId);
      return linha && linha.organizationId === alvo.organizationId ? linha.platform : null;
    },
    async carregar(alvo) {
      const linha = linhas.get(alvo.connectionId);
      return linha && linha.organizationId === alvo.organizationId ? linha.registro : null;
    },
    async guardar(alvo, novo) {
      const linha = linhas.get(alvo.connectionId)!;
      linha.registro = {
        connectionId: alvo.connectionId,
        organizationId: alvo.organizationId,
        platform: linha.platform,
        tipo: novo.tipo,
        segredo: novo.cifrado.bytes,
        segredoExpiraEm: novo.expiraEm,
        acesso: null,
        acessoExpiraEm: null,
        renovadoEm: null,
        versao: (linha.registro?.versao ?? 0) + 1,
      };
    },
    comTrava(alvo, trabalho) {
      const anterior = filas.get(alvo.connectionId) ?? Promise.resolve();
      const atual = anterior.then(async () => {
        const linha = linhas.get(alvo.connectionId);
        const registro = linha?.registro ?? null;
        const gravar: Gravar = async (mudanca) => {
          if (!linha?.registro || linha.registro.versao !== registro?.versao) return false;
          linha.registro = {
            ...linha.registro,
            ...(mudanca.acesso ? { acesso: mudanca.acesso.cifrado.bytes, acessoExpiraEm: mudanca.acesso.expiraEm } : {}),
            ...(mudanca.segredo ? { segredo: mudanca.segredo.cifrado.bytes, segredoExpiraEm: mudanca.segredo.expiraEm } : {}),
            ...(mudanca.renovadoEm ? { renovadoEm: mudanca.renovadoEm } : {}),
            versao: linha.registro.versao + 1,
          };
          falhas.push(mudanca.falha ?? null);
          return true;
        };
        return trabalho(registro, gravar);
      });
      filas.set(alvo.connectionId, atual.catch(() => undefined));
      return atual;
    },
    async apagar(alvo) {
      const linha = linhas.get(alvo.connectionId);
      const existia = Boolean(linha?.registro);
      if (linha) linha.registro = null;
      return existia;
    },
    async aRenovar(antes) {
      return [...linhas.entries()]
        .filter(([, linha]) => linha.registro?.tipo === 'oauth_long_lived' && linha.registro.segredoExpiraEm! < antes)
        .map(([connectionId, linha]) => ({ connectionId, organizationId: linha.organizationId }));
    },
  };
  const falhas: (string | null)[] = [];
  return { repositorio, linhas, falhas };
}

type Roteiro = (segredo: string) => Promise<Result<Renovacao, FalhaDoProvedor>>;

function criarProvedor(roteiro: Roteiro) {
  const chamadas: string[] = [];
  const revogados: string[] = [];
  let revogacaoFalha = false;
  const provedor: ProvedorDeToken = {
    async renovar(segredo) {
      chamadas.push(segredo);
      return roteiro(segredo);
    },
    async revogar(segredo) {
      revogados.push(segredo);
      return revogacaoFalha ? { ok: false, error: { natureza: 'transitoria', codigo: 'http_503' } } : { ok: true, value: 'revogado' };
    },
  };
  return {
    provedor,
    chamadas,
    revogados,
    falharRevogacao() {
      revogacaoFalha = true;
    },
  };
}

function criarRegistro() {
  const linhas: string[] = [];
  const anotar = (mensagem: string, contexto: Record<string, unknown>) => linhas.push(JSON.stringify({ mensagem, contexto }));
  const registro: Registro = { info: anotar, aviso: anotar, erro: anotar };
  return { registro, linhas };
}

const ORG = 'org-1';
const GOOGLE: Alvo = { organizationId: ORG, connectionId: 'conexao-google' };
const META: Alvo = { organizationId: ORG, connectionId: 'conexao-meta' };
const APIFY: Alvo = { organizationId: ORG, connectionId: 'conexao-apify' };
const OUTRA: Alvo = { organizationId: ORG, connectionId: 'conexao-outra' };

function montar(opcoes: { roteiro?: Roteiro; agora?: () => Date } = {}) {
  const { repositorio, linhas, falhas } = criarRepositorio({
    [GOOGLE.connectionId]: { organizationId: ORG, platform: 'google' },
    [META.connectionId]: { organizationId: ORG, platform: 'meta' },
    [APIFY.connectionId]: { organizationId: ORG, platform: 'apify' },
    [OUTRA.connectionId]: { organizationId: ORG, platform: 'google' },
  });
  const google = criarProvedor(opcoes.roteiro ?? (async () => ({ ok: true, value: { accessToken: ACESSO, expiraEm: new Date(AGORA.getTime() + 3_600_000) } })));
  const meta = criarProvedor(async () => ({
    ok: true,
    value: { accessToken: `${TOKEN_META}-novo`, expiraEm: new Date(AGORA.getTime() + 60 * DIA), novoSegredo: `${TOKEN_META}-novo`, segredoExpiraEm: new Date(AGORA.getTime() + 60 * DIA) },
  }));
  const provedores: FabricaDeProvedores = (platform, tipo) => {
    if (tipo === 'oauth_refresh') return google.provedor;
    if (tipo === 'oauth_long_lived') return meta.provedor;
    return { renovar: async (s) => ({ ok: true, value: { accessToken: s, expiraEm: null } }), revogar: async () => ({ ok: true, value: 'sem_suporte' }) };
  };
  const marcadas: { alvo: Alvo; motivo: string }[] = [];
  const { registro, linhas: logs } = criarRegistro();
  const cifra = createCifraEnvelope(createChaveMestraLocal('s'.repeat(40)));
  const relogio = opcoes.agora ?? (() => AGORA);
  const novoCofre = () =>
    createCofreDeTokens({
      repositorio,
      cifra,
      provedores,
      marcador: { marcar: async (alvo, motivo) => void marcadas.push({ alvo, motivo }) },
      registro,
      relogio,
    });
  return { cofre: novoCofre(), novoCofre, linhas, falhas, google, meta, marcadas, logs };
}

describe('CofreDeTokens — Google (refresh token)', () => {
  it('renova uma vez, devolve bearer e guarda o access token só cifrado', async () => {
    const t = montar();
    assert.ok((await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH })).ok);

    const acesso = await t.cofre.obterAcesso(GOOGLE);
    assert.ok(acesso.ok);
    assert.equal(acesso.value.token, ACESSO);
    assert.equal(acesso.value.tipo, 'bearer');
    assert.deepEqual(t.google.chamadas, [REFRESH]);

    const registro = t.linhas.get(GOOGLE.connectionId)!.registro!;
    assert.ok(registro.acesso);
    assert.ok(!registro.acesso.toString('latin1').includes(ACESSO));
    assert.ok(!registro.segredo.toString('latin1').includes(REFRESH));
  });

  it('usa o cache em memória e, depois de reiniciar, o access token cifrado do banco', async () => {
    const t = montar();
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    await t.cofre.obterAcesso(GOOGLE);
    await t.cofre.obterAcesso(GOOGLE);
    const reiniciado = await t.novoCofre().obterAcesso(GOOGLE);
    assert.ok(reiniciado.ok);
    assert.equal(reiniciado.value.token, ACESSO);
    assert.equal(t.google.chamadas.length, 1);
  });

  it('renova de novo quando o access token entra na margem de 5 minutos', async () => {
    let agora = AGORA;
    const t = montar({ agora: () => agora });
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    await t.cofre.obterAcesso(GOOGLE);
    agora = new Date(AGORA.getTime() + 56 * 60_000);
    await t.cofre.obterAcesso(GOOGLE);
    assert.equal(t.google.chamadas.length, 2);
  });

  it('chamadas paralelas resultam em uma única renovação (no processo e entre processos)', async () => {
    const t = montar({
      roteiro: async () => {
        await new Promise((resolver) => setTimeout(resolver, 20));
        return { ok: true, value: { accessToken: ACESSO, expiraEm: new Date(AGORA.getTime() + 3_600_000) } };
      },
    });
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    const outroProcesso = t.novoCofre();
    const resultados = await Promise.all([
      ...Array.from({ length: 10 }, () => t.cofre.obterAcesso(GOOGLE)),
      ...Array.from({ length: 10 }, () => outroProcesso.obterAcesso(GOOGLE)),
    ]);
    assert.ok(resultados.every((r) => r.ok && r.value.token === ACESSO));
    assert.equal(t.google.chamadas.length, 1);
  });

  it('invalid_grant marca reauth_pending e registra a falha', async () => {
    const t = montar({ roteiro: async () => ({ ok: false, error: { natureza: 'reautorizar', codigo: 'invalid_grant' } }) });
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    const acesso = await t.cofre.obterAcesso(GOOGLE);
    assert.deepEqual(acesso, { ok: false, error: 'reautorizar' });
    assert.deepEqual(t.marcadas, [{ alvo: GOOGLE, motivo: 'invalid_grant' }]);
    assert.deepEqual(t.falhas, ['invalid_grant']);
  });

  it('falha transitória não marca reautorização', async () => {
    const t = montar({ roteiro: async () => ({ ok: false, error: { natureza: 'transitoria', codigo: 'http_503' } }) });
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    assert.deepEqual(await t.cofre.obterAcesso(GOOGLE), { ok: false, error: 'indisponivel' });
    assert.equal(t.marcadas.length, 0);
  });

  it('conexão sem linha no cofre devolve sem_token', async () => {
    const t = montar();
    assert.deepEqual(await t.cofre.obterAcesso(GOOGLE), { ok: false, error: 'sem_token' });
  });
});

describe('CofreDeTokens — AAD', () => {
  it('recusa ciphertext copiado de outra conexão', async () => {
    const t = montar();
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    await t.cofre.guardar(OUTRA, { tipo: 'oauth_refresh', segredo: 'outro-refresh' });
    const linhaOutra = t.linhas.get(OUTRA.connectionId)!;
    linhaOutra.registro = { ...linhaOutra.registro!, segredo: t.linhas.get(GOOGLE.connectionId)!.registro!.segredo };

    assert.deepEqual(await t.novoCofre().obterAcesso(OUTRA), { ok: false, error: 'cifra_invalida' });
    assert.equal(t.google.chamadas.length, 0);
  });
});

describe('CofreDeTokens — Meta (token de longa duração)', () => {
  it('devolve o próprio token como bearer, sem chamar a Meta', async () => {
    const t = montar();
    await t.cofre.guardar(META, { tipo: 'oauth_long_lived', segredo: TOKEN_META, expiraEm: new Date(AGORA.getTime() + 50 * DIA) });
    const acesso = await t.cofre.obterAcesso(META);
    assert.ok(acesso.ok);
    assert.equal(acesso.value.token, TOKEN_META);
    assert.equal(t.meta.chamadas.length, 0);
  });

  it('varredura proativa renova perto do fim (≈ dia 45) e ignora quem ainda tem folga', async () => {
    const t = montar();
    await t.cofre.guardar(META, { tipo: 'oauth_long_lived', segredo: TOKEN_META, expiraEm: new Date(AGORA.getTime() + 14 * DIA) });
    const resumo = await t.cofre.renovarProativamente();
    assert.deepEqual(resumo, { avaliadas: 1, renovadas: 1, reautorizar: 0, falhas: 0 });
    assert.deepEqual(t.meta.chamadas, [TOKEN_META]);

    const registro = t.linhas.get(META.connectionId)!.registro!;
    assert.equal(registro.segredoExpiraEm!.getTime(), AGORA.getTime() + 60 * DIA);
    const acesso = await t.cofre.obterAcesso(META);
    assert.ok(acesso.ok);
    assert.equal(acesso.value.token, `${TOKEN_META}-novo`);

    assert.deepEqual(await t.cofre.renovarProativamente(), { avaliadas: 0, renovadas: 0, reautorizar: 0, falhas: 0 });
  });

  it('token já vencido vira reauth_pending', async () => {
    const t = montar();
    await t.cofre.guardar(META, { tipo: 'oauth_long_lived', segredo: TOKEN_META, expiraEm: new Date(AGORA.getTime() - DIA) });
    assert.deepEqual(await t.cofre.obterAcesso(META), { ok: false, error: 'reautorizar' });
    assert.equal(t.marcadas[0]?.motivo, 'segredo_expirado');
  });
});

describe('CofreDeTokens — chave de API e remoção', () => {
  it('devolve a chave como está, na forma da plataforma', async () => {
    const t = montar();
    await t.cofre.guardar(APIFY, { tipo: 'api_key', segredo: 'apify_api_chave-secreta' });
    const acesso = await t.cofre.obterAcesso(APIFY);
    assert.ok(acesso.ok);
    assert.deepEqual([acesso.value.token, acesso.value.tipo, acesso.value.expiraEm], ['apify_api_chave-secreta', 'bearer', null]);
  });

  it('revoga no provedor e apaga; se a revogação falha, apaga mesmo assim', async () => {
    const t = montar();
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    assert.deepEqual(await t.cofre.revogarEApagar(GOOGLE), { revogacao: 'revogado', apagado: true });
    assert.deepEqual(t.google.revogados, [REFRESH]);

    t.google.falharRevogacao();
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    assert.deepEqual(await t.cofre.revogarEApagar(GOOGLE), { revogacao: 'falhou', apagado: true });
    assert.equal(t.linhas.get(GOOGLE.connectionId)!.registro, null);
    assert.deepEqual(await t.cofre.revogarEApagar(GOOGLE), { revogacao: 'sem_token', apagado: false });
  });

  it('recusa segredo vazio e conexão de outra organização', async () => {
    const t = montar();
    assert.deepEqual(await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: '' }), { ok: false, error: 'segredo_invalido' });
    assert.deepEqual(
      await t.cofre.guardar({ organizationId: 'org-2', connectionId: GOOGLE.connectionId }, { tipo: 'oauth_refresh', segredo: REFRESH }),
      { ok: false, error: 'conexao_inexistente' },
    );
  });
});

describe('CofreDeTokens — registros sem segredo', () => {
  it('nenhuma linha de log contém segredo ou access token', async () => {
    const t = montar({ roteiro: async () => ({ ok: false, error: { natureza: 'reautorizar', codigo: 'invalid_grant' } }) });
    await t.cofre.guardar(GOOGLE, { tipo: 'oauth_refresh', segredo: REFRESH });
    await t.cofre.obterAcesso(GOOGLE);
    await t.cofre.guardar(META, { tipo: 'oauth_long_lived', segredo: TOKEN_META, expiraEm: new Date(AGORA.getTime() + DIA) });
    await t.cofre.renovarProativamente();
    await t.cofre.guardar(OUTRA, { tipo: 'oauth_refresh', segredo: 'outro-refresh' });
    const linhaOutra = t.linhas.get(OUTRA.connectionId)!;
    linhaOutra.registro = { ...linhaOutra.registro!, segredo: Buffer.from([1, 0, 5, 9, 9, 9, 9, 9]) };
    await t.cofre.obterAcesso(OUTRA);
    t.google.falharRevogacao();
    await t.cofre.revogarEApagar(GOOGLE);

    assert.ok(t.logs.length > 0);
    for (const linha of t.logs) {
      for (const segredo of [REFRESH, ACESSO, TOKEN_META, 'outro-refresh']) assert.ok(!linha.includes(segredo), linha);
    }
  });
});
