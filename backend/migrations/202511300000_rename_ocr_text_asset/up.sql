UPDATE tenant.document_assets
SET asset_type = 'text-content'
WHERE asset_type = 'ocr-text';
