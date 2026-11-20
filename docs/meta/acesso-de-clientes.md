# Login de clientes pelo app da Meta ("Agencia24/7 Ads", ID 1333473459829837)

## Sintoma (2026-11-20)

Cliente convidado pelo link de convite (`/convite/<token>`) vê no Facebook:
"Como estamos atualizando detalhes adicionais para esse aplicativo, o Login do Facebook está indisponível para
ele no momento" (Feature Unavailable, código 1349220).

## Causa

O app só aceita login de quem tem **papel no app** (administrador, desenvolvedor ou testador). Hoje há 2
administradores e nenhum cliente. Isso vale enquanto o app estiver em modo de desenvolvimento **e** também em
modo Live para permissões sem **Acesso Avançado** aprovado: `ads_read`, `ads_management`,
`business_management` e `leads_retrieval` com acesso padrão só funcionam para quem tem papel no app.

Além disso, o cadastro do app estava inconsistente (consultado pela Graph API):

| Campo | Valor encontrado | Valor correto |
|---|---|---|
| Política de privacidade | `https://www.agencia24por7.com/privacidade` (do site) | `https://platform.agencia24por7.com/privacidade` |
| Termos de serviço | `https://www.facebook.com/` (placeholder) | `https://platform.agencia24por7.com/termos` |
| Instruções de exclusão de dados | — | `https://platform.agencia24por7.com/exclusao-de-dados` |

## Caminhos

### A. Imediato: cliente como testador (minutos, até o App Review sair)

1. developers.facebook.com → app → **Funções do app → Funções → Adicionar pessoas → Testador**, com o
   Facebook do cliente (nome de usuário ou ID).
2. O cliente aceita o convite em developers.facebook.com/requests (precisa ter conta de desenvolvedor, que é
   gratuita e se cria na hora).
3. O link de convite da orla passa a funcionar para ele.

Serve para poucos clientes; cada um passa por esse passo extra.

### B. Definitivo: Acesso Avançado pelo App Review

Pré-requisitos:
1. **Verificação da empresa** no Business Manager da Agência 24/7 (Central de Segurança). Exige documento da
   empresa com CNPJ e nome legal, comprovante de domínio ou telefone. **Bloqueio atual: a empresa ainda não
   está constituída** (a política identifica uma pessoa física).
2. Cadastro do app completo: ícone 1024×1024, categoria, URLs da tabela acima, domínio
   `platform.agencia24por7.com` em Domínios do app.
3. Modo **Live**.

Depois, em **Revisão do app → Permissões e recursos**, pedir Acesso Avançado para cada permissão com
justificativa e vídeo:

| Permissão | Uso na orla (justificativa resumida) |
|---|---|
| `ads_read` | Ler contas de anúncio e métricas de campanhas do cliente para os relatórios |
| `ads_management` | Solicitar o acesso de parceiro da agência às contas de anúncio do cliente, quando ele pede |
| `business_management` | Listar os Business Managers e contas do cliente para ele escolher o que conectar; pedido de parceiro |
| `leads_retrieval` | Receber os leads dos formulários de anúncio do cliente e entregar no CRM dele |

Vídeo por permissão: login com uma conta de teste sem papel, tela de consentimento, a funcionalidade usando o dado.
Prazo típico: 1 a 4 semanas.

### Recomendação

Usar o caminho A agora para os clientes atuais e iniciar o B assim que houver CNPJ. Corrigir as URLs do
cadastro já (vale para os dois caminhos).
