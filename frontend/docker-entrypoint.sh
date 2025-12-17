#!/bin/sh
set -euo pipefail

# Add mjs to mime.types if not present
sed -i 's|application/javascript|application/javascript mjs|' /etc/nginx/mime.types

API_PROXY_PASS_TRIMMED="${API_PROXY_PASS:-}"
API_PROXY_PASS_TRIMMED="${API_PROXY_PASS_TRIMMED%%/}"

MAX_BODY_SIZE_RAW="${UPLOAD_BODY_LIMIT_BYTES:-}"
if [ -n "$MAX_BODY_SIZE_RAW" ]; then
    MAX_BODY_SIZE=$(printf '%sm' "$((MAX_BODY_SIZE_RAW / (1024 * 1024)))")
else
    MAX_BODY_SIZE="128m"
fi

cat <<BASE > /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;

    client_max_body_size ${MAX_BODY_SIZE};

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
BASE

if [ -n "$API_PROXY_PASS_TRIMMED" ]; then
cat <<PROXY >> /etc/nginx/conf.d/default.conf

    location /api/ {
        client_max_body_size ${MAX_BODY_SIZE};
        proxy_pass ${API_PROXY_PASS_TRIMMED};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /download/ {
        client_max_body_size ${MAX_BODY_SIZE};
        proxy_pass ${API_PROXY_PASS_TRIMMED};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
PROXY
fi

cat <<'ENDCFG' >> /etc/nginx/conf.d/default.conf
}
ENDCFG

exec "$@"
