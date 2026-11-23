---
paths:
  - "n8n/**"
  - "scripts/n8n-*.mjs"
  - "scripts/tunel.sh"
---
# n8n (coletores e executores)

- Workflows genéricos por plataforma: `ORLA · {Plataforma} · coletor` e `· executor`, com a credencial "ORLA · worker token". O token do cliente vem do cofre (KMS), nunca fica no workflow (ADR 0032).
- Todo workflow da plataforma leva a tag `platform`. Fluxos com tag `credaz` ou `agencia` são de terceiros: nunca usar, editar nem listar conteúdo.
- Sincronização versionada: `npm run n8n:sincronizar -- --criar --aplicar`, rodar duas vezes (ADR 0009). A chave de API do n8n está no Secret Manager `tria-producao-n8n-api-key`; nunca imprimir. Túnel: `scripts/tunel.sh n8n`.
- Coletor não grava dado pessoal.
