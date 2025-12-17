DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'papercrate_app') THEN
        CREATE ROLE papercrate_app NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'papercrate_app_login') THEN
        CREATE ROLE papercrate_app_login LOGIN PASSWORD 'papercrate_app';
        GRANT papercrate_app TO papercrate_app_login;
    END IF;
END
$$;

-- Ensure the login role inherits and uses a sensible search path by default
ALTER ROLE papercrate_app_login INHERIT;
ALTER ROLE papercrate_app_login SET search_path = 'tenant, shared, public';

GRANT CONNECT ON DATABASE papercrate TO papercrate_app;
GRANT CONNECT ON DATABASE papercrate TO papercrate_app_login;
GRANT USAGE ON SCHEMA public TO papercrate_app;
GRANT USAGE ON SCHEMA public TO papercrate_app_login;
