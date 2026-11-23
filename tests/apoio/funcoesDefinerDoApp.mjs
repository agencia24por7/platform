export const FUNCOES_DEFINER_DO_APP = Object.freeze([
  'core.accept_invitation(p_invitation_id uuid, p_user_id uuid)',
  'core.any_organization_exists()',
  'core.client_scope_of(p_user_id uuid, p_organization_id uuid)',
  'core.contexto_link_abrir(p_token_hash text)',
  'core.contexto_link_concluir(p_token_hash text)',
  'core.contexto_link_confirmar_arquivo(p_token_hash text, p_id uuid, p_section text, p_field_key text, p_item_id uuid, p_filename text, p_mime text, p_size_bytes bigint, p_sha256 text)',
  'core.contexto_link_ler(p_token_hash text, p_campos text[])',
  'core.contexto_link_liberar_reserva(p_token_hash text, p_id uuid)',
  'core.contexto_link_pelo_convite(p_invite_token text)',
  'core.contexto_link_registrar_abertura(p_token_hash text)',
  'core.contexto_link_remover_item(p_token_hash text, p_item_id uuid, p_versao_esperada integer)',
  'core.contexto_link_reservar_arquivo(p_token_hash text, p_id uuid, p_section text, p_item_id uuid, p_object_path text, p_size_bytes bigint, p_cota_bytes bigint, p_orcamento_bytes_hora bigint, p_envios_hora integer)',
  'core.contexto_link_salvar_campo(p_token_hash text, p_section text, p_field_key text, p_value jsonb, p_epistemic text, p_versao_esperada integer)',
  'core.contexto_link_salvar_item(p_token_hash text, p_section text, p_list_key text, p_item_id uuid, p_data jsonb, p_epistemic text, p_versao_esperada integer)',
  'core.contexto_link_salvar_item(p_token_hash text, p_section text, p_list_key text, p_item_id uuid, p_data jsonb, p_epistemic text, p_versao_esperada integer, p_maximo integer)',
  'core.contexto_reservar_arquivo_da_equipe(p_cliente uuid, p_id uuid, p_object_path text, p_size_bytes bigint, p_cota_bytes bigint)',
  'core.create_organization(p_name text, p_slug text, p_type core.organization_type, p_manager_account_id text, p_business_manager_id text, p_developer_token_ref text)',
  'core.encerrar_sessoes(p_usuario uuid, p_em timestamp with time zone)',
  'core.is_member(p_organization_id uuid, p_user_id uuid)',
  'core.memberships_of(p_user_id uuid)',
  'core.organizations_of(p_user_id uuid)',
  'core.pending_invitations_for(p_email text)',
  'core.sessao_alcanca_organizacao(p_organization_id uuid, p_user_id uuid)',
  'core.sessao_valida(p_usuario uuid, p_emitida_em timestamp with time zone)',
  'core.shares_organization(p_user_id uuid, p_other_id uuid)',
  'core.slug_taken(p_slug text)',
  'core.upsert_identity(p_email text, p_name text, p_picture_url text)',
  'integrations.acesso_compartilhado(p_connection uuid)',
  'integrations.complete_invite_item(p_item_id uuid, p_connection_id uuid)',
  'integrations.invite_item_still_pending(p_item_id uuid)',
  'integrations.record_whatsapp_inbound(p_connection_id uuid, p_source text, p_external_ref text, p_payload jsonb)',
  'integrations.resolve_invite_for_display(p_token text)',
  'integrations.resolve_invite_item(p_token text, p_platform integrations.platform)',
  'integrations.resolve_webhook_connection(p_token text, p_platform integrations.platform)',
  'privacidade.enfileirar_expurgo_da_conexao(p_connection uuid)',
  'privacidade.registrar_pedido_de_exclusao_meta(p_usuario_hash text, p_hashes_anteriores text[], p_usuario_externo text, p_codigo text)',
  'privacidade.registrar_pedido_de_exclusao_meta(p_usuario_hash text, p_usuario_externo text, p_codigo text)',
  'privacidade.registrar_resultado_do_expurgo(p_id uuid, p_erro text)',
  'privacidade.situacao_do_pedido_de_exclusao(p_codigo text)',
]);

export const SQL_FUNCOES_DEFINER_DO_APP = `
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND has_function_privilege('orla_app', p.oid, 'EXECUTE')
   ORDER BY 1`;
