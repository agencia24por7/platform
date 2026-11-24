variable "project_id" {
  description = "Projeto do Google Cloud dedicado a este ambiente. Use um projeto separado da produção."
  type        = string
}

variable "billing_account_id" {
  description = "Conta de faturamento, usada apenas para criar o alerta de orçamento."
  type        = string
}

variable "region" {
  description = "Região elegível ao free tier do Compute Engine."
  type        = string
  default     = "us-central1"

  validation {
    condition     = contains(["us-west1", "us-central1", "us-east1"], var.region)
    error_message = "O e2-micro sempre grátis só existe em us-west1, us-central1 e us-east1."
  }
}

variable "zone" {
  description = "Zona dentro da região."
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "e2-medium (4 GB). O e2-micro (1 GB) não comporta n8n + app + postgres. Veja o ADR 0002."
  type        = string
  default     = "e2-medium"
}

variable "environment" {
  description = "Nome curto do ambiente, usado como prefixo dos recursos."
  type        = string
  default     = "teste"
}

variable "dns_zone_name" {
  description = "Nome da zona gerenciada no Cloud DNS. Vazio desliga a criação do registro."
  type        = string
  default     = ""
}

variable "dns_zone_project" {
  description = "Projeto onde a zona DNS vive, se for diferente deste."
  type        = string
  default     = ""
}

variable "app_hostname" {
  description = "Nome completo pelo qual o app será acessado. Precisa de HTTPS: IP cru não é aceito como URI de redirecionamento do OAuth."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+\\.[a-z0-9.-]+\\.[a-z]{2,}$", var.app_hostname))
    error_message = "Informe um nome completo, como orla.suaempresa.com.br."
  }
}

variable "n8n_hostname" {
  description = "Nome para a interface do n8n. Vazio mantém o n8n acessível apenas por túnel."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "E-mail usado pelo Let's Encrypt para avisos de expiração de certificado."
  type        = string
}

variable "budget_amount" {
  description = "Teto mensal do alerta de orçamento, na moeda da conta de faturamento."
  type        = number
  default     = 60
}

variable "budget_notification_emails" {
  description = "Quem recebe o alerta de orçamento."
  type        = list(string)
  default     = []
}

variable "boot_disk_gb" {
  description = "Disco de sistema, descartável: só SO, Docker e imagens. Os dados ficam no disco de dados."
  type        = number
  default     = 20
}

variable "data_disk_gb" {
  description = "Disco de dados persistente: volumes Docker (postgres, n8n, caddy). Não pode ser menor que o snapshot de origem."
  type        = number
  default     = 30
}

variable "data_disk_source_snapshot" {
  description = "Snapshot usado só na criação do disco de dados. null cria um disco vazio. Mudanças posteriores são ignoradas."
  type        = string
  default     = null
}

variable "backup_logico_retencao_dias" {
  description = "Por quantos dias os dumps lógicos do Postgres (feitos a cada desligamento da VM) ficam no bucket de backups."
  type        = number
  default     = 30
}

variable "contexto_versoes_antigas_dias" {
  description = "Por quantos dias as versões não atuais dos arquivos do contexto do cliente ficam no bucket (ADR 0027)."
  type        = number
  default     = 90
}

variable "contexto_versoes_mantidas" {
  description = "Teto de versões não atuais por arquivo do contexto do cliente; as mais antigas além disso são apagadas."
  type        = number
  default     = 5
}

variable "backup_retention_days" {
  description = "Por quantos dias os snapshots diários do disco de dados são mantidos."
  type        = number
  default     = 7
}

variable "logs_na_nuvem_habilitado" {
  description = "Liga o pacote opcional de logs na nuvem (ADR 0049, decisão 6): instala o Ops Agent na VM só para logs dos containers, cria a métrica de erros e a política de alerta por e-mail. Desligado por padrão; ver a seção Logs na nuvem do README antes de ligar."
  type        = bool
  default     = false
}

variable "logs_na_nuvem_chave_apt_impressao" {
  description = "Impressão digital (40 hex) da chave do repositório apt do Ops Agent (Artifact Registry Repository Signer). Proveniência e como conferir: seção Logs na nuvem do README. Vazia, a instalação do agente é recusada."
  type        = string
  default     = "35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3"

  validation {
    condition     = can(regex("^([0-9A-Fa-f]{40})?$", var.logs_na_nuvem_chave_apt_impressao))
    error_message = "A impressão digital deve ter exatamente 40 caracteres hexadecimais, sem espaços, ou ficar vazia."
  }
}

variable "logs_na_nuvem_retencao_dias" {
  description = "Retenção, em dias, do bucket _Default do Cloud Logging, onde ficam os logs da aplicação (ADR 0054). O padrão de 3 dias cobre um fim de semana entre o alerta por e-mail e a investigação. Acima de 30 dias a retenção é cobrada (US$ 0,01/GiB/mês); por isso o limite é 30."
  type        = number
  default     = 3

  validation {
    condition     = var.logs_na_nuvem_retencao_dias >= 1 && var.logs_na_nuvem_retencao_dias <= 30 && floor(var.logs_na_nuvem_retencao_dias) == var.logs_na_nuvem_retencao_dias
    error_message = "A retenção deve ser um número inteiro de dias entre 1 e 30."
  }
}

variable "logs_na_nuvem_alerta_uso_gib" {
  description = "Limite, em GiB de logs ingeridos no mês corrente, a partir do qual o alerta de uso avisa por e-mail (ADR 0054). O free tier do Cloud Logging é de 50 GiB por projeto por mês; o padrão de 40 GiB deixa folga para agir."
  type        = number
  default     = 40

  validation {
    condition     = var.logs_na_nuvem_alerta_uso_gib > 0 && var.logs_na_nuvem_alerta_uso_gib <= 50
    error_message = "O limite de alerta deve ser maior que 0 e no máximo 50 GiB (o free tier)."
  }
}
