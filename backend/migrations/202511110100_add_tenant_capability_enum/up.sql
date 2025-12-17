-- diesel:run_in_transaction = false

DO $$
BEGIN
    BEGIN
        EXECUTE 'ALTER TYPE tenant.api_capability ADD VALUE ''tenants:write''';
    EXCEPTION
        WHEN undefined_object THEN
            BEGIN
                EXECUTE 'ALTER TYPE api_capability ADD VALUE ''tenants:write''';
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END;
        WHEN duplicate_object THEN NULL;
    END;
END $$;

DO $$
BEGIN
    BEGIN
        EXECUTE 'ALTER TYPE tenant.api_capability ADD VALUE ''tenants:reset''';
    EXCEPTION
        WHEN undefined_object THEN
            BEGIN
                EXECUTE 'ALTER TYPE api_capability ADD VALUE ''tenants:reset''';
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END;
        WHEN duplicate_object THEN NULL;
    END;
END $$;

DO $$
BEGIN
    BEGIN
        EXECUTE 'ALTER TYPE tenant.api_capability ADD VALUE ''tenants:delete''';
    EXCEPTION
        WHEN undefined_object THEN
            BEGIN
                EXECUTE 'ALTER TYPE api_capability ADD VALUE ''tenants:delete''';
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END;
        WHEN duplicate_object THEN NULL;
    END;
END $$;
