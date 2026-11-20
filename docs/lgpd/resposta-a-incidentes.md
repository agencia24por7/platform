# Resposta a incidentes de segurança (LGPD, art. 48; Resolução CD/ANPD nº 15/2024)

Responsável: o encarregado (contato@agencia24por7.com).

## 1. Conter (primeiras horas)

- Revogar o que vazou: token do worker (`tria-producao-worker-token` e a credencial "ORLA · worker token" do
  n8n, como na troca de 2026-11-20), chave da API do n8n, segredo de sessão (`session-secret`, derruba todas as
  sessões) ou credenciais de conexão (remover a conexão no app e revogar na plataforma).
- Se a VM estiver comprometida: `./scripts/vm-desligar.sh` (faz o dump antes) e preservar o disco de dados
  (snapshot) para análise.
- Anotar horário de descoberta, quem descobriu e o que foi feito.

## 2. Avaliar

- Quais dados e quantos titulares (use `docs/lgpd/registro-de-operacoes.md`).
- Houve risco ou dano relevante? Considere dados de leads (público de crédito), tokens de acesso a contas de
  anúncio e volume de titulares.
- A trilha `audit.audit_log` e os logs do contêiner (`docker logs orla-app`) mostram acessos e origens.

## 3. Comunicar (se houver risco ou dano relevante)

- À ANPD, pelo formulário no gov.br, em até 3 dias úteis do conhecimento do incidente.
- Aos titulares afetados, no mesmo prazo, em linguagem simples: o que aconteceu, quais dados, riscos, o que
  fizemos e o que a pessoa pode fazer.
- Aos clientes controladores (incidente com leads ou métricas deles), imediatamente, para que comuniquem os
  titulares deles.

## 4. Registrar

Todo incidente, mesmo sem comunicação, vira um registro em `docs/lgpd/incidentes/AAAA-MM-DD-*.md` com: data,
descrição, dados e titulares envolvidos, avaliação de risco, medidas tomadas e comunicações feitas. Guardar por
no mínimo 5 anos.
