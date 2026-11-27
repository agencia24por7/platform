---
status: accepted
date: 2026-11-27
---
# ADR-0069: Estratégia: página única de planos, plano em dois blocos, destino do plano, judge do Comitê e lacunas com sugestão

Supera em parte o ADR 0065 (§8 esquema do plano, §10 interface, §6 judge). Complementa os ADRs 0051, 0056, 0067 e 0068. Issue 24K-132. Decidido pelo dono do produto em 2026-11-27. As migrações são a 0148 (destino e landing pages) e a 0149 (judge e correção do Gate).

## Contexto

O plano da fase 1 (ADR 0065) era único por tipo, tinha esquema com `criativos`, abas por tipo (Plano, Comitê, Gates, Histórico) e o Comitê aceitava ou recusava cada ponto pelo próprio agente de redação. Três problemas: o plano não dizia onde o tráfego cai (plataforma, landing page, WhatsApp, UTM), o plano de mídia não era conferível contra os campos reais de cada plataforma, e a redação decidia sozinha o que do Comitê acatar.

## Decisão

### 1. Página única de planos
- A Estratégia é uma página única: cards de planos, página do plano e linha do tempo. Saem as abas por tipo.
- Comitê, Gates, histórico e eventos continuam gravados, mas nenhum papel os vê na tela. O leitor (`viewer`) continua sem acesso, como no ADR 0065 §5.
- Planos são independentes: o mesmo cliente tem vários do mesmo tipo. A migração 0148 remove `strategy_plans_tipo_unico` e cria o índice `strategy_plans_cliente_tipo`.

### 2. Esquema único em dois blocos
- `SCHEMA_VERSION` continua 1; o esquema muda no lugar. A seção `criativos` sai. `normalizarPlanoLegado` descarta `criativos` (e `conceito_id` das campanhas) ao ler versão antiga e preenche `plano_de_midia` vazio.
- Dois blocos: resumo executivo e plano de mídia por plataforma. O plano de mídia traz, por plataforma, seções e campos do catálogo, cada campo com valor, `justificativa` e prova.
- Gate `cobertura_do_plano_de_midia`: para cada plataforma escolhida, todo campo obrigatório do catálogo presente, na seção certa, com justificativa e valor do tipo certo; campo fora do catálogo reprova; plataforma sem catálogo reprova ("não é possível conferir"). URL, WhatsApp e UTM do campo têm de ser iguais aos da intenção.
- O catálogo de campos é versionado em código (`src/modules/strategy/domain/catalogo/`), um por plataforma. O da Meta foi levantado pela Marketing API v27.0 em conta da agência; as campanhas de teste foram criadas só `PAUSED` e apagadas. O catálogo da Meta (`meta.ts`, v27.0) é o único em `CATALOGOS_DISPONIVEIS`. Cada campo pode declarar `aplicavelA` (objetivos em que vale, lido pelo `campoDoObjetivo` do catálogo, `campaign_objective` na Meta) e `evidenciaDaApi`. Limites do levantamento: 13 campos de anúncio e criativo estão marcados `nao_verificado_pela_api` por falta de acesso da Página à API; o plano grava neles o valor `a_confirmar` (só aceito nesses campos, conferido pelo gate de cobertura) e eles viram pendência. As regras de dependência da API entram no gate (`dependenciasDaMeta.ts`).
- Google Ads não tem catálogo comprovado: não é selecionável como plataforma com plano de mídia (`plataformasComCatalogo` só lista quem tem catálogo).

### 3. Criação do plano e destino
- Na criação a pessoa escolhe plataformas (1 a 13, sem duplicata), a landing page (picklist de `core.client_landing_pages` do cliente) e o WhatsApp (cadastro do cliente, coluna `core.clients.whatsapp`, E.164).
- URL e WhatsApp são validados no servidor (`validarUrlDeDestino`: https, sem credencial, porta, IP nem host interno, até 2048 caracteres; `normalizarWhatsapp`: E.164). O CHECK do banco é a defesa final. A landing page não tem validação de conteúdo nesta fase; virá depois.
- UTM único do app: `gerarUtmPorPlataforma` (`src/modules/strategy/domain/utm.ts`, sobre `src/shared/utm`) gera `utm_source`, `utm_medium` e `utm_campaign` por código, nunca pelo modelo, e a intenção é fixa (o motor recoloca a intenção original, ADR 0065 §7). O Gate recusa campo de UTM diferente do gerado.
- Migrações: 0148 adiciona `plataformas`, `whatsapp` e `landing_page_id` (FK composta com organização e cliente) a `core.strategy_plans`, nulos só em planos anteriores (sem dado inventado). Plano novo sempre preenche, imposto no serviço. Plano antigo recusa mudança com `plano_sem_destino` (conflito) e a pessoa cria um plano novo. `core.client_landing_pages` tem RLS, escrita só de `owner`, `admin` ou `operator` e arquivamento como único caminho de remoção.

### 4. Judge, correção do Gate e lacunas
- **Judge** (tarefa `juiz`, classe `raciocinio_forte`): um lote único por raiz da cadeia julga os pontos de mudança do Comitê (`pontosParaJulgar`, até 45) e devolve `aceito` ou `rejeitado` com motivo de até 160 caracteres e prova do pacote. Pendência obrigatória (risco e legal) não passa por ele: é sempre acatada. O ajuste é conferido contra o veredito (`aceito_nao_acatado`, `rejeitado_acatado`). O veredito é o evento imutável `veredito_juiz` (um por versão, só ator agente, só versão rascunho; trigger e índice na 0149).
- **Correção do Gate com IA**: Gate reprovado abre uma nova execução `corrigir_gate` sobre o rascunho reprovado e reconvoca o Comitê: o banco exige que a cadeia de pareceres e ajustes seja de uma só execução (ADR 0065 §4) e não permite reabrir execução em estado final. O custo de cada clique é a correção, as nove personas, o juiz, o ajuste e os Gates, e o teto de 2 por raiz é o que o limita. Os "não faremos" são restaurados de forma determinística (`restaurarNaoFaremos`) depois da resposta do modelo. Teto de 2 correções por versão-raiz (`correcoesNaLinhagem`, espelhado por trigger na 0149). Sem convergência, a execução termina com `correcao_nao_convergiu`; Gate reprovado fora da correção segue `gate_reprovado`.
- **Lacunas com sugestão**: a lacuna traz `regra` (natureza, escopo, chave) e `sugestao` com origem. Sem evidência não há valor: valor sugerido exige origem `evidencia`, e o Gate `sugestoes_de_lacunas` reprova valor sem entrada no pacote, só com metadados ou só com nota D. A aprovação é de `owner` ou `admin` (`podeAprovarSugestoes`) e grava em Regras do cliente pelo serviço do ADR 0051, por item, com resultado `ja_aprovada`, `regra_ja_existe` ou falha. A lacuna atendida é derivada da regra vigente (`lacunaAtendida`), nunca gravada.

### 5. Princípios
- Toda lógica no servidor: o front só renderiza view-models (`interface/cardsDePlano.ts` e afins).
- Justificativa e prova em todo o fluxo agêntico: campo do plano de mídia, veredito do judge e sugestão de lacuna carregam as duas.
- Economia de tokens: a redação é por grupos de seções e o plano de mídia, por plataforma (`GRUPOS_DE_REDACAO`, `esquemaDaMidiaDaPlataforma`); cada chamada recebe só a fatia do plano de que precisa; instruções enxutas (a do judge cabe em poucas linhas). Teto de saída por tarefa em `ORCAMENTO_DA_IA`: `strategy_plan` 6.500, `comite` 5.000, `juiz` 4.500 e `gate` 3.000 tokens. O modelo recebe o catálogo compacto (`catalogo/compacto.ts`): 15.903 para 7.214 bytes na Meta (medição informada pelo dono da tarefa, não gravada em teste).

## Consequências

- O plano diz onde o tráfego cai e é conferível campo a campo; Comitê e Gates deixam de ser tela, mas seguem auditáveis no banco.
- Planos antigos ficam só para leitura: qualquer mudança recusa com `plano_sem_destino`.
- Cada execução com ponto não obrigatório do Comitê custa uma chamada a mais (o judge).

## Riscos residuais

- Levantamento da Meta incompleto: criativo, anúncio e WhatsApp sem verificação pela API; os 13 campos de anúncio e criativo ficam `a_confirmar` e podem divergir da plataforma.
- Execução em andamento sem veredito no registro da raiz falha com `juiz_ausente_na_cadeia`; a pessoa cria nova execução.
- Duplo clique em "criar plano" cria dois planos: com a unicidade por tipo removida, nada os distingue.
- Google Ads sem catálogo comprovado: fica fora até o levantamento.
- Landing page sem validação de conteúdo: a URL é válida, mas a página pode não existir ou não converter.
