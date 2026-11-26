BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'brain.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'brain.papel_worker',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_worker', 'tria_worker') ORDER BY rolname = 'orla_worker' DESC LIMIT 1),
    true
  );
  IF current_setting('brain.papel_app') = '' OR current_setting('brain.papel_worker') = '' THEN
    RAISE EXCEPTION 'papeis do app e do worker ausentes; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.knowledge_entries (
  key              text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  categoria        text NOT NULL CHECK (categoria IN ('lente', 'pratica', 'regra_legal', 'benchmark')),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160),
  resumo           text NOT NULL CHECK (length(resumo) BETWEEN 1 AND 600),
  fonte            text NOT NULL CHECK (length(fonte) BETWEEN 1 AND 300),
  nota             text NOT NULL CHECK (nota IN ('A', 'B', 'C', 'D')),
  maturidade       text CHECK (maturidade IN ('rumor', 'piloto', 'validado')),
  mercado          text NOT NULL CHECK (length(mercado) BETWEEN 1 AND 40),
  jurisdicao       text NOT NULL CHECK (jurisdicao ~ '^[a-z]{2,10}$'),
  data_da_fonte    date NOT NULL,
  valido_ate       date,
  verificado_em    date,
  obrigatoria      boolean NOT NULL DEFAULT false,
  replicada        boolean NOT NULL DEFAULT false,
  ativa            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version),
  CONSTRAINT knowledge_entries_maturidade CHECK (
    (categoria = 'pratica' AND maturidade IS NOT NULL) OR (categoria <> 'pratica' AND maturidade IS NULL)),
  CONSTRAINT knowledge_entries_obrigatoria CHECK (
    NOT obrigatoria OR (categoria = 'regra_legal' AND verificado_em IS NOT NULL))
);

COMMENT ON TABLE core.knowledge_entries IS
  'Conhecimento global do Brain (ADR 0065 §2): lentes de estratégia, práticas, regras legais e benchmarks, cada um com fonte, nota (A primária, B pesquisa com método, C fornecedor, D não verificável), validade, jurisdição e data de verificação. Sem dado de cliente e sem organization_id. Imutável: versão nova é linha nova (mesma key); a carga é por migração. O app e o worker só leem; o provedor conhecimento projeta as entradas ativas, na última versão, no catálogo de cada cliente.';
COMMENT ON COLUMN core.knowledge_entries.maturidade IS
  'Só para categoria pratica: rumor, piloto ou validado. Nula nas demais categorias.';
COMMENT ON COLUMN core.knowledge_entries.jurisdicao IS
  'Código curto em minúsculas: global, br, ue. O catálogo do cliente projeta só global e br na v1.';
COMMENT ON COLUMN core.knowledge_entries.valido_ate IS
  'Fim da validade da evidência. Vencida, a entrada continua no catálogo e aparece marcada; nula = sem prazo.';
COMMENT ON COLUMN core.knowledge_entries.verificado_em IS
  'Data em que o texto foi conferido na fonte oficial, por pessoa ou por agente de IA (o resumo diz quem e se houve revisão jurídica). Nula = não verificado.';
COMMENT ON COLUMN core.knowledge_entries.obrigatoria IS
  'Só regra legal com verificado_em preenchido pode ser obrigatória no Gate (CHECK knowledge_entries_obrigatoria).';
COMMENT ON COLUMN core.knowledge_entries.replicada IS
  'Verdadeiro quando o resultado foi replicado por outro estudo independente.';
COMMENT ON COLUMN core.knowledge_entries.ativa IS
  'A última versão de cada key vale; versão com ativa falso retira a entrada do catálogo.';

CREATE OR REPLACE FUNCTION core.conhecimento_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'conhecimento do Brain e imutavel: crie uma versao nova (mesma key)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.conhecimento_imutavel IS
  'Gatilho de core.knowledge_entries: nega UPDATE e DELETE, inclusive ao dono. App e worker não têm privilégio de escrita nem de esvaziar a tabela. Versão nova é linha nova.';

DROP TRIGGER IF EXISTS knowledge_entries_imutavel ON core.knowledge_entries;
CREATE TRIGGER knowledge_entries_imutavel BEFORE UPDATE OR DELETE ON core.knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION core.conhecimento_imutavel();

DO $$
DECLARE papel text := current_setting('brain.papel_app');
BEGIN
  ALTER TABLE core.knowledge_entries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.knowledge_entries FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS knowledge_entries_leitura ON core.knowledge_entries;
  EXECUTE format('CREATE POLICY knowledge_entries_leitura ON core.knowledge_entries FOR SELECT TO %I USING (true)', papel);
  REVOKE ALL ON core.knowledge_entries FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.knowledge_entries FROM %I', papel);
  EXECUTE format('REVOKE ALL ON core.knowledge_entries FROM %I', current_setting('brain.papel_worker'));
  EXECUTE format('GRANT SELECT ON core.knowledge_entries TO %I', papel);
END $$;

INSERT INTO core.knowledge_entries
  (key, version, categoria, titulo, resumo, fonte, nota, maturidade, mercado, jurisdicao, data_da_fonte, valido_ate, verificado_em, obrigatoria, replicada)
VALUES
  ('rumelt_nucleo_da_estrategia', 1, 'lente', 'Rumelt: o núcleo da estratégia',
   'Estratégia é um núcleo de três partes: diagnóstico do desafio, política orientadora e ações coerentes entre si.',
   'Rumelt, Good Strategy Bad Strategy (2011). Lida por fonte secundária, não pelo texto original.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('porter_trade_offs', 1, 'lente', 'Porter: estratégia é escolher o que não fazer',
   'Estratégia é escolher o que não fazer. Exige trade-offs e encaixe entre as atividades da empresa, de modo que uma reforce a outra.',
   'Porter, What Is Strategy? (Harvard Business Review, 1996). Lida por fonte secundária.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('mintzberg_deliberada_e_emergente', 1, 'lente', 'Mintzberg: estratégia deliberada e emergente',
   'A estratégia realizada soma a deliberada e a emergente. Vale comparar o plano com o que foi de fato realizado.',
   'Mintzberg e Waters (1985). Lida por fonte secundária.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('sharp_penetracao_e_disponibilidade', 1, 'lente', 'Sharp: penetração e disponibilidade',
   'Marcas crescem por penetração, com disponibilidade mental (ser lembrada) e física (ser fácil de achar e comprar).',
   'Sharp, How Brands Grow (2010). Lida por fonte secundária.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('ritson_diagnostico_antes_da_tatica', 1, 'lente', 'Ritson: diagnóstico antes da tática',
   'A ordem é diagnóstico, depois estratégia (segmentação, alvo e posicionamento) e só então a tática.',
   'Mark Ritson (aulas e colunas). Lida por fonte secundária.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('kotler_stp', 1, 'lente', 'Kotler: segmentação, alvo e posicionamento',
   'Segmentação, alvo e posicionamento (STP) são uma base atemporal do marketing. A tecnologia citada nas obras é datada e não deve ser tomada como atual.',
   'Kotler e Keller, Administração de Marketing. Lida por fonte secundária.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('helmer_sete_poderes', 1, 'lente', 'Helmer: os sete poderes',
   'Sete fontes de vantagem durável: economia de escala, efeito de rede, contraposicionamento, custo de troca, marca, recurso exclusivo e poder de processo.',
   'Helmer, 7 Powers (2016). Lida por fonte secundária.',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('meira_aeiou', 1, 'lente', 'Meira: AEIOU',
   'AEIOU: Ambiente, Estratégia, Interações, Operação e Unificação. Nesta lente, estratégia transforma aspirações em capacidades.',
   'silvio.meira.com (leitura direta do blog, sem intermediário).',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('meira_efeitos_de_rede', 1, 'lente', 'Meira: tipos de efeito de rede',
   'Há tipos distintos de efeito de rede, e o efeito de dados é raro.',
   'silvio.meira.com (leitura direta do blog, sem intermediário).',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('meira_rede_agentica', 1, 'lente', 'Meira: rede de agentes',
   'Em rede de agentes, a mensagem é conteúdo não confiável. Exige proveniência e autoridade presa a propósito, tempo e contraparte. Eco não é evidência. Pedem-se telemetria e kill switch.',
   'silvio.meira.com (leitura direta do blog, sem intermediário).',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),

  ('gordon_2019_observacional_superestima', 1, 'benchmark', 'Gordon et al. (2019): método observacional superestima o efeito do anúncio',
   'Métodos observacionais superestimam o efeito do anúncio quando comparados a experimentos aleatorizados.',
   'Gordon, Zettelmeyer, Bhargava e Chapsky, Marketing Science (2019).',
   'A', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, true),
  ('lewis_rao_2015_medir_roi_e_caro', 1, 'benchmark', 'Lewis e Rao (2015): medir o retorno de uma campanha é caro',
   'Medir o retorno de uma campanha isolada exige amostras muito grandes, da ordem de milhões de pessoas-semana.',
   'Lewis e Rao, Quarterly Journal of Economics (2015).',
   'A', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('blake_2015_busca_de_marca', 1, 'benchmark', 'Blake, Nosko e Tadelis (2015): retorno da busca paga de marca',
   'Em experimento no eBay, o retorno da busca paga de marca ficou próximo de zero. Separar a busca de marca da prospecção.',
   'Blake, Nosko e Tadelis, Econometrica (2015).',
   'A', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('binet_field_marca_ativacao', 1, 'benchmark', 'Binet e Field: divisão entre marca e ativação',
   'Divisão marca:ativação perto de 60:40 como ponto de partida, e perto de 46:54 em B2B. É ponto de partida, não regra.',
   'Binet e Field, IPA (2013); LinkedIn B2B Institute (2019).',
   'B', NULL, 'global', 'global', '2026-11-24', NULL, NULL, false, false),
  ('att_custo_por_conversao', 1, 'benchmark', 'App Tracking Transparency e o custo por conversão',
   'Depois do App Tracking Transparency o custo por conversão subiu. A pesquisa de 2026-11 cita +73,2%. Número não verificado: referência original a confirmar.',
   'Pesquisa de 2026-11 que cita o dado; referência original não confirmada.',
   'C', NULL, 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('ncs_criativo_47', 1, 'benchmark', 'NCS/Nielsen: peso do criativo nas vendas incrementais',
   'O criativo responderia por cerca de 47% das vendas incrementais em bens de consumo. Número não verificado: relatório original não localizado.',
   'NCS/Nielsen; relatório original não localizado.',
   'C', NULL, 'eua', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('haus_manual_x_automatico', 1, 'benchmark', 'Haus: campanha manual contra Advantage+',
   'Fornecedor de medição reporta que 58% das marcas tiveram iROAS maior em campanha manual que em Advantage+. Número de fornecedor, sem verificação independente.',
   'Haus (fornecedor de medição).',
   'C', NULL, 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('geo_citacoes_em_ia', 1, 'benchmark', 'Generative Engine Optimization: citações e visibilidade em IA',
   'Incluir citações e estatísticas aumentou a visibilidade em respostas de IA (25 a 40% em estudo acadêmico). Marcação de schema para IA não mostrou ganho.',
   'Estudo de Generative Engine Optimization (Princeton e outros).',
   'B', NULL, 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),

  ('incrementalidade_com_holdout', 1, 'pratica', 'Meta de canal em incrementalidade, com grupo de controle',
   'Definir a meta de canal em incrementalidade (lift ou iROAS) medida com grupo de controle. O ROAS de plataforma serve só como teto. Apoiada por Gordon et al. (2019) e Lewis e Rao (2015).',
   'Gordon et al. (2019); Lewis e Rao (2015).',
   'A', 'validado', 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('qualidade_de_sinal', 1, 'pratica', 'Qualidade de sinal antes de otimizar',
   'API de conversões, qualidade de correspondência e deduplicação são pré-requisito de otimização.',
   'Documentação de plataforma.',
   'C', 'validado', 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('diversidade_de_conceito_criativo', 1, 'pratica', 'Diversidade de conceito criativo',
   'Conceitos realmente distintos contam. Variação cosmética tende a ser agrupada pela plataforma.',
   'Plataformas e fornecedores.',
   'C', 'piloto', 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('click_to_whatsapp', 1, 'pratica', 'Click-to-WhatsApp no Brasil',
   'Canal forte no Brasil. A atribuição exige o identificador de clique via provedor oficial. Os custos por lead publicados são de fornecedor.',
   'Fornecedores e documentação de plataforma.',
   'C', 'piloto', 'brasil', 'br', '2026-11-24', '2027-05-31', NULL, false, false),
  ('holdout_em_campanha_automatica', 1, 'pratica', 'Holdout em campanha automática',
   'Há casos de superestimação em campanhas automáticas de plataforma. Testar com holdout. Só há números de fornecedor.',
   'Fornecedores de medição.',
   'C', 'piloto', 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),
  ('promessa_de_ganho_garantido', 1, 'pratica', 'Promessa de ganho garantido',
   'Alegações como "+14% garantido" em produto automático ou "custo por lead 92% menor" não têm medição independente. Nunca usar como meta.',
   'Material de fornecedores, sem medição independente.',
   'D', 'rumor', 'global', 'global', '2026-11-24', '2027-05-31', NULL, false, false),

  ('lgpd_base_legal_em_publicos', 1, 'regra_legal', 'LGPD: todo uso de dado pessoal em anúncios precisa de base legal',
   'Todo tratamento de dado pessoal exige uma das hipóteses do art. 7º; consentimento e legítimo interesse são duas delas. A lei não cita públicos personalizados: enviar lista de clientes a uma plataforma é tratamento e precisa de base legal. Dado coletado por consentimento e compartilhado com outro controlador pede consentimento específico (art. 7º, § 5º). Dado sensível (art. 11) e de criança (art. 14) têm regra mais estrita. Conferido na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica.',
   'Lei nº 13.709, de 14/08/2018 (LGPD), texto compilado em planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
   'A', NULL, 'brasil', 'br', '2026-11-26', '2027-05-31', '2026-11-26', false, false),
  ('eca_digital', 1, 'regra_legal', 'ECA Digital: proibido perfilar menores para publicidade',
   'A Lei 15.211/2025, em vigor desde 17/03/2026 e regulamentada pelo Decreto 12.880/2026, veda o uso de técnicas de perfilamento para direcionar publicidade comercial a crianças e adolescentes (art. 22) e a criação de perfis comportamentais deles para esse fim (art. 26). Vale para planos que segmentem ou perfilem menores de 18 anos. Não ficou confirmado se a obrigação recai direto sobre o anunciante ou só sobre o fornecedor do serviço digital. Conferido na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica.',
   'Lei nº 15.211, de 17/09/2025, e Decreto nº 12.880, de 18/03/2026, em planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/L15211.htm',
   'A', NULL, 'brasil', 'br', '2026-11-26', '2027-05-31', '2026-11-26', false, false),
  ('apostas_publicidade_vedada', 1, 'regra_legal', 'Apostas: publicidade proibida no Brasil por medida provisória',
   'A Medida Provisória 1.394, de 25/09/2026, veda no território nacional as ações de comunicação, publicidade, propaganda, marketing e patrocínio de loterias de aposta de quota fixa, em qualquer meio, físico ou digital (art. 16). Não alcança as demais modalidades lotéricas autorizadas por lei (art. 1º, § 2º). Está em vigor, mas não foi convertida em lei: o prazo de deliberação vai até 04/03/2027 e, sem conversão, ela perde eficácia. Conferido na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica.',
   'Medida Provisória nº 1.394, de 25/09/2026, em planalto.gov.br/ccivil_03/_ato2023-2026/2026/Mpv/mpv1394.htm; tramitação em congressonacional.leg.br (MPV 1394/2026)',
   'A', NULL, 'brasil', 'br', '2026-11-26', '2027-03-04', '2026-11-26', false, false),
  ('conar_anexo_x_apostas', 1, 'regra_legal', 'CONAR, Anexo X: autorregulação da publicidade de apostas',
   'O Anexo X do Código do CONAR, na versão aprovada em 27/08/2026, vale só para o setor de apostas e é norma ética privada, não lei: sem menores como participantes ou público-alvo, sem promessa de ganho certo, fácil ou elevado, com mensagem de alerta padronizada e identificação da licença. Desde 25/09/2026 a Medida Provisória 1.394 proíbe a publicidade de apostas de quota fixa no Brasil; enquanto ela valer, o Anexo não autoriza anunciar. Conferido na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica.',
   'Código Brasileiro de Autorregulamentação Publicitária, Anexo X (Apostas), versão de 27/08/2026, em conar.org.br/codigos',
   'A', NULL, 'brasil', 'br', '2026-11-26', '2027-03-04', '2026-11-26', false, false),
  ('anpd_cookies_de_publicidade', 1, 'regra_legal', 'ANPD: cookies de publicidade e base legal (guia orientativo)',
   'O Guia Orientativo da ANPD sobre cookies (versão 1.0, outubro de 2022) é boa prática, não norma. Classifica os cookies de publicidade como não necessários, diz que o legítimo interesse dificilmente será a hipótese mais apropriada para publicidade e que o consentimento pode ser a mais apropriada, conforme o caso. Recomenda opção de rejeitar os cookies não necessários e mantê-los desativados por padrão. Vale para quem usa pixel ou tag próprios. Conferido na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica.',
   'ANPD, Guia Orientativo Cookies e proteção de dados pessoais, versão 1.0 (outubro de 2022), em gov.br/anpd',
   'A', NULL, 'brasil', 'br', '2026-11-26', '2027-05-31', '2026-11-26', false, false),
  ('consent_mode_v2', 1, 'regra_legal', 'Google: consentimento de usuários do EEE, Reino Unido e Suíça',
   'A política de consentimento de usuários da UE do Google é regra contratual de plataforma, não lei. Vale para usuários finais localizados no Espaço Econômico Europeu, no Reino Unido e na Suíça, onde quer que o anunciante esteja. Exige obter e registrar o consentimento e enviar o sinal: ad_user_data e ad_personalization precisam estar concedidos para publicidade personalizada, remarketing e listas de clientes. Plano só com público no Brasil não é alcançado. Conferido na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica.',
   'Google, EU user consent policy e documentação do consent mode, em google.com/about/company/user-consent-policy',
   'A', NULL, 'europa', 'ue', '2026-11-26', '2027-05-31', '2026-11-26', false, false)
ON CONFLICT (key, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS core.client_brain_performance (
  client_id               uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  organization_id         uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  platform                text NOT NULL CHECK (platform IN ('meta', 'google')),
  periodo                 date NOT NULL,
  recorte                 text NOT NULL CHECK (recorte IN ('total', 'campanha', 'idade_genero', 'regiao', 'dispositivo', 'posicionamento')),
  item                    text NOT NULL CHECK (length(item) <= 200),
  rotulo                  text NOT NULL CHECK (length(rotulo) BETWEEN 1 AND 200),
  investimento_centavos   bigint NOT NULL CHECK (investimento_centavos >= 0),
  impressoes              bigint NOT NULL CHECK (impressoes >= 0),
  cliques                 bigint NOT NULL CHECK (cliques >= 0),
  conversoes              numeric NOT NULL CHECK (conversoes >= 0),
  receita_centavos        bigint CHECK (receita_centavos IS NULL OR receita_centavos >= 0),
  moeda                   char(3) NOT NULL CHECK (moeda ~ '^[A-Z]{3}$'),
  medido_em               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, platform, periodo, recorte, item),
  CONSTRAINT client_brain_performance_mes CHECK (EXTRACT(day FROM periodo) = 1),
  CONSTRAINT client_brain_performance_item CHECK ((recorte = 'total') = (item = ''))
);

CREATE INDEX IF NOT EXISTS client_brain_performance_org_idx ON core.client_brain_performance (organization_id);

COMMENT ON TABLE core.client_brain_performance IS
  'Resumos agregados de desempenho por cliente, copiados do BigQuery por medição periódica (ADR 0065 §2, molde de core.client_brain_coverage): o catálogo nunca consulta o BigQuery na leitura. Só agregados de meses fechados, sem dado pessoal. total: uma linha por plataforma e mês, periodo = primeiro dia do mês. Os demais recortes (campanha, idade_genero, regiao, dispositivo, posicionamento) agregam os 3 últimos meses fechados: periodo = primeiro dia do primeiro mês dessa janela (os três meses são periodo e os dois seguintes). Campanha traz as 10 maiores por investimento por plataforma; os outros recortes, as 8 maiores fatias. A gravação substitui todas as linhas do cliente numa transação.';
COMMENT ON COLUMN core.client_brain_performance.item IS
  'Identificador da fatia no recorte (id da campanha, região, faixa etária e gênero etc.). Vazio no recorte total.';
COMMENT ON COLUMN core.client_brain_performance.receita_centavos IS
  'Nula quando a plataforma não informou valor de conversão (receita ausente ou zero): o ROAS não se calcula.';
COMMENT ON COLUMN core.client_brain_performance.moeda IS
  'Moeda da plataforma; XXX quando a janela mistura moedas e o total em centavos não é comparável.';

DO $$
DECLARE papel text := current_setting('brain.papel_app');
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.client_brain_performance TO %I', papel);
END $$;

ALTER TABLE core.client_brain_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.client_brain_performance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.client_brain_performance FROM PUBLIC;

DO $$ BEGIN
  DROP POLICY IF EXISTS client_brain_performance_tenant ON core.client_brain_performance;
  EXECUTE format(
    'CREATE POLICY client_brain_performance_tenant ON core.client_brain_performance FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_brain_performance.client_id
                          AND c.organization_id = client_brain_performance.organization_id))
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_brain_performance.client_id
                          AND c.organization_id = client_brain_performance.organization_id))',
    current_setting('brain.papel_app'));
END $$;

COMMIT;
