# Bucket CORS for Presigned Asset Fetches

The frontend loads certain assets (e.g. OCR text) with `fetch()` against their presigned URLs
(see `frontend/src/preview/DocumentViewerPanel.jsx`). Browsers will block that request unless
the storage bucket sends CORS headers that allow the frontend origin. Configure a rule that
includes:

* the list of allowed origins (your production, staging, or local domains)
* `GET` (and optionally other methods you expose)
* permissive request headers (usually `"*"` is fine for presigned URLs)
* exposed response headers if the frontend needs them (`etag`, `content-length`, etc.)

## Example CORS document

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://app.example"],
      "AllowedMethods": ["GET"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["etag", "content-length", "content-type"],
      "MaxAgeSeconds": 300
    }
  ]
}
```

Replace `https://app.example` with each domain that must fetch presigned assets. Add additional
rules if different origins require different methods.

## Applying the rule

### AWS S3 CLI
```bash
aws s3api put-bucket-cors \
  --bucket <bucket-name> \
  --cors-configuration file://cors.json \
  [--endpoint-url <custom-endpoint>]
```
Save the JSON payload as `cors.json`. When targeting S3-compatible providers (e.g. Hetzner, Ceph RGW),
pass their endpoint via `--endpoint-url`.

### s3cmd (Ceph RGW / generic S3)
```bash
s3cmd setcors cors.json s3://<bucket-name>
```

### Garage
Garage supports CORS configuration via the S3 `PutBucketCors` API, which works
with the standard AWS CLI command above.

Most dashboards expose a similar form—paste the JSON rule into the CORS section for the bucket.
Once the rule is active, browsers will allow the frontend to read presigned assets with fetch().
