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
    content   = "Houve linha de log com severidade ERROR ou acima nos containers da VM nos últimos 5 minutos. Abra o Logs Explorer com o filtro `logName=\"projects/${var.project_id}/logs/containers_docker\" AND severity>=ERROR` e investigue pelo `requestId`. Esta mensagem não traz conteúdo de log."
  }

  depends_on = [google_project_service.required]
}
