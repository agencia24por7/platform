import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avaliarAnexo } from './arquivos.ts';
import { CATALOGO, type Campo } from './catalogo.ts';

const marca = CATALOGO.find((secao) => secao.key === 'marca')!;
const campo = (key: string): Campo & { tipo: 'arquivo' } => {
  const achado = marca.campos.find((c) => c.key === key);
  assert.ok(achado && achado.tipo === 'arquivo', `${key} deve ser campo de arquivo`);
  return achado;
};

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
const PDF = Uint8Array.from([...Buffer.from('%PDF-1.7\n'), ...new Array(64).fill(32)]);

function enviar(key: string, nome: string, mime: string, conteudo: Uint8Array) {
  return avaliarAnexo({ nome, mime, conteudo, categoriasAceitas: campo(key).categorias, usoAtualDoClienteBytes: 0 });
}

describe('perguntas de imagem da marca', () => {
  it('existem, são de aprofundar e não mexem na completude essencial', () => {
    for (const key of ['referencias_visuais', 'identidade_visual', 'criativos_historicos']) {
      assert.equal(campo(key).nivel, 'aprofundar');
    }
  });

  it('referências e identidade aceitam imagem e recusam documento', () => {
    for (const key of ['referencias_visuais', 'identidade_visual']) {
      assert.equal(enviar(key, 'ref.png', 'image/png', PNG).ok, true);
      const recusado = enviar(key, 'manual.pdf', 'application/pdf', PDF);
      assert.equal(recusado.ok, false);
      assert.equal(!recusado.ok && recusado.motivo, 'categoria_nao_aceita');
    }
  });

  it('criativos históricos aceitam imagem e vídeo, e não documento', () => {
    assert.deepEqual([...campo('criativos_historicos').categorias].sort(), ['imagem', 'video']);
    assert.equal(enviar('criativos_historicos', 'post.png', 'image/png', PNG).ok, true);
    assert.equal(enviar('criativos_historicos', 'deck.pdf', 'application/pdf', PDF).ok, false);
  });

  it('svg disfarçado de imagem continua recusado', () => {
    const svg = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'));
    assert.equal(enviar('referencias_visuais', 'x.png', 'image/png', svg).ok, false);
  });
});
