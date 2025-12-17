-- Rename document content_type column to mime_type for consistency with API.
ALTER TABLE tenant.documents
    RENAME COLUMN content_type TO mime_type;
