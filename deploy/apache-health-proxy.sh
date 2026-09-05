#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

# Optional LAN HTTP proxy when HTTPS is already provided by Tailscale Serve.
# Never disable TLS for an enabled Apache site that uses it.
if [ "${HTTP_ONLY:-false}" = "true" ]; then
  if grep -Eqri '^[[:space:]]*(<VirtualHost[^>]*:443|SSLEngine[[:space:]]+on)' /etc/apache2/sites-enabled/; then
    echo "An enabled Apache site uses TLS; preserve it and configure Listen addresses explicitly." >&2
    exit 2
  fi
  if [ -e /etc/apache2/mods-enabled/ssl.load ]; then a2dismod ssl >/dev/null; fi
  if [ -e /etc/apache2/mods-enabled/gnutls.load ]; then a2dismod gnutls >/dev/null; fi
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
systemctl reload-or-restart apache2

echo "Configured: http://${SERVER_NAME}/"
