---
paths:
  - "n8n/**"
  - "scripts/n8n-*.mjs"
  - "scripts/tunel.sh"
---
# n8n (coletores e executores)

- Workflows genéricos por plataforma: `ORLA · {Plataforma} · coletor` e `· executor`, com a credencial "ORLA · worker token". O token do cliente vem do cofre (KMS), nunca fica no workflow (ADR 0032).
- Todo workflow da plataforma leva a tag `platform`. Fluxos com tag `credaz` ou `agencia` são de terceiros: o agente nunca os usa, edita no n8n nem lista conteúdo. O deploy os aplica a partir de `n8n/workflows/clientes/` e `n8n/workflows/agencia/` por `scripts/n8n-aplicar-clientes.mjs`, e mudar esses arquivos ou o script é PR do humano (ADR 0053).
- Sincronização versionada em produção: `scripts/n8n-sincronizar-producao.sh --projeto tria-platform --vm tria-producao-vm --criar --aplicar`, rodar duas vezes (ADR 0009). O script abre o túnel e lê a chave `tria-producao-n8n-api-key` sem eco; nunca a leia no comando. Ativar um fluxo da plataforma: o mesmo script com `--ativar <id> --aplicar`.
- Coletor não grava dado pessoal.
