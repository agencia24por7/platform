import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { psqlComoDono as dono } from './apoio/psql.mjs';

function arquivosDe(raiz, extensoes) {
  const encontrados = [];
  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome === '.next') continue;
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) encontrados.push(...arquivosDe(caminho, extensoes));
    else if (extensoes.some((ext) => nome.endsWith(ext))) encontrados.push(caminho);
  }
  return encontrados;
}

const FONTES = [...arquivosDe('src', ['.ts']), ...arquivosDe('app', ['.ts', '.tsx'])].filter(
  (caminho) => !caminho.endsWith('.test.ts'),
);

describe('o segredo não mora aqui', { concurrency: false }, () => {
  it('nenhuma coluna do banco guarda segredo de plataforma', () => {
    const suspeitas = dono(`
      SELECT coalesce(string_agg(table_schema || '.' || table_name || '.' || column_name, ', '), '')
      FROM information_schema.columns
      WHERE table_schema IN ('core','integrations','metrics','automation','audit')
        AND (column_name ~* '(access_?token|refresh_?token|client_?secret|api_?key|password|senha|chave)')
        AND NOT (table_schema = 'integrations' AND table_name = 'connection_tokens'
                 AND column_name LIKE '%\\_ciphertext' AND data_type = 'bytea')`);

    assert.equal(suspeitas, '', `coluna com cara de segredo: ${suspeitas}`);
  });

  it('as colunas legadas de ponteiro do n8n não existem mais: o segredo vive só cifrado no cofre (ADR 0032, 0123)', () => {
    const colunasLegadas = dono(`
      SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'integrations' AND table_name = 'connections'
        AND column_name IN ('credential_ref', 'coletor_ref', 'executor_ref')`);
    assert.equal(colunasLegadas, '0', 'a 0123 removeu credential_ref, coletor_ref e executor_ref');
    assert.equal(dono(`SELECT to_regclass('integrations.corte_para_cofre_refs') IS NULL`), 't');

    const ativaSemToken = dono(`
      SELECT count(*) FROM integrations.connections c
      WHERE c.status IN ('active', 'expiring', 'degraded')
        AND NOT EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = c.id)`);
    assert.equal(ativaSemToken, '0', 'conexão ativa sem token no cofre');
  });

  it('o banco recusa conexão ativa sem token no cofre (gatilho adiado do corte)', () => {
    let erro = '';
    try {
      dono(`INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, scopes)
            VALUES ((SELECT id FROM core.organizations LIMIT 1), 'ga4', 'oauth_user', 'sem token', 'sem-token-${Date.now()}', ARRAY[]::text[])`);
    } catch (falha) {
      erro = String(falha.stderr ?? falha.message);
    }
    assert.match(erro, /ativa sem token no cofre/);
  });

  it('a chave de API nunca é gravada, só o apelido com as pontas', () => {
    const servico = readFileSync(
      'src/modules/connections/application/connectionService.ts',
      'utf8',
    );
    const guardar = servico.slice(
      servico.indexOf('async guardarChave('),
      servico.indexOf('async removerConexao('),
    );

    assert.ok(/cofre\.selar\([^)]*segredo: chave/.test(guardar), 'a chave precisa ir para o cofre');
    assert.ok(
      !/externalId:\s*chave\b/.test(guardar) && !/label:.*\$\{chave\}/.test(guardar),
      'a chave crua não pode virar coluna do banco',
    );
    assert.ok(
      /externalId:\s*identidade/.test(guardar),
      'o identificador não pode derivar da chave, nem do apelido dela',
    );
    assert.ok(
      !/externalId:\s*apelido/.test(guardar),
      'apelido é fingerprint e colide: não serve de identidade',
    );
    assert.ok(
      !/metadata:.*\bchave\b/.test(guardar),
      'a chave não pode entrar na trilha de auditoria',
    );
  });

  it('nenhum log recebe a chave', () => {
    const vazamentos = FONTES.flatMap((caminho) => {
      const conteudo = readFileSync(caminho, 'utf8');
      return [...conteudo.matchAll(/logger\.\w+\([^)]*\)/gs)]
        .filter((m) => /\b(chave|accessToken|clientSecret|apiKey|senha)\b\s*[,}]/.test(m[0]))
        .map(() => caminho);
    });

    assert.deepEqual([...new Set(vazamentos)], [], 'log recebendo segredo');
  });

  it('todo destino de rede é constante do código, nunca vem de fora', () => {
    const suspeitas = FONTES.flatMap((caminho) => {
      const conteudo = readFileSync(caminho, 'utf8');
      return [...conteudo.matchAll(/fetch\(\s*([^,)]+)/g)]
        .map((m) => m[1].trim())
        .filter((alvo) => !/^(new URL\(|`|'|"|GOOGLE_TOKEN_URL|destinoDoAlerta|exchange\.url|troca\.url|url\b|onde\.url)/.test(alvo))
        .map((alvo) => `${caminho}: ${alvo}`);
    });

    assert.deepEqual(suspeitas, [], 'destino de rede derivado de valor externo');
  });

  it('nenhum segredo viaja em query string', () => {
    const suspeitas = FONTES.flatMap((caminho) => {
      const conteudo = readFileSync(caminho, 'utf8');
      return [...conteudo.matchAll(/searchParams\.set\(\s*'([^']+)'/g)]
        .map((m) => m[1])
        .filter((campo) => /secret|token|password|senha|chave|api_?key/i.test(campo))
        .map((campo) => `${caminho}: ${campo}`);
    });

    assert.deepEqual(suspeitas, [], 'segredo em parâmetro de URL');
  });

  it('o worker não tem privilégio de objeto e o app não cria objeto', () => {
    assert.equal(
      dono(
        `SELECT table_schema || '.' || table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type)
           FROM information_schema.table_privileges WHERE grantee = 'orla_worker' GROUP BY table_schema, table_name`,
      ),
      'automation.alertas:INSERT,SELECT,UPDATE',
    );
    assert.equal(
      dono(`SELECT count(*) FROM pg_namespace WHERE nspname IN ('public','core','integrations','metrics','automation','audit') AND has_schema_privilege('orla_app', nspname, 'CREATE')`),
      '0',
    );
  });
});
