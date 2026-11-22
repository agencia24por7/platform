---
status: accepted
date: 2026-11-21
---
# ADR-0042: Recifragem do cofre de tokens depois da rotação da chave do KMS

Fecha a pendência do ADR 0032 ("job de recifragem após rotação do KMS"). Vale para `integrations.connection_tokens`.

## Contexto
O envelope de cada token guarda a versão da chave mestra que o selou (`kms_key_version`, `access_kms_key_version`). A rotação do KMS cria uma versão nova primária, mas o que já estava gravado continua selado com a versão antiga. Desativar ou destruir a versão antiga antes de recifrar tornaria esses tokens ilegíveis e obrigaria a reautorizar todas as conexões.

## Decisão
1. `integrations.tokens_com_chave_antiga(versao_primaria, limite)` (migração 0138, `SECURITY DEFINER`, só `orla_worker`) devolve ponteiros (conexão e organização) de linhas cujo segredo ou token de acesso foi selado com outra versão. Nunca devolve segredo.
2. `CofreDeTokens.recifrarProativamente(limite)` descobre a versão primária selando uma sonda, lista as linhas antigas e, para cada uma, dentro do tenant e com a mesma concessão e trava otimista da renovação (`reivindicarRenovacao`/`concluirRenovacao`), decifra o segredo e o sela de novo na versão primária. O token de acesso em cache de banco é apagado (volta a ser emitido na próxima renovação) em vez de recifrado.
3. `POST /api/v0/tokens/recifrar {limite 1..200 = 50}` (worker token, fora do proxy como as demais rotas do cofre) devolve `{versaoPrimaria, avaliadas, recifradas, falhas}` e audita `tokens.recifragem` só com contagens e a versão.
4. O workflow `ORLA · tokens · recifragem` (`n8n/workflows/plataforma/tokens-recifragem.json`) roda aos domingos às 04:30 e a mão. É idempotente e barato quando não há nada em versão antiga.

## Procedimento de rotação
1. A chave tem rotação automática de 90 dias (`rotation_period` em `infra/terraform/tokens.tf`). A versão nova vira primária sozinha; as versões criadas pela rotação não estão no state do Terraform.
2. O workflow semanal recifra o que ficou em versão antiga. Para antecipar, rodar o workflow (ou a rota) a mão até `avaliadas = 0` e `falhas = 0`.
3. Só com `avaliadas = 0` e `falhas = 0` o humano desativa a versão antiga no KMS. Isso é um passo manual com exceção registrada aqui: a versão criada pela rotação não é gerenciada pelo Terraform, e declará-la (`google_kms_crypto_key_version`) fica para quando houver necessidade de desativar. Nunca desativar antes: o token daquela versão fica ilegível e a conexão precisa ser reautorizada. Falha numa conexão não é motivo para desativar: investigar o `connectionId` em `tokens.cifra.falhou`.

## Capacidade
Cada rodada recifra até 50 linhas (teto de 200 por chamada); semanal são cerca de 650 por ciclo de 90 dias. Acima disso o cofre não perde nada, só não chega a `avaliadas = 0` até aumentar o `limite` do workflow.

## Consequências
- A recifragem não chama provedor nenhum, só o KMS; não renova nem reautoriza.
- Concorrência: se outra renovação ganhar a corrida, a linha é ignorada nesta rodada e volta na seguinte.
- Sem a chave primária disponível a rodada termina com `falhas: 1` e não toca em nenhuma linha.
