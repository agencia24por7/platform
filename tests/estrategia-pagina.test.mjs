import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, sessionCookie, signIn, signOut, submitAction } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';
import { comoApp, criarSemeadorDeEstrategia, dono } from './apoio/semearEstrategia.mjs';

const sufixo = randomBytes(4).toString('hex');

const disponibilidade = await (async () => {
  try {
    const existe = dono("SELECT to_regclass('core.strategy_plan_runs') IS NOT NULL AND to_regprocedure('core.redigir_plano(uuid,text)') IS NOT NULL");
    if (existe !== 't') return `container ${PG_CONTAINER} sem as migrações 0143, 0145 e 0147 aplicadas`;
  } catch (falha) {
    return `Postgres do container ${PG_CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
  return (await appIsUp()) ? null : 'App fora do ar';
})();

if (disponibilidade && process.env.CI) {
  describe('aba Estratégia da página do cliente', () => {
    it('o app e o Postgres do harness precisam estar disponíveis no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const pular = disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false;

const fixtures = pular ? null : await import('../src/modules/strategy/domain/fixturesDeTeste.ts');

function planoDoCliente(organizacao, cliente) {
  const base = fixtures.planoCompletoBruto();
  base.riscos_e_regras.limites_nao_aplicaveis = [{ medida: 'custo_por_lead', motivo: 'Sem histórico de leads no Brain' }];
  const bruto = JSON.stringify(base)
    .replaceAll(fixtures.ORGANIZACAO_ID, organizacao)
    .replaceAll(fixtures.CLIENTE_ID, cliente);
  return JSON.parse(bruto);
}

const CHECAGENS_APROVADAS = [
  { chave: 'urns_no_pacote', resultado: 'aprovado', motivo: 'Todas as citações estão no pacote.', onde: [] },
  { chave: 'orcamento_fecha', resultado: 'aprovado', motivo: 'O orçamento fecha.', onde: [] },
  { chave: 'comite_completo', resultado: 'aprovado', motivo: 'Comitê completo.', onde: [] },
];

const TERMOS_INTERNOS = /Comitê|Gates?\b|Histórico|Parecer|Parecer do/;

describe('Estratégia: lista de planos e página do plano (ADR 0055 e 0065 §10)', { concurrency: false, skip: pular }, () => {
  const ids = {};
  const clientes = {};
  const criadas = { orgs: [], usuarios: [], clientes: [] };
  let semear;

  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Estratégia ${nome} ${sufixo}', 'estrategia-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, segment, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'Alimentação', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const membro = (papel, organizacao) => {
    const id = ensureUser(`estrategia-${papel}-${organizacao.slice(0, 4)}-${sufixo}@tria.local`);
    criadas.usuarios.push(id);
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${id}', '${papel}')`);
    return id;
  };

  const parecer = (persona, veredito, motivo, pontos = []) => ({ persona, veredito, motivo, pontos });
  const gateAprovado = () => ({ resultado: 'aprovado', checagens: CHECAGENS_APROVADAS, modelo: { resultado: 'aprovado', problemas: [] } });

  const planoComVersaoProposta = (cli, { comReferencia = false } = {}) => {
    const plano = semear.planoNovo(cli);
    const referencias = comReferencia ? [`orla:${ids.org}:${cli}:regra:regra-removida-${sufixo}`] : [];
    const versao = semear.versaoRascunho(cli, plano, planoDoCliente(ids.org, cli), { referencias });
    const execucao = semear.iniciarExecucao({ cli, plano });
    semear.eventoDoWorker(cli, versao, 'parecer', parecer('redator', 'aprova', 'Mensagem clara.'), execucao);
    semear.eventoDoWorker(cli, versao, 'gate', gateAprovado(), execucao);
    semear.concluirExecucao(execucao.id);
    semear.eventoDaPessoa(cli, versao, 'proposta', ids.operador);
    return { plano, versao };
  };

  const planoProntoParaAplicar = (cli) => {
    const plano = semear.planoNovo(cli);
    const conteudo = planoDoCliente(ids.org, cli);
    const execucao = semear.iniciarExecucao({ cli, plano });
    const primeira = semear.versaoRascunho(cli, plano, conteudo);
    semear.eventoDoWorker(cli, primeira, 'parecer', parecer('redator', 'aprova', 'Primeira leitura.'), execucao);
    const versao = semear.versaoRascunho(cli, plano, conteudo);
    semear.eventoDoWorker(
      cli,
      versao,
      'parecer',
      parecer('redator', 'aprova_com_ajuste', 'Promessa genérica.', [
        { id: 'p1', trecho: 'posicionamento_e_mensagem', problema: 'A promessa está vaga', ajustePedido: 'Dar um número à promessa', fontes: [] },
      ]),
      execucao,
    );
    semear.eventoDoWorker(cli, versao, 'parecer', parecer('risco_legal', 'aprova', 'Sem risco legal aparente.'), execucao);
    semear.eventoDoWorker(
      cli,
      versao,
      'ajuste',
      { responde_a: primeira, respostas: [{ pontoId: 'p1', persona: 'redator', decisao: 'acatado', motivo: 'Promessa com número' }] },
      execucao,
    );
    semear.eventoDoWorker(cli, versao, 'gate', gateAprovado(), execucao);
    semear.concluirExecucao(execucao.id);
    return { plano, versao, primeira };
  };

  async function pagina(caminho) {
    const resposta = await browse(caminho);
    const texto = (await resposta.text()).replaceAll('<!-- -->', '');
    return { status: resposta.status, texto, location: resposta.headers.get('location') };
  }

  const semScripts = (texto) => texto.replace(/<script[\s\S]*?<\/script>/g, '');
  const semAreaDeTexto = (texto) => semScripts(texto).replace(/<textarea[\s\S]*?<\/textarea>/g, '');

  function botao(texto, rotulo) {
    const casos = [...semScripts(texto).matchAll(new RegExp(`<button([^>]*)>\\s*${rotulo}\\s*</button>`, 'g'))];
    return casos.map((caso) => ({ atributos: caso[1], desabilitado: /\sdisabled(=|\s|$)/.test(` ${caso[1]}`) }));
  }
  const habilitado = (texto, rotulo) => botao(texto, rotulo).some((b) => !b.desabilitado);
  const desabilitado = (texto, rotulo) => {
    const todos = botao(texto, rotulo);
    return todos.length > 0 && todos.every((b) => b.desabilitado);
  };

  const formularios = (texto) => semScripts(texto).split('<form').slice(1).map((pedaco) => pedaco.slice(0, pedaco.indexOf('</form>')));

  function acaoDoBotao(texto, rotulo) {
    for (const formulario of formularios(texto)) {
      if (!formulario.includes(`>${rotulo}</button>`)) continue;
      const id = formulario.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
      if (id) return id;
    }
    throw new Error(`Nenhuma server action para o botão "${rotulo}".`);
  }

  async function ocultosDoFormulario(caminho, quem, campo) {
    signIn(quem);
    const { texto, status } = await pagina(caminho);
    assert.equal(status, 200, `status de ${caminho}`);
    const formulario = formularios(texto).find((candidato) => candidato.includes(`name="${campo}"`));
    assert.ok(formulario, `formulário com o campo ${campo} em ${caminho}`);
    const ocultos = [...formulario.matchAll(/<input type="hidden" name="(\$ACTION[^"]*)"(?: value="([^"]*)")?\/>/g)].map(([, nome, valor]) => [nome, (valor ?? '').replaceAll('&quot;', '"')]);
    assert.ok(ocultos.length >= 3, 'campos de ação do useActionState');
    return ocultos;
  }

  async function postar(caminho, quem, ocultos, campos) {
    const corpo = new FormData();
    for (const [nome, valor] of ocultos) corpo.set(nome, valor);
    for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
    const resposta = await fetch(`${BASE}${caminho}`, {
      method: 'POST',
      headers: { Cookie: sessionCookie(quem), Origin: BASE, Referer: `${BASE}${caminho}` },
      body: corpo,
      redirect: 'manual',
    });
    const texto = (await resposta.text()).replaceAll('<!-- -->', '');
    const destino = decodeURIComponent(resposta.headers.get('location') ?? texto.match(/"(\/clientes\/[a-z0-9/?=%.&;-]*)"/i)?.[1] ?? '');
    return { status: resposta.status, texto, destino };
  }

  const postarFormulario = async (caminho, quem, campo, campos) => postar(caminho, quem, await ocultosDoFormulario(caminho, quem, campo), campos);
  const rota = (cli, resto = '') => `/clientes/${cli}/estrategia${resto}`;
  const rotaPlano = (cli, plano, busca = '') => `/clientes/${cli}/estrategia/${plano}${busca}`;
  const destinoDe = (resposta) => decodeURIComponent(resposta.location ?? resposta.redirectedTo ?? '');

  before(() => {
    ids.org = org('a');
    ids.orgOutra = org('b');
    ids.dono = membro('owner', ids.org);
    ids.admin = membro('admin', ids.org);
    ids.operador = membro('operator', ids.org);
    ids.leitor = membro('viewer', ids.org);
    ids.recortado = ensureUser(`estrategia-recortado-${sufixo}@tria.local`);
    criadas.usuarios.push(ids.recortado);
    ids.membroRecortado = dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${ids.org}', '${ids.recortado}', 'operator') RETURNING id`);
    ids.donoOutra = membro('owner', ids.orgOutra);
    semear = criarSemeadorDeEstrategia({ org: ids.org, operador: ids.operador });

    clientes.semPlano = cliente(ids.org, 'Padaria Estrela do Sul');
    dono(`UPDATE core.clients SET whatsapp = '+5511999998888' WHERE id = '${clientes.semPlano}'`);
    ids.landing = dono(`INSERT INTO core.client_landing_pages (organization_id, client_id, url, rotulo) VALUES ('${ids.org}', '${clientes.semPlano}', 'https://padaria.example.com.br/oferta', 'Oferta de inauguração') RETURNING id`);
    clientes.andamento = cliente(ids.org, 'Oficina Roda Viva');
    clientes.pronto = cliente(ids.org, 'Cafeteria Grão Dourado');
    clientes.acao = cliente(ids.org, 'Livraria Folha Solta');
    clientes.emAutorizacao = cliente(ids.org, 'Floricultura Pétala Azul');
    clientes.vigente = cliente(ids.org, 'Academia Ponto Forte');
    clientes.falhou = cliente(ids.org, 'Sorveteria Gelo Fino');
    clientes.preso = cliente(ids.org, 'Mercearia Quatro Ventos');
    clientes.parado = cliente(ids.org, 'Lavanderia Roupa Limpa');
    clientes.outro = cliente(ids.org, 'Papelaria Traço Fino');
    clientes.alheio = cliente(ids.orgOutra, 'Chaveiro Porta Aberta');
    dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${ids.membroRecortado}', '${clientes.outro}')`);

    const planoAndamento = semear.planoNovo(clientes.andamento);
    const versaoAndamento = semear.versaoRascunho(clientes.andamento, planoAndamento, planoDoCliente(ids.org, clientes.andamento));
    ids.andamento = { plano: planoAndamento, versao: versaoAndamento, execucao: semear.iniciarExecucao({ cli: clientes.andamento, plano: planoAndamento, tipo: 'ajustar', base: versaoAndamento }) };
    semear.avancarEtapa(ids.andamento.execucao.id, 'comite');

    ids.pronto = planoProntoParaAplicar(clientes.pronto);
    ids.acao = planoProntoParaAplicar(clientes.acao);
    ids.emAutorizacao = planoComVersaoProposta(clientes.emAutorizacao);
    ids.vigente = planoComVersaoProposta(clientes.vigente, { comReferencia: true });
    semear.eventoDaPessoa(clientes.vigente, ids.vigente.versao, 'efetivada', ids.admin);

    const planoFalhou = semear.planoNovo(clientes.falhou);
    ids.falhou = { plano: planoFalhou };
    const falhou = semear.iniciarExecucao({ cli: clientes.falhou, plano: planoFalhou });
    semear.falharExecucao(falhou.id, 'ia_nao_configurada');

    ids.preso = { plano: semear.planoNovo(clientes.preso) };
    ids.preso.execucao = semear.pedirExecucao({ cli: clientes.preso, plano: ids.preso.plano });

    ids.parado = { plano: semear.planoNovo(clientes.parado) };
    ids.parado.execucao = semear.pedirExecucao({ cli: clientes.parado, plano: ids.parado.plano });
    dono(`SET session_replication_role = replica; UPDATE core.strategy_plan_runs SET created_at = now() - interval '30 minutes', updated_at = now() - interval '30 minutes' WHERE id = '${ids.parado.execucao.id}'`);
  });

  after(() => {
    signOut();
    if (process.env.ESTRATEGIA_MANTER_DADOS) {
      writeFileSync(process.env.ESTRATEGIA_MANTER_DADOS, JSON.stringify({ ids, clientes }, null, 2));
      return;
    }
    const tentar = (sql) => {
      try {
        dono(sql);
      } catch {
        return;
      }
    };
    for (const id of criadas.clientes) tentar(`DELETE FROM core.member_clients WHERE client_id = '${id}'`);
    for (const id of criadas.clientes) tentar(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) tentar(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) tentar(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) tentar(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('(a) sem plano: estado vazio, botão Novo plano e nenhuma aba interna', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.semPlano));
    assert.equal(status, 200);
    assert.match(texto, /Este cliente ainda não tem plano/);
    assert.match(texto, new RegExp(`<a [^>]*href="${rota(clientes.semPlano, '\\?novo=1')}"[^>]*>Novo plano</a>`));
    assert.ok(!texto.includes('aria-label="Seções de Estratégia"'), 'sem abas dentro da Estratégia');
    assert.ok(texto.includes('>Estratégia<'), 'aba Estratégia na barra');
    assert.ok(!TERMOS_INTERNOS.test(semScripts(texto)), 'sem Comitê, Gates ou Histórico');
    for (const ruim of ['undefined', '[object Object]', 'NaN']) assert.ok(!semScripts(texto).includes(ruim), ruim);
  });

  it('(a) o formulário de novo plano traz rótulo em todo campo, o tipo dentro dele, o WhatsApp do cliente e a landing page escolhida', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.semPlano, '?novo=1'));
    assert.equal(status, 200);
    for (const rotulo of ['Tipo de plano', 'Plataformas', 'Landing page', 'Ousadia', 'Objetivo', 'Início do horizonte', 'Fim do horizonte', 'Retorno esperado', 'Verba (R$)', 'Total do período', 'Por mês', 'Links com UTM']) {
      assert.ok(texto.includes(rotulo), rotulo);
    }
    for (const tipo of ['Aquisição', 'Marca', 'Comunidade', 'Retenção']) assert.ok(texto.includes(`>${tipo}</option>`), tipo);
    assert.ok(texto.includes('+5511999998888'), 'WhatsApp do cadastro do cliente');
    assert.ok(texto.includes('Oferta de inauguração'), 'landing page do cliente');
    const campos = [...semScripts(texto).matchAll(/<(input|select|textarea)\b[^>]*\bname="(tipoDePlano|landingPageId|ousadia|objetivo|inicio|fim|retorno|verba)"[^>]*>/g)];
    assert.equal(campos.length, 8);
    for (const [tag] of campos) {
      const id = tag.match(/\bid="([^"]+)"/)?.[1];
      assert.ok(id && texto.includes(`for="${id}"`), `campo sem rótulo: ${tag.slice(0, 80)}`);
    }
  });

  it('(a) cliente sem WhatsApp nem landing page: mensagem com link para o cadastro e Pedir o plano desabilitado', async () => {
    signIn(ids.operador);
    const resposta = await pagina(rota(clientes.outro, '?novo=1'));
    assert.equal(resposta.status, 200);
    assert.match(resposta.texto, /ainda não tem landing page cadastrada/);
    assert.match(resposta.texto, /ainda não tem WhatsApp cadastrado/);
    assert.ok(resposta.texto.includes(`/clientes/${clientes.outro}/contexto?secao=destino`));
    assert.ok(desabilitado(resposta.texto, 'Pedir o plano'));
  });

  it('(b) execução ativa: linha do tempo com etapas simples, sem termos internos e nenhum Aplicar habilitado', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rotaPlano(clientes.andamento, ids.andamento.plano));
    assert.equal(status, 200);
    assert.match(texto, /Andamento do plano/);
    assert.match(texto, /etapas__item--atual"[^>]*aria-current="step"[\s\S]{0,900}?Revisando o plano/);
    for (const etapa of ['Lendo o contexto do cliente', 'Redigindo o plano', 'Ajustando o plano', 'Conferindo o plano']) assert.ok(texto.includes(etapa), etapa);
    assert.ok(!TERMOS_INTERNOS.test(semScripts(texto)), 'sem Comitê, Gates ou Histórico');
    assert.ok(!habilitado(texto, 'Aplicar o plano'));
    assert.ok(desabilitado(texto, 'Aplicar o plano'));
    assert.match(texto, /Há uma execução em andamento/);
    assert.ok(habilitado(texto, 'Cancelar execução'));
    const lista = await pagina(rota(clientes.andamento));
    assert.match(lista.texto, /Gerando|Em geração/);
    assert.match(lista.texto, /<progress /);
  });

  it('(c) rascunho pronto: Resumo executivo e Plano de mídia, marcas de evidência, links com UTM e Aplicar habilitado para operator', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rotaPlano(clientes.pronto, ids.pronto.plano));
    assert.equal(status, 200);
    assert.ok(texto.includes('id="titulo-resumo_executivo"') && texto.includes('id="titulo-plano_de_midia"'), 'os dois blocos');
    assert.equal((semScripts(texto).match(/class="card estrategia-bloco"/g) ?? []).length, 2, 'só dois blocos');
    const plano = planoDoCliente(ids.org, clientes.pronto);
    assert.ok(texto.includes(plano.resumo_executivo.aposta_central.texto.slice(0, 40).replace(/&/g, '&amp;')), 'aposta central');
    assert.ok(!texto.includes(plano.campanhas.campanhas[0].nome), 'campanhas não aparecem na página');
    assert.match(texto, /Em rascunho/);
    assert.match(texto, /Confira antes de autorizar: o plano declara limites que não se aplicam/);
    assert.match(texto, /Custo por lead: Sem histórico de leads no Brain/);
    assert.match(texto, /Verba e período/);
    assert.match(texto, /Link com UTM:/);
    assert.match(texto, /<details class="midia-plataforma"/);
    assert.match(texto, /Por quê:/);
    assert.match(texto, /Atualizado em \d{2}\/\d{2}\/\d{4}/);
    assert.match(texto, /R\$ [\d.]+,\d{2}/);
    const marcas = [...texto.matchAll(/<a class="marca" title="([^"]+)" href="([^"]+)"/g)];
    for (const [, urn, href] of marcas) {
      assert.equal(href, `/clientes/${clientes.pronto}/contexto`);
      assert.ok(urn.startsWith(`orla:${ids.org}:${clientes.pronto}:`), urn);
    }
    assert.ok(habilitado(texto, 'Aplicar o plano'));
    assert.ok(botao(texto, 'Cancelar rascunho').length > 0);
    assert.match(texto, /Pedir mudança ao agente/);
    assert.match(texto, /Editar seção/);
    assert.match(texto, /Toda mudança cria uma versão nova, que passa por revisão de novo\./);
    assert.doesNotMatch(texto, /Edição avançada|name="json"/);
    assert.match(texto, /[0-9]+\/2000/);
    assert.ok(!TERMOS_INTERNOS.test(semAreaDeTexto(texto)), 'sem Comitê, Gates ou Histórico');
    for (const interno of TEXTOS_INTERNOS_SEMEADOS) assert.ok(!texto.includes(interno), interno);
    for (const ruim of ['undefined', '[object Object]', 'NaN']) assert.ok(!semScripts(texto).includes(ruim), ruim);
    assert.ok(!semAreaDeTexto(texto).includes('&quot;centavos&quot;'), 'JSON cru fora do editor avançado');
    const lista = await pagina(rota(clientes.pronto));
    assert.match(lista.texto, new RegExp(`href="${rotaPlano(clientes.pronto, ids.pronto.plano)}"`));
    assert.match(lista.texto, /Em rascunho/);
  });

  it('(d) em autorização: operator vê Autorizar desabilitado com motivo; admin vê habilitado', async () => {
    signIn(ids.operador);
    const comoOperador = await pagina(rotaPlano(clientes.emAutorizacao, ids.emAutorizacao.plano));
    assert.equal(comoOperador.status, 200);
    assert.match(comoOperador.texto, /Em autorização/);
    assert.ok(desabilitado(comoOperador.texto, 'Autorizar'));
    assert.match(comoOperador.texto, /Só quem administra pode autorizar ou rejeitar o plano/);
    assert.ok(!habilitado(comoOperador.texto, 'Autorizar'));

    signIn(ids.admin);
    const comoAdmin = await pagina(rotaPlano(clientes.emAutorizacao, ids.emAutorizacao.plano));
    assert.ok(habilitado(comoAdmin.texto, 'Autorizar'));
    assert.ok(botao(comoAdmin.texto, 'Rejeitar').some((b) => !b.desabilitado));
  });

  it('(e) autorizado: status Autorizado, Revogar só para quem administra e revisão pedida quando o Brain mudou', async () => {
    signIn(ids.admin);
    const comoAdmin = await pagina(rotaPlano(clientes.vigente, ids.vigente.plano));
    assert.equal(comoAdmin.status, 200);
    assert.match(comoAdmin.texto, /Autorizado/);
    assert.ok(habilitado(comoAdmin.texto, 'Revogar'));
    assert.match(comoAdmin.texto, /O plano está desatualizado: o contexto do cliente mudou/);
    assert.ok(habilitado(comoAdmin.texto, 'Pedir revisão'));
    signIn(ids.operador);
    const comoOperador = await pagina(rotaPlano(clientes.vigente, ids.vigente.plano));
    assert.ok(desabilitado(comoOperador.texto, 'Revogar'));
  });

  it('(f) execução que falhou por IA não configurada: aviso com link para /config', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rotaPlano(clientes.falhou, ids.falhou.plano));
    assert.equal(status, 200);
    assert.match(texto, /A inteligência artificial ainda não está configurada/);
    assert.match(texto, /<a [^>]*href="\/config"[^>]*>Abrir configurações<\/a>/);
    assert.ok(!texto.includes('ia_nao_configurada'));
  });

  const TEXTOS_INTERNOS_SEMEADOS = [
    'Promessa genérica.',
    'A promessa está vaga',
    'Dar um número à promessa',
    'Promessa com número',
    'A verba fecha com a soma das campanhas',
    'Comitê completo e todos os pontos respondidos',
  ];

  async function semAcessoAEstrategia(quem, cli, extras = [], planoId = null) {
    signIn(quem);
    const plano = planoDoCliente(ids.org, cli);
    const proibidos = [...TEXTOS_INTERNOS_SEMEADOS, ...extras, plano.campanhas.campanhas[0].nome, plano.resumo_executivo.aposta_central.texto.slice(0, 40).replace(/&/g, '&amp;')];
    const caminhos = [rota(cli), rota(cli, '?novo=1'), ...(planoId ? [rotaPlano(cli, planoId)] : [])];
    for (const caminho of caminhos) {
      const secao = caminho;
      const resposta = await pagina(caminho);
      assert.ok([302, 303, 307, 308].includes(resposta.status), `${secao || 'sem secao'}: status ${resposta.status}`);
      assert.equal(destinoDe(resposta), `/clientes/${cli}/conexoes`, secao);
      const limpo = semScripts(resposta.texto);
      for (const texto of proibidos) {
        assert.ok(!limpo.includes(texto), `${texto} em ${secao}`);
        assert.ok(!resposta.texto.includes(texto), `${texto} no HTML cru e no payload em ${secao}`);
      }
      assert.ok(!limpo.includes('id="titulo-resumo_executivo"'), `bloco do plano em ${secao}`);
    }
  }

  it('(g) viewer é o papel do cliente e não acessa a Estratégia: sem aba, rota redireciona e nenhum texto interno vaza', async () => {
    for (const cli of [clientes.pronto, clientes.emAutorizacao, clientes.vigente, clientes.andamento, clientes.semPlano, clientes.preso]) {
      await semAcessoAEstrategia(ids.leitor, cli, [], ({ [clientes.pronto]: ids.pronto, [clientes.emAutorizacao]: ids.emAutorizacao, [clientes.vigente]: ids.vigente, [clientes.andamento]: ids.andamento, [clientes.preso]: ids.preso })[cli]?.plano ?? null);
    }
    signIn(ids.leitor);
    const barra = await pagina(`/clientes/${clientes.pronto}/conexoes`);
    assert.equal(barra.status, 200);
    const limpa = semScripts(barra.texto);
    assert.match(limpa, /aria-label="Blocos do cliente"/);
    assert.match(limpa, />Conexões</);
    assert.ok(!limpa.includes('>Estratégia<'), 'sem a aba Estratégia');
    assert.ok(!limpa.includes(`/clientes/${clientes.pronto}/estrategia`), 'sem link para a Estratégia');
    for (const texto of TEXTOS_INTERNOS_SEMEADOS) {
      assert.ok(!limpa.includes(texto), texto);
      assert.ok(!barra.texto.includes(texto), `${texto} no HTML cru e no payload`);
    }

    signIn(ids.operador);
    const comoOperador = await pagina(`/clientes/${clientes.pronto}/conexoes`);
    assert.match(semScripts(comoOperador.texto), new RegExp(`href="/clientes/${clientes.pronto}/estrategia"[^>]*>(?:(?!</a>)[\\s\\S])*Estratégia`));
  });

  it('(h) a Estratégia é uma página só: rotas antigas de seção e tipo caem na lista e nada interno aparece', async () => {
    signIn(ids.dono);
    for (const antiga of ['?secao=comite', '?secao=gates', '?secao=historico', '?secao=plano&tipo=marca']) {
      const resposta = await pagina(rota(clientes.pronto, antiga));
      assert.equal(resposta.status, 200, antiga);
      assert.ok(!TERMOS_INTERNOS.test(semScripts(resposta.texto)), antiga);
      assert.ok(!semScripts(resposta.texto).includes('aria-label="Seções de Estratégia"'), antiga);
      assert.ok(!semScripts(resposta.texto).includes('aria-label="Tipo de plano"'), antiga);
    }
    const plano = await pagina(rotaPlano(clientes.pronto, ids.pronto.plano));
    assert.ok(!TERMOS_INTERNOS.test(semAreaDeTexto(plano.texto)));
    assert.ok(!semScripts(plano.texto).includes('Parecer'), 'sem pareceres');
  });

  it('a lista tem um card por plano, em qualquer status, com status em português e atualização', async () => {
    signIn(ids.operador);
    const planos = [[clientes.pronto, ids.pronto.plano, 'Em rascunho'], [clientes.emAutorizacao, ids.emAutorizacao.plano, 'Em autorização'], [clientes.falhou, ids.falhou.plano, 'Falhou']];
    for (const [cli, plano, rotulo] of planos) {
      const { status, texto } = await pagina(rota(cli));
      assert.equal(status, 200);
      assert.match(texto, new RegExp(`href="${rotaPlano(cli, plano)}"`));
      assert.ok(texto.includes(rotulo), rotulo);
      assert.match(texto, /Atualizado em \d{2}\/\d{2}\/\d{4}/);
    }
  });

  it('(i) outra organização e usuário restrito a outro cliente não veem o plano', async () => {
    signIn(ids.donoOutra);
    assert.equal((await pagina(rota(clientes.pronto))).status, 404);
    assert.equal((await pagina(rotaPlano(clientes.pronto, ids.pronto.plano))).status, 404);
    signIn(ids.recortado);
    assert.equal((await pagina(rota(clientes.pronto))).status, 404);
    assert.equal((await pagina(rotaPlano(clientes.outro, ids.pronto.plano))).status, 404, 'plano de outro cliente da organização');
    assert.equal((await pagina(rotaPlano(clientes.outro, 'nao-e-uuid'))).status, 404);
    const proprio = await pagina(rota(clientes.outro));
    assert.equal(proprio.status, 200);
    assert.match(proprio.texto, /Este cliente ainda não tem plano/);
  });

  it('(i) toda server action recusa id de outro cliente da organização e de outra organização, sem gravar nada', async () => {
    signIn(ids.operador);
    const paginaDoPronto = (await pagina(rotaPlano(clientes.pronto, ids.pronto.plano))).texto;
    signIn(ids.admin);
    const paginaDaAutorizacao = (await pagina(rotaPlano(clientes.emAutorizacao, ids.emAutorizacao.plano))).texto;
    const paginaDoVigente = (await pagina(rotaPlano(clientes.vigente, ids.vigente.plano))).texto;
    const paginaDoAndamento = (await pagina(rotaPlano(clientes.andamento, ids.andamento.plano))).texto;

    const simples = [
      { nome: 'aplicar', acao: acaoDoBotao(paginaDoPronto, 'Aplicar o plano'), campo: 'versaoId', alvo: ids.pronto.versao, mensagem: /erro=Versão do plano não encontrada/ },
      { nome: 'cancelar rascunho', acao: acaoDoBotao(paginaDoPronto, 'Cancelar rascunho'), campo: 'versaoId', alvo: ids.pronto.versao, mensagem: /erro=Versão do plano não encontrada/ },
      { nome: 'autorizar', acao: acaoDoBotao(paginaDaAutorizacao, 'Autorizar'), campo: 'versaoId', alvo: ids.emAutorizacao.versao, mensagem: /erro=Versão do plano não encontrada/ },
      { nome: 'rejeitar', acao: acaoDoBotao(paginaDaAutorizacao, 'Rejeitar'), campo: 'versaoId', alvo: ids.emAutorizacao.versao, mensagem: /erro=Versão do plano não encontrada/ },
      { nome: 'revogar', acao: acaoDoBotao(paginaDoVigente, 'Revogar'), campo: 'versaoId', alvo: ids.vigente.versao, mensagem: /erro=Versão do plano não encontrada/ },
      { nome: 'pedir revisão', acao: acaoDoBotao(paginaDoVigente, 'Pedir revisão'), campo: 'planoId', alvo: ids.vigente.plano, mensagem: /erro=Plano não encontrado/ },
      { nome: 'cancelar execução', acao: acaoDoBotao(paginaDoAndamento, 'Cancelar execução'), campo: 'execucaoId', alvo: ids.andamento.execucao.id, mensagem: /erro=Execução não encontrada/ },
    ];
    const atacantes = [
      { quem: ids.recortado, cliente: clientes.outro, rotulo: 'usuário restrito a outro cliente da mesma organização' },
      { quem: ids.donoOutra, cliente: clientes.alheio, rotulo: 'dono de outra organização' },
    ];

    const antes = semear.fotografia();
    for (const atacante of atacantes) {
      signIn(atacante.quem);
      for (const caso of simples) {
        const resposta = await submitAction(rotaPlano(atacante.cliente, ids.pronto.plano), caso.acao, { clienteId: atacante.cliente, [caso.campo]: caso.alvo });
        assert.match(destinoDe(resposta), caso.mensagem, `${caso.nome} por ${atacante.rotulo}`);
      }
    }
    assert.equal(semear.fotografia(), antes, 'nenhuma escrita');

    const comandos = [
      { nome: 'pedir mudança', campo: 'instrucao', extra: { instrucao: 'Reduzir a verba de social' } },
      { nome: 'editar seção', campo: 'campo:objetivo', extra: { secao: 'resumo_executivo', 'campo:objetivo': 'Novo objetivo' } },
    ];
    for (const comando of comandos) {
      const ocultos = await ocultosDoFormulario(rotaPlano(clientes.pronto, ids.pronto.plano), ids.operador, comando.campo);
      for (const atacante of atacantes) {
        const resposta = await postar(rotaPlano(atacante.cliente, ids.pronto.plano), atacante.quem, ocultos, { clienteId: atacante.cliente, planoId: ids.pronto.plano, versaoId: ids.pronto.versao, ...comando.extra });
        assert.ok(resposta.status < 500, `${comando.nome}: ${resposta.status}`);
        assert.match(resposta.texto, /Plano não encontrado/, `${comando.nome} por ${atacante.rotulo}`);
      }
    }
    assert.equal(semear.fotografia(), antes, 'nenhuma escrita');
  });

  it('a edição e o pedido de mudança recusam quando a versão vista já não é a atual', async () => {
    const antes = semear.fotografia();
    const ocultosDaMudanca = await ocultosDoFormulario(rotaPlano(clientes.pronto, ids.pronto.plano), ids.operador, 'instrucao');
    const mudanca = await postar(rotaPlano(clientes.pronto, ids.pronto.plano), ids.operador, ocultosDaMudanca, { clienteId: clientes.pronto, planoId: ids.pronto.plano, versaoId: ids.pronto.primeira, instrucao: 'Reduzir a verba de social' });
    assert.match(mudanca.texto, /O plano mudou enquanto você editava\. Recarregue a página\./);
    const ocultosDaEdicao = await ocultosDoFormulario(rotaPlano(clientes.pronto, ids.pronto.plano), ids.operador, 'campo:objetivo');
    const edicao = await postar(rotaPlano(clientes.pronto, ids.pronto.plano), ids.operador, ocultosDaEdicao, { clienteId: clientes.pronto, planoId: ids.pronto.plano, versaoId: ids.pronto.primeira, secao: 'resumo_executivo', 'campo:objetivo': 'Novo objetivo' });
    assert.match(edicao.texto, /O plano mudou enquanto você editava\. Recarregue a página\./);
    assert.equal(semear.fotografia(), antes);
    const pagina2 = await pagina(rotaPlano(clientes.pronto, ids.pronto.plano));
    assert.ok(pagina2.texto.includes(`name="versaoId" value="${ids.pronto.versao}"`), 'o formulário carrega a versão exibida');
  });

  it('(1) sem versão e com execução pendente: Cancelar execução pede confirmação, funciona e o plano passa a Cancelado', async () => {
    signIn(ids.operador);
    const antes = await pagina(rotaPlano(clientes.preso, ids.preso.plano));
    assert.equal(antes.status, 200);
    assert.match(antes.texto, /Andamento do plano/);
    assert.ok(habilitado(antes.texto, 'Cancelar execução'));
    const acao = acaoDoBotao(antes.texto, 'Cancelar execução');
    const resposta = await submitAction(rotaPlano(clientes.preso, ids.preso.plano), acao, { clienteId: clientes.preso, planoId: ids.preso.plano, execucaoId: ids.preso.execucao.id });
    assert.match(destinoDe(resposta), /feito=Execução cancelada/);
    assert.match(destinoDe(resposta), new RegExp(`/estrategia/${ids.preso.plano}`));
    assert.equal(dono(`SELECT status FROM core.strategy_plan_runs WHERE id = '${ids.preso.execucao.id}'`), 'cancelada');
    const depois = await pagina(rotaPlano(clientes.preso, ids.preso.plano));
    assert.ok(!habilitado(depois.texto, 'Cancelar execução'));
    const lista = await pagina(rota(clientes.preso));
    assert.match(lista.texto, />Novo plano</);
  });

  it('(2) execução presa: aviso claro e Cancelar execução, que funciona', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rotaPlano(clientes.parado, ids.parado.plano));
    assert.equal(status, 200);
    assert.match(texto, /A execução não está avançando/);
    assert.ok(habilitado(texto, 'Cancelar execução'));
    const cancelada = await submitAction(rotaPlano(clientes.parado, ids.parado.plano), acaoDoBotao(texto, 'Cancelar execução'), { clienteId: clientes.parado, planoId: ids.parado.plano, execucaoId: ids.parado.execucao.id });
    assert.match(destinoDe(cancelada), /feito=Execução cancelada/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_runs WHERE id = '${ids.parado.execucao.id}'`), 'cancelada');
  });

  it('(i) a server action de aplicar recusa viewer e age para operator', async () => {
    signIn(ids.operador);
    const acaoDeAplicar = acaoDoBotao((await pagina(rotaPlano(clientes.acao, ids.acao.plano))).texto, 'Aplicar o plano');
    const caminho = rotaPlano(clientes.acao, ids.acao.plano);
    const proposta = (versao) => Number(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND kind = 'proposta'`));
    const alvo = ids.acao.versao;

    signIn(ids.leitor);
    const leitor = await submitAction(caminho, acaoDeAplicar, { clienteId: clientes.acao, planoId: ids.acao.plano, versaoId: alvo });
    assert.match(destinoDe(leitor), /erro=/);
    assert.equal(proposta(alvo), 0);

    signIn(ids.operador);
    const feito = await submitAction(caminho, acaoDeAplicar, { clienteId: clientes.acao, planoId: ids.acao.plano, versaoId: alvo });
    assert.match(destinoDe(feito), /feito=Plano aplicado/);
    assert.equal(proposta(alvo), 1);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${alvo}'`), 'proposto');
    const depois = await pagina(rotaPlano(clientes.acao, ids.acao.plano));
    assert.match(depois.texto, /Em autorização/);
  });

  it('a server action de autorizar recusa operator e aceita admin', async () => {
    signIn(ids.admin);
    const acaoDeAutorizar = acaoDoBotao((await pagina(rotaPlano(clientes.emAutorizacao, ids.emAutorizacao.plano))).texto, 'Autorizar');
    const caminho = rotaPlano(clientes.emAutorizacao, ids.emAutorizacao.plano);
    const versao = ids.emAutorizacao.versao;
    signIn(ids.operador);
    const negada = await submitAction(caminho, acaoDeAutorizar, { clienteId: clientes.emAutorizacao, planoId: ids.emAutorizacao.plano, versaoId: versao });
    assert.match(destinoDe(negada), /erro=/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'proposto');
    signIn(ids.admin);
    const aceita = await submitAction(caminho, acaoDeAutorizar, { clienteId: clientes.emAutorizacao, planoId: ids.emAutorizacao.plano, versaoId: versao });
    assert.match(destinoDe(aceita), /feito=Plano autorizado/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'vigente');
  });

  it('o formulário de novo plano valida no servidor, mostra a prévia de UTM e cria a execução', async () => {
    const caminho = rota(clientes.semPlano, '?novo=1');
    const campos = { clienteId: clientes.semPlano, acao: 'criar', tipoDePlano: 'aquisicao', plataformas: 'meta', landingPageId: ids.landing, focoMarca: '1', objetivo: 'Gerar leads qualificados', inicio: '2026-12-01', fim: '2027-02-28', ousadia: 'moderado', retorno: '300 leads por mês', verba: '15.000,00' };
    const invalido = await postarFormulario(caminho, ids.operador, 'objetivo', { ...campos, objetivo: 'a', fim: '2026-11-01', verba: 'abc' });
    assert.ok(invalido.status < 500, `status ${invalido.status}`);
    assert.match(invalido.texto, /Corrija os campos indicados/);
    assert.match(invalido.texto, /O fim não pode ser antes do início/);
    assert.match(invalido.texto, /Informe a verba em reais/);
    assert.equal(Number(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE client_id = '${clientes.semPlano}'`)), 0);

    const semFoco = await postarFormulario(caminho, ids.operador, 'objetivo', { ...campos, focoMarca: '' });
    assert.match(semFoco.texto, /Escolha ao menos um produto ou marque campanha de marca/);
    assert.equal(Number(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE client_id = '${clientes.semPlano}'`)), 0);

    const semObjetivo = await postarFormulario(caminho, ids.operador, 'objetivo', { ...campos, acao: 'previa', objetivo: '' });
    assert.match(semObjetivo.texto, /Descreva o objetivo para ver os links/);
    const previa = await postarFormulario(caminho, ids.operador, 'objetivo', { ...campos, acao: 'previa' });
    assert.ok(previa.status < 500, `status ${previa.status}`);
    assert.match(previa.texto, /https:\/\/padaria\.example\.com\.br\/oferta\?utm_source=meta/);
    assert.equal(Number(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE client_id = '${clientes.semPlano}'`)), 0);

    const valido = await postarFormulario(caminho, ids.operador, 'objetivo', campos);
    assert.match(valido.destino, new RegExp(`/clientes/${clientes.semPlano}/estrategia/[0-9a-f-]{36}.*feito=Plano pedido`));
    assert.equal(Number(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE client_id = '${clientes.semPlano}'`)), 1);
    const depois = await pagina(rota(clientes.semPlano));
    assert.match(depois.texto, /Gerando|Em geração/);
  });

  it('o cadastro de destino aparece em Contexto: operador gerencia, viewer só lê', async () => {
    signIn(ids.operador);
    const comoOperador = await pagina(`/clientes/${clientes.semPlano}/contexto?secao=destino`);
    assert.equal(comoOperador.status, 200);
    assert.ok(comoOperador.texto.includes('+5511999998888'));
    assert.ok(comoOperador.texto.includes('Oferta de inauguração'));
    assert.ok(habilitado(comoOperador.texto, 'Salvar WhatsApp'));
    assert.ok(botao(comoOperador.texto, 'Arquivar').length > 0);
    signIn(ids.leitor);
    const comoLeitor = await pagina(`/clientes/${clientes.semPlano}/contexto?secao=destino`);
    assert.equal(comoLeitor.status, 200);
    assert.ok(comoLeitor.texto.includes('Oferta de inauguração'));
    assert.equal(botao(comoLeitor.texto, 'Salvar WhatsApp').length, 0);
    assert.equal(botao(comoLeitor.texto, 'Cadastrar landing page').length, 0);
  });

  it('a edição por campos explica o erro de cada campo em linguagem clara e nunca aceita conteúdo bruto', async () => {
    const caminho = rotaPlano(clientes.pronto, ids.pronto.plano);
    const base = { clienteId: clientes.pronto, planoId: ids.pronto.plano, versaoId: ids.pronto.versao, secao: 'resumo_executivo' };
    const vazio = await postarFormulario(caminho, ids.operador, 'campo:objetivo', { ...base, 'campo:objetivo': '   ' });
    assert.ok(vazio.status < 500);
    assert.match(vazio.texto, /Preencha este campo\./);
    const verba = await postarFormulario(caminho, ids.operador, 'campo:objetivo', { ...base, 'campo:verba': 'abc' });
    assert.match(verba.texto, /Informe a verba em reais/);
    const bruto = await postarFormulario(caminho, ids.operador, 'campo:objetivo', { ...base, json: '{"objetivo":"x"}', 'campo:objetivo': 'ok' });
    assert.match(bruto.texto, /não aceita conteúdo bruto/);
    const fora = await postarFormulario(caminho, ids.operador, 'campo:objetivo', { ...base, 'aposta_central.evidencias': 'x', 'campo:aposta_central.evidencias.0.urn': 'orla:x' });
    assert.match(fora.texto, /Este campo não pode ser editado/);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${ids.pronto.plano}'`), '2');
  });

  it('o pedido de mudança recusa texto curto e cria a execução do próprio plano', async () => {
    const caminho = rotaPlano(clientes.vigente, ids.vigente.plano);
    const base = { clienteId: clientes.vigente, planoId: ids.vigente.plano, versaoId: ids.vigente.versao };
    const curto = await postarFormulario(caminho, ids.operador, 'instrucao', { ...base, instrucao: 'x' });
    assert.match(curto.texto, /mínimo 3 caracteres/);
    const execucoes = () => Number(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE plan_id = '${ids.vigente.plano}' AND kind = 'ajustar'`));
    assert.equal(execucoes(), 0);
    const feito = await postarFormulario(caminho, ids.operador, 'instrucao', { ...base, instrucao: 'Reduzir a verba de social' });
    assert.match(feito.destino, /feito=Mudança pedida/);
    assert.equal(execucoes(), 1);
  });
  describe('com o Brain preenchido e as URNs reais do catálogo do cliente', () => {
    const brain = {};
    const urnDe = (cli, tipo, id) => `orla:${ids.org}:${cli}:${tipo}:${id}`;
    const URN_B = 'conhecimento_benchmark:binet_field_marca_ativacao-v1';
    const URN_D = 'conhecimento_pratica:promessa_de_ganho_garantido-v1';
    const URN_LEGAL = 'conhecimento_regra_legal:lgpd_base_legal_em_publicos-v1';
    const URN_REGRA = 'regra:governanca.sem_promessa_de_resultado';
    const URN_LIMITE = 'limite:investimento.teto_mensal--cliente';
    const URN_OBJETIVOS = 'contexto_secao:objetivos';
    const dividir = (urn) => urn.split(':');

    function planoComUrnsReais(cli) {
      const alias = (tipo, id) => urnDe(cli, tipo, id);
      const trocas = [
        [alias('tabela_de_dados', 'desempenho-ads'), urnDe(cli, ...dividir(URN_OBJETIVOS))],
        [alias('conhecimento', 'benchmark-b'), urnDe(cli, ...dividir(URN_B))],
        [alias('conhecimento', 'benchmark-d'), urnDe(cli, ...dividir(URN_D))],
        [alias('conhecimento', 'benchmark-vencido'), urnDe(cli, 'conhecimento_benchmark', 'haus_manual_x_automatico-v1')],
        [alias('conhecimento', 'regra-publicidade'), urnDe(cli, ...dividir(URN_LEGAL))],
        [alias('limite', 'teto-mensal'), urnDe(cli, ...dividir(URN_LIMITE))],
        [alias('tabela_de_dados', 'base-restrita'), urnDe(cli, ...dividir(URN_REGRA))],
      ];
      const plano = JSON.parse(trocas.reduce((texto, [de, para]) => texto.replaceAll(de, para), JSON.stringify(planoDoCliente(ids.org, cli))));
      plano.posicionamento_e_mensagem.promessa = {
        texto: 'Qualidade com entrega rápida.',
        hipotese: false,
        evidencias: [
          { urn: urnDe(cli, ...dividir(URN_D)), papel: 'favor' },
          { urn: urnDe(cli, ...dividir(URN_LEGAL)), papel: 'premissa' },
          { urn: urnDe(cli, ...dividir(URN_REGRA)), papel: 'premissa' },
        ],
      };
      plano.resumo_executivo.aposta_central = { ...plano.resumo_executivo.aposta_central, evidencias: plano.posicionamento_e_mensagem.promessa.evidencias };
      plano.resumo_executivo.resultado_esperado = { ...plano.resumo_executivo.resultado_esperado, evidencias: [...plano.resumo_executivo.resultado_esperado.evidencias, { urn: urnDe(cli, ...dividir(URN_LIMITE)), papel: 'premissa' }] };
      return plano;
    }

    async function referenciasReais(cli, conteudo) {
      const catalogo = await semear.catalogoDoCliente(cli);
      const citadas = JSON.stringify(conteudo).match(/orla:[0-9a-f-]{36}:[0-9a-f-]{36}:[a-z_]+:[^"\\]+/g) ?? [];
      const implicitas = [...catalogo.keys()].filter((urn) => ['limite', 'regra', 'decisao'].includes(urn.split(':')[3]));
      return [...new Set([...citadas, ...implicitas])].map((urn) => {
        const hash = catalogo.get(urn);
        assert.ok(hash, `URN fora do catálogo real: ${urn}`);
        return { urn, hash };
      });
    }

    async function clienteComBrain(nome) {
      const cli = cliente(ids.org, nome);
      semear.semearBrain(cli, ids.admin);
      const conteudo = planoComUrnsReais(cli);
      const plano = semear.planoNovo(cli, 'aquisicao', conteudo.intencao.whatsapp);
      const execucao = semear.iniciarExecucao({ cli, plano });
      const versao = semear.versaoRascunho(cli, plano, conteudo, { referencias: await referenciasReais(cli, conteudo) });
      semear.eventoDoWorker(cli, versao, 'parecer', parecer('redator', 'aprova', 'Mensagem clara.'), execucao);
      semear.eventoDoWorker(cli, versao, 'gate', gateAprovado(), execucao);
      semear.concluirExecucao(execucao.id);
      return { cli, plano, versao, conteudo };
    }

    function marca(texto, titulo) {
      const casos = [...semScripts(texto).matchAll(/<a class="marca"[^>]*>(?:(?!<\/a>)[\s\S])*<\/a>/g)].map((caso) => caso[0]);
      return casos.find((caso) => caso.includes(`marca__texto">${titulo}<`)) ?? null;
    }

    const versoes = (plano) => dono(`SELECT string_agg(status, ',' ORDER BY created_at) FROM core.strategy_plan_versions WHERE plan_id = '${plano}'`);

    before(async () => {
      brain.edicao = await clienteComBrain('Doceria Maré Mansa');
      brain.intencao = await clienteComBrain('Doceria Maré Cheia');
      brain.vigente = await clienteComBrain('Doceria Maré Firme');
      semear.eventoDaPessoa(brain.vigente.cli, brain.vigente.versao, 'proposta', ids.operador);
      semear.eventoDaPessoa(brain.vigente.cli, brain.vigente.versao, 'efetivada', ids.admin);
    });

    it('as marcas mostram o título da entrada do Brain, a nota e a hipótese, e levam ao Brain do cliente certo', async () => {
      signIn(ids.operador);
      const { status, texto } = await pagina(rotaPlano(brain.edicao.cli, brain.edicao.plano));
      assert.equal(status, 200);
      const b = marca(texto, 'Binet e Field: divisão entre marca e ativação');
      assert.ok(b, 'marca da entrada de benchmark');
      assert.match(b, /marca__nota marca__nota--b" title="Nota B: pesquisa com método"/);
      const d = marca(texto, 'Promessa de ganho garantido');
      assert.ok(d, 'marca da entrada de nota D');
      assert.match(d, /marca__nota marca__nota--d" title="Nota D: não verificável"/);
      const legal = marca(texto, 'LGPD: todo uso de dado pessoal em anúncios precisa de base legal');
      assert.ok(legal, 'marca da regra legal');
      assert.match(legal, /marca__nota marca__nota--a" title="Nota A: fonte primária"/);
      assert.ok(!legal.includes('não verificada'), 'a regra legal conferida não carrega a marca de não verificada');
      assert.ok(marca(texto, 'Regra: Não prometer resultado garantido'), 'marca da regra do cliente');
      assert.ok(marca(texto, 'Limite: Teto mensal de investimento'), 'marca do limite do cliente');
      assert.match(semScripts(texto), />\s*hipótese\s*</);
      for (const [, , href] of semScripts(texto).matchAll(/<a class="marca"( title="[^"]*")? href="([^"]+)"/g)) {
        assert.equal(href, `/clientes/${brain.edicao.cli}/contexto`);
      }
      const rotulos = [...semScripts(texto).matchAll(/<span class="marca__texto">([^<]+)<\/span>/g)].map((caso) => caso[1]);
      assert.ok(rotulos.every((rotulo) => !/^[a-z_]+$/.test(rotulo)), `nenhuma marca com o tipo cru da URN: ${rotulos.join(' | ')}`);
    });

    it('viewer não recebe título de evidência do Brain em nenhuma seção da Estratégia', async () => {
      await semAcessoAEstrategia(ids.leitor, brain.edicao.cli, [
        'Binet e Field: divisão entre marca e ativação',
        'Promessa de ganho garantido',
        'LGPD: todo uso de dado pessoal em anúncios precisa de base legal',
        'Regra: Não prometer resultado garantido',
        'Limite: Teto mensal de investimento',
      ], brain.edicao.plano);
    });

    it('edição com dado pessoal é recusada apontando o campo, sem repetir o dado e sem gravar', async () => {
      const base = { clienteId: brain.edicao.cli, planoId: brain.edicao.plano, versaoId: brain.edicao.versao, secao: 'resumo_executivo' };
      const antes = semear.fotografia();
      const resposta = await postarFormulario(rotaPlano(brain.edicao.cli, brain.edicao.plano), ids.operador, 'campo:objetivo', { ...base, 'campo:objetivo': 'Escreva para contato@doceria.example ou (81) 98888-7777' });
      assert.ok(resposta.status < 500, `status ${resposta.status}`);
      assert.match(resposta.texto, /O plano não pode conter dado pessoal/);
      assert.match(resposta.texto, /Dado pessoal/);
      const mensagens = resposta.texto.match(/"(?:erro|campos)":\{?"[^}]*\}?/g)?.join(' ') ?? '';
      assert.ok(mensagens.length > 0, 'mensagens de erro no estado do formulário');
      for (const dado of ['contato@doceria.example', '98888-7777']) assert.ok(!mensagens.includes(dado), `a mensagem repete ${dado}`);
      assert.equal(semear.fotografia(), antes, 'nenhuma escrita');
    });

    it('valor acima do limite aponta o campo e o texto digitado volta ao formulário em vez de se perder', async () => {
      const base = { clienteId: brain.edicao.cli, planoId: brain.edicao.plano, versaoId: brain.edicao.versao, secao: 'resumo_executivo' };
      const digitado = 'x'.repeat(401);
      const resposta = await postarFormulario(rotaPlano(brain.edicao.cli, brain.edicao.plano), ids.operador, 'campo:objetivo', { ...base, 'campo:objetivo': digitado });
      assert.match(resposta.texto, /No máximo 400 caracteres/);
      assert.ok(resposta.texto.includes('"valores"'), 'o estado devolve o que foi digitado');
      assert.ok(resposta.texto.includes(digitado), 'o texto digitado volta no estado');
      assert.equal(versoes(brain.edicao.plano), 'rascunho');
    });

    it('edição válida por campos de ponta a ponta: versão nova em rascunho, anterior cancelada, revisão pedida e Aplicar desabilitado', async () => {
      const base = { clienteId: brain.edicao.cli, planoId: brain.edicao.plano, versaoId: brain.edicao.versao, secao: 'resumo_executivo' };
      const feita = await postarFormulario(rotaPlano(brain.edicao.cli, brain.edicao.plano), ids.operador, 'campo:objetivo', { ...base, 'campo:objetivo': 'Qualidade com entrega em até 48 horas.' });
      assert.match(feita.destino, /feito=Seção editada/);
      assert.equal(versoes(brain.edicao.plano), 'cancelado,rascunho');
      const nova = dono(`SELECT id FROM core.strategy_plan_versions WHERE plan_id = '${brain.edicao.plano}' AND status = 'rascunho'`);
      assert.equal(dono(`SELECT author_kind || ':' || author_user_id FROM core.strategy_plan_versions WHERE id = '${nova}'`), `usuario:${ids.operador}`);
      assert.equal(dono(`SELECT content->'resumo_executivo'->>'objetivo' FROM core.strategy_plan_versions WHERE id = '${nova}'`), 'Qualidade com entrega em até 48 horas.');
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_refs WHERE version_id = '${nova}'`) > '0', true);
      assert.equal(
        dono(`SELECT actor_kind || ':' || (payload->>'motivo') FROM core.strategy_plan_events WHERE version_id = '${brain.edicao.versao}' AND kind = 'cancelada'`),
        'sistema:substituida_por_edicao',
      );
      assert.equal(
        dono(`SELECT kind || ':' || status || ':' || (pedido->>'motivo') || ':' || (base_version_id = '${nova}') FROM core.strategy_plan_runs WHERE plan_id = '${brain.edicao.plano}' AND kind = 'revisar'`),
        'revisar:pendente:edicao_manual:true',
      );
      const depois = await pagina(rotaPlano(brain.edicao.cli, brain.edicao.plano));
      assert.ok(desabilitado(depois.texto, 'Aplicar o plano'));
      assert.match(depois.texto, /Há uma execução em andamento/);
      assert.match(depois.texto, /Revisando o plano/);
      assert.ok(!TERMOS_INTERNOS.test(semAreaDeTexto(depois.texto)), 'sem Comitê, Gates ou Histórico');
    });

    it('a intenção é fixa: não há campo nem caminho para editá-la pela tela', async () => {
      const base = { clienteId: brain.intencao.cli, planoId: brain.intencao.plano, versaoId: brain.intencao.versao };
      const antes = semear.fotografia();
      const resposta = await postarFormulario(rotaPlano(brain.intencao.cli, brain.intencao.plano), ids.operador, 'campo:objetivo', { ...base, secao: 'intencao', 'campo:verba': '15.000,00' });
      assert.ok(resposta.status < 500);
      assert.match(resposta.texto, /Esta seção não pode ser editada/);
      assert.equal(semear.fotografia(), antes, 'nenhuma escrita');
    });

    it('Brain mudado: o plano vigente aparece desatualizado, só quem opera vê Pedir revisão e pedir cria a execução sem tocar na vigente', async () => {
      const { cli, plano, versao } = brain.vigente;
      signIn(ids.operador);
      const atual = await pagina(rotaPlano(cli, plano));
      assert.ok(!atual.texto.includes('O plano está desatualizado'), 'com o Brain igual ao lido, nada desatualizado');

      const decisoes = () => Number(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`));
      assert.equal(decisoes(), 2);
      comoApp(ids.org, ids.admin, `INSERT INTO core.client_decisions (organization_id, client_id, category, nature, origin, status, key, scope, title, context, body, decided_by)
        VALUES ('${ids.org}', '${cli}', 'etica_marca', 'regra', 'agencia', 'vigente', 'etica_marca.sem_comparacao', 'cliente', 'Sem comparação com concorrente nomeado', 'Política da agência', 'Nenhum anúncio compara a doceria com um concorrente pelo nome.', '${ids.admin}') RETURNING id`);
      dono(`INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value) VALUES ('${ids.org}', '${cli}', 'objetivos', 'objetivo_90_dias', '"Chegar a 600 encomendas por trimestre"'::jsonb)`);

      const desatualizado = await pagina(rotaPlano(cli, plano));
      assert.match(desatualizado.texto, /O plano está desatualizado: o contexto do cliente mudou/);
      assert.match(desatualizado.texto, /Limite ou regra nova: Regra: Sem comparação com concorrente nomeado/);
      assert.match(desatualizado.texto, /Conteúdo da entrada mudou: Contexto: Objetivos e metas/);
      assert.ok(habilitado(desatualizado.texto, 'Pedir revisão'));

      await semAcessoAEstrategia(ids.leitor, cli, ['O plano está desatualizado', 'Limite ou regra nova', 'Sem comparação com concorrente nomeado'], plano);

      signIn(ids.operador);
      const antes = versoes(plano);
      const acao = acaoDoBotao(desatualizado.texto, 'Pedir revisão');
      const feita = await submitAction(rotaPlano(cli, plano), acao, { clienteId: cli, planoId: plano });
      assert.match(destinoDe(feita), /feito=Revisão pedida/);
      assert.equal(
        dono(`SELECT kind || ':' || status || ':' || (pedido->>'motivo') || ':' || (base_version_id = '${versao}') || ':' || requested_kind FROM core.strategy_plan_runs WHERE plan_id = '${plano}' AND kind = 'revisar'`),
        'revisar:pendente:brain_mudou:true:usuario',
      );
      assert.equal(versoes(plano), antes);
      assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'vigente');
    });
    it('plano só com versões encerradas: a página mostra o último status e a lista o card, sem histórico', async () => {
      const cli = cliente(ids.org, 'Doceria Maré Quieta');
      const plano = semear.planoNovo(cli);
      const versao = semear.versaoRascunho(cli, plano, planoDoCliente(ids.org, cli));
      semear.eventoDaPessoa(cli, versao, 'cancelada', ids.operador);
      signIn(ids.operador);
      const planoTela = await pagina(rotaPlano(cli, plano));
      assert.equal(planoTela.status, 200);
      assert.match(planoTela.texto, /Cancelado/);
      assert.ok(!TERMOS_INTERNOS.test(semAreaDeTexto(planoTela.texto)));
      const lista = await pagina(rota(cli));
      assert.match(lista.texto, new RegExp(`href="${rotaPlano(cli, plano)}"`));
      assert.match(lista.texto, /Cancelado/);
    });
  });
});
