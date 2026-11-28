import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { mencionaPessoa, normalizarSinal } from './cultura.ts';

const MIGRACAO = new URL('../../../../db/migrations/0152_brain_sinais_de_cultura.sql', import.meta.url);

function regexDoBanco(): readonly RegExp[] {
  const sql = readFileSync(MIGRACAO, 'utf8');
  const bloco = sql.slice(sql.indexOf('texto_de_sinal_sem_pessoa(p_texto text)'), sql.indexOf('COMMENT ON FUNCTION core.texto_de_sinal_sem_pessoa'));
  return [...bloco.matchAll(/p_texto !~ '([^']+)'/g)].map((m) =>
    new RegExp(m[1]!.replaceAll('[[:alnum:]', '[\\p{L}\\p{N}').replaceAll('[:alnum:]', '\\p{L}\\p{N}').replaceAll('[[:alpha:]]', '\\p{L}'), 'u'),
  );
}

const COM_PESSOA = [
  '@perfil',
  'fale com @maria.silva',
  'joao@example.com',
  'ligue +55 11 98765-4321',
  'ligue (11) 98765-4321',
  'ligue (11) 98765-43210',
  'ligue (11)987654321',
  'ligue 11 98765-4321',
  '11987654321',
  'zap 11987654321 agora',
  '11 9876-5432',
  '123.456.789-09',
  'cpf 123.456.789-091',
];

const SEM_PESSOA = [
  '#corridaderua com 1.500.000 de visualizações',
  'preço de R$ 5 @ loja',
  'alta de 300% em 2026',
  'versão 3.2.1 lançada',
  'codigo 1198765432100',
];

describe('contrato dos sinais de cultura: domínio é superconjunto do banco', () => {
  const banco = regexDoBanco();

  it('lê todas as regex da migração', () => {
    assert.equal(banco.length, 7);
  });

  for (const texto of COM_PESSOA) {
    it(`recusa no domínio e no banco: ${texto}`, () => {
      assert.equal(mencionaPessoa(texto), true);
      assert.equal(banco.some((regex) => regex.test(texto)), true);
    });
  }

  for (const texto of SEM_PESSOA) {
    it(`aceita no domínio e no banco: ${texto}`, () => {
      assert.equal(mencionaPessoa(texto), false);
      assert.equal(banco.some((regex) => regex.test(texto)), false);
    });
  }

  it('tudo o que o banco recusa o domínio também recusa', () => {
    for (const texto of [...COM_PESSOA, ...SEM_PESSOA]) {
      if (banco.some((regex) => regex.test(texto))) assert.equal(mencionaPessoa(texto), true, texto);
    }
  });
});

describe('sinal de cultura: pessoa no caminho da fonte', () => {
  const agora = new Date('2026-11-20T15:00:00Z');
  const sinal = (fonteUrl: string) => ({
    tipo: 'tendencia',
    titulo: 'Corrida de rua',
    resumo: 'Cresce a conversa sobre corrida.',
    fonteNome: 'TikTok',
    fonteUrl,
    plataforma: 'tiktok',
    observadoEm: '2026-11-18',
    validoAte: '2026-12-18',
    nota: 'B',
  });

  it('recusa URL que aponta para perfil, inclusive codificada', () => {
    for (const url of ['https://www.tiktok.com/@pessoa/video/1', 'https://www.tiktok.com/%40pessoa/video/1']) {
      const r = normalizarSinal(sinal(url), agora);
      assert.equal(r.ok, false, url);
      if (!r.ok) assert.ok(r.error.details?.['fonteUrl']);
    }
  });

  it('aceita URL pública sem pessoa', () => {
    assert.equal(normalizarSinal(sinal('https://trends.google.com/trends/explore?q=corrida'), agora).ok, true);
  });
});
