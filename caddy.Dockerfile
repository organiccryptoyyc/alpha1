FROM caddy:2-alpine

# Baked in at build time instead of bind-mounted at runtime: Portainer's
# git-repository stack deployments don't reliably materialize sibling
# non-compose files (like a bind-mounted ./Caddyfile) at the host path it
# resolves relative volume sources against, even though the same git clone
# works fine as a `build:` context (proven by onchain-snapshot-api's own
# Dockerfile in this repo). Copying the file in at build time sidesteps
# that entirely.
COPY Caddyfile /etc/caddy/Caddyfile
