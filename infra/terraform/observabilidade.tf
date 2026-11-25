locals {
  filtro_linha_da_app = "resource.type=\"gce_instance\" AND logName=\"projects/${var.project_id}/logs/containers_docker\" AND jsonPayload.at:*"
}

resource "google_logging_metric" "erros_app" {
  count = var.logs_na_nuvem_habilitado ? 1 : 0

  name        = "${local.prefix}-erros-containers"
  description = "Linhas de severidade ERROR ou acima nos logs dos containers da VM."
  filter      = "resource.type=\"gce_instance\" AND logName=\"projects/${var.project_id}/logs/containers_docker\" AND severity>=ERROR AND jsonPayload.at:* AND NOT jsonPayload.message=\"client.erro\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.required]
}

resource "google_logging_project_exclusion" "containers_fora_da_aplicacao" {
  count = var.logs_na_nuvem_habilitado ? 1 : 0

  name        = "${local.prefix}-containers-fora-da-aplicacao"
  description = "Descarta do armazenamento o log de container que não tem o formato da linha da aplicação (Caddy, Postgres, n8n), mesmo que o filtro do agente na VM falhe."
  filter      = "resource.type=\"gce_instance\" AND logName=\"projects/${var.project_id}/logs/containers_docker\" AND NOT jsonPayload.at:*"

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "erros_app" {
  count = var.logs_na_nuvem_habilitado ? 1 : 0

  display_name = "${local.prefix} · erros nos containers"
  combiner     = "OR"

  conditions {
    display_name = "Erros nos logs dos containers em 5 minutos"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.erros_app[0].name}\" AND resource.type=\"gce_instance\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [for canal in google_monitoring_notification_channel.budget : canal.id]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Houve linha de log com severidade ERROR ou acima nos containers da VM nos últimos 5 minutos. Abra o Logs Explorer, em Refinar escopo escolha o bucket `${local.prefix}-aplicacao`, filtre `severity>=ERROR` e investigue pelo `requestId`. Esta mensagem não traz conteúdo de log."
  }

  depends_on = [google_project_service.required]
}

resource "google_logging_project_bucket_config" "aplicacao" {
  count = var.logs_na_nuvem_habilitado ? 1 : 0

  project        = var.project_id
  location       = "global"
  bucket_id      = "${local.prefix}-aplicacao"
  retention_days = var.logs_na_nuvem_retencao_dias
  description    = "Logs da aplicação, com retenção mínima (ADR 0054). Não guarda auditoria nem logs de outros serviços."

  depends_on = [google_project_service.required]
}

resource "google_logging_project_sink" "aplicacao" {
  count = var.logs_na_nuvem_habilitado ? 1 : 0

  name                   = "${local.prefix}-aplicacao"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.aplicacao[0].id}"
  filter                 = local.filtro_linha_da_app
  unique_writer_identity = true

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "uso_de_logs" {
  count = var.logs_na_nuvem_habilitado ? 1 : 0

  display_name = "${local.prefix} · uso de logs perto do free tier"
  combiner     = "OR"

  conditions {
    display_name = "Logs ingeridos no mês acima do limite de alerta"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/billing/monthly_bytes_ingested\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.logs_na_nuvem_alerta_uso_gib * 1073741824
      duration        = "0s"

      aggregations {
        alignment_period     = "7200s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [for canal in google_monitoring_notification_channel.budget : canal.id]

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "O volume de logs ingeridos no mês passou do limite de alerta (${var.logs_na_nuvem_alerta_uso_gib} GiB; o free tier é de 50 GiB por projeto por mês, e o excedente custa US$ 0,50/GiB). Veja a página Logs Storage do console, identifique a origem do volume e, se preciso, aperte o filtro do agente na VM ou a exclusão do projeto. Esta mensagem não traz conteúdo de log."
  }

  depends_on = [google_project_service.required]
}
