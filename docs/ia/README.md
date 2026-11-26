# Camada de IA e MCP

Decisão e motivos: `docs/adr/0057-camada-de-ia-e-mcp.md`. Este arquivo diz o que existe e como usar.

## O que existe

| Peça | Onde | Para quê |
| -- | -- | -- |
| Registro de ferramentas | `src/modules/ia/domain/ferramenta.ts` | Uma ferramenta declarada uma vez serve o agente interno e o MCP. Só aceita classe `leitura`. |
| Ferramenta `brain_consultar_catalogo` | `src/modules/brain/interface/ferramentas.ts` | Lê o catálogo do Brain de um cliente, com a política de uso do Brain. |
| Credencial de agente | `core.agent_credentials`, `src/modules/ia/application/credencialService.ts`, tela `/config/agentes` | Dá a um agente acesso de leitura a uma organização, com lista de clientes, ferramentas e validade. |
| Servidor MCP | `POST /api/mcp` | Expõe as ferramentas do escopo da credencial. Desligado por padrão. |
| Executor | `modules().ia.executor.executar(...)` | Ponto único para chamar modelo de linguagem. Nenhum módulo importa SDK de fornecedor. |
| Suíte de contrato | `scripts/ia-contrato.ts` | Prova um fornecedor com chave real, à mão, fora do CI. |

## Ligar o servidor MCP

1. Defina `IA_MCP_HABILITADO=true` no ambiente do app. Sem isso a rota responde 404.
2. Em `/config/agentes`, quem administra a organização cria a credencial: nome, ferramentas, alcance e validade (até 90 dias). O segredo aparece uma vez.
3. Configure o cliente MCP com a URL `<endereço do app>/api/mcp`, transporte HTTP e o cabeçalho `Authorization: Bearer <credencial>`.

A credencial é segredo: não vai para repositório, log nem URL. Revogar em `/config/agentes` corta o acesso na chamada seguinte.

## Acrescentar uma ferramenta

1. No módulo dono do dado, declare com `definirFerramenta`: nome (`modulo_verbo_objeto`), descrição fixa, esquema zod estrito de entrada, classe `leitura` e o executor.
2. O executor recebe o escopo do agente (`EscopoDoAgente`). Use a organização do escopo, nunca uma organização vinda da entrada, e confira o cliente com `clienteNoEscopo`.
3. Devolva pouco por padrão: página pequena, cursor e um modo resumido.
4. Registre em `src/composition.ts`, na lista passada a `criarIa`.
5. Teste: sucesso, cliente fora do escopo e outra organização. A ferramenta aparece no MCP e no agente interno ao mesmo tempo.

## Usar IA num módulo

```ts
const resumir = definirTarefa({
  chave: 'resumo_do_catalogo',
  classe: 'rapido_e_barato',
  instrucao: 'Resuma o catálogo informado nos dados em até três frases.',
  saida: z.object({ resumo: z.string().max(600) }),
  orcamento: { passos: 3, tokensDeSaida: 400, tempoMs: 30_000 },
  ferramentas: ['brain_consultar_catalogo'],
});

const resposta = await modules().ia.executor.executar({ organizationId, tarefa: resumir, dados, requestId, agente });
```

- `dados` é sempre tratado como dado não confiável e vai delimitado no pedido. Instrução vai só em `instrucao`.
- A saída volta validada pelo esquema. Nunca execute o que o modelo devolveu.
- `agente` é opcional: sem ele o modelo não recebe ferramenta. Com ele, recebe só a interseção entre as ferramentas da tarefa e as do escopo.
- Hoje toda tarefa responde "sem modelo configurado": guardar a chave do fornecedor e escolher o modelo por tarefa é a próxima entrega (ADR 0057 §11).

## Provar um fornecedor

```
node --env-file=<arquivo de ambiente> --experimental-strip-types scripts/ia-contrato.ts google GEMINI_API_KEY <id-do-modelo>
```

Roda três casos com pedido trivial, sem dado de cliente: saída estruturada, laço com ferramenta e instrução escondida no dado. Imprime o resultado, os tokens e o tempo. O valor da chave nunca é impresso.

## Variáveis de ambiente

| Variável | Padrão | Efeito |
| -- | -- | -- |
| `IA_MCP_HABILITADO` | `false` | Liga `POST /api/mcp`. |
| `IA_MCP_CHAMADAS_POR_MINUTO` | `60` | Limite por credencial. |
| `IA_FORNECEDORES_HABILITADOS` | `anthropic,google,openai,xai` | Fornecedores aceitos pelo executor. `moonshot` só entra se listado, depois do aceite legal. |
