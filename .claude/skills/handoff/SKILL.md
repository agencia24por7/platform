---
name: handoff
description: Grava o estado técnico da tarefa em HANDOFF.md antes de trocar de etapa ou limpar a sessão com /clear. Use ao terminar uma etapa, ao trocar de modelo ou quando a conversa estiver longa.
disable-model-invocation: true
---
Escreva `HANDOFF.md` na raiz, sobrescrevendo o anterior, com no máximo 50 linhas e estas seções, nesta ordem:

1. **Tarefa** — uma frase.
2. **Decidido** — decisões tomadas e ADRs criados ou lidos.
3. **Arquivos alterados** — `git status --short` resumido, com o motivo de cada um.
4. **Testes** — o que rodou e o resultado; o que foi pulado e por quê.
5. **Riscos abertos** — o que pode quebrar e o que não foi verificado.
6. **Próximos passos** — lista ordenada, o primeiro já acionável.

Regras: sem segredo nem dado pessoal; só fatos verificados nesta sessão; `HANDOFF.md` não é commitado (está no `.gitignore`). Ao final, diga ao usuário: rode `/clear` e a próxima sessão já recebe o HANDOFF pelo hook de início.
