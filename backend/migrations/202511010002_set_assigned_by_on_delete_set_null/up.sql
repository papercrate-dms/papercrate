ALTER TABLE tenant.document_tags
    DROP CONSTRAINT IF EXISTS document_tags_assigned_by_fkey,
    ADD CONSTRAINT document_tags_assigned_by_fkey
        FOREIGN KEY (assigned_by)
        REFERENCES shared.users (id)
        ON DELETE SET NULL;

ALTER TABLE tenant.document_correspondents
    DROP CONSTRAINT IF EXISTS document_correspondents_assigned_by_fkey,
    ADD CONSTRAINT document_correspondents_assigned_by_fkey
        FOREIGN KEY (assigned_by)
        REFERENCES shared.users (id)
        ON DELETE SET NULL;
