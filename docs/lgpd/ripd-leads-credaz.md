# RIPD — Relatório de impacto à proteção de dados: automação de leads da Credaz

- Versão: 1 (rascunho) — 2026-11-20
- Elaborado por: Agência 24/7 (operadora), para validação da Credaz (controladora)
- Encarregado da operadora: Filipe Jones, contato@agencia24por7.com
- Base: LGPD, art. 38; Guia de RIPD da ANPD

> O RIPD é de responsabilidade da controladora (Credaz). Este rascunho descreve o tratamento que a Agência
> executa, para a Credaz completar com a parte dela (base legal da coleta, uso do CRM, retenção no RD Station).

## 1. Por que fazer este relatório

O público dos anúncios é de crédito consignado, FGTS e benefícios sociais (ex.: Bolsa Família), o que indica
titulares potencialmente vulneráveis e informação sobre situação financeira. A ANPD trata esse cenário como de
risco elevado (Resolução CD/ANPD nº 2/2022, art. 4º: uso de dados de grupos vulneráveis e tratamento em larga
escala de dados que afetam interesses dos titulares).

## 2. Descrição do tratamento

| Etapa | O que acontece | Dados | Onde |
|---|---|---|---|
| 1. Coleta | Pessoa preenche o formulário do anúncio no Facebook/Instagram | nome, telefone, e-mail, produto | Meta |
| 2. Aviso | A Meta avisa o webhook da automação (só IDs), assinatura conferida | ID do lead, do formulário e da página | n8n (Google Cloud, EUA) |
| 3. Consulta | A automação consulta o lead na Graph API com o token da Credaz | nome, telefone, e-mail, produto | em memória, não gravado |
| 4. Entrega | Cria a negociação no RD Station CRM da Credaz | nome, telefone, e-mail, produto | RD Station |
| 5. Controle | Guarda o par ID do lead ↔ ID da negociação para não duplicar | só IDs | tabela de controle do n8n |
| 6. Conversões | A cada mudança de etapa no RD, envia à Meta o evento com o ID do lead | ID do lead, evento, valor | Meta (API de Conversões) |
| 7. Tarefas | Cria tarefas no RD conforme a etapa | ID da negociação | RD Station |
| 8. Conciliação | De hora em hora, busca leads que não chegaram ao RD e reenvia | como na etapa 3 | em memória |

Volume estimado: [preencher pela Credaz: leads/mês]. Retenção na Agência: só IDs, excluídos em até 30 dias após o
fim do contrato. Retenção no RD Station: definida pela Credaz.

## 3. Necessidade e proporcionalidade

- **Finalidade:** atender quem pediu contato sobre um produto de crédito. Legítima e informada no formulário.
- **Base legal (a confirmar pela Credaz):** procedimentos preliminares a contrato a pedido do titular (art. 7º, V)
  para o contato comercial; legítimo interesse (art. 7º, IX), com teste de balanceamento, para as conversões
  enviadas à Meta.
- **Minimização:** a Agência não grava o conteúdo do lead; o evento de conversão leva só o ID do lead (sem
  e-mail, telefone ou hash deles).
- **Transparência:** o formulário do anúncio deve linkar a política de privacidade da Credaz [confirmar].

## 4. Riscos e medidas

| Risco | Probabilidade | Impacto | Medidas existentes | Risco residual |
|---|---|---|---|---|
| Vazamento do conteúdo dos leads pela automação | Baixa | Alto | Execuções não são salvas; só IDs gravados; tráfego TLS; acesso administrativo por IAP | Baixo |
| Aviso falso injetando leads | Baixa | Médio | Assinatura `X-Hub-Signature-256` conferida; lead sempre reconsultado na Graph API | Baixo |
| Token de acesso da Credaz exposto | Baixa | Alto | Token cifrado no cofre; nunca exibido; revogável na Meta | Baixo |
| Uso do dado para outra finalidade (ex.: venda de listas) | Baixa | Alto | Contrato de operador proíbe; a Agência não guarda os dados | Baixo |
| Perfilamento discriminatório por condição financeira | Média | Alto | Fora da Agência: depende da segmentação dos anúncios e do uso no CRM pela Credaz | **Avaliar pela Credaz** |
| Retenção excessiva no CRM | Média | Médio | Fora da Agência | **Avaliar pela Credaz** |
| Transferência internacional | Certa | Baixo | Cláusulas-padrão dos fornecedores (Google, Meta) | Baixo |
| Falha da automação perdendo leads | Média | Médio | Conciliação horária e alerta de falha por e-mail | Baixo |

## 5. Plano de ação

1. Assinar o acordo de tratamento (`docs/lgpd/minuta-contrato-operador-credaz.md`).
2. Credaz: confirmar a base legal e o link de privacidade no formulário do anúncio.
3. Credaz: definir prazo de retenção dos leads no RD Station.
4. Credaz: avaliar o teste de legítimo interesse para o envio de conversões.
5. Revisar este RIPD a cada mudança no fluxo ou anualmente.

## 6. Aprovação

| Papel | Nome | Data |
|---|---|---|
| Encarregado da Credaz | [•] | [•] |
| Encarregado da Agência | Filipe Jones | [•] |
