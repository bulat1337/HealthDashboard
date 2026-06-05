#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

a2enmod proxy proxy_http proxy_wstunnel headers >/dev/null

cat >/etc/apache2/sites-available/health-dashboard.conf <<'EOF'
<VirtualHost *:80>
    ServerName health.local
    ServerAlias health health-dashboard.local healthdashboard.local vaioserver.local
    ServerAlias health.192-168-31-74.sslip.io 192-168-31-74.sslip.io 192.168.31.74.sslip.io

    ProxyRequests Off
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "http"

    ProxyPass "/ws" "ws://127.0.0.1:5000/ws"
    ProxyPassReverse "/ws" "ws://127.0.0.1:5000/ws"
    ProxyPass "/" "http://127.0.0.1:5000/"
    ProxyPassReverse "/" "http://127.0.0.1:5000/"
</VirtualHost>
EOF

a2ensite health-dashboard.conf >/dev/null
apache2ctl configtest
systemctl reload apache2

echo "Configured: http://health.local/"
