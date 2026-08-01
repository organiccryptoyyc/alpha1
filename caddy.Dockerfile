FROM caddy:builder AS builder

# acme-dns DNS provider plugin, needed for the DNS-01 challenge configured in
# the Caddyfile (see there for why: this router can't remap ports, and
# Umbrel's dashboard already owns host ports 80/443, so the default
# HTTP-01/TLS-ALPN-01 challenges - which require inbound 80/443 - can never
# succeed on this network).
RUN xcaddy build --with github.com/caddy-dns/acmedns

FROM caddy:2-alpine

# curl+jq: used by entrypoint.sh to self-register an acme-dns account on
# first boot and store the resulting credentials in the persistent caddy_data
# volume. Nothing secret is ever committed to this repo or typed into
# Portainer - the container generates and keeps its own credentials.
RUN apk add --no-cache curl jq

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Baked in at build time instead of bind-mounted at runtime: Portainer's
# git-repository stack deployments don't reliably materialize sibling
# non-compose files (like a bind-mounted ./Caddyfile) at the host path it
# resolves relative volume sources against, even though the same git clone
# works fine as a `build:` context (proven by onchain-snapshot-api's own
# Dockerfile in this repo). Copying the file in at build time sidesteps
# that entirely.
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
