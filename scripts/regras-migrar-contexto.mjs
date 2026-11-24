#!/usr/bin/env node
import postgres from 'postgres';
import { CAMPOS_MIGRADOS, mapearLinhaDoContexto } from '../src/modules/clients/domain/regras/migracaoDoContexto.ts';

const AJUDA = `Migra os campos normativos das seções J e K do Contexto para Regras (ADR 0051, §9).

Uso:
  node --experimental-strip-types scripts/regras-migrar-contexto.mjs --org <uuid> [--org <uuid>...] [--ensaio | --aplicar]
  node --experimental-strip-types scripts/regras-migrar-contexto.mjs --todas [--ensaio | --aplicar]

Campos lidos de core.client_context_entries (as linhas antigas FICAM, sem leitura pela tela nem pelo Brain):
  orcamento_mensal_total  -> limite investimento.teto_mensal (centavos, conversão automática)
  regras_regulatorias     -> regra, categoria segmento
  o_que_nao_pode_ser_dito -> regra, categoria etica_marca
  quem_aprova             -> regra, categoria governanca
  prazo_de_aprovacao      -> regra, categoria governanca
Texto livre com número vira regra com review_flag = revisar_e_converter_em_limite, nunca limite.
Sugestões não confirmadas e valores inválidos são pulados e listados.

Modo:
  --ensaio   (padrão) lê e calcula o que faria; não grava nada.
  --aplicar  grava as decisões, uma transação por organização.

Ambiente:
  DATABASE_URL            conexão do papel do worker (só ele grava o livro da migração e preserva a data
                          original); RLS vale. Superusuário e outros papéis são recusados.
  MIGRACAO_ADMIN_URL      só para --todas: lista as organizações com linhas a migrar.

Preserva a data original: valid_from = data de updated_at (America/Sao_Paulo) e created_at = updated_at.
O evento inicial da decisão (efetivada) leva a data da execução, pois é gravado por gatilho.
Autor = updated_by, gravado com app.user_id = autor por linha. Linha sem autor (updated_by nulo ou usuário
removido) é ignorada e listada como "ignorada_sem_autor"; autor que não é mais membro vivo da organização,
como "ignorada_autor_nao_membro": limite ou regra vigente nunca nasce sem uma pessoa da organização.
Origem sempre agencia (o cliente só propõe, ADR 0051 §5.2); quando source = cliente, contexto e evidência
registram "informado pelo cliente".
Idempotente por prova que a redação LGPD não toca: o livro core.regras_migracao_contexto (cliente, campo,
decisão) e, além dele, qualquer decisão do cliente na mesma chave (qualquer status, inclusive redigida,
superada ou revogada) fazem a linha ser pulada. Reexecutar nunca recria texto redigido nem sobrescreve.

Produção: só com autorização nomeada do humano (ADR 0046). O alvo é impresso antes de qualquer leitura.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_ID = 'migracao-contexto-24k114';

function falhar(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

function alvoSemSenha(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')} (usuário ${decodeURIComponent(u.username)})`;
  } catch {
    return 'URL inválida';
  }
}

function lerArgumentos(argv) {
  const orgs = [];
  let ensaio = true;
  let aplicar = false;
  let todas = false;
  let ajuda = argv.length === 0;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') ajuda = true;
    else if (a === '--ensaio') ensaio = true;
    else if (a === '--aplicar') aplicar = true;
    else if (a === '--todas') todas = true;
    else if (a === '--org') {
      const valor = argv[i + 1];
      if (!valor || !UUID.test(valor)) falhar('--org precisa de um uuid em minúsculas.');
      orgs.push(valor);
      i += 1;
    } else falhar(`Argumento desconhecido: ${a}\n\n${AJUDA}`);
  }
  if (aplicar && argv.includes('--ensaio')) falhar('Use --ensaio ou --aplicar, não os dois.');
  return { orgs, aplicar, ensaio: !aplicar && ensaio, todas, ajuda };
}

const opcoes = lerArgumentos(process.argv.slice(2));
if (opcoes.ajuda) {
  console.log(AJUDA);
  process.exit(0);
}
if (opcoes.todas === (opcoes.orgs.length > 0)) falhar('Informe --org <uuid> (uma ou mais) ou --todas, não ambos nem nenhum.');

const url = process.env.DATABASE_URL;
if (!url) falhar('DATABASE_URL ausente.');

console.log(`Alvo: ${alvoSemSenha(url)}`);
console.log(`Modo: ${opcoes.aplicar ? 'APLICAR (grava)' : 'ENSAIO (não grava)'}`);

const banco = postgres(url, { max: 1, onnotice: () => {} });

function resumo() {
  return { lidas: 0, criadas: 0, ja_migrada: 0, chave_ja_usada: 0, puladas: {} };
}

async function organizacoesAMigrar() {
  if (!opcoes.todas) return opcoes.orgs;
  const urlAdmin = process.env.MIGRACAO_ADMIN_URL;
  if (!urlAdmin) falhar('--todas exige MIGRACAO_ADMIN_URL (só para listar as organizações).');
  console.log(`Alvo da listagem de organizações: ${alvoSemSenha(urlAdmin)}`);
  const admin = postgres(urlAdmin, { max: 1, onnotice: () => {} });
  try {
    const linhas = await admin`
      SELECT DISTINCT organization_id FROM core.client_context_entries WHERE field_key = ANY(${[...CAMPOS_MIGRADOS]})
      ORDER BY organization_id`;
    return linhas.map((l) => l.organization_id);
  } finally {
    await admin.end();
  }
}

async function migrarOrganizacao(tx, organizationId, totais) {
  await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
  await tx`SELECT set_config('app.client_ids', '*', true)`;
  await tx`SELECT set_config('app.request_id', ${REQUEST_ID}, true)`;
  await tx`SELECT set_config('orla.migracao_contexto', 'sim', true)`;

  const linhas = await tx`
    SELECT client_id, field_key, value, source, review, updated_by, updated_at
    FROM core.client_context_entries
    WHERE field_key = ANY(${[...CAMPOS_MIGRADOS]})
    ORDER BY client_id, field_key`;

  for (const linha of linhas) {
    totais.lidas += 1;
    const mapeada = mapearLinhaDoContexto({
      fieldKey: linha.field_key,
      valor: linha.value,
      source: linha.source,
      review: linha.review,
      updatedBy: linha.updated_by,
      updatedAt: linha.updated_at,
    });
    if (!mapeada.ok) {
      totais.puladas[mapeada.motivo] = (totais.puladas[mapeada.motivo] ?? 0) + 1;
      console.log(`  pulada  cliente ${linha.client_id} campo ${linha.field_key}: ${mapeada.motivo}`);
      continue;
    }
    const d = mapeada.decisao;

    const jaMigrada = await tx`
      SELECT 1 FROM core.regras_migracao_contexto WHERE client_id = ${linha.client_id} AND field_key = ${d.campo} LIMIT 1`;
    if (jaMigrada.length > 0) {
      totais.ja_migrada += 1;
      continue;
    }
    const chaveUsada = await tx`
      SELECT 1 FROM core.client_decisions WHERE client_id = ${linha.client_id} AND key = ${d.chave} LIMIT 1`;
    if (chaveUsada.length > 0) {
      totais.chave_ja_usada += 1;
      console.log(`  pulada  cliente ${linha.client_id} chave ${d.chave}: o cliente já tem decisão nesta chave (qualquer status); não recria`);
      continue;
    }

    await tx`SELECT set_config('app.user_id', ${d.decididoPor}, true)`;
    const [{ membro }] = await tx`SELECT core.is_member(${organizationId}::uuid, ${d.decididoPor}::uuid) AS membro`;
    if (!membro) {
      totais.puladas.ignorada_autor_nao_membro = (totais.puladas.ignorada_autor_nao_membro ?? 0) + 1;
      console.log(`  pulada  cliente ${linha.client_id} campo ${linha.field_key}: ignorada_autor_nao_membro`);
      continue;
    }

    totais.criadas += 1;
    console.log(`  ${opcoes.aplicar ? 'criada ' : 'criaria'} cliente ${linha.client_id} ${d.natureza} ${d.chave}${d.reviewFlag ? ' [revisar]' : ''}`);
    if (!opcoes.aplicar) continue;

    const [criada] = await tx`
      INSERT INTO core.client_decisions
        (organization_id, client_id, category, nature, origin, strength, key, scope, title, context, body, value,
         valid_from, status, decided_by, evidence, without_advertiser_confirmation,
         definition_key, definition_version, review_flag, created_at)
      VALUES
        (${organizationId}, ${linha.client_id}, ${d.categoria}, ${d.natureza}, ${d.origem}, ${d.forca}, ${d.chave}, ${d.escopo},
         ${d.titulo}, ${d.contexto}, ${d.texto}, ${d.valor ? tx.json(d.valor) : null},
         ${d.vigenciaInicio}::date, 'vigente', ${d.decididoPor}, ${d.evidencia}, false,
         ${d.definicaoChave}, ${d.definicaoVersao}, ${d.reviewFlag}, ${d.criadaEm})
      RETURNING id`;
    await tx`
      INSERT INTO core.regras_migracao_contexto (organization_id, client_id, field_key, decision_id)
      VALUES (${organizationId}, ${linha.client_id}, ${d.campo}, ${criada.id})`;
  }
}

try {
  const [identidade] = await banco`
    SELECT current_user AS papel, current_database() AS banco,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario,
           EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('orla_worker', 'tria_worker')
                    AND pg_has_role(current_user, r.oid, 'member')) AS worker`;
  console.log(`Banco: ${identidade.banco} | papel: ${identidade.papel}`);
  if (identidade.superusuario) falhar('Papel superusuário ignora a RLS: use o papel do worker em DATABASE_URL.');
  if (!identidade.worker) falhar('Use o papel do worker em DATABASE_URL: só ele grava o livro da migração.');

  const organizacoes = await organizacoesAMigrar();
  const totais = resumo();
  for (const organizationId of organizacoes) {
    console.log(`Organização ${organizationId}`);
    await banco.begin((tx) => migrarOrganizacao(tx, organizationId, totais));
  }

  console.log('Resumo:', JSON.stringify(totais));
  console.log(opcoes.aplicar ? 'Aplicado.' : 'Ensaio concluído: nada foi gravado. Use --aplicar para gravar.');
} finally {
  await banco.end();
}
