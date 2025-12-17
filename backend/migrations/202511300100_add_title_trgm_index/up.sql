CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_documents_title_trgm
    ON tenant.documents
    USING gin (title gin_trgm_ops)
    WHERE deleted_at IS NULL;
