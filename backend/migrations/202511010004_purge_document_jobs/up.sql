CREATE UNIQUE INDEX jobs_purge_document_pending_unique
    ON shared.jobs (
        tenant_id,
        ((payload ->> 'document_id')::uuid)
    )
    WHERE job_type = 'purge-document'
      AND payload ? 'document_id'
      AND status IN ('queued', 'processing');
