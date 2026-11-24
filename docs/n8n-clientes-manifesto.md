# Manifesto dos fluxos de clientes e da agência no n8n

Condições do ADR 0053 sobre `scripts/n8n-aplicar-clientes.mjs`. O manifesto é `n8n/clientes-manifesto.json`. Fica fora de `n8n/workflows/` de propósito: a sincronização da
plataforma e os testes leem todo `*.json` da raiz dessa pasta como workflow. No deploy ele é copiado ao lado do script.

## Formato

```json
{
  "clientes/credaz/rd-para-meta-conversoes.json": { "id": "<id do workflow no n8n>", "nome": "<nome exato esperado>" }
}
```

A chave é o caminho do arquivo relativo a `n8n/workflows/`, com `/`. Arquivo fora do manifesto não é aplicado e o passo do
deploy falha. O arquivo versionado começa vazio (`{}`): os ids reais só o humano obtém, por túnel.

## Regras do script

- Aplica só no workflow do id do manifesto. O nome implantado e o nome do arquivo têm de ser iguais ao `nome` do manifesto.
- Recusa (erro, arquivo não aplicado) alvo com tag `platform` ou nome começando por `ORLA ·`.
- Id inexistente, nome divergente, credencial de exemplo (`a-definir…`) e arquivo fora do manifesto são erro definitivo.
- `--aplicar` exige `--backup-dir <dir>`. Antes de cada `PUT`, grava `<id>-<timestamp>.json` (arquivo 0600, diretório 0700)
  com o JSON anterior. Se a ativação falhar após o `PUT`, restaura o JSON anterior, reativa se estava ativo e sai com erro.
- Códigos de saída: `0` ok; `1` erro definitivo (o deploy não repete); `2` n8n indisponível ou erro de rede (o deploy repete).
- No deploy, os backups ficam em `/var/backups/tria-n8n` na VM (fora de `/opt/tria`, que o deploy apaga), modo 0700.
  Nada os expurga: o humano limpa quando quiser.

## Como preencher o manifesto (feito pelo humano)

1. `scripts/tunel.sh n8n`.
2. `N8N_API_URL=http://localhost:15678 N8N_API_KEY=… node scripts/n8n-aplicar-clientes.mjs n8n/workflows --propor-manifesto`.
   Somente leitura: lista `arquivo → id nome` por nome exato, sem imprimir conteúdo de fluxo e sem gravar nada.
   Candidato com tag `platform` ou nome `ORLA ·…` nunca é proposto; nome repetido aparece como ambíguo.
3. Revise os pares, escreva-os no manifesto e abra o PR (toca fora de `src/`, `app/` e afins: é do humano, ADR 0048).
4. Simule duas vezes seguidas (`node scripts/n8n-aplicar-clientes.mjs n8n/workflows`); a segunda tem de dizer `igual`.

## Deploy

- Imagem do passo: variável do repositório `N8N_CLIENTES_IMAGEM`, uma imagem do Node fixada por `@sha256:<64 hex>`.
  Vazia ou sem digest, o passo falha com mensagem clara.
- A `N8N_API_KEY` vai ao contêiner por `--env-file` temporário 0600 na VM, removido ao fim, nunca na linha de comando.
- O smoke pós-deploy roda mesmo se o passo do n8n falhar (o job continua falhando).
- `saveManualExecutions: false` está nos fluxos que carregam dados pessoais de leads:
  `rd-para-meta-conversoes`, `lead-meta-para-rd` e `meta-leads-entrada`.
