import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, makeOwner, signIn, signOut, submitAction, workerHeaders } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as query, psqlComoApp } from './apoio/psql.mjs';

const sufixo = () => randomUUID().slice(0, 8);
const novaCredencial = () => `orla_ag_${randomBytes(32).toString('base64url')}`;
const hash = (credencial) => createHash('sha256').update(credencial, 'utf8').digest('hex');
const FERRAMENTA = 'brain_consultar_catalogo';

const naOrganizacao = (organizacao, usuario = '') =>
  `SET app.organization_id = '${organizacao}'; SET app.client_ids = '*'; SET app.user_id = '${usuario}'; `;
const comoApp = (sql) => psqlComoApp(sql).split('\n').pop().trim();

function recusado(sql) {
  try {
    psqlComoApp(sql);
    return null;
  } catch (erro) {
    return String(erro.message);
  }
}

function organizacaoComCliente(rotulo) {
  const s = sufixo();
  const org = query(`insert into core.organizations (name, slug, type) values ('Agência ${rotulo} ${s}', 'mcp-${rotulo}-${s}', 'agency') returning id`);
  const cliente = query(`insert into core.clients (organization_id, name, business_model) values ('${org}', 'Cliente ${rotulo} ${s}', 'leads') returning id`);
  const vizinho = query(`insert into core.clients (organization_id, name, business_model) values ('${org}', 'Vizinho ${rotulo} ${s}', 'leads') returning id`);
  return { org, cliente, vizinho };
}

function emitir(org, { clientes = null, ferramentas = [FERRAMENTA], criadaEm = 'now()', venceEm = "now() + interval '30 days'" } = {}) {
  const segredo = novaCredencial();
  const lista = clientes ? `ARRAY[${clientes.map((c) => `'${c}'`).join(',')}]::uuid[]` : 'NULL';
  const id = query(
    `insert into core.agent_credentials (organization_id, name, token_hash, token_label, client_ids, tools, created_at, expires_at)
     values ('${org}', 'Agente de teste', '${hash(segredo)}', 'orla_ag_••••test', ${lista},
             ARRAY[${ferramentas.map((f) => `'${f}'`).join(',')}]::text[], ${criadaEm}, ${venceEm}) returning id`,
  );
  return { id, segredo };
}

async function mcp(corpo, cabecalhos = {}) {
  const resposta = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...cabecalhos },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  });
  const texto = await resposta.text();
  const dados = texto.split('\n').find((linha) => linha.startsWith('data: '));
  let mensagem = null;
  try {
    mensagem = JSON.parse(dados ? dados.slice('data: '.length) : texto);
  } catch {
    mensagem = null;
  }
  return { status: resposta.status, texto, mensagem, cabecalhos: resposta.headers };
}

const semEscape = (valor) => valor.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

async function enviarFormularioComEstado(caminho, campo, campos) {
  const html = await (await browse(caminho)).text();
  const pedaco = html.split('<form').slice(1).find((formulario) => formulario.slice(0, formulario.indexOf('</form>')).includes(`name="${campo}"`));
  assert.ok(pedaco, `formulário com o campo ${campo} em ${caminho}`);
  const corpo = new FormData();
  for (const oculto of pedaco.slice(0, pedaco.indexOf('</form>')).matchAll(/<input type="hidden" name="(\$ACTION[^"]*)"(?: value="([^"]*)")?/g)) {
    corpo.set(oculto[1], semEscape(oculto[2] ?? ''));
  }
  for (const [chave, valor] of Object.entries(campos)) {
    if (Array.isArray(valor)) valor.forEach((item) => corpo.append(chave, item));
    else corpo.set(chave, valor);
  }
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: 'POST',
    headers: { Cookie: signIn(usuarioDaVez), Origin: BASE, Referer: `${BASE}${caminho}` },
    body: corpo,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  return { status: resposta.status, location: resposta.headers.get('location'), text: await resposta.text() };
}

let usuarioDaVez = '';
const entrar = (userId) => {
  usuarioDaVez = userId;
  return signIn(userId);
};

const portador = (segredo) => ({ authorization: `Bearer ${segredo}` });
const listar = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const consultar = (clienteId, extra = {}) => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: FERRAMENTA, arguments: { clienteId, ...extra } },
});
const conteudo = (resposta) => resposta.mensagem?.result?.content?.[0]?.text ?? '';
const naoEncontrado = (resposta) => resposta.mensagem?.result?.isError === true && conteudo(resposta) === 'Cliente não encontrado.';

describe('credencial de agente e servidor MCP (ADR 0057)', { concurrency: false }, () => {
  let a;
  let b;
  let usuario;

  before(async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    a = organizacaoComCliente('a');
    b = organizacaoComCliente('b');
    usuario = ensureUser(`mcp-${sufixo()}@tria.local`);
  });

  describe('banco: RLS e travessia por segredo', () => {
    it('o app só enxerga credenciais da organização do contexto; sem contexto, nenhuma', () => {
      emitir(a.org);
      emitir(b.org);
      assert.equal(comoApp(`${naOrganizacao(a.org)} select count(*) from core.agent_credentials where organization_id = '${b.org}'`), '0');
      assert.equal(comoApp(`${naOrganizacao(a.org)} select count(*) > 0 from core.agent_credentials`), 't');
      assert.equal(comoApp(`${naOrganizacao(a.org)} select count(distinct organization_id) from core.agent_credentials`), '1');
      assert.equal(comoApp(`select count(*) from core.agent_credentials`), '0');
    });

    it('o app não insere credencial em outra organização nem em nome de outro usuário', () => {
      const linha = (org, autor) =>
        `insert into core.agent_credentials (organization_id, name, token_hash, token_label, tools, expires_at, created_by)
         values ('${org}', 'x', '${hash(novaCredencial())}', 'orla_ag_••••test', ARRAY['${FERRAMENTA}'], now() + interval '1 day', ${autor})`;
      assert.match(recusado(`${naOrganizacao(a.org, usuario)} ${linha(b.org, `'${usuario}'`)}`) ?? '', /row-level security/);
      assert.match(recusado(`${naOrganizacao(a.org, usuario)} ${linha(a.org, `'${randomUUID()}'`)}`) ?? '', /row-level security/);
      assert.match(recusado(`${naOrganizacao(a.org, usuario)} ${linha(a.org, 'NULL')}`) ?? '', /row-level security/);
      assert.equal(recusado(`${naOrganizacao(a.org, usuario)} ${linha(a.org, `'${usuario}'`)}`), null);
    });

    it('o app só altera revoked_at, nunca apaga, e não revoga credencial de outra organização', () => {
      const deA = emitir(a.org);
      const deB = emitir(b.org);
      for (const coluna of [`token_hash = '${hash(novaCredencial())}'`, `expires_at = now() + interval '80 days'`, `client_ids = NULL`, `tools = ARRAY['outra_ferramenta']`, `organization_id = '${b.org}'`]) {
        assert.match(recusado(`${naOrganizacao(a.org)} update core.agent_credentials set ${coluna} where id = '${deA.id}'`) ?? '', /permission denied/);
      }
      assert.match(recusado(`${naOrganizacao(a.org)} delete from core.agent_credentials where id = '${deA.id}'`) ?? '', /permission denied/);
      comoApp(`${naOrganizacao(a.org)} update core.agent_credentials set revoked_at = now() where id = '${deB.id}'`);
      assert.equal(query(`select revoked_at is null from core.agent_credentials where id = '${deB.id}'`), 't');
      comoApp(`${naOrganizacao(a.org)} update core.agent_credentials set revoked_at = now() where id = '${deA.id}'`);
      assert.equal(query(`select revoked_at is not null from core.agent_credentials where id = '${deA.id}'`), 't');
    });

    it('o app não escolhe a data de criação nem reativa credencial revogada', () => {
      const comData = `insert into core.agent_credentials (organization_id, name, token_hash, token_label, tools, created_at, expires_at, created_by)
        values ('${a.org}', 'x', '${hash(novaCredencial())}', 'orla_ag_••••test', ARRAY['${FERRAMENTA}'], now() + interval '5 years', now() + interval '5 years 80 days', '${usuario}')`;
      assert.match(recusado(`${naOrganizacao(a.org, usuario)} ${comData}`) ?? '', /permission denied/);
      const jaRevogada = `insert into core.agent_credentials (organization_id, name, token_hash, token_label, tools, expires_at, created_by, revoked_at)
        values ('${a.org}', 'x', '${hash(novaCredencial())}', 'orla_ag_••••test', ARRAY['${FERRAMENTA}'], now() + interval '1 day', '${usuario}', NULL)`;
      assert.match(recusado(`${naOrganizacao(a.org, usuario)} ${jaRevogada}`) ?? '', /permission denied/);

      const credencial = emitir(a.org);
      comoApp(`${naOrganizacao(a.org)} update core.agent_credentials set revoked_at = now() where id = '${credencial.id}'`);
      assert.match(recusado(`${naOrganizacao(a.org)} update core.agent_credentials set revoked_at = NULL where id = '${credencial.id}'`) ?? '', /row-level security/);
      assert.equal(query(`select revoked_at is not null from core.agent_credentials where id = '${credencial.id}'`), 't');
    });

    it('validade acima de 90 dias, lista de clientes vazia e hash malformado não entram', () => {
      const linha = (campos) =>
        `insert into core.agent_credentials (organization_id, name, token_hash, token_label, client_ids, tools, expires_at)
         values ('${a.org}', 'x', ${campos.hash ?? `'${hash(novaCredencial())}'`}, 'orla_ag_••••test', ${campos.clientes ?? 'NULL'}, ARRAY['${FERRAMENTA}'], ${campos.vence ?? "now() + interval '1 day'"})`;
      const tenta = (campos) => {
        try {
          query(linha(campos));
          return null;
        } catch (erro) {
          return String(erro.message ?? erro.stderr ?? erro);
        }
      };
      assert.match(tenta({ vence: "now() + interval '91 days'" }) ?? '', /agent_credentials_prazo/);
      assert.match(tenta({ vence: "now() - interval '1 day'" }) ?? '', /agent_credentials_prazo/);
      assert.match(tenta({ clientes: "'{}'::uuid[]" }) ?? '', /check constraint/);
      assert.match(tenta({ hash: "'segredo-em-claro'" }) ?? '', /check constraint/);
    });

    it('a travessia só resolve o hash certo de credencial viva', () => {
      const viva = emitir(a.org, { clientes: [a.cliente] });
      const vencida = emitir(a.org, { criadaEm: "now() - interval '40 days'", venceEm: "now() - interval '1 day'" });
      const revogada = emitir(a.org);
      query(`update core.agent_credentials set revoked_at = now() where id = '${revogada.id}'`);
      const resolver = (h) => comoApp(`select coalesce((select organization_id::text || '|' || credential_id::text || '|' || client_ids::text from core.agente_resolver('${h}')), 'nada')`);

      assert.equal(resolver(hash(viva.segredo)), `${a.org}|${viva.id}|{${a.cliente}}`);
      assert.equal(resolver(hash(novaCredencial())), 'nada');
      assert.equal(resolver(hash(vencida.segredo)), 'nada');
      assert.equal(resolver(hash(revogada.segredo)), 'nada');
      assert.equal(resolver('nao-e-hash'), 'nada');
      assert.equal(resolver(viva.segredo), 'nada');
    });

    it('organização arquivada deixa de resolver', () => {
      const c = organizacaoComCliente('c');
      const credencial = emitir(c.org);
      const resolve = () => comoApp(`select count(*) from core.agente_resolver('${hash(credencial.segredo)}')`);
      assert.equal(resolve(), '1');
      query(`update core.organizations set status = 'archived' where id = '${c.org}'`);
      assert.equal(resolve(), '0');
    });

    it('o banco não guarda o segredo em coluna nenhuma', () => {
      const credencial = emitir(a.org);
      const linha = query(`select row_to_json(c)::text from core.agent_credentials c where id = '${credencial.id}'`);
      assert.equal(linha.includes(credencial.segredo), false);
      assert.equal(linha.includes(credencial.segredo.slice(8)), false);
    });
  });

  describe('rota /api/mcp', () => {
    it('sem credencial, com credencial inventada e com o token do worker responde 401', async () => {
      const worker = workerHeaders().Authorization;
      for (const cabecalhos of [{}, portador(novaCredencial()), { authorization: worker }, { authorization: 'Bearer ' }]) {
        const resposta = await mcp(listar, cabecalhos);
        assert.equal(resposta.status, 401);
        assert.equal(resposta.cabecalhos.get('www-authenticate'), 'Bearer');
      }
    });

    it('lote de mensagens e método fora da lista são recusados sem consultar o catálogo', async () => {
      const credencial = emitir(a.org);
      const base = Number(query(`select coalesce(max(id), 0) from audit.audit_log`));
      const lote = Array.from({ length: 50 }, (_, i) => ({ ...consultar(a.cliente), id: i }));
      assert.equal((await mcp(lote, portador(credencial.segredo))).status, 400);
      assert.equal((await mcp({ jsonrpc: '2.0', id: 1, method: 'subscriptions/listen' }, portador(credencial.segredo))).status, 400);
      assert.equal(query(`select count(*) from audit.audit_log where id > ${base} and action = 'brain.consulta' and target_id = '${a.cliente}'`), '0');
    });

    it('GET não é servido', async () => {
      const resposta = await fetch(`${BASE}/api/mcp`, { signal: AbortSignal.timeout(20000) });
      assert.equal(resposta.status, 405);
    });

    it('lista só a ferramenta do escopo e consulta o catálogo do próprio cliente', async () => {
      const credencial = emitir(a.org);
      const lista = await mcp(listar, portador(credencial.segredo));
      assert.equal(lista.status, 200);
      assert.deepEqual(lista.mensagem.result.tools.map((t) => t.name), [FERRAMENTA]);
      assert.equal(lista.mensagem.result.tools[0].annotations.readOnlyHint, true);

      const consulta = await mcp(consultar(a.cliente, { limite: 3 }), portador(credencial.segredo));
      assert.equal(consulta.status, 200);
      assert.notEqual(consulta.mensagem.result.isError, true);
      const pagina = JSON.parse(conteudo(consulta));
      assert.equal(pagina.clienteId, a.cliente);
      assert.match(pagina.catalogHash, /^[0-9a-f]{16,}$/);
      assert.ok(pagina.entradas.length > 0 && pagina.entradas.length <= 3);
      assert.deepEqual(Object.keys(pagina.entradas[0]).sort(), ['descricao', 'plataforma', 'sensibilidade', 'tipo', 'titulo', 'urn']);
      assert.equal(pagina.entradas.every((entrada) => entrada.urn.includes(a.cliente)), true);
    });

    it('credencial da organização A não alcança cliente da organização B', async () => {
      const deA = emitir(a.org);
      const deB = emitir(b.org);
      assert.equal(naoEncontrado(await mcp(consultar(b.cliente), portador(deA.segredo))), true);
      assert.equal(naoEncontrado(await mcp(consultar(a.cliente), portador(deB.segredo))), true);
      const propria = await mcp(consultar(b.cliente), portador(deB.segredo));
      assert.equal(JSON.parse(conteudo(propria)).clienteId, b.cliente);
    });

    it('lista de clientes da credencial restringe dentro da própria organização', async () => {
      const restrita = emitir(a.org, { clientes: [a.cliente] });
      assert.equal(JSON.parse(conteudo(await mcp(consultar(a.cliente), portador(restrita.segredo)))).clienteId, a.cliente);
      assert.equal(naoEncontrado(await mcp(consultar(a.vizinho), portador(restrita.segredo))), true);
    });

    it('id de cliente de outra organização na lista da credencial não abre nada', async () => {
      const forjada = emitir(a.org, { clientes: [b.cliente] });
      assert.equal(naoEncontrado(await mcp(consultar(b.cliente), portador(forjada.segredo))), true);
    });

    it('cliente excluído e cliente inexistente respondem igual', async () => {
      const c = organizacaoComCliente('d');
      const credencial = emitir(c.org);
      query(`update core.clients set excluido_em = now(), excluido_por = 'teste' where id = '${c.cliente}'`);
      const excluido = await mcp(consultar(c.cliente), portador(credencial.segredo));
      const inexistente = await mcp(consultar(randomUUID()), portador(credencial.segredo));
      assert.equal(naoEncontrado(excluido), true);
      assert.equal(conteudo(excluido), conteudo(inexistente));
    });

    it('credencial sem a ferramenta no escopo não lista nem executa', async () => {
      const semFerramenta = emitir(a.org, { ferramentas: ['ferramenta_que_nao_existe'] });
      const lista = await mcp(listar, portador(semFerramenta.segredo));
      assert.deepEqual(lista.mensagem?.result?.tools ?? [], []);
      assert.equal(lista.texto.includes(FERRAMENTA), false);
      const consulta = await mcp(consultar(a.cliente), portador(semFerramenta.segredo));
      assert.equal(consulta.mensagem?.result?.isError === true || consulta.mensagem?.error !== undefined, true);
      assert.equal(consulta.texto.includes(a.cliente), false);
    });

    it('revogar corta o acesso na chamada seguinte', async () => {
      const credencial = emitir(a.org);
      assert.equal((await mcp(listar, portador(credencial.segredo))).status, 200);
      query(`update core.agent_credentials set revoked_at = now() where id = '${credencial.id}'`);
      assert.equal((await mcp(listar, portador(credencial.segredo))).status, 401);
    });

    it('audita o agente como ator, só com contagens, e registra o uso da credencial', async () => {
      const credencial = emitir(a.org);
      const base = Number(query(`select coalesce(max(id), 0) from audit.audit_log`));
      await mcp(consultar(a.cliente, { limite: 2 }), portador(credencial.segredo));
      const linha = query(
        `select actor_type || '|' || actor_id || '|' || organization_id::text || '|' || metadata::text from audit.audit_log
          where id > ${base} and action = 'brain.consulta' and target_id = '${a.cliente}' order by id desc limit 1`,
      );
      const [tipo, ator, organizacao, metadados] = linha.split('|');
      assert.deepEqual([tipo, ator, organizacao], ['agent', credencial.id, a.org]);
      assert.deepEqual(Object.keys(JSON.parse(metadados)).sort(), ['devolvidas', 'omitidas', 'restritas', 'rota', 'total']);
      assert.equal(linha.includes(credencial.segredo), false);
      assert.equal(query(`select last_used_at is not null from core.agent_credentials where id = '${credencial.id}'`), 't');
    });

    it('a rota do worker continua fechada para a credencial de agente', async () => {
      const credencial = emitir(a.org);
      const resposta = await fetch(`${BASE}/api/v0/brain/clientes/${a.cliente}/catalogo`, { headers: portador(credencial.segredo), signal: AbortSignal.timeout(20000) });
      assert.equal(resposta.status, 401);
    });
  });

  describe('tela /config/agentes', () => {
    const membro = (org, papel) => {
      const id = ensureUser(`mcp-${papel}-${sufixo()}@tria.local`);
      query(`insert into core.members (organization_id, user_id, role) values ('${org}', '${id}', '${papel}')`);
      return id;
    };

    it('sem sessão redireciona para a entrada', async () => {
      signOut();
      const resposta = await browse('/config/agentes');
      assert.equal(resposta.status, 307);
      assert.match(resposta.headers.get('location') ?? '', /\/api\/auth\/google\/start/);
    });

    it('quem opera ou só enxerga não abre a tela', async () => {
      for (const papel of ['operator', 'viewer']) {
        signIn(membro(a.org, papel));
        const resposta = await browse('/config/agentes');
        assert.equal(resposta.status, 307);
        assert.match(resposta.headers.get('location') ?? '', /\/config$/);
        assert.equal((await resposta.text()).includes('orla_ag_'), false);
      }
      signOut();
    });

    it('quem responde pela organização vê só as credenciais dela, sem segredo', async () => {
      const dono = ensureUser(`mcp-dono-${sufixo()}@tria.local`);
      makeOwner(dono, a.org);
      const deA = emitir(a.org);
      const deB = emitir(b.org);
      query(`update core.agent_credentials set name = 'Marca A ' || id::text where id = '${deA.id}'`);
      query(`update core.agent_credentials set name = 'Marca B ' || id::text where id = '${deB.id}'`);
      signIn(dono);
      const resposta = await browse('/config/agentes');
      const html = await resposta.text();
      assert.equal(resposta.status, 200);
      assert.equal(html.includes(`Marca A ${deA.id}`), true);
      assert.equal(html.includes(`Marca B ${deB.id}`), false);
      assert.equal(html.includes(deA.segredo), false);
      assert.equal(html.includes(hash(deA.segredo)), false);
      assert.equal(html.includes(FERRAMENTA), true);
      signOut();
    });

    it('criações simultâneas não passam do teto de credenciais ativas', async () => {
      const c = organizacaoComCliente('teto');
      const dono = ensureUser(`mcp-dono-${sufixo()}@tria.local`);
      makeOwner(dono, c.org);
      for (let i = 0; i < 19; i += 1) emitir(c.org);
      entrar(dono);
      const campos = { nome: 'Corrida', ferramentas: [FERRAMENTA], alcance: 'organizacao', validadeEmDias: '7' };
      await Promise.all(Array.from({ length: 4 }, () => enviarFormularioComEstado('/config/agentes', 'nome', campos)));
      assert.equal(query(`select count(*) from core.agent_credentials where organization_id = '${c.org}' and revoked_at is null`), '20');
      signOut();
    });

    it('revoga pela tela a credencial da própria organização e nunca a de outra', async () => {
      const dono = ensureUser(`mcp-dono-${sufixo()}@tria.local`);
      makeOwner(dono, a.org);
      const deA = emitir(a.org);
      const deB = emitir(b.org);
      signIn(dono);
      const acao = await acaoComCampo('/config/agentes', 'credencialId');
      const base = Number(query(`select coalesce(max(id), 0) from audit.audit_log`));

      await submitAction('/config/agentes', acao, { credencialId: deB.id });
      assert.equal(query(`select revoked_at is null from core.agent_credentials where id = '${deB.id}'`), 't');

      await submitAction('/config/agentes', acao, { credencialId: deA.id });
      assert.equal(query(`select revoked_at is not null from core.agent_credentials where id = '${deA.id}'`), 't');
      assert.equal((await mcp(listar, portador(deA.segredo))).status, 401);
      assert.equal((await mcp(listar, portador(deB.segredo))).status, 200);
      assert.equal(
        query(`select actor_type || '|' || actor_id || '|' || target_id from audit.audit_log where id > ${base} and action = 'ia.credencial_revogada'`),
        `user|${dono}|${deA.id}`,
      );
      signOut();
    });

    it('cria pela tela: o segredo aparece uma vez, funciona no MCP e some na recarga', async () => {
      const dono = ensureUser(`mcp-dono-${sufixo()}@tria.local`);
      makeOwner(dono, a.org);
      entrar(dono);
      const nome = `Criada pela tela ${sufixo()}`;
      const resposta = await enviarFormularioComEstado('/config/agentes', 'nome', {
        nome,
        ferramentas: [FERRAMENTA],
        alcance: 'clientes',
        clienteIds: [a.cliente],
        validadeEmDias: '7',
      });
      const segredo = resposta.text.match(/orla_ag_[A-Za-z0-9_-]{43}/)?.[0];
      assert.ok(segredo, 'a resposta da criação traz a credencial uma vez');
      assert.equal(resposta.location, null);

      const guardada = query(`select token_hash || '|' || client_ids::text || '|' || (expires_at - created_at)::text from core.agent_credentials where name = '${nome}'`);
      assert.equal(guardada, `${hash(segredo)}|{${a.cliente}}|7 days`);
      assert.equal(JSON.parse(conteudo(await mcp(consultar(a.cliente), portador(segredo)))).clienteId, a.cliente);
      assert.equal(naoEncontrado(await mcp(consultar(a.vizinho), portador(segredo))), true);

      const recarga = await (await browse('/config/agentes')).text();
      assert.equal(recarga.includes(nome), true);
      assert.equal(recarga.includes(segredo), false);
      signOut();
    });

    it('a tela recusa cliente de outra organização e validade acima do teto', async () => {
      const dono = ensureUser(`mcp-dono-${sufixo()}@tria.local`);
      makeOwner(dono, a.org);
      entrar(dono);
      const antes = query(`select count(*) from core.agent_credentials where organization_id = '${a.org}'`);
      for (const campos of [
        { alcance: 'clientes', clienteIds: [b.cliente], validadeEmDias: '7' },
        { alcance: 'organizacao', validadeEmDias: '365' },
        { alcance: 'clientes', validadeEmDias: '7' },
      ]) {
        const resposta = await enviarFormularioComEstado('/config/agentes', 'nome', { nome: 'Recusada', ferramentas: [FERRAMENTA], ...campos });
        assert.equal(/orla_ag_[A-Za-z0-9_-]{43}/.test(resposta.text), false);
      }
      assert.equal(query(`select count(*) from core.agent_credentials where organization_id = '${a.org}'`), antes);
      signOut();
    });

    it('quem opera não revoga, mesmo chamando a ação direto', async () => {
      const dono = ensureUser(`mcp-dono-${sufixo()}@tria.local`);
      makeOwner(dono, a.org);
      const credencial = emitir(a.org);
      signIn(dono);
      const acao = await acaoComCampo('/config/agentes', 'credencialId');
      signIn(membro(a.org, 'operator'));
      await submitAction('/config/agentes', acao, { credencialId: credencial.id });
      assert.equal(query(`select revoked_at is null from core.agent_credentials where id = '${credencial.id}'`), 't');
      signOut();
    });
  });
});
