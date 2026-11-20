# 0027 — Armazenamento do contexto do cliente (bucket único, prefixo por cliente)

- Status: aceito
- Data: 2026-11-20
- Relaciona: ADR 0026 (contexto do cliente), ADR 0022 (exclusão lógica e expurgo), ADR 0023 (expurgo no BigQuery)

## Contexto

O contexto do cliente guarda (a) uma exportação estruturada derivada do banco ("cérebro") e (b) arquivos
enviados por pessoas: logos, manual de marca, CSV/feed, imagens, depoimentos. Os arquivos podem conter
dado pessoal (depoimentos com nome, planilhas) e dado de negócio. Postgres não é o lugar de binários, e o
disco da VM é descartável e único.

## Decisão

### Um bucket, um prefixo por organização e cliente

`${project_id}-tria-${ambiente}-contexto`, região do projeto (`var.region`, a mesma da VM), classe STANDARD
(`infra/terraform/contexto.tf`).

```
orgs/{orgId}/clientes/{clientId}/contexto/...              exportação derivada (reconstruível)
orgs/{orgId}/clientes/{clientId}/arquivos/{fileId}-{nome}  envios (fonte primária, não reconstruível)
```

Um bucket por cliente foi descartado: cria um recurso por cadastro (cota de criação de buckets, nomes globais
que vazam o cliente), exige um IAM por bucket e multiplica Terraform/monitoramento, sem ganho real, porque
quem acessa é sempre a mesma conta de serviço da VM. O isolamento entre clientes é lógico e feito pelo app:
`src/shared/storage/caminhos.ts` só aceita caminhos sob `orgs/{uuid}/clientes/{uuid}/`, recusa `..`, barra
dupla, controle e qualquer caractere fora de `[A-Za-z0-9._-]`, e o nome do arquivo só entra no caminho
depois de `nomeSeguro()` (NFKD, lista branca, 80 caracteres, uma única extensão, sem arquivo oculto).
O `orgId`/`clientId` vêm da sessão e do banco, nunca do corpo da requisição.

### Proteções do bucket

- `uniform_bucket_level_access` e `public_access_prevention = enforced`: sem ACL de objeto e sem acesso público.
- Sem CORS e sem URL assinada: todo tráfego do navegador passa pelo app (upload e download em streaming).
  Assim não há `signBlob`/`serviceAccountTokenCreator`, a autorização (papel, recorte por cliente) é a do app e
  cada acesso pode ser auditado.
- `force_destroy = false`; rótulos `ambiente`, `uso`, `dados`.
- Versionamento ligado: sobrescrever ou apagar um arquivo preserva a geração anterior.

### Retenção e custo

| Mecanismo | Valor | Por quê |
|---|---|---|
| Soft delete | 7 dias | Igual ao time travel do BigQuery (ADR 0023). Cobre exclusão acidental sem alongar a permanência de dado que o titular pediu para eliminar. O padrão do Google é 7; fica explícito no Terraform. |
| Versões não atuais | apagadas após 90 dias (`contexto_versoes_antigas_dias`) | Janela para desfazer troca de logo ou manual. |
| Quantidade de versões | no máximo 5 não atuais por objeto (`contexto_versoes_mantidas`) | Limita o crescimento quando um arquivo é regravado em laço. |
| Multipart incompleto | abortado após 7 dias | Evita pagar por pedaços órfãos. |

Custo: STANDARD em região única custa na ordem de US$ 0,02 por GB-mês. A cota é de 500 MB por cliente e 25 MB
por arquivo; com dezenas de clientes e versões, o total fica em poucos GB, centavos por mês. Operações e
saída de rede dentro da região são desprezíveis neste volume.

### IAM mínimo

Só a conta de serviço da VM, só neste bucket: `roles/storage.objectAdmin`
(`google_storage_bucket_iam_member.vm_usa_contexto`). O app precisa de `objects.list/get/create/delete`; o
menor papel predefinido que reúne os quatro é `objectAdmin`. A alternativa, `objectUser` mais
`legacyBucketReader`, também junta quatro permissões, mas inclui `buckets.get`, que o app não usa, e pede dois
vínculos. Apagar uma geração específica (expurgo) exige só `storage.objects.delete` com `generation`; não é
preciso nenhum papel de nível de projeto. Sem `buckets.*`, sem `signBlob`, sem `storage.admin`.

O app não chama `buckets.get`: `saudavel()` faz uma listagem de uma página. O script
`scripts/contexto-verificar-bucket.mjs` confere a configuração com a credencial de quem o roda.

### Semântica de exclusão

- `delete(path)`: com versionamento, apenas arquiva a geração atual (recuperável por até 90 dias pelas
  regras acima). Serve para o uso do dia a dia e para a exclusão lógica de cliente (ADR 0022), que não apaga.
- `delete(path, { todasAsVersoes: true })` e `deletePrefix(prefixo)`: listam com `versions: true` e apagam
  cada geração pelo número, incluindo as não atuais. É o caminho do expurgo por LGPD
  (`expurgar-cliente`): o prefixo precisa ter o formato `orgs/{org}/clientes/{cliente}/` ou mais fundo e terminar em
  `/`, para que um prefixo parecido não alcance outro cliente.
- O que sobra depois de um expurgo: objetos apagados ficam em soft delete por até 7 dias, fora do alcance do app
  e sem listagem normal. Esse prazo deve constar no que se informa ao titular (já registrado em
  `docs/lgpd/retencao.md`). Se a eliminação imediata for exigida, o administrador apaga o objeto em soft delete
  pelo console ou pelo `gcloud storage`, fora do app.
- O retorno `deleted` conta gerações apagadas, não nomes de objeto.
- Planilhas e CSV exportados do contexto devem neutralizar fórmulas (`=`, `+`, `-`, `@`) na camada de domínio.

### Recuperação e o que não é coberto

Coberto: exclusão ou sobrescrita acidental (versionamento + soft delete) e perda da VM (os dados não estão no
disco). Não coberto: exclusão do próprio bucket ou do projeto (o `force_destroy = false` e o `prevent_destroy`
manual ajudam, mas não há cópia em outro projeto ou região), corrupção lógica gravada pelo app (vira uma nova
versão válida), e retenção além de 90 dias para versões antigas. Cópia entre projetos e bucket lock ficam
fora enquanto o volume e a exigência contratual não o justificarem.

### Caminho de migração

- Chave de criptografia própria por cliente (CMEK) ou isolamento contratual: criar um bucket por cliente
  exigente e roteá-lo pelo `clientId`. O adaptador recebe o nome do bucket por injeção
  (`ArmazenamentoGcs(bucket)`); bastaria uma tabela cliente → bucket na fábrica. O formato do caminho já inclui
  `orgs/{orgId}/clientes/{clientId}/`, então a cópia é um `gcloud storage cp -r` por prefixo, sem renomear.
- Se a escala pedir, mover o streaming de download para URL assinada exigiria `serviceAccountTokenCreator` na
  própria conta e CORS; hoje isso é recusado de propósito.

## Interface no código

`src/shared/storage/`: `tipos.ts` (porta `ArmazenamentoDeContexto`, erros), `caminhos.ts` (validação e
`nomeSeguro`), `politicaDeArquivos.ts` (lista de tipos, 25 MB por arquivo, 500 MB por cliente, identificação por
bytes iniciais, cabeçalhos de download), `armazenamentoGcs.ts`, `armazenamentoNulo.ts` (sem `CONTEXT_BUCKET`,
toda operação rejeita com `ArmazenamentoIndisponivelError` e `saudavel()` devolve `false`) e
`criarArmazenamentoDeContexto.ts`.

Tipos aceitos: png, jpeg, webp, gif, pdf, csv, txt, xlsx, docx e, para ativos de marca, zip e fontes
(ttf, otf, woff2). Recusados: html, svg, js e executáveis. O tipo é decidido pelos bytes iniciais; extensão e
`Content-Type` declarado só podem confirmar, nunca promover. CSV/TXT precisam ser UTF-8 sem NUL e sem marcadores
ativos (`<script`, `<html`, `<svg`...). Download sempre como `attachment`, com `nosniff`, `Content-Security-Policy:
sandbox` e `Cache-Control: private, no-store`.

## Ordem de aplicação

1. `terraform apply` (workflow `infra.yml`, no merge em `main`): cria o bucket, o vínculo de IAM e grava
   `CONTEXT_BUCKET` no `startup.sh` da VM. Mudar o script de inicialização reinicia a VM
   (`allow_stopping_for_update`), que regrava o `.env`.
2. Rodar `node scripts/contexto-verificar-bucket.mjs <bucket>` (saída `contexto_bucket` do Terraform) com
   credencial de operador.
3. Só então o deploy do app com a funcionalidade. Sem a variável, o app sobe normalmente e as rotas de arquivo
   respondem "indisponível".
