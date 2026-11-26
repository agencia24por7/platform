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
    if (existe !== 't') return `container ${PG_CONTAINER} sem as migrações 0143 e 0145 aplicadas`;
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

const secoesDoPlano = [
  'resumo_executivo', 'intencao', 'diagnostico', 'publico_alvo', 'comunidades_alvo', 'posicionamento_e_mensagem', 'estrategia',
  'canais_e_plataformas', 'campanhas', 'criativos', 'orcamento', 'metas_e_metricas', 'medicao', 'calendario', 'riscos_e_regras', 'lacunas',
];

describe('aba Estratégia da página do cliente (ADR 0055 e 0062 §10)', { concurrency: false, skip: pular }, () => {
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
    const destino = decodeURIComponent(resposta.headers.get('location') ?? texto.match(/"(\/[a-z0-9/?=%.&;-]*)"/i)?.[1] ?? '');
    return { status: resposta.status, texto, destino };
  }

  const postarFormulario = async (caminho, quem, campo, campos) => postar(caminho, quem, await ocultosDoFormulario(caminho, quem, campo), campos);
  const rota = (cli, resto = '') => `/clientes/${cli}/estrategia${resto}`;
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

  it('(a) sem plano: estado vazio e o botão Novo plano', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.semPlano));
    assert.equal(status, 200);
    assert.match(texto, /Este cliente ainda não tem plano/);
    assert.match(texto, new RegExp(`<a [^>]*href="${rota(clientes.semPlano, '\\?secao=plano&amp;novo=1')}[^"]*"[^>]*>Novo plano</a>`));
    assert.match(texto, /aria-label="Seções de Estratégia"/);
    assert.ok(texto.includes('>Estratégia<'), 'aba Estratégia na barra');
    for (const ruim of ['undefined', '[object Object]', 'NaN']) assert.ok(!semScripts(texto).includes(ruim), ruim);
  });

  it('(a) o formulário da intenção abre e traz rótulos em todo campo', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.semPlano, '?secao=plano&novo=1'));
    assert.equal(status, 200);
    for (const rotulo of ['Tipo de plano', 'Ousadia', 'Objetivo', 'Início do horizonte', 'Fim do horizonte', 'Retorno esperado', 'Verba disponível']) {
      assert.ok(texto.includes(rotulo), rotulo);
    }
    const campos = [...semScripts(texto).matchAll(/<(input|select|textarea)\b[^>]*\bname="(tipoDePlano|ousadia|objetivo|inicio|fim|retorno|verba)"[^>]*>/g)];
    assert.equal(campos.length, 7);
    for (const [tag] of campos) {
      const id = tag.match(/\bid="([^"]+)"/)?.[1];
      assert.ok(id && texto.includes(`for="${id}"`), `campo sem rótulo: ${tag.slice(0, 80)}`);
    }
  });

  it('(b) rascunho com execução ativa na etapa Comitê: indicador de etapas e nenhum Aplicar habilitado', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.andamento));
    assert.equal(status, 200);
    assert.match(texto, /Andamento da execução/);
    assert.match(texto, /etapas__item--atual"[^>]*aria-current="step"[\s\S]{0,900}?Comitê/);
    for (const etapa of ['Lendo o Brain', 'Redigindo', 'Ajustando']) assert.ok(texto.includes(etapa), etapa);
    assert.match(texto, /role="status"/);
    assert.ok(!habilitado(texto, 'Aplicar o plano'));
    assert.ok(desabilitado(texto, 'Aplicar o plano'));
    assert.match(texto, /Há uma execução em andamento/);
    assert.ok(habilitado(texto, 'Cancelar execução'));
  });

  it('(c) rascunho pronto: 16 seções com texto do plano, marcas de evidência e Aplicar habilitado para operator', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.pronto));
    assert.equal(status, 200);
    for (const chave of secoesDoPlano) assert.ok(texto.includes(`id="plano-${chave}"`), `seção ${chave}`);
    const plano = planoDoCliente(ids.org, clientes.pronto);
    assert.ok(texto.includes(plano.campanhas.campanhas[0].nome), 'nome da primeira campanha');
    assert.ok(texto.includes(plano.resumo_executivo.aposta_central.texto.slice(0, 40).replace(/&/g, '&amp;')), 'aposta central');
    assert.match(texto, /Em rascunho/);
    assert.match(texto, /O plano declara que o limite custo por lead não se aplica/);
    assert.match(texto, /item-do-plano--destaque/);
    assert.match(texto, /Sem histórico de leads no Brain/);
    assert.match(texto, /Verba, horizonte e objetivo só mudam editando a seção Intenção/);
    assert.match(texto, /Versão 2/);
    assert.match(texto, /R\$ [\d.]+,\d{2}/);
    assert.match(texto, /\d{2}\/\d{2}\/\d{4}/);
    const marcas = [...texto.matchAll(/<a class="marca" title="([^"]+)" href="([^"]+)"/g)];
    assert.ok(marcas.length > 0, 'marcas de evidência');
    for (const [, urn, href] of marcas) {
      assert.equal(href, `/clientes/${clientes.pronto}/contexto?secao=brain`);
      assert.ok(urn.startsWith(`orla:${ids.org}:${clientes.pronto}:`), urn);
    }
    assert.ok(habilitado(texto, 'Aplicar o plano'));
    assert.ok(botao(texto, 'Cancelar rascunho').length > 0);
    assert.match(texto, /Pedir mudança ao agente/);
    assert.match(texto, /Editar seção/);
    assert.match(texto, /Edição avançada/);
    assert.match(texto, /[0-9]+\/2000/);
    for (const ruim of ['undefined', '[object Object]', 'NaN']) assert.ok(!semScripts(texto).includes(ruim), ruim);
    assert.ok(!semAreaDeTexto(texto).includes('&quot;centavos&quot;'), 'JSON cru fora do editor avançado');
  });

  it('(d) em autorização: operator vê Autorizar desabilitado com motivo; admin vê habilitado', async () => {
    signIn(ids.operador);
    const comoOperador = await pagina(rota(clientes.emAutorizacao));
    assert.equal(comoOperador.status, 200);
    assert.match(comoOperador.texto, /Em autorização/);
    assert.ok(desabilitado(comoOperador.texto, 'Autorizar'));
    assert.match(comoOperador.texto, /Só quem administra pode autorizar ou rejeitar o plano/);
    assert.ok(!habilitado(comoOperador.texto, 'Autorizar'));

    signIn(ids.admin);
    const comoAdmin = await pagina(rota(clientes.emAutorizacao));
    assert.ok(habilitado(comoAdmin.texto, 'Autorizar'));
    assert.ok(botao(comoAdmin.texto, 'Rejeitar').some((b) => !b.desabilitado));
  });

  it('(e) autorizado: status Autorizado, Revogar só para quem administra e revisão pedida quando o Brain mudou', async () => {
    signIn(ids.admin);
    const comoAdmin = await pagina(rota(clientes.vigente));
    assert.equal(comoAdmin.status, 200);
    assert.match(comoAdmin.texto, /Autorizado/);
    assert.ok(habilitado(comoAdmin.texto, 'Revogar'));
    assert.match(comoAdmin.texto, /O plano está desatualizado: o Brain mudou/);
    assert.ok(habilitado(comoAdmin.texto, 'Pedir revisão'));
    signIn(ids.operador);
    const comoOperador = await pagina(rota(clientes.vigente));
    assert.ok(desabilitado(comoOperador.texto, 'Revogar'));
  });

  it('(f) execução que falhou por IA não configurada: aviso com link para /config', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.falhou));
    assert.equal(status, 200);
    assert.match(texto, /A inteligência artificial ainda não está configurada/);
    assert.match(texto, /<a [^>]*href="\/config"[^>]*>Abrir configurações<\/a>/);
    assert.ok(!texto.includes('ia_nao_configurada'));
  });

  it('(g) viewer lê tudo e não recebe nenhum formulário de ação', async () => {
    signIn(ids.leitor);
    for (const cli of [clientes.pronto, clientes.emAutorizacao, clientes.vigente, clientes.andamento, clientes.semPlano, clientes.preso]) {
      const { status, texto } = await pagina(rota(cli));
      assert.equal(status, 200);
      const limpo = semScripts(texto);
      for (const marca of ['name="versaoId"', 'name="planoId"', 'name="execucaoId"', 'name="instrucao"', 'name="objetivo"']) assert.ok(!limpo.includes(marca), `${marca} em ${cli}`);
      for (const rotulo of ['Aplicar o plano', 'Autorizar', 'Rejeitar', 'Revogar', 'Cancelar rascunho', 'Pedir mudança ao agente', 'Editar seção', 'Novo plano', 'Cancelar execução', 'Pedir revisão']) {
        assert.ok(!limpo.includes(`>${rotulo}<`), `${rotulo} em ${cli}`);
      }
    }
    const pronto = await pagina(rota(clientes.pronto));
    assert.ok(pronto.texto.includes('id="plano-campanhas"'), 'o viewer lê o plano');
  });

  it('(h) cada subseção responde 200 com o conteúdo esperado', async () => {
    signIn(ids.dono);
    const comite = await pagina(rota(clientes.pronto, '?secao=comite'));
    assert.equal(comite.status, 200);
    for (const esperado of ['Redator', 'Risco e legal', 'Aprova com ajuste', 'Promessa genérica.', 'A promessa está vaga', 'Dar um número à promessa', 'Acatado', 'Promessa com número']) {
      assert.ok(comite.texto.includes(esperado), esperado);
    }
    const gates = await pagina(rota(clientes.pronto, '?secao=gates'));
    assert.equal(gates.status, 200);
    for (const esperado of ['Gates aprovados', 'A verba fecha com a soma das campanhas', 'Comitê completo e todos os pontos respondidos', 'Aprovada']) {
      assert.ok(gates.texto.includes(esperado), esperado);
    }
    const historico = await pagina(rota(clientes.pronto, '?secao=historico'));
    assert.equal(historico.status, 200);
    for (const esperado of ['Versões', 'Eventos', 'Cancelado', 'Em rascunho', 'Parecer do Comitê', 'Ajuste do plano aos pareceres', 'Gates executados']) {
      assert.ok(historico.texto.includes(esperado), esperado);
    }
    for (const secao of ['comite', 'gates', 'historico']) {
      const vazio = await pagina(rota(clientes.semPlano, `?secao=${secao}`));
      assert.equal(vazio.status, 200, secao);
      assert.ok(!semScripts(vazio.texto).includes('undefined'));
    }
    assert.match(comite.texto, /aria-current="page"[^>]*>Comitê/);
  });

  it('segundo tipo de plano: o seletor oferece criar os tipos que o cliente ainda não tem', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.pronto));
    assert.equal(status, 200);
    assert.match(texto, /aria-label="Tipo de plano"/);
    assert.match(texto, new RegExp(`href="${rota(clientes.pronto, '\\?secao=plano&amp;novo=1&amp;tipo=marca')}"[^>]*>Novo plano de marca</a>`));
    const novoTipo = await pagina(rota(clientes.pronto, '?secao=plano&novo=1&tipo=marca'));
    assert.equal(novoTipo.status, 200);
    assert.match(novoTipo.texto, /Você informa só a intenção/);
    assert.match(novoTipo.texto, /<option value="marca" selected="">Marca<\/option>/);
    assert.ok(!novoTipo.texto.includes('<option value="aquisicao"'), 'o tipo que já existe não é oferecido');
    const semFormulario = await pagina(rota(clientes.pronto, '?secao=plano&tipo=marca'));
    assert.match(semFormulario.texto, /Este cliente ainda não tem plano/);
    assert.match(semFormulario.texto, />Novo plano</);
  });

  it('(i) outra organização e usuário restrito a outro cliente não veem o plano', async () => {
    signIn(ids.donoOutra);
    assert.equal((await pagina(rota(clientes.pronto))).status, 404);
    assert.equal((await pagina(rota(clientes.pronto, '?secao=comite'))).status, 404);
    signIn(ids.recortado);
    assert.equal((await pagina(rota(clientes.pronto))).status, 404);
    const proprio = await pagina(rota(clientes.outro));
    assert.equal(proprio.status, 200);
    assert.match(proprio.texto, /Este cliente ainda não tem plano/);
  });

  it('(i) toda server action recusa id de outro cliente da organização e de outra organização, sem gravar nada', async () => {
    signIn(ids.operador);
    const paginaDoPronto = (await pagina(rota(clientes.pronto))).texto;
    signIn(ids.admin);
    const paginaDaAutorizacao = (await pagina(rota(clientes.emAutorizacao))).texto;
    const paginaDoVigente = (await pagina(rota(clientes.vigente))).texto;
    const paginaDoAndamento = (await pagina(rota(clientes.andamento))).texto;

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
        const resposta = await submitAction(rota(atacante.cliente), caso.acao, { clienteId: atacante.cliente, [caso.campo]: caso.alvo });
        assert.match(destinoDe(resposta), caso.mensagem, `${caso.nome} por ${atacante.rotulo}`);
      }
    }
    assert.equal(semear.fotografia(), antes, 'nenhuma escrita');

    const comandos = [
      { nome: 'pedir mudança', campo: 'instrucao', extra: { instrucao: 'Reduzir a verba de social' } },
      { nome: 'editar seção', campo: 'json', extra: { secao: 'lacunas', json: '{"itens":[]}' } },
    ];
    for (const comando of comandos) {
      const ocultos = await ocultosDoFormulario(rota(clientes.pronto), ids.operador, comando.campo);
      for (const atacante of atacantes) {
        const resposta = await postar(rota(atacante.cliente), atacante.quem, ocultos, { clienteId: atacante.cliente, planoId: ids.pronto.plano, versaoId: ids.pronto.versao, ...comando.extra });
        assert.ok(resposta.status < 500, `${comando.nome}: ${resposta.status}`);
        assert.match(resposta.texto, /Plano não encontrado/, `${comando.nome} por ${atacante.rotulo}`);
      }
    }
    assert.equal(semear.fotografia(), antes, 'nenhuma escrita');
  });

  it('a edição e o pedido de mudança recusam quando a versão vista já não é a atual', async () => {
    const antes = semear.fotografia();
    const ocultosDaMudanca = await ocultosDoFormulario(rota(clientes.pronto), ids.operador, 'instrucao');
    const mudanca = await postar(rota(clientes.pronto), ids.operador, ocultosDaMudanca, { clienteId: clientes.pronto, planoId: ids.pronto.plano, versaoId: ids.pronto.primeira, instrucao: 'Reduzir a verba de social' });
    assert.match(mudanca.texto, /O plano mudou enquanto você editava\. Recarregue a página\./);
    const ocultosDaEdicao = await ocultosDoFormulario(rota(clientes.pronto), ids.operador, 'json');
    const edicao = await postar(rota(clientes.pronto), ids.operador, ocultosDaEdicao, { clienteId: clientes.pronto, planoId: ids.pronto.plano, versaoId: ids.pronto.primeira, secao: 'lacunas', json: '{"itens":[]}' });
    assert.match(edicao.texto, /O plano mudou enquanto você editava\. Recarregue a página\./);
    assert.equal(semear.fotografia(), antes);
    const pagina2 = await pagina(rota(clientes.pronto));
    assert.ok(pagina2.texto.includes(`name="versaoId" value="${ids.pronto.versao}"`), 'o formulário carrega a versão exibida');
  });

  it('(1) sem plano e com execução pendente: Cancelar execução funciona e Novo plano volta', async () => {
    signIn(ids.operador);
    const antes = await pagina(rota(clientes.preso));
    assert.equal(antes.status, 200);
    assert.match(antes.texto, /Andamento da execução|Etapa atual/);
    assert.ok(habilitado(antes.texto, 'Cancelar execução'));
    assert.ok(!antes.texto.includes('>Novo plano</a>'), 'sem link de novo plano enquanto a execução está ativa');
    const acao = acaoDoBotao(antes.texto, 'Cancelar execução');
    const resposta = await submitAction(rota(clientes.preso), acao, { clienteId: clientes.preso, execucaoId: ids.preso.execucao.id });
    assert.match(destinoDe(resposta), /feito=Execução cancelada/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_runs WHERE id = '${ids.preso.execucao.id}'`), 'cancelada');
    const depois = await pagina(rota(clientes.preso));
    assert.match(depois.texto, new RegExp(`<a [^>]*href="${rota(clientes.preso, '\\?secao=plano&amp;novo=1')}[^"]*"[^>]*>Novo plano</a>`));
    assert.ok(!habilitado(depois.texto, 'Cancelar execução'));
  });

  it('(2) execução presa: aviso claro e Cancelar execução, que funciona', async () => {
    signIn(ids.operador);
    const { status, texto } = await pagina(rota(clientes.parado));
    assert.equal(status, 200);
    assert.match(texto, /A execução não está avançando/);
    assert.ok(habilitado(texto, 'Cancelar execução'));
    const cancelada = await submitAction(rota(clientes.parado), acaoDoBotao(texto, 'Cancelar execução'), { clienteId: clientes.parado, execucaoId: ids.parado.execucao.id });
    assert.match(destinoDe(cancelada), /feito=Execução cancelada/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_runs WHERE id = '${ids.parado.execucao.id}'`), 'cancelada');
  });

  it('(i) a server action de aplicar recusa viewer e age para operator', async () => {
    signIn(ids.operador);
    const acaoDeAplicar = acaoDoBotao((await pagina(rota(clientes.acao))).texto, 'Aplicar o plano');
    const caminho = rota(clientes.acao);
    const proposta = (versao) => Number(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND kind = 'proposta'`));
    const alvo = ids.acao.versao;

    signIn(ids.leitor);
    const leitor = await submitAction(caminho, acaoDeAplicar, { clienteId: clientes.acao, versaoId: alvo });
    assert.match(destinoDe(leitor), /erro=/);
    assert.equal(proposta(alvo), 0);

    signIn(ids.operador);
    const feito = await submitAction(caminho, acaoDeAplicar, { clienteId: clientes.acao, versaoId: alvo });
    assert.match(destinoDe(feito), /feito=Plano aplicado/);
    assert.equal(proposta(alvo), 1);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${alvo}'`), 'proposto');
    const depois = await pagina(rota(clientes.acao));
    assert.match(depois.texto, /Em autorização/);
  });

  it('a server action de autorizar recusa operator e aceita admin', async () => {
    signIn(ids.admin);
    const acaoDeAutorizar = acaoDoBotao((await pagina(rota(clientes.emAutorizacao))).texto, 'Autorizar');
    const caminho = rota(clientes.emAutorizacao);
    const versao = ids.emAutorizacao.versao;
    signIn(ids.operador);
    const negada = await submitAction(caminho, acaoDeAutorizar, { clienteId: clientes.emAutorizacao, versaoId: versao });
    assert.match(destinoDe(negada), /erro=/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'proposto');
    signIn(ids.admin);
    const aceita = await submitAction(caminho, acaoDeAutorizar, { clienteId: clientes.emAutorizacao, versaoId: versao });
    assert.match(destinoDe(aceita), /feito=Plano autorizado/);
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'vigente');
  });

  it('o formulário de nova intenção valida no servidor e cria a execução', async () => {
    const caminho = rota(clientes.semPlano, '?secao=plano&novo=1');
    const campos = { clienteId: clientes.semPlano, tipoDePlano: 'aquisicao', objetivo: 'Gerar leads qualificados', inicio: '2026-12-01', fim: '2027-02-28', ousadia: 'moderado', retorno: '300 leads por mês', verba: '15.000,00' };
    const invalido = await postarFormulario(caminho, ids.operador, 'objetivo', { ...campos, objetivo: 'a', fim: '2026-11-01', verba: 'abc' });
    assert.ok(invalido.status < 500, `status ${invalido.status}`);
    assert.match(invalido.texto, /Corrija os campos indicados/);
    assert.match(invalido.texto, /O fim não pode ser antes do início/);
    assert.match(invalido.texto, /Informe a verba em reais/);
    assert.equal(Number(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE client_id = '${clientes.semPlano}'`)), 0);

    const valido = await postarFormulario(caminho, ids.operador, 'objetivo', campos);
    assert.match(valido.destino, /feito=Plano pedido/);
    assert.equal(dono(`SELECT pedido->'verba'->>'centavos' FROM core.strategy_plan_runs WHERE client_id = '${clientes.semPlano}'`), '1500000');
    const depois = await pagina(rota(clientes.semPlano));
    assert.match(depois.texto, /Andamento da execução|Etapa atual/);
  });

  it('a edição avançada de seção explica o erro de JSON e de esquema em linguagem clara', async () => {
    const caminho = rota(clientes.pronto);
    const base = { clienteId: clientes.pronto, planoId: ids.pronto.plano, versaoId: ids.pronto.versao, secao: 'lacunas' };
    const semJson = await postarFormulario(caminho, ids.operador, 'json', { ...base, json: '{segredo: 1' });
    assert.ok(semJson.status < 500);
    assert.match(semJson.texto, /O texto não é um JSON válido/);
    const mensagemDoErro = semJson.texto.match(/"erro":"[^"]*"/)?.[0] ?? '';
    assert.ok(mensagemDoErro.length > 0 && !mensagemDoErro.includes('segredo'), 'o texto digitado não volta na mensagem');
    const foraDoEsquema = await postarFormulario(caminho, ids.operador, 'json', { ...base, json: JSON.stringify({ itens: [{ id: 'x', tipo: 'limite_ausente', descricao: 'd', impacto: 'i' }] }) });
    assert.ok(foraDoEsquema.status < 500);
    assert.match(foraDoEsquema.texto, /Lacunas ›/);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${ids.pronto.plano}'`), '2');
  });

  it('o pedido de mudança recusa texto curto e cria a execução do próprio plano', async () => {
    const caminho = rota(clientes.vigente);
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
      const plano = semear.planoNovo(cli);
      const conteudo = planoComUrnsReais(cli);
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
      const { status, texto } = await pagina(rota(brain.edicao.cli));
      assert.equal(status, 200);
      const b = marca(texto, 'Binet e Field: divisão entre marca e ativação');
      assert.ok(b, 'marca da entrada de benchmark');
      assert.match(b, /marca__nota marca__nota--b" title="Nota B: pesquisa com método"/);
      const d = marca(texto, 'Promessa de ganho garantido');
      assert.ok(d, 'marca da entrada de nota D');
      assert.match(d, /marca__nota marca__nota--d" title="Nota D: não verificável"/);
      const legal = marca(texto, 'LGPD: base legal em públicos personalizados');
      assert.ok(legal, 'marca da regra legal');
      assert.match(legal, /marca__nota marca__nota--c" title="Nota C: dado de fornecedor"/);
      assert.ok(marca(texto, 'Regra: Não prometer resultado garantido'), 'marca da regra do cliente');
      assert.ok(marca(texto, 'Limite: Teto mensal de investimento'), 'marca do limite do cliente');
      assert.match(semScripts(texto), />\s*hipótese\s*</);
      for (const [, , href] of semScripts(texto).matchAll(/<a class="marca"( title="[^"]*")? href="([^"]+)"/g)) {
        assert.equal(href, `/clientes/${brain.edicao.cli}/contexto?secao=brain`);
      }
      const rotulos = [...semScripts(texto).matchAll(/<span class="marca__texto">([^<]+)<\/span>/g)].map((caso) => caso[1]);
      assert.ok(rotulos.every((rotulo) => !/^[a-z_]+$/.test(rotulo)), `nenhuma marca com o tipo cru da URN: ${rotulos.join(' | ')}`);
    });

    it('edição com dado pessoal é recusada apontando a seção, sem repetir o dado e sem gravar', async () => {
      const base = { clienteId: brain.edicao.cli, planoId: brain.edicao.plano, versaoId: brain.edicao.versao, secao: 'posicionamento_e_mensagem' };
      const secao = { ...brain.edicao.conteudo.posicionamento_e_mensagem, tom: 'Escreva para contato@doceria.example ou (81) 98888-7777' };
      const antes = semear.fotografia();
      const resposta = await postarFormulario(rota(brain.edicao.cli), ids.operador, 'json', { ...base, json: JSON.stringify(secao) });
      assert.ok(resposta.status < 500, `status ${resposta.status}`);
      assert.match(resposta.texto, /O plano não pode conter dado pessoal/);
      assert.match(resposta.texto, /Posicionamento e mensagem › tom/);
      const mensagens = resposta.texto.match(/"(?:erro|campos)":\{?"[^}]*\}?/g)?.join(' ') ?? '';
      assert.ok(mensagens.length > 0, 'mensagens de erro no estado do formulário');
      for (const dado of ['contato@doceria.example', '98888-7777']) assert.ok(!mensagens.includes(dado), `a mensagem repete ${dado}`);
      assert.equal(semear.fotografia(), antes, 'nenhuma escrita');
    });

    it('JSON inválido aponta o problema e o texto digitado volta ao editor em vez de se perder', async () => {
      const base = { clienteId: brain.edicao.cli, planoId: brain.edicao.plano, versaoId: brain.edicao.versao, secao: 'posicionamento_e_mensagem' };
      const digitado = '{ "promessa": { "texto": "abc" ';
      const resposta = await postarFormulario(rota(brain.edicao.cli), ids.operador, 'json', { ...base, json: digitado });
      assert.match(resposta.texto, /O texto não é um JSON válido/);
      assert.ok(resposta.texto.includes('"valores"'), 'o estado devolve o que foi digitado');
      assert.ok(resposta.texto.includes('{ \\"promessa\\": { \\"texto\\": \\"abc\\" '), 'o texto digitado volta no estado');
      assert.equal(versoes(brain.edicao.plano), 'rascunho');
    });

    it('edição válida de seção de ponta a ponta: versão nova em rascunho, anterior cancelada, revisão pedida e Aplicar desabilitado', async () => {
      const base = { clienteId: brain.edicao.cli, planoId: brain.edicao.plano, versaoId: brain.edicao.versao, secao: 'posicionamento_e_mensagem' };
      const promessa = { ...brain.edicao.conteudo.posicionamento_e_mensagem.promessa, texto: 'Qualidade com entrega em até 48 horas.' };
      const secao = { ...brain.edicao.conteudo.posicionamento_e_mensagem, promessa };
      const feita = await postarFormulario(rota(brain.edicao.cli), ids.operador, 'json', { ...base, json: JSON.stringify(secao) });
      assert.match(feita.destino, /feito=Seção editada/);
      assert.equal(versoes(brain.edicao.plano), 'cancelado,rascunho');
      const nova = dono(`SELECT id FROM core.strategy_plan_versions WHERE plan_id = '${brain.edicao.plano}' AND status = 'rascunho'`);
      assert.equal(dono(`SELECT author_kind || ':' || author_user_id FROM core.strategy_plan_versions WHERE id = '${nova}'`), `usuario:${ids.operador}`);
      assert.equal(dono(`SELECT content->'posicionamento_e_mensagem'->'promessa'->>'texto' FROM core.strategy_plan_versions WHERE id = '${nova}'`), 'Qualidade com entrega em até 48 horas.');
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_refs WHERE version_id = '${nova}'`) > '0', true);
      assert.equal(
        dono(`SELECT actor_kind || ':' || (payload->>'motivo') FROM core.strategy_plan_events WHERE version_id = '${brain.edicao.versao}' AND kind = 'cancelada'`),
        'sistema:substituida_por_edicao',
      );
      assert.equal(
        dono(`SELECT kind || ':' || status || ':' || (pedido->>'motivo') || ':' || (base_version_id = '${nova}') FROM core.strategy_plan_runs WHERE plan_id = '${brain.edicao.plano}' AND kind = 'revisar'`),
        'revisar:pendente:edicao_manual:true',
      );
      const depois = await pagina(rota(brain.edicao.cli));
      assert.ok(desabilitado(depois.texto, 'Aplicar o plano'));
      assert.match(depois.texto, /Falta parecer do Comitê/);
      assert.match(depois.texto, /Falta rodar os Gates/);
      assert.match(depois.texto, /Há uma execução em andamento/);
      assert.match(depois.texto, /Revisando o plano/);
      assert.ok(depois.texto.includes('Qualidade com entrega em até 48 horas.'), 'a tela mostra a versão nova');
    });

    it('editar a seção Intenção com outra verba é aceito e é a única forma de mudar a intenção', async () => {
      const base = { clienteId: brain.intencao.cli, planoId: brain.intencao.plano, versaoId: brain.intencao.versao, secao: 'intencao' };
      const secao = { ...brain.intencao.conteudo.intencao, verba: { centavos: '1500000', moeda: 'BRL' } };
      const feita = await postarFormulario(rota(brain.intencao.cli), ids.operador, 'json', { ...base, json: JSON.stringify(secao) });
      assert.match(feita.destino, /feito=Seção editada/);
      assert.equal(dono(`SELECT content->'intencao'->'verba'->>'centavos' FROM core.strategy_plan_versions WHERE plan_id = '${brain.intencao.plano}' AND status = 'rascunho'`), '1500000');
    });

    it('Brain mudado: o plano vigente aparece desatualizado, só quem opera vê Pedir revisão e pedir cria a execução sem tocar na vigente', async () => {
      const { cli, plano, versao } = brain.vigente;
      signIn(ids.operador);
      const atual = await pagina(rota(cli));
      assert.ok(!atual.texto.includes('O plano está desatualizado'), 'com o Brain igual ao lido, nada desatualizado');

      const decisoes = () => Number(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`));
      assert.equal(decisoes(), 2);
      comoApp(ids.org, ids.admin, `INSERT INTO core.client_decisions (organization_id, client_id, category, nature, origin, status, key, scope, title, context, body, decided_by)
        VALUES ('${ids.org}', '${cli}', 'etica_marca', 'regra', 'agencia', 'vigente', 'etica_marca.sem_comparacao', 'cliente', 'Sem comparação com concorrente nomeado', 'Política da agência', 'Nenhum anúncio compara a doceria com um concorrente pelo nome.', '${ids.admin}') RETURNING id`);
      dono(`INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value) VALUES ('${ids.org}', '${cli}', 'objetivos', 'objetivo_90_dias', '"Chegar a 600 encomendas por trimestre"'::jsonb)`);

      const desatualizado = await pagina(rota(cli));
      assert.match(desatualizado.texto, /O plano está desatualizado: o Brain mudou/);
      assert.match(desatualizado.texto, /Limite ou regra nova: Regra: Sem comparação com concorrente nomeado/);
      assert.match(desatualizado.texto, /Conteúdo da entrada mudou: Contexto: Objetivos e metas/);
      assert.ok(habilitado(desatualizado.texto, 'Pedir revisão'));

      signIn(ids.leitor);
      const leitor = await pagina(rota(cli));
      assert.match(leitor.texto, /O plano está desatualizado: o Brain mudou/);
      assert.ok(botao(leitor.texto, 'Pedir revisão').length === 0, 'viewer não recebe o botão');

      signIn(ids.operador);
      const antes = versoes(plano);
      const acao = acaoDoBotao(desatualizado.texto, 'Pedir revisão');
      const feita = await submitAction(rota(cli), acao, { clienteId: cli, planoId: plano });
      assert.match(destinoDe(feita), /feito=Revisão pedida/);
      assert.equal(
        dono(`SELECT kind || ':' || status || ':' || (pedido->>'motivo') || ':' || (base_version_id = '${versao}') || ':' || requested_kind FROM core.strategy_plan_runs WHERE plan_id = '${plano}' AND kind = 'revisar'`),
        'revisar:pendente:brain_mudou:true:usuario',
      );
      assert.equal(versoes(plano), antes);
      assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'vigente');
    });
    it('plano só com versões encerradas: a tela avisa onde ver e o Histórico lista as versões', async () => {
      const cli = cliente(ids.org, 'Doceria Maré Quieta');
      const plano = semear.planoNovo(cli);
      const versao = semear.versaoRascunho(cli, plano, planoDoCliente(ids.org, cli));
      semear.eventoDaPessoa(cli, versao, 'cancelada', ids.operador);
      signIn(ids.operador);
      const planoTela = await pagina(rota(cli));
      assert.match(planoTela.texto, /Não há plano em rascunho nem autorizado/);
      assert.match(planoTela.texto, /Status da última versão: cancelado/);
      assert.match(planoTela.texto, /Este cliente não tem plano em vigor/);
      const historico = await pagina(rota(cli, '?secao=historico'));
      assert.ok(!historico.texto.includes('Sem histórico ainda'));
      assert.match(historico.texto, /Cancelado/);
    });
  });
});
