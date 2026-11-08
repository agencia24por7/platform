#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set app_password="$APP_DB_PASSWORD" --set worker_password="$WORKER_DB_PASSWORD" \
  --set n8n_password="$N8N_DB_PASSWORD" --set db_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE tria_app LOGIN PASSWORD :'app_password';
CREATE ROLE tria_worker LOGIN PASSWORD :'worker_password';
CREATE ROLE n8n LOGIN PASSWORD :'n8n_password';

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO tria_app, tria_worker;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DATABASE :"db_name" SET row_security = on;
SQL

createdb --username "$POSTGRES_USER" --owner n8n n8n
psql --username "$POSTGRES_USER" --dbname n8n --set ON_ERROR_STOP=1 -c "REVOKE ALL ON DATABASE n8n FROM PUBLIC;"
psql --username "$POSTGRES_USER" --dbname n8n --set ON_ERROR_STOP=1 -c "REVOKE CONNECT ON DATABASE n8n FROM tria_app, tria_worker;"
