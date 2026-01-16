#!/bin/bash
set -e

# Standard production pattern: Use shell variables to target the correct database
echo "Initializing roles for database: $POSTGRES_DB"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'papercrate_app') THEN
            CREATE ROLE papercrate_app NOLOGIN;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'papercrate_app_login') THEN
            CREATE ROLE papercrate_app_login LOGIN PASSWORD 'papercrate_app';
            GRANT papercrate_app TO papercrate_app_login;
        END IF;
    END
    \$\$;

    -- Ensure the login role inherits and uses a sensible search path by default
    ALTER ROLE papercrate_app_login INHERIT;
    ALTER ROLE papercrate_app_login SET search_path = 'public';

    -- Dynamic Grant: Uses the currently connected database ($POSTGRES_DB)
    GRANT CONNECT, CREATE ON DATABASE "$POSTGRES_DB" TO papercrate_app;
    GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO papercrate_app_login;

    GRANT USAGE, CREATE ON SCHEMA public TO papercrate_app;
    GRANT USAGE, CREATE ON SCHEMA public TO papercrate_app_login;

    -- Ensure the app user can access existing tables (if any)
    GRANT ALL ON ALL TABLES IN SCHEMA public TO papercrate_app;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO papercrate_app;
EOSQL
