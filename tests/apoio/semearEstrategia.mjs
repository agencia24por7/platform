import { randomBytes, randomUUID } from 'node:crypto';
import { BASE, workerHeaders } from '../helpers.mjs';
import { psqlComoDono, psqlComoRole } from './psql.mjs';

const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();

export const aspas = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`);

export const dono = (sql) => ultimaLinha(psqlComoDono(sql));

const contexto = (organizacao, quem) => `SET app.organization_id = '${organizacao}'; SET app.client_ids = '*'; SET app.user_id = '${quem ?? ''}'; `;

export const comoApp = (organizacao, quem, sql) => ultimaLinha(psqlComoRole('orla_app', contexto(organizacao, quem) + sql));

export const comoWorker = (organizacao, sql) => ultimaLinha(psqlComoRole('orla_worker', contexto(organizacao, '') + sql));

export function criarSemeadorDeEstrategia({ org, operador }) {
  const planoNovo = (cli, tipo = 'aquisicao') =>
    dono(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key, plataformas) VALUES ('${org}', '${cli}', '${tipo}', ARRAY['meta']) RETURNING id`);

  const versaoRascunho = (cli, plano, conteudo, { quem = operador, referencias = [] } = {}) => {
    const id = randomUUID();
    const refs = referencias
      .map((referencia) => (typeof referencia === 'string' ? { urn: referencia } : referencia))
      .map(
        ({ urn, hash = 'a'.repeat(64) }) => `INSERT INTO core.strategy_plan_refs (organization_id, client_id, version_id, urn, content_hash, role)
          VALUES ('${org}', '${cli}', '${id}', '${urn}', '${hash}', 'premissa');`,
      )
      .join('\n');
    comoApp(
      org,
      quem,
      `INSERT INTO core.strategy_plan_versions (id, organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id)
       VALUES ('${id}', '${org}', '${cli}', '${plano}', ${aspas(JSON.stringify(conteudo))}::jsonb, 1, 'usuario', '${quem}'); ${refs}`,
    );
    return id;
  };

  const pedirExecucao = ({ cli, plano, quem = operador, tipo = 'criar', base = null, pedido }) => {
    const agentRunId = `run-${randomBytes(5).toString('hex')}`;
    const corpo = pedido ?? (tipo === 'criar' ? { tipo: 'criar', intencao: { objetivo: 'Gerar leads' } } : { instrucao: 'Ajustar a verba' });
    const id = comoApp(
      org,
      quem,
      `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, base_version_id, agent_run_id, requested_by, requested_kind)
       VALUES ('${org}', '${cli}', '${plano}', '${tipo}', ${aspas(JSON.stringify(corpo))}::jsonb, ${aspas(base)}, '${agentRunId}', '${quem}', 'usuario') RETURNING id;`,
    );
    return { id, agentRunId, tentativas: 0 };
  };

  const reservar = (execucaoId) =>
    comoWorker(
      org,
      `UPDATE core.strategy_plan_runs SET status = 'rodando', tentativas = tentativas + 1, lease_until = now() + interval '30 minutes' WHERE id = '${execucaoId}' RETURNING id;`,
    );

  const iniciarExecucao = (opcoes) => {
    const execucao = pedirExecucao(opcoes);
    reservar(execucao.id);
    return { ...execucao, tentativas: 1 };
  };

  const avancarEtapa = (execucaoId, etapa, rodada = 1) =>
    comoWorker(org, `UPDATE core.strategy_plan_runs SET etapa = '${etapa}', rodada = ${rodada} WHERE id = '${execucaoId}' RETURNING id;`);

  const concluirExecucao = (execucaoId) =>
    comoWorker(org, `UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${execucaoId}' RETURNING id;`);

  const falharExecucao = (execucaoId, codigo) =>
    comoWorker(org, `UPDATE core.strategy_plan_runs SET status = 'falhou', erro_codigo = '${codigo}' WHERE id = '${execucaoId}' RETURNING id;`);

  const eventoDoWorker = (cli, versao, tipo, payload, execucao) =>
    comoWorker(
      org,
      `DO $$ BEGIN PERFORM set_config('orla.ficha_execucao', '${execucao.tentativas}', true); END $$;
       INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, agent_id, agent_run_id, idempotency_key, payload)
       VALUES ('${org}', '${cli}', '${versao}', '${tipo}', 'agente', 'comite', '${execucao.agentRunId}', '${randomBytes(6).toString('hex')}', ${aspas(JSON.stringify(payload))}::jsonb);`,
    );

  const eventoDaPessoa = (cli, versao, tipo, quem) =>
    comoApp(
      org,
      quem,
      `INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, payload)
       VALUES ('${org}', '${cli}', '${versao}', '${tipo}', 'usuario', '${quem}', '{}'::jsonb);`,
    );

  const semearBrain = (cli, admin) => {
    const contexto = [
      ['segmento', 'Doceria artesanal'],
      ['cidade', 'Recife'],
      ['descricao', 'Bolos e doces por encomenda'],
    ];
    for (const [campo, valor] of contexto) {
      dono(`INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value) VALUES ('${org}', '${cli}', 'empresa', '${campo}', ${aspas(JSON.stringify(valor))}::jsonb)`);
    }
    const decisao = (colunas) => {
      const todas = { organization_id: org, client_id: cli, origin: 'agencia', status: 'vigente', scope: 'cliente', decided_by: admin, ...colunas };
      const valores = Object.entries(todas)
        .map(([coluna, valor]) => (coluna === 'value' ? `${aspas(valor)}::jsonb` : coluna === 'definition_version' ? valor : aspas(valor)))
        .join(', ');
      comoApp(org, admin, `INSERT INTO core.client_decisions (${Object.keys(todas).join(', ')}) VALUES (${valores}) RETURNING id`);
    };
    decisao({
      category: 'investimento',
      nature: 'limite',
      key: 'investimento.teto_mensal',
      definition_key: 'investimento.teto_mensal',
      definition_version: 1,
      title: 'Teto mensal de investimento',
      context: 'Teto combinado',
      value: JSON.stringify({ valor: '500000', unidade: 'brl_centavos' }),
    });
    decisao({ category: 'governanca', nature: 'regra', key: 'governanca.sem_promessa_de_resultado', title: 'Não prometer resultado garantido', context: 'Política da agência', body: 'Nenhum anúncio promete resultado garantido.' });
  };

  const catalogoDoCliente = async (cli) => {
    const resposta = await fetch(`${BASE}/api/v0/brain/clientes/${cli}/catalogo?limite=200`, { headers: workerHeaders() });
    const corpo = await resposta.json();
    return new Map(corpo.entradas.map((entrada) => [entrada.urn, entrada.hash]));
  };

  const fotografia = () =>
    dono(`SELECT md5(
      coalesce((SELECT string_agg(id || status, ',' ORDER BY id) FROM core.strategy_plan_versions WHERE organization_id = '${org}'), '') ||
      coalesce((SELECT string_agg(id || kind, ',' ORDER BY id) FROM core.strategy_plan_events WHERE organization_id = '${org}'), '') ||
      coalesce((SELECT string_agg(id || status || etapa, ',' ORDER BY id) FROM core.strategy_plan_runs WHERE organization_id = '${org}'), ''))`);

  return { planoNovo, semearBrain, catalogoDoCliente, versaoRascunho, pedirExecucao, reservar, iniciarExecucao, avancarEtapa, concluirExecucao, falharExecucao, eventoDoWorker, eventoDaPessoa, fotografia };
}
