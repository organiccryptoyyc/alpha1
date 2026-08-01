#!/bin/sh
# Self-registers an acme-dns account (https://auth.acme-dns.io) on first boot
# and stores the credentials in the persistent caddy_data volume, so Caddy's
# acmedns DNS provider plugin can solve ACME DNS-01 challenges without any
# secrets ever being committed to git or typed into Portainer's UI.
#
# Why DNS-01 at all: this network's router only supports symmetric port
# forwarding (external port N -> internal port N, no remapping), and Umbrel's
# own dashboard already owns host ports 80/443 on this box. That means the
# default ACME HTTP-01/TLS-ALPN-01 challenges - which require Let's Encrypt to
# reach port 80/443 on the public IP - can never succeed here. DNS-01 proves
# domain control via a DNS TXT record instead, so no inbound port 80/443 is
# needed at all.
set -e

CRED_DIR=/data/acmedns
CRED_FILE="$CRED_DIR/creds.json"
FULLDOMAIN_FILE="$CRED_DIR/fulldomain.txt"

mkdir -p "$CRED_DIR"

if [ ! -f "$CRED_FILE" ]; then
  echo "[entrypoint] No acme-dns credentials found, registering new account..."
    RESP=$(curl -sf -X POST https://auth.acme-dns.io/register -H "Content-Type: application/json" -d '{}')
      echo "$RESP" | jq '{username, password, subdomain, server_url: "https://auth.acme-dns.io"}' > "$CRED_FILE"
        echo "$RESP" | jq -r .fulldomain > "$FULLDOMAIN_FILE"
          echo "[entrypoint] Registered. Credentials stored at $CRED_FILE (persisted in the caddy_data volume)."
          else
            echo "[entrypoint] Existing acme-dns credentials found at $CRED_FILE, reusing."
            fi

            FULLDOMAIN=$(cat "$FULLDOMAIN_FILE" 2>/dev/null || echo "(unknown - see earlier logs)")
            echo "[entrypoint] =================================================================="
            echo "[entrypoint] Required DNS CNAME records (add these once, in Squarespace DNS):"
            echo "[entrypoint]   _acme-challenge.organiccryptoyyc.com      CNAME  $FULLDOMAIN"
            echo "[entrypoint]   _acme-challenge.www.organiccryptoyyc.com  CNAME  $FULLDOMAIN"
            echo "[entrypoint] =================================================================="

            exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
