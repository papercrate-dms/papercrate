UPDATE tenant.document_assets
SET asset_type = 'ocr-text'
WHERE asset_type = 'text-content';
