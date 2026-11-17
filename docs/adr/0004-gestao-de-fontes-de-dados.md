# 0004 — Gestão de fontes de dados (recursos sem conta de anúncio)

- Status: aceito
- Data: 2026-11-17
- Issue: 24K-111

## Contexto

Propriedade do GA4, site do Search Console, canal do YouTube, contêiner do GTM
e local do GBP são "recursos". Eles não são conta de anúncio: o dono vem de
`connection_accounts.client_id` (migração 0027), não de `ad_accounts`.

Até aqui, o único caminho para vincular um recurso era
`/integracoes/conector/<plataforma>`, e ele tinha três problemas:

1. **Não gravava auditoria.** O vínculo de conta de anúncio grava
   `ad_account.link`.
2. **Não validava a plataforma.** A ação aceitava qualquer id descoberto.
3. **Não havia como desvincular nem mover um recurso.** Além disso, a página
   do cliente não mostrava os recursos dele, e `/clientes/[id]/contas/nova`
   oferecia recursos que o `linkAccount` recusava (*"ID do Google Ads deve
   ter o formato…"*).

## Decisão

- **As regras ficam no domínio** (`connections/domain/recurso.ts`), em funções
  puras e testadas:
  - só quem opera vincula, move ou desvincula;
  - só recursos (nunca Google/Meta) passam por aqui;
  - um recurso com dono não é vinculado de novo; ele é **movido**;
  - o cliente de destino precisa estar ativo.
- **`recursoService` orquestra** a regra de domínio, o repositório (sob RLS,
  via `withTenant`) e a auditoria: `connection_account.link`,
  `connection_account.reassigned` e `connection_account.unlink`. Toda Server
  Action chama o serviço, que confere o papel de novo, porque a action é
  alcançável por POST direto.
- **Telas:**
  - página do cliente: card *Fontes de dados*, com Mover e Desvincular;
  - `/clientes/[id]/contas/nova`: separa contas de anúncio e fontes de dados,
    e encaminha cada uma ao serviço certo;
  - conector: ganha Desvincular.
- **Desvincular** devolve o recurso para `discovered` e `client_id = NULL`. Ele
  sai de `automation.fontes_de_coleta` e volta à lista de recursos sem dono.

## Consequências

- **Mover não reescreve o histórico no BigQuery.** As linhas já gravadas
  continuam com o `client_id` antigo; só a próxima coleta grava no novo
  cliente. As telas dizem isso. Reatribuir histórico, se um dia for preciso,
  é um backfill explícito.
- Desvincular não apaga dado coletado. Só interrompe a coleta daquele recurso.
