# Minuta — Acordo de tratamento de dados pessoais (controlador e operador)

> Rascunho técnico preparado a partir do fluxo real implantado em 2026-11-20. **Não é parecer jurídico**: deve
> ser revisado por advogado antes de assinar. Campos entre colchetes precisam ser preenchidos.

**CONTROLADORA:** [razão social da Credaz], CNPJ [•], com sede em [•], representada por [•] ("Credaz").

**OPERADORA:** Agência 24/7, representada por Filipe Jones, CPF [•], [ou razão social e CNPJ quando constituída], e-mail contato@agencia24por7.com ("Agência").

Este acordo integra o contrato de prestação de serviços de marketing entre as partes ("Contrato Principal") e
regula o tratamento de dados pessoais feito pela Agência em nome da Credaz, nos termos da Lei nº 13.709/2018
(LGPD), em especial os arts. 37 a 40.

## 1. Objeto e papéis

1.1. A Credaz é a controladora dos dados pessoais dos leads e contatos descritos no Anexo I e decide as
finalidades do tratamento. A Agência é operadora e só trata esses dados para executar os serviços descritos no
Anexo I, conforme as instruções documentadas da Credaz.

1.2. A Agência não usará os dados para finalidade própria, não os venderá, não os combinará com dados de
outros clientes e não os usará para treinar modelos de inteligência artificial.

## 2. Instruções

2.1. As instruções da Credaz são as deste acordo e as registradas por escrito (e-mail ou chamado) pelos
responsáveis indicados no Anexo III.

2.2. A Agência avisará a Credaz se considerar que uma instrução viola a LGPD, podendo suspender a execução
dessa instrução até o esclarecimento.

## 3. Confidencialidade e pessoal

3.1. Só têm acesso aos dados as pessoas da Agência que precisam deles para prestar o serviço, sujeitas a dever
de confidencialidade.

## 4. Segurança

4.1. A Agência mantém as medidas técnicas e administrativas do Anexo II, adequadas ao risco, e não as reduzirá
durante a vigência sem aviso prévio à Credaz.

## 5. Suboperadores

5.1. A Credaz autoriza os suboperadores listados no Anexo I. A Agência avisará com 15 dias de antecedência a
inclusão ou troca de suboperador, e a Credaz poderá se opor de forma fundamentada.

5.2. A Agência exigirá dos suboperadores obrigações de proteção de dados equivalentes às deste acordo.

## 6. Transferência internacional

6.1. A Credaz reconhece que parte do tratamento ocorre nos Estados Unidos (infraestrutura Google Cloud e
plataformas Meta), amparada nas cláusulas-padrão contratuais aprovadas pela ANPD (Resolução CD/ANPD nº 19/2024)
ou mecanismo equivalente adotado por cada fornecedor (LGPD, art. 33).

## 7. Direitos dos titulares

7.1. A Agência encaminhará à Credaz em até 2 dias úteis todo pedido de titular que receber sobre os dados deste
acordo e apoiará a resposta, inclusive localizando e excluindo dados sob sua guarda.

## 8. Incidentes de segurança

8.1. A Agência comunicará à Credaz qualquer incidente de segurança que envolva os dados deste acordo em até 24
horas do conhecimento, com: natureza do incidente, dados e titulares envolvidos, medidas tomadas e contato.

8.2. A comunicação à ANPD e aos titulares cabe à Credaz, com o apoio da Agência.

## 9. Retenção, devolução e exclusão

9.1. A Agência não guarda o conteúdo dos leads: eles transitam pela automação e são entregues ao CRM da
Credaz. Ficam guardados apenas identificadores técnicos (ID do lead e da negociação) para evitar duplicidade.

9.2. Ao término do Contrato Principal, a Agência excluirá em até 30 dias os identificadores e as credenciais de
acesso às contas da Credaz e confirmará por escrito, salvo obrigação legal de guarda.

## 10. Auditoria

10.1. A Agência fornecerá, mediante pedido com 15 dias de antecedência e no máximo uma vez por ano (salvo
incidente), as informações necessárias para demonstrar o cumprimento deste acordo.

## 11. Responsabilidade

11.1. Cada parte responde pelos danos que causar por violação da LGPD ou deste acordo, nos termos do art. 42 da
LGPD.

## 12. Vigência

12.1. Este acordo vigora enquanto durar o Contrato Principal e, após o término, até a conclusão da cláusula 9.

[Local e data] — [assinaturas]

---

## Anexo I — Descrição do tratamento

| Item | Descrição |
|---|---|
| Titulares | Pessoas que preenchem formulários de anúncios da Credaz no Facebook/Instagram; contatos e negociações no RD Station CRM da Credaz |
| Dados | Nome, telefone, e-mail, produto de interesse (ex.: consignado INSS, FGTS, Bolsa Família), identificadores do lead e da negociação, etapa do funil |
| Dados sensíveis | Não são coletados intencionalmente. O produto de interesse pode indicar condição socioeconômica (público vulnerável) |
| Finalidades | (a) entregar o lead ao CRM da Credaz; (b) criar tarefas por etapa do funil; (c) enviar à Meta eventos de conversão com o ID do lead, para otimizar anúncios; (d) conciliação horária para recuperar leads não entregues |
| Operações | Recepção do aviso da Meta (webhook), consulta do lead na Graph API, envio ao RD Station, envio do ID do lead à API de Conversões da Meta |
| Duração | Enquanto vigorar o Contrato Principal |
| Suboperadores | Google Cloud (hospedagem, EUA); Meta Platforms (origem dos leads e API de Conversões, EUA); RD Station (CRM da Credaz, contratado pela Credaz) |

## Anexo II — Medidas de segurança

- Tráfego sempre cifrado (HTTPS/TLS); avisos da Meta validados por assinatura (`X-Hub-Signature-256`).
- Credenciais de acesso cifradas no cofre da automação; nunca exibidas nem enviadas a terceiros.
- A automação de leads não salva o conteúdo das execuções (configuração `saveData… = none`).
- Somente identificadores ficam guardados (tabelas de controle sem nome, telefone ou e-mail).
- Acesso administrativo só por túnel autenticado (IAP); nenhuma porta de banco exposta.
- Backups cifrados em repouso, com expiração em 30 dias.
- Registro de incidentes e plano de resposta (`docs/lgpd/resposta-a-incidentes.md`).

## Anexo III — Contatos

| Parte                 | Responsável  | E-mail                                                        |
| --------------------- | ------------ | ------------------------------------------------------------- |
| Credaz                | \[•\]        | \[•\]                                                         |
| Agência (encarregado) | Filipe Jones | [contato@agencia24por7.com](mailto:contato@agencia24por7.com) |
