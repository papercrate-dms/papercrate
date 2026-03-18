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

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'self';" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;
    gzip_vary on;
    gzip_min_length 256;

    # Cache hashed assets aggressively
    location ~* \.[0-9a-f]{8,20}\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri /index.html;
    }
}
ENDCFG

exec "$@"
