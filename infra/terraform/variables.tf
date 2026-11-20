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
