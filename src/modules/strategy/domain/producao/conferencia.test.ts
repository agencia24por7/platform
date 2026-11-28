import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planoCompleto, URN_LIMITE } from '../fixturesDeTeste.ts';
import { conferirPlanoDeProducao, conferirProducaoDaCampanha, janelaDoCalendario, motivoDaConferencia, type ContextoDaCampanha } from './conferencia.ts';
import { JANELA_DE_TESTE, URN_ANTI_REFERENCIA, URN_REFERENCIA, pacoteDaProducao, producaoDaBusca, producaoDoSocial } from './fixturesDaProducao.ts';
import { esquemaPlanoDeProducao, esquemaProducaoDaCampanha, type ProducaoDaCampanha } from './planoDeProducao.ts';

const contexto = (campanhaId = 'cp_busca'): ContextoDaCampanha => ({ plano: planoCompleto(), campanhaId, pacote: pacoteDaProducao(), janela: JANELA_DE_TESTE });
const codigos = (producao: ProducaoDaCampanha, campanhaId = 'cp_busca') => conferirProducaoDaCampanha(producao, contexto(campanhaId)).map((problema) => problema.codigo);

function comEntregavel(mudar: (entregavel: ProducaoDaCampanha['entregaveis'][number]) => void): ProducaoDaCampanha {
  const producao = producaoDaBusca();
  mudar(producao.entregaveis[0]!);
  return producao;
}

describe('conferência do plano de produção por campanha', () => {
  it('os fixtures passam no esquema estrito e na conferência', () => {
    assert.ok(esquemaProducaoDaCampanha.safeParse(producaoDaBusca()).success);
    assert.deepEqual(codigos(producaoDaBusca()), []);
    assert.deepEqual(codigos(producaoDoSocial(), 'cp_social'), []);
  });

  it('a janela vem das fases do calendário', () => {
    assert.deepEqual(janelaDoCalendario(planoCompleto()), { inicio: '2026-12-01', fim: '2027-02-28' });
  });

  it('o esquema recusa campo desconhecido e entregável sem prompt', () => {
    assert.equal(esquemaProducaoDaCampanha.safeParse({ ...producaoDaBusca(), extra: 1 }).success, false);
    const semPrompt = comEntregavel((e) => (e.prompts = []));
    assert.equal(esquemaProducaoDaCampanha.safeParse(semPrompt).success, false);
  });

  it('campanha diferente ou inexistente reprova', () => {
    assert.ok(codigos({ ...producaoDaBusca(), campanha_id: 'cp_social' }).includes('campanha_diferente'));
    assert.ok(conferirProducaoDaCampanha(producaoDaBusca(), { ...contexto(), campanhaId: 'cp_nenhuma' }).some((p) => p.codigo === 'campanha_inexistente'));
  });

  it('campo fora do catálogo da plataforma e mídia incompatível reprovam', () => {
    assert.ok(codigos(comEntregavel((e) => (e.especificacao = { origem: 'catalogo', campos: ['creative_headline'] }))).includes('campo_fora_do_catalogo'));
    assert.ok(codigos(comEntregavel((e) => (e.especificacao = { origem: 'catalogo', campos: ['ad_headlines', 'ad_display_marketing_images'] }))).includes('midia_incompativel'));
  });

  it('limite de caracteres e de peças do catálogo do Google', () => {
    assert.ok(codigos(comEntregavel((e) => (e.textos[0]!.texto = 'Um título bem maior que trinta caracteres'))).includes('texto_acima_do_limite'));
    const muitos = comEntregavel((e) => {
      e.textos = Array.from({ length: 16 }, (_, i) => ({ campo: 'ad_headlines', texto: `Título ${i}` }));
    });
    assert.ok(codigos(muitos).includes('pecas_acima_do_limite'));
    assert.ok(codigos(comEntregavel((e) => (e.textos[0]!.campo = 'ad_path1'))).includes('texto_de_campo_nao_especificado'));
  });

  it('proporção só a do catálogo; sem número inventado', () => {
    const imagem = (campos: string[], proporcao: string | null) =>
      comEntregavel((e) => {
        e.tipo = 'imagem';
        e.textos = [];
        e.prompts = [{ tipo: 'imagem', prompt: 'Foto do produto em fundo claro.' }];
        e.especificacao = { origem: 'catalogo', campos };
        e.proporcao = proporcao;
      });
    assert.deepEqual(codigos(imagem(['ad_display_square_marketing_images'], '1:1')), []);
    assert.ok(codigos(imagem(['ad_display_square_marketing_images'], '4:5')).includes('proporcao_divergente'));
    assert.ok(codigos(imagem(['ad_display_square_marketing_images', 'ad_display_marketing_images'], '1:1')).includes('proporcoes_misturadas'));
    assert.ok(codigos(imagem(['ad_dg_portrait_marketing_images'], '4:5')).includes('proporcao_sem_catalogo'));
  });

  it('tipo e conteúdo coerentes: copy com texto, vídeo com roteiro, prompt do tipo', () => {
    assert.ok(codigos(comEntregavel((e) => (e.textos = []))).includes('copy_sem_texto'));
    assert.ok(codigos(comEntregavel((e) => (e.prompts = [{ tipo: 'imagem', prompt: 'Imagem.' }]))).includes('prompt_ausente'));
    const social = producaoDoSocial();
    social.entregaveis[0]!.roteiro = [];
    assert.ok(codigos(social, 'cp_social').includes('video_sem_roteiro'));
    assert.ok(codigos(comEntregavel((e) => (e.duracao_segundos = 10))).includes('duracao_fora_de_video'));
  });

  it('referências só do pacote, e anti-referência só para evitar', () => {
    assert.ok(codigos(comEntregavel((e) => (e.referencias = [{ urn: URN_LIMITE.replace('teto-mensal', 'nao-existe'), uso: 'inspiracao', motivo: 'x' }]))).includes('referencia_fora_do_pacote'));
    assert.ok(codigos(comEntregavel((e) => (e.referencias = [{ urn: URN_ANTI_REFERENCIA, uso: 'inspiracao', motivo: 'x' }]))).includes('anti_referencia_mal_usada'));
    assert.ok(codigos(comEntregavel((e) => (e.referencias = [{ urn: URN_REFERENCIA, uso: 'evitar', motivo: 'x' }]))).includes('evitar_sem_anti_referencia'));
    assert.ok(codigos(comEntregavel((e) => (e.evidencias = [{ urn: URN_LIMITE.replace('teto-mensal', 'x'), papel: 'favor' }]))).includes('evidencia_fora_do_pacote'));
  });

  it('justificativa com prova ou hipótese', () => {
    assert.ok(codigos(comEntregavel((e) => (e.evidencias = []))).includes('sem_fundamento'));
    assert.deepEqual(codigos(comEntregavel((e) => {
      e.evidencias = [];
      e.hipotese = true;
    })), []);
  });

  it('a confirmar exige lacuna', () => {
    const social = producaoDoSocial();
    social.lacunas = [];
    assert.ok(codigos(social, 'cp_social').includes('lacuna_ausente'));
    const aConfirmar = comEntregavel((e) => (e.especificacao = { origem: 'a_confirmar', motivo: 'Formato sem campo no catálogo.' }));
    aConfirmar.entregaveis[0]!.textos = aConfirmar.entregaveis[0]!.textos.map((peca) => ({ ...peca, campo: null }));
    assert.deepEqual(codigos(aConfirmar), ['lacuna_ausente']);
  });

  it('custos: fatia até a verba da campanha, maior que zero e de entregável existente', () => {
    const caro = producaoDaBusca();
    caro.custos[0]!.valor = { origem: 'verba_da_campanha', valor: { centavos: '600001', moeda: 'BRL' } };
    assert.ok(codigos(caro).includes('custo_acima_da_verba'));
    const zerado = producaoDaBusca();
    zerado.custos[0]!.valor = { origem: 'verba_da_campanha', valor: { centavos: '0', moeda: 'BRL' } };
    assert.ok(codigos(zerado).includes('custo_zerado'));
    const orfao = producaoDaBusca();
    orfao.custos[0]!.entregavel_ids = ['nao_existe'];
    assert.ok(codigos(orfao).includes('custo_sem_entregavel'));
  });

  it('workflow dentro do calendário, até o fim da campanha e em ordem', () => {
    const fora = producaoDaBusca();
    fora.workflow[0]!.inicio = '2026-11-20';
    assert.ok(codigos(fora).includes('etapa_fora_da_janela'));
    const invertida = producaoDaBusca();
    invertida.workflow[0]!.fim = '2026-11-30';
    assert.ok(codigos(invertida).includes('etapa_invertida'));
    const antes = producaoDaBusca();
    antes.workflow[1]!.inicio = '2026-12-02';
    assert.ok(codigos(antes).includes('etapa_antes_da_dependencia'));
    const ordem = producaoDaBusca();
    ordem.workflow[0]!.depende_de = ['w_revisao'];
    assert.ok(codigos(ordem).includes('dependencia_fora_de_ordem'));
    const inexistente = producaoDaBusca();
    inexistente.workflow[0]!.depende_de = ['w_nada'];
    assert.ok(codigos(inexistente).includes('dependencia_inexistente'));
    const descoberto = producaoDaBusca();
    descoberto.entregaveis.push({ ...descoberto.entregaveis[0]!, id: 'rsa_dois' });
    assert.ok(codigos(descoberto).includes('entregavel_sem_etapa'));
  });

  it('ids repetidos e dado pessoal reprovam', () => {
    const repetido = producaoDaBusca();
    repetido.workflow[1]!.id = 'w_redacao';
    assert.ok(codigos(repetido).includes('id_repetido'));
    const pessoal = producaoDaBusca();
    pessoal.conceito = 'Fale com joao.silva@exemplo.com.br para aprovar.';
    assert.ok(codigos(pessoal).includes('dado_pessoal'));
  });
});

describe('conferência do plano de produção inteiro', () => {
  const montar = (campanhas: ProducaoDaCampanha[]) =>
    esquemaPlanoDeProducao.parse({ schema_version: 1, janela: JANELA_DE_TESTE, campanhas, referencias: [] });

  it('todas as campanhas do plano cobertas e soma dentro do orçamento', () => {
    assert.deepEqual(conferirPlanoDeProducao(montar([producaoDaBusca(), producaoDoSocial()]), planoCompleto()), []);
    assert.ok(conferirPlanoDeProducao(montar([producaoDaBusca()]), planoCompleto()).some((p) => p.codigo === 'campanha_sem_producao'));
  });

  it('a soma das fatias acima do orçamento total reprova', () => {
    const plano = planoCompleto();
    plano.orcamento.total = { centavos: '10000', moeda: 'BRL' };
    assert.ok(conferirPlanoDeProducao(montar([producaoDaBusca(), producaoDoSocial()]), plano).some((p) => p.codigo === 'custo_acima_do_orcamento'));
  });

  it('o motivo é compacto: só caminhos e códigos, sem texto livre', () => {
    const motivo = motivoDaConferencia('campanha:cp_busca', [{ caminho: 'entregaveis.0.textos.[1] texto', codigo: 'texto_acima_do_limite' }]);
    assert.match(motivo, /^[A-Za-z0-9_.:;,=-]{1,240}$/);
    assert.equal(motivo, 'campanha:cp_busca:entregaveis.0.textos.1texto=texto_acima_do_limite');
  });
});
