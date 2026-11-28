---
status: accepted
date: 2026-11-27
---
# ADR-0075: Brain com sinais de cultura e referências criativas (24K-134)

Complementa os ADRs 0030 (catálogo e provedores), 0051 (autoridade e padrão de RLS), 0067 (a Estratégia lê o Brain na visão da equipe e envia conteúdo ao fornecedor), 0069 (conduta com o acesso) e 0036 (estrutura da página do cliente: esta decisão acrescenta uma seção ao Contexto).

## Contexto
Os comitês do planejador (ADR 0056) precisam de duas informações que o Brain não tinha: o que está acontecendo na cultura (tendência, meme, conversa emergente, movimento de comunidade) e as referências criativas (campanha de referência, território criativo, anti-referência). Entram catalogadas como as demais entradas (desempenho, conhecimento): provedor com `tiposDeclarados`, URN, resumo, evidência com nota e política de uso.

## Decisão

### 1. Só fenômeno público, nunca pessoa
O sinal descreve um fenômeno público (um formato, um assunto, um movimento). Não descreve nem nomeia pessoa. A regra vale em três camadas:
- Domínio (`src/modules/brain/domain/cultura.ts`): título, resumo e nome da fonte recusam `@perfil`, e-mail, telefone e CPF (`mencionaPessoa`, que reaproveita `procurarPii`).
- Banco: `core.texto_de_sinal_sem_pessoa` em CHECK nos mesmos três campos (defesa final, padrões inequívocos).
- Catálogo: `textoSeguro` no título, no resumo e na fonte, e o `construirCatalogo` descarta a entrada que ainda traga padrão de dado pessoal.

**Limite assumido:** nome próprio de pessoa digitado sem `@` (por exemplo o nome de um criador de conteúdo) não é detectável por padrão. A defesa é o texto de ajuda na tela, a escrita restrita a owner, admin e operator e o arquivamento. O link da fonte (que pode identificar um perfil) fica só no app: o catálogo e o modelo recebem o nome e o domínio, nunca a URL. É risco aceito, no mesmo espírito do ADR 0067 §4.

### 2. Modelo (migração 0152, aditiva e idempotente)
`core.client_culture_signals`: `id` uuid, `organization_id`, `client_id` (FK `ON DELETE CASCADE`; o expurgo do cliente leva tudo), `kind` (`tendencia`, `meme`, `conversa`, `comunidade`, `referencia_criativa`, `anti_referencia`), `titulo` (1 a 160), `resumo` (1 a 600), `fonte_url` (https, sem credencial, até 2048), `fonte_nome` (1 a 120), `plataforma` opcional, `observado_em`, `valido_ate` obrigatório (não anterior à observação e no máximo 90 dias depois), `nota_evidencia` (A a D), `origem` (`manual`, `coletor`), `criado_por`, `criado_em`, `arquivado_em`. `UNIQUE (id, organization_id, client_id)` como em `core.client_landing_pages`.
- RLS ligada e forçada; leitura e inserção por `core.current_organization()` e `core.cliente_no_escopo`, com o cliente conferido contra a organização (mais estrito que o molde da 0148).
- O app e o worker só têm `SELECT`, `INSERT` e `UPDATE (arquivado_em)`. Não há `DELETE`: arquivar é o único caminho de remoção e o conteúdo não se edita (versionar seria complexidade sem ganho: o sinal vence sozinho em até 90 dias).
- Gatilho `core.client_culture_signal_escrita` (sem `SECURITY DEFINER`): o app exige `app.user_id` com papel owner, admin ou operator, origem `manual` e fixa `criado_por`; o worker só insere com origem `coletor` e sem autor; arquivar exige pessoa com papel (o worker não arquiva); `observado_em` não passa de amanhã (São Paulo). O `UPDATE` tolera só o `SET NULL` de `criado_por` quando o usuário é removido.
- Único por cliente, `lower(fonte_url)` e `observado_em`, inclusive arquivado: é a chave de idempotência do coletor e impede que ele recrie o que a equipe arquivou. Efeito colateral: a equipe também não recadastra a mesma fonte no mesmo dia depois de arquivar.

### 3. Provedor `culture` no Brain (`infrastructure/provedores/cultura.ts`)
Fase primária; tipos `culture_tendencia`, `culture_meme`, `culture_conversa`, `culture_comunidade`, `culture_referencia`, `culture_anti_referencia`; URN `orla:{org}:{cliente}:{tipo}:{uuid}`.
- Evidência com categoria `benchmark`, nota do sinal, fonte (nome e domínio), `dataDaFonte` = observação, `validoAte`. Marca epistêmica `fato` para A e B e `hipotese` para C e D; revisão `confirmado` para origem manual e `sugerido` para coletor.
- Sempre `conteudoNaoConfiavel`. Política de uso por agente: `permitido`, sensibilidade `publico`, sem dado pessoal. Nota D leva o aviso de que não sustenta meta nem afirmação; o Gate `meta_sem_nota_d` da Estratégia já a trata pela `evidencia.nota`. Referência e anti-referência levam aviso de que são inspiração, não prova de desempenho.
- Expiração: sinal com `valido_ate` anterior a hoje (São Paulo) sai do catálogo, e portanto do pacote. Sem nenhum vigente (ou sem nenhum cadastrado) o provedor responde `ok` com o motivo "Radar sem sinal vigente"; o aviso também aparece na tela. A mudança de hash republica o catálogo na varredura horária (`brain-catalogo-publicar`), sem workflow novo.
- Carga limitada a 100 sinais por cliente, vigentes primeiro. Falha de leitura deixa o provedor `indisponivel` sem derrubar o catálogo.
- Na leitura da Estratégia (`prioridadeDaEntrada`), `culture` fica entre desempenho e conhecimento.

### 4. Escrita pela tela
Seção "Sinais de cultura" no Contexto (`secao=cultura`): lista com estado (ícone e texto), criar e arquivar. Escopo por `escopoDoClienteNaOrganizacao`; permissão no serviço (`canOperate`), repetida no banco. Sem lógica no componente: view-model em `src/modules/brain/interface/visaoDeCultura.ts`. A estrutura do Contexto ganha uma seção; esta decisão é o registro exigido pelo ADR 0036.

### 5. Ingestão pelo coletor
`POST /api/v0/brain/clientes/{clienteId}/sinais`, autenticada pelo `TRIA_WORKER_TOKEN` (`workerRoute`, o mecanismo que o Brain e as regras já usam; não existe credencial de agente com escrita no Brain). Corpo estrito `{ sinais: [...] }` de 1 a 50 itens, até 256 KB. Um item inválido recusa o lote inteiro (422, com o índice do campo). `origem` não vem do corpo: é `coletor`, fixada no servidor. Idempotência por URL (sem caixa) e dia observado: a resposta traz `criados`, `repetidos` e o id de cada item. Cliente inexistente ou malformado dá o mesmo 404. A auditoria `brain.cultura.ingestao` guarda só contagens. Não há workflow n8n nesta entrega.

## Riscos e o que não cobre
- **Injeção de prompt.** O texto do sinal chega ao modelo como dado não confiável (`conteudoNaoConfiavel`, tag e aviso). Quem escreve é a equipe ou o coletor, e o coletor lê a web: um resumo pode trazer instrução disfarçada. As defesas são o tamanho (600), a instrução do motor de que texto do Brain é dado, `textoSeguro` e o Gate, que decide pelos fatos e pelas referências, não pelo texto. Nada disso elimina o risco; ele é aceito como o do conhecimento global.
- **Tenant.** O coletor escreve como worker, com o cliente resolvido no servidor e a organização conferida pela RLS e pelo gatilho. O lote não leva organização nem cliente no corpo.
- **Sem lacuna estruturada na Estratégia.** "Radar sem sinal vigente" está no estado do provedor e na tela; o pacote da Estratégia ainda não o recebe como lacuna própria. Isso pede mudança em `src/modules/strategy` e fica para a próxima tarefa.
- Nota D e coletor não bloqueiam a entrada: ficam visíveis com aviso, como no conhecimento global.

## Consequências
- Sinal vence sozinho em até 90 dias; renovar é cadastrar outro.
- Tabela nova com dado de cliente, com RLS e teste de isolamento em `tests/brain-sinais-de-cultura.test.mjs`.
- `retencao`: enquanto o sinal valer e o cliente existir; o expurgo apaga em cascata.

## Rollback
Reverter o PR. A migração é aditiva: `DROP TABLE core.client_culture_signals` e `DROP FUNCTION core.texto_de_sinal_sem_pessoa` desfazem (migração destrutiva, entra em `db/corte-gate.txt` se um dia for revertida em produção).
