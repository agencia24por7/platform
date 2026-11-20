# 2026-11-20 — Token do worker gravado nos dados de execução do n8n

- Descoberto em: 2026-11-20, durante a sincronização dos workflows (ADR 0009).
- O quê: o gatilho do webhook `ORLA · coleta · backfill` grava os cabeçalhos da requisição nos dados de
  execução, incluindo `Authorization: Bearer <token do worker>`, em texto puro no banco do n8n.
- Dados pessoais envolvidos: nenhum. O token é credencial de serviço (permite chamar as rotas `/api/v0` do app).
- Exposição: só a quem tem acesso ao editor ou ao banco do n8n (equipe da agência). Sem indício de acesso indevido.
- Avaliação de risco: baixo, sem titulares afetados. Não exige comunicação à ANPD.

## Medidas

1. O workflow do backfill deixou de salvar dados de execução (sucesso e erro).
2. As 10 execuções antigas com o token foram apagadas; nenhuma das 100 execuções restantes contém token.
3. Token trocado: nova versão no Secret Manager, credencial do n8n atualizada por API, ambiente da VM regravado.
   O token antigo foi verificado como recusado (401 no app, 403 no webhook) e a versão 1 do segredo, desabilitada.
