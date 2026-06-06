#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

a2enmod proxy proxy_http proxy_wstunnel headers >/dev/null

SERVER_NAME="${SERVER_NAME:-health.local}"
SERVER_ALIASES="${SERVER_ALIASES:-health health-dashboard.local healthdashboard.local}"
UPSTREAM_HTTP="${UPSTREAM_HTTP:-http://127.0.0.1:5000}"
UPSTREAM_WS="${UPSTREAM_WS:-ws://127.0.0.1:5000/ws}"

cat >/etc/apache2/sites-available/health-dashboard.conf <<EOF
<VirtualHost *:80>
    ServerName ${SERVER_NAME}
    ServerAlias ${SERVER_ALIASES}

    ProxyRequests Off
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "http"

    ProxyPass "/ws" "${UPSTREAM_WS}"
    ProxyPassReverse "/ws" "${UPSTREAM_WS}"
    ProxyPass "/" "${UPSTREAM_HTTP}/"
    ProxyPassReverse "/" "${UPSTREAM_HTTP}/"
</VirtualHost>
EOF

a2ensite health-dashboard.conf >/dev/null
apache2ctl configtest
systemctl reload apache2

echo "Configured: http://${SERVER_NAME}/"
