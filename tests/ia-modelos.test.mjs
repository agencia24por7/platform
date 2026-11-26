import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, makeOwner, post, signIn, signOut, submitAction } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as query, psqlComoApp, psqlComoWorker } from './apoio/psql.mjs';

const sufixo = () => randomUUID().slice(0, 8);
const chaveDeTeste = () => `orla-teste:${randomUUID()}${randomUUID()}`;
const CHAVE_RECUSADA = 'orla-teste:chave-recusada-pelo-fornecedor';
const TAREFA = 'teste_de_modelo';
const PAGINA = '/config/ia';

const naOrganizacao = (organizacao, clientes = '*') => `SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; SET app.user_id = ''; `;
const comoApp = (sql) => psqlComoApp(sql).split('\n').pop().trim();

function recusado(executar) {
  try {
    executar();
    return null;
  } catch (erro) {
    return String(erro.message);
  }
}

function organizacao(rotulo) {
  const s = sufixo();
  const org = query(`insert into core.organizations (name, slug, type) values ('Agência ${rotulo} ${s}', 'ia-${rotulo}-${s}', 'agency') returning id`);
  const cliente = query(`insert into core.clients (organization_id, name, business_model) values ('${org}', 'Cliente ${rotulo} ${s}', 'leads') returning id`);
  const dono = ensureUser(`ia-dono-${s}@tria.local`);
  makeOwner(dono, org);
  return { org, cliente, dono };
}

function membro(org, papel) {
  const id = ensureUser(`ia-${papel}-${sufixo()}@tria.local`);
  query(`insert into core.members (organization_id, user_id, role) values ('${org}', '${id}', '${papel}')`);
  return id;
}

const semEscape = (valor) => valor.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

async function formularios() {
  const html = await (await browse(PAGINA)).text();
  return html.split('<form').slice(1).map((pedaco) => pedaco.slice(0, pedaco.indexOf('</form>')));
}

async function acaoDoBotao(texto) {
  const formulario = (await formularios()).find((candidato) => candidato.includes(texto));
  assert.ok(formulario, `formulário com o botão "${texto}"`);
  const id = formulario.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
  assert.ok(id, `ação do botão "${texto}"`);
  return id;
}

async function enviar(botao, campos) {
  return submitAction(PAGINA, await acaoDoBotao(botao), campos);
}

async function testarModelo(cookie) {
  const formulario = (await formularios()).find((candidato) => candidato.includes('name="teste"'));
  assert.ok(formulario, 'formulário de teste de modelo');
  const corpo = new FormData();
  for (const oculto of formulario.matchAll(/<input type="hidden" name="(\$ACTION[^"]*)"(?: value="([^"]*)")?/g)) corpo.set(oculto[1], semEscape(oculto[2] ?? ''));
  corpo.set('teste', 'modelo');
  const resposta = await fetch(`${BASE}${PAGINA}`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: BASE, Referer: `${BASE}${PAGINA}` },
    body: corpo,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  return resposta.text();
}

const usos = (org) => Number(query(`select count(*) from core.ai_usage where organization_id = '${org}'`));

describe('IA: chave do fornecedor, modelo por tarefa, uso e teto (ADR 0058)', { concurrency: false }, () => {
  let a;
  let b;

  before(async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    a = organizacao('a');
    b = organizacao('b');
  });

  describe('tela /config/ia', () => {
    it('sem sessão redireciona; quem opera ou só enxerga não abre', async () => {
      signOut();
      assert.equal((await browse(PAGINA)).status, 307);
      for (const papel of ['operator', 'viewer']) {
        signIn(membro(a.org, papel));
        const resposta = await browse(PAGINA);
        assert.equal(resposta.status, 307);
        assert.match(resposta.headers.get('location') ?? '', /\/config$/);
      }
      signOut();
    });

    it('chave recusada pelo fornecedor não é guardada', async () => {
      signIn(a.dono);
      await enviar('Testar e guardar', { fornecedor: 'google', chave: CHAVE_RECUSADA });
      assert.equal(query(`select count(*) from core.ai_provider_keys where organization_id = '${a.org}'`), '0');
      signOut();
    });

    it('fornecedor fora da lista habilitada não aceita chave', async () => {
      signIn(a.dono);
      for (const fornecedor of ['moonshot', 'xai', 'inexistente']) {
        await submitAction(PAGINA, await acaoDoBotao('Testar e guardar'), { fornecedor, chave: chaveDeTeste() });
      }
      assert.equal(query(`select count(*) from core.ai_provider_keys where organization_id = '${a.org}'`), '0');
      signOut();
    });

    it('guarda a chave selada: o banco, a auditoria e a página nunca têm o valor', async () => {
      signIn(a.dono);
      const chave = chaveDeTeste();
      const base = Number(query(`select coalesce(max(id), 0) from audit.audit_log`));
      const resposta = await enviar('Testar e guardar', { fornecedor: 'google', chave });
      assert.equal(resposta.text.includes(chave), false);
      assert.equal((resposta.location ?? resposta.redirectedTo ?? '').includes(chave), false);

      const linha = query(`select kms_key_version || '|' || key_label || '|' || array_to_string(models, ',')
                             from core.ai_provider_keys where organization_id = '${a.org}' and provider = 'google'`);
      assert.match(linha, /^local:v1\|••••[0-9a-f-]{4}\|modelo-de-teste-a,modelo-de-teste-b$/);
      const selado = Buffer.from(query(`select encode(key_ciphertext, 'hex') from core.ai_provider_keys where organization_id = '${a.org}' and provider = 'google'`), 'hex');
      assert.ok(selado.length > chave.length);
      assert.equal(selado.includes(Buffer.from(chave, 'utf8')), false);
      assert.equal(selado.includes(Buffer.from(chave.slice(11, 30), 'utf8')), false);

      const auditoria = query(`select metadata::text from audit.audit_log where id > ${base} and action = 'ia.chave_guardada' and organization_id = '${a.org}'`);
      assert.deepEqual(JSON.parse(auditoria), { fornecedor: 'google', modelos: 2 });
      const pagina = await (await browse(PAGINA)).text();
      assert.equal(pagina.includes(chave), false);
      assert.equal(pagina.includes('modelo-de-teste-a'), true);
      signOut();
    });

    it('modelo fora da lista, tarefa desconhecida e fornecedor sem chave não viram escolha', async () => {
      signIn(a.dono);
      const acao = await acaoDoBotao('Salvar</button>');
      await submitAction(PAGINA, acao, { tarefa: TAREFA, escolha: 'google|modelo-que-a-chave-nao-alcanca' });
      await submitAction(PAGINA, acao, { tarefa: 'tarefa_inexistente', escolha: 'google|modelo-de-teste-a' });
      await submitAction(PAGINA, acao, { tarefa: TAREFA, escolha: 'anthropic|modelo-de-teste-a' });
      assert.equal(query(`select count(*) from core.ai_task_models where organization_id = '${a.org}'`), '0');
      await submitAction(PAGINA, acao, { tarefa: TAREFA, escolha: 'google|modelo-de-teste-a' });
      assert.equal(query(`select provider || '|' || model from core.ai_task_models where organization_id = '${a.org}' and task = '${TAREFA}'`), 'google|modelo-de-teste-a');
      signOut();
    });

    it('testar modelo chama pelo executor e registra uma linha de uso só com contagens', async () => {
      const cookie = signIn(a.dono);
      const antes = usos(a.org);
      const html = await testarModelo(cookie);
      assert.equal(html.includes('Olá do modelo de teste.'), true);
      assert.equal(usos(a.org), antes + 1);
      const linha = query(`select task || '|' || provider || '|' || model || '|' || result || '|' || input_tokens || '|' || output_tokens || '|' || steps || '|' || reserved_tokens
                             from core.ai_usage where organization_id = '${a.org}' order by id desc limit 1`);
      assert.equal(linha, `${TAREFA}|google|modelo-de-teste-a|ok|12|8|1|200`);
      signOut();
    });

    it('salvar tetos não religa a IA, e desligar não apaga os tetos', async () => {
      signIn(a.dono);
      const acaoDosTetos = await acaoDoBotao('Salvar tetos');
      await enviar('Desligar a IA da organização', { ligada: 'nao' });
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: '150', tokensPorDia: '1500000' });
      assert.equal(query(`select enabled || '|' || daily_calls || '|' || daily_tokens from core.ai_settings where organization_id = '${a.org}'`), 'false|150|1500000');
      await enviar('Ligar a IA da organização', { ligada: 'sim' });
      assert.equal(query(`select enabled || '|' || daily_calls || '|' || daily_tokens from core.ai_settings where organization_id = '${a.org}'`), 'true|150|1500000');
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: '200', tokensPorDia: '2000000' });
      signOut();
    });

    it('desligada: o teste é recusado e nenhuma linha de uso nasce; religar volta a funcionar', async () => {
      const cookie = signIn(a.dono);
      await enviar('Desligar a IA da organização', { ligada: 'nao' });
      assert.equal(query(`select enabled from core.ai_settings where organization_id = '${a.org}'`), 'f');
      const antes = usos(a.org);
      const html = await testarModelo(cookie);
      assert.equal(html.includes('A IA está desligada'), true);
      assert.equal(html.includes('Olá do modelo de teste.'), false);
      assert.equal(usos(a.org), antes);
      await enviar('Ligar a IA da organização', { ligada: 'sim' });
      assert.equal((await testarModelo(cookie)).includes('Olá do modelo de teste.'), true);
      signOut();
    });

    it('só quem responde pela organização muda os tetos; atingido o teto de chamadas, o teste para', async () => {
      signIn(a.dono);
      const acaoDosTetos = await acaoDoBotao('Salvar tetos');
      signIn(membro(a.org, 'admin'));
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: '99999', tokensPorDia: '999999999' });
      assert.notEqual(query(`select daily_calls from core.ai_settings where organization_id = '${a.org}'`), '99999');

      const cookie = signIn(a.dono);
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: String(usos(a.org) + 1), tokensPorDia: '2000000' });
      assert.equal((await testarModelo(cookie)).includes('Olá do modelo de teste.'), true);
      const noTeto = usos(a.org);
      const barrado = await testarModelo(cookie);
      assert.equal(barrado.includes('teto diário de chamadas'), true);
      assert.equal(usos(a.org), noTeto);
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: '200', tokensPorDia: '2000000' });
      signOut();
    });

    it('chamadas simultâneas não passam do teto', async () => {
      const cookie = signIn(a.dono);
      const acaoDosTetos = await acaoDoBotao('Salvar tetos');
      const base = usos(a.org);
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: String(base + 2), tokensPorDia: '2000000' });
      await Promise.all(Array.from({ length: 6 }, () => testarModelo(cookie)));
      assert.equal(usos(a.org), base + 2);
      await submitAction(PAGINA, acaoDosTetos, { chamadasPorDia: '200', tokensPorDia: '2000000' });
      signOut();
    });

    it('a organização B não vê chave, escolha nem uso da A', async () => {
      signIn(b.dono);
      const pagina = await (await browse(PAGINA)).text();
      assert.equal(pagina.includes('modelo-de-teste-a'), false);
      assert.equal(pagina.includes('Sem chave'), true);
      signOut();
    });
  });

  describe('banco: RLS e privilégios', () => {
    it('o app só enxerga as linhas da organização do contexto, e usuário com recorte de clientes não enxerga nenhuma', () => {
      for (const tabela of ['ai_provider_keys', 'ai_task_models', 'ai_settings', 'ai_usage']) {
        assert.equal(comoApp(`${naOrganizacao(a.org)} select count(*) > 0 from core.${tabela}`), 't', tabela);
        assert.equal(comoApp(`${naOrganizacao(b.org)} select count(*) from core.${tabela} where organization_id = '${a.org}'`), '0', tabela);
        assert.equal(comoApp(`${naOrganizacao(a.org, a.cliente)} select count(*) from core.${tabela}`), '0', tabela);
        assert.equal(comoApp(`select count(*) from core.${tabela}`), '0', tabela);
      }
    });

    it('o app não grava chave nem escolha em outra organização', () => {
      const chave = `insert into core.ai_provider_keys (organization_id, provider, key_ciphertext, kms_key_version, key_algorithm, key_label)
                     values ('${b.org}', 'openai', decode(repeat('00', 64), 'hex'), 'local:v1', 'aes-256-gcm+local', '••••0000')`;
      assert.match(recusado(() => psqlComoApp(`${naOrganizacao(a.org)} ${chave}`)) ?? '', /row-level security/);
      assert.match(recusado(() => psqlComoApp(`${naOrganizacao(a.org)} update core.ai_provider_keys set organization_id = '${b.org}' where organization_id = '${a.org}'`)) ?? '', /row-level security/);
    });

    it('o app não escolhe a data nem o resultado inicial do uso, não muda a reserva e não apaga uso', () => {
      const base = `${naOrganizacao(a.org)} insert into core.ai_usage (organization_id, task, provider, model, reserved_tokens`;
      assert.match(recusado(() => psqlComoApp(`${base}, occurred_at) values ('${a.org}', '${TAREFA}', 'google', 'm', 10, now() - interval '2 days')`)) ?? '', /permission denied/);
      assert.match(recusado(() => psqlComoApp(`${base}, result) values ('${a.org}', '${TAREFA}', 'google', 'm', 10, 'ok')`)) ?? '', /permission denied/);
      assert.match(recusado(() => psqlComoApp(`${naOrganizacao(a.org)} update core.ai_usage set reserved_tokens = 1 where organization_id = '${a.org}'`)) ?? '', /permission denied/);
      assert.match(recusado(() => psqlComoApp(`${naOrganizacao(a.org)} update core.ai_usage set occurred_at = now() - interval '2 days' where organization_id = '${a.org}'`)) ?? '', /permission denied/);
      assert.match(recusado(() => psqlComoApp(`${naOrganizacao(a.org)} delete from core.ai_usage where organization_id = '${a.org}'`)) ?? '', /permission denied/);
    });

    it('linha de uso concluída não muda: o app não zera tokens nem volta a reserva', () => {
      const concluida = query(`select id from core.ai_usage where organization_id = '${a.org}' and result = 'ok' order by id desc limit 1`);
      for (const mudanca of [`input_tokens = 0, output_tokens = 0`, `result = 'reservada'`, `result = 'unavailable'`]) {
        assert.match(recusado(() => psqlComoApp(`${naOrganizacao(a.org)} update core.ai_usage set ${mudanca} where id = ${concluida}`)) ?? '', /concluida nao muda/);
      }
      assert.equal(query(`select result || '|' || input_tokens || '|' || output_tokens from core.ai_usage where id = ${concluida}`), 'ok|12|8');
    });

    it('chamada que falhou conta a reserva inteira no teto de tokens', () => {
      const tokens = () => Number(comoApp(`${naOrganizacao(b.org)} select coalesce(sum(case when result = 'ok' then input_tokens + output_tokens else greatest(reserved_tokens, input_tokens + output_tokens) end), 0) from core.ai_usage`));
      const antes = tokens();
      const id = comoApp(`${naOrganizacao(b.org)} insert into core.ai_usage (organization_id, task, provider, model, reserved_tokens) values ('${b.org}', '${TAREFA}', 'google', 'm', 700) returning id`).split('\n')[0].trim();
      comoApp(`${naOrganizacao(b.org)} update core.ai_usage set result = 'validation' where id = ${id}`);
      assert.equal(tokens(), antes + 700);
    });

    it('a varredura de versão antiga só é executável pelo worker e só devolve ponteiros', () => {
      assert.match(recusado(() => psqlComoApp(`select * from core.ia_chaves_com_versao_antiga('local:v1', 10)`)) ?? '', /permission denied/);
      const linha = psqlComoWorker(`select organization_id::text || '|' || provider from core.ia_chaves_com_versao_antiga('versao-que-nao-existe', 200) where organization_id = '${a.org}'`);
      assert.equal(linha.trim(), `${a.org}|google`);
    });
  });

  describe('rotação do KMS e remoção', () => {
    it('a rota de recifragem do cofre cobre a chave de IA e ela continua abrindo', async () => {
      query(`update core.ai_provider_keys set kms_key_version = 'local:v0' where organization_id = '${a.org}' and provider = 'google'`);
      const resposta = await post('/api/v0/tokens/recifrar', { limite: 200 });
      assert.equal(resposta.status, 200);
      const resumo = await resposta.json();
      assert.equal(resumo.versaoPrimaria, 'local:v1');
      assert.ok(resumo.avaliadas >= 1 && resumo.recifradas >= 1, JSON.stringify(resumo));
      assert.equal(resumo.falhas, 0);
      assert.equal(query(`select kms_key_version from core.ai_provider_keys where organization_id = '${a.org}' and provider = 'google'`), 'local:v1');

      const depois = await (await post('/api/v0/tokens/recifrar', { limite: 200 })).json();
      assert.equal(depois.avaliadas, 0);
      const cookie = signIn(a.dono);
      assert.equal((await testarModelo(cookie)).includes('Olá do modelo de teste.'), true);
      signOut();
    });

    it('chave adulterada no banco conta como falha na varredura e o teste responde sem vazar nada', async () => {
      const c = organizacao('c');
      const cookie = signIn(c.dono);
      const chave = chaveDeTeste();
      await enviar('Testar e guardar', { fornecedor: 'google', chave });
      await submitAction(PAGINA, await acaoDoBotao('Salvar</button>'), { tarefa: TAREFA, escolha: 'google|modelo-de-teste-b' });
      query(`update core.ai_provider_keys set kms_key_version = 'local:v0',
               key_ciphertext = (select key_ciphertext from core.ai_provider_keys where organization_id = '${a.org}' and provider = 'google')
              where organization_id = '${c.org}'`);
      const resumo = await (await post('/api/v0/tokens/recifrar', { limite: 200 })).json();
      assert.ok(resumo.falhas >= 1, JSON.stringify(resumo));
      const html = await testarModelo(cookie);
      assert.equal(html.includes('não pôde ser lida'), true);
      assert.equal(html.includes(chave), false);
      assert.equal(query(`select result from core.ai_usage where organization_id = '${c.org}' order by id desc limit 1`), 'unavailable');
      query(`delete from core.ai_provider_keys where organization_id = '${c.org}'`);
      signOut();
    });

    it('remover a chave apaga o selado e as escolhas que dependiam dela', async () => {
      const cookie = signIn(a.dono);
      await enviar('Remover chave', { fornecedor: 'google' });
      assert.equal(query(`select count(*) from core.ai_provider_keys where organization_id = '${a.org}'`), '0');
      assert.equal(query(`select count(*) from core.ai_task_models where organization_id = '${a.org}'`), '0');
      const pagina = await (await browse(PAGINA)).text();
      assert.equal(pagina.includes('name="teste"'), false);
      assert.ok(cookie);
      signOut();
    });
  });
});
