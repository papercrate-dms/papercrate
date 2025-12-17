-- Revert column rename.
ALTER TABLE tenant.documents
    RENAME COLUMN mime_type TO content_type;
