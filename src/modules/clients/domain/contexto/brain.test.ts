import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { construirBrain, formatarCentavos } from './brain.ts';
import { anexo, CLIENTE, DATA, entrada, item, ORG } from './fixturesDeTeste.ts';
import type { ContextoBruto } from './tipos.ts';

const P1 = '66666666-6666-4666-8666-666666666661';
const P2 = '66666666-6666-4666-8666-666666666662';

function contexto(): ContextoBruto {
  return {
    campos: [
      entrada('nome_empresa', 'Acme', { fonte: 'cliente' }),
      entrada('descricao_do_cliente', 'Faz pão.\nPara o bairro.'),
      entrada('posicionamento_desejado', 'A padaria do bairro', { epistemico: 'desejo' }),
      entrada('tom_formal_informal', 4),
      entrada('orcamento_mensal_total', 1234567),
      entrada('segmento', 'sugestão da IA', { fonte: 'ia', revisao: 'sugerido' }),
    ],
    itens: [
      item('produtos', { nome: 'Pão B', preco: 900 }, { id: P2, posicao: 2 }),
      item('produtos', { nome: 'Pão A', preco: 500 }, { id: P1, posicao: 1 }),
      item('produtos', { nome: 'Sugerido' }, { revisao: 'sugerido' }),
    ],
    arquivos: [anexo('logo', 'logo.png')],
  };
}

const gerar = (c: ContextoBruto, geradoEm = DATA) =>
  construirBrain({ organizationId: ORG, clientId: CLIENTE, nomeDoCliente: 'Acme', contexto: c, geradoEm });

const conteudo = (brain: ReturnType<typeof gerar>, nome: string) => brain.arquivos.find((a) => a.nome === nome)!.conteudo;

describe('exportação do company brain', () => {
  it('gera o layout combinado sob o prefixo do cliente', () => {
    const brain = gerar(contexto());
    const nomes = brain.arquivos.map((a) => a.nome);
    for (const esperado of [
      'perfil.md',
      'perfil.json',
      'produtos.jsonl',
      'personas.jsonl',
      'concorrentes.jsonl',
      'redes.jsonl',
      'campanhas.jsonl',
      'manifest.json',
    ]) {
      assert.ok(nomes.includes(esperado), esperado);
    }
    assert.ok(brain.arquivos.every((a) => a.caminho === `orgs/${ORG}/clientes/${CLIENTE}/contexto/brain/${a.nome}`));
  });

  it('é determinístico: mesma entrada em outra ordem e outra hora dá o mesmo hash', () => {
    const a = gerar(contexto());
    const embaralhado = { ...contexto(), campos: [...contexto().campos].reverse(), itens: [...contexto().itens].reverse() };
    const b = gerar(embaralhado, new Date('2027-01-01T00:00:00Z'));
    assert.equal(a.contentHash, b.contentHash);
    for (const arquivo of a.arquivos.filter((x) => x.nome !== 'manifest.json')) {
      assert.equal(arquivo.conteudo, conteudo(b, arquivo.nome), arquivo.nome);
    }
    assert.notEqual(conteudo(a, 'manifest.json'), conteudo(b, 'manifest.json'));
  });

  it('o hash muda quando um dado confirmado muda', () => {
    const outro = { ...contexto(), campos: [...contexto().campos, entrada('cidade', 'Recife')] };
    assert.notEqual(gerar(contexto()).contentHash, gerar(outro).contentHash);
  });

  it('sugestões não confirmadas ficam de fora', () => {
    const brain = gerar(contexto());
    assert.ok(!conteudo(brain, 'perfil.md').includes('sugestão da IA'));
    assert.ok(!conteudo(brain, 'produtos.jsonl').includes('Sugerido'));
  });

  it('perfil.md traz status e fonte por linha e seções A a K', () => {
    const md = conteudo(gerar(contexto()), 'perfil.md');
    assert.match(md, /^# Contexto do cliente: Acme/);
    assert.match(md, /- \*\*Nome da empresa:\*\* Acme _\(Fato · fonte: cliente\)_/);
    assert.match(md, /- \*\*Posicionamento desejado:\*\* _\(Desejo · fonte: equipe\)_\n\n  A padaria do bairro/);
    assert.match(md, /- \*\*Tom: formal ou informal\?\*\* 4/);
    assert.match(md, /4 de 5 \(1 = Formal, 5 = Informal\)/);
    assert.match(md, /R\$ 12\.345,67/);
    assert.match(md, /logo\.png \(image\/png\)/);
    assert.match(md, /## K\. Restrições e operação/);
    assert.ok(md.indexOf('Pão A') < md.indexOf('Pão B'));
  });

  it('JSONL tem uma linha por item com id estável', () => {
    const linhas = conteudo(gerar(contexto()), 'produtos.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(
      linhas.map((l) => [l.id, l.dados.nome]),
      [
        [P1, 'Pão A'],
        [P2, 'Pão B'],
      ],
    );
    assert.equal(conteudo(gerar(contexto()), 'personas.jsonl'), '');
  });

  it('manifest traz versão, hash, contagens e completude', () => {
    const brain = gerar(contexto());
    const manifesto = JSON.parse(conteudo(brain, 'manifest.json'));
    assert.equal(manifesto.schemaVersion, 1);
    assert.equal(manifesto.clientId, CLIENTE);
    assert.equal(manifesto.contentHash, brain.contentHash);
    assert.equal(manifesto.counts.itens.produtos, 2);
    assert.equal(typeof manifesto.completude.geral, 'number');
    assert.equal(manifesto.generatedAt, DATA.toISOString());
  });

  it('formata centavos em reais', () => {
    assert.equal(formatarCentavos(0), 'R$ 0,00');
    assert.equal(formatarCentavos(123456789), 'R$ 1.234.567,89');
  });
});
