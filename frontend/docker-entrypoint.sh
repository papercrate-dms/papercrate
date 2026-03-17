#!/bin/sh
set -euo pipefail

# Add mjs to mime.types if not present
sed -i 's|application/javascript|application/javascript mjs|' /etc/nginx/mime.types

MAX_BODY_SIZE_RAW="${UPLOAD_BODY_LIMIT_BYTES:-}"
if [ -n "$MAX_BODY_SIZE_RAW" ]; then
    MAX_BODY_SIZE=$(printf '%sm' "$((MAX_BODY_SIZE_RAW / (1024 * 1024)))")
else
    MAX_BODY_SIZE="128m"
fi

cat <<ENDCFG > /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;

    client_max_body_size ${MAX_BODY_SIZE};

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
}
ENDCFG

exec "$@"
