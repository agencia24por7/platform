---
status: accepted
date: 2026-11-22
---
# ADR-0043: Operador da plataforma é uma identidade explícita, fora do papel de organização

Complementa os ADRs 0021 e 0036. Corrige o achado C1 e o M3 da revisão de tenant.

## Contexto
O login Google aceita qualquer e-mail verificado, e `/organizacoes/nova` deixa o usuário sem vínculo criar uma organização e virar `owner`. `podeEntrarNaAutomacao` (`app/api/portaria/_acesso.ts`) tratava "administra organização inteira" como permissão para entrar no n8n como dono (`N8N_OWNER_*`). Qualquer pessoa com uma conta Google chegava ao n8n da plataforma, que guarda fluxos e credenciais de terceiros. Os alertas de plataforma (`automation.alertas`) tinham `USING (true)` e eram lidos por qualquer organização.

## Decisão
1. Existe um papel separado, o operador da plataforma: o usuário cujo e-mail verificado consta em `PLATAFORMA_OPERADORES` (lista separada por vírgula, comparação sem diferença de caixa). Variável ausente ou vazia significa nenhum operador: falha fechada.
2. Papel de organização (`owner`, `admin`) nunca concede acesso à automação, ao n8n nem aos alertas de plataforma. Só o operador concede.
3. A portaria do n8n (`/api/portaria`, `emitir`, `receber`) e a página `/automacoes` exigem operador. A decisão fica numa função única (`operadorDaPlataforma`), usada por todos os pontos, e a checagem é refeita a cada passagem emitida e a cada recebimento do cookie.
4. Os alertas de plataforma deixam de ser legíveis pelo papel do app. O app lê alertas só por chamada do worker, depois de confirmar operador. O worker tem `SELECT`, `INSERT` e `UPDATE` direto em `automation.alertas` (exceção única e exata ao "worker herda o app", testada em `fronteiras.test.mjs`).
5. A lista de operadores entra por Terraform e `infra/compose`, como as demais variáveis; nunca vai para o repositório.

## Consequências
- Quem cria organização própria não chega ao n8n nem aos alertas.
- Trocar de operador exige deploy, o que deixa histórico.
- A tela de alertas some para quem não é operador; o contador do menu também.
