---
status: accepted
date: 2026-11-27
---
# ADR-0073: Estratégia: Memória do plano (Case Study Builder, sem IA) (24K-134)

Supera em parte o ADR 0069 §1 (nenhum papel vê o Comitê na tela). Complementa os ADRs 0056, 0065, 0070, 0072 e 0075. Decidido pelo dono do produto em 2026-11-27.

## Contexto
O plano guarda tudo o que o motivou: versões, pareceres dos comitês, respostas do ajuste e provas citadas. Nada disso era legível como história do plano, e a página do plano não podia mostrar o Comitê (ADR 0069 §1). Faltava uma camada de documentação derivada do que já está gravado, sem custo de IA, que explicasse o que mudou, por que e quem decidiu.

## Decisão

### 1. Exceção ao ADR 0069 §1
- A página do plano ganha o bloco "Memória do plano" e o botão "Baixar memória do plano" (Markdown). É a única superfície em que o Comitê aparece.
- O que aparece: decisões por tema da seção alterada, com o motivo, e o autor como "Comitê de X" (nome do comitê), "Revisão automática" (mudança do agente sem comitê autor) ou uma pessoa.
- O que continua fora da tela e do arquivo: parecer bruto dos comitês (veredito, motivo, problema, ajuste pedido, fontes), deliberação de membros e mesas, Gates e seus resultados, vereditos do juiz como evento, nomes de membros e eventos de execução. O Comitê continua sem tela, aba ou rota próprias.
- A decisão exibida é a resposta do ajuste (`acatado` ou `nao_acatado`) com o motivo de até 160 caracteres. O prefixo "Juiz: " do motivo é retirado e o juiz não é citado.

### 2. Conteúdo (tudo derivado, nada novo gravado)
- Versões: linha cronológica com quando, tipo de mudança (criação, ajuste após a revisão, edição manual, mudança pelo agente), autor, estado e marcos (enviada para autorização, autorizada, rejeitada, revogada, cancelada). Mostra no máximo as 10 versões que o painel já lê.
- Intenção e foco da versão exibida (objetivo, foco, período, verba, ousadia, plataformas).
- Decisões criativas por versão, agrupadas por tema (título da seção do plano), ligando cada resposta ao ponto do parecer da versão respondida só para descobrir o tema; o texto do ponto não é exibido.
- Sinais de cultura e evidências citadas: título e nota da entrada no Brain, com o papel na evidência. Nunca a URL da fonte (ADR 0075 §1) nem a URN. Entrada que saiu do Brain aparece com rótulo neutro.
- Créditos: pessoas e o que fizeram, e comitês convocados (por parecer gravado).
- Resultados: impactos anotados (evento `impacto_anotado`, hoje sem emissor no app) e a avaliação de impacto atual do contexto do cliente.
- Pessoas aparecem como "Pessoa 1", "Pessoa 2", numeradas por ordem de aparição no próprio plano, sem nome nem e-mail: o módulo não tem resolução de nome de usuário e nome seria dado pessoal novo na tela e no arquivo. Revisitar se a equipe pedir nomes.

### 3. Implementação e segurança
- View-model em `src/modules/strategy/interface/memoriaDoPlano.ts` e geração de Markdown em `memoriaEmMarkdown.ts`; o componente só renderiza. A página lê o mesmo painel que já lê, então não há consulta nova.
- Download: `GET /clientes/{id}/estrategia/{planoId}/memoria`, no servidor, com `escopoDoClienteNaOrganizacao` e `podeVerAEstrategia` (viewer recebe 403, cliente fora do escopo ou de outra organização recebe 404, como o restante da Estratégia). Resposta `text/markdown`, `attachment`, `Cache-Control: private, no-store`.
- O Markdown escapa `\`, crases, `*`, `_`, colchetes, parênteses, `#`, `|`, `!`, `~`, `$`, `&`, `<`, `>`, `@` e `://` e junta quebras de linha: texto do modelo e do Brain não vira HTML, link, imagem, autolink nem título.
- Sem tabela, migração nem IA. Risco aceito: o motivo de uma decisão é texto do modelo (já conferido por `respostasDoAjusteSemDadoPessoal` na gravação) e aparece fora do Comitê; só é escapado, não reescrito.

## Consequências
- `.claude/rules/frontend.md` passa a dizer que a Memória do plano é a exceção. O teste de integração da página deixou de proibir "Comitê" dentro do bloco da memória e continua proibindo fora dele.
- Plano antigo (anterior à 0153) mostra decisões com o autor "Comitê" do que já existia; o que não tem mapeamento de ponto cai no tema "Plano".

## Rollback
Reverter o PR. Não há dado novo.
