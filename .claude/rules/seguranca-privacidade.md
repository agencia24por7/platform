---
paths:
  - "src/modules/tokens/**"
  - "src/modules/privacidade/**"
  - "src/modules/identity/**"
  - "src/modules/audit/**"
  - "app/api/**"
---
# Segurança e privacidade

- Token de cliente: envelope KMS no cofre (ADR 0032). Nunca em log, resposta, URL, query string nem comentário.
- Sem dado pessoal em coletores; revogação e exclusão seguem ADR 0029 e ADR 0010.
- Webhook público do n8n: ver ADR 0007. Endpoint novo sem autenticação precisa de justificativa em ADR.
- Toda mudança nesta área passa por `security-reviewer` (Opus) com o diff antes de concluir.
- Teste de segurança novo vai em `tests/security.test.mjs` ou arquivo da área.
