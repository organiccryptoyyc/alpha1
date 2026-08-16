# searxng.Dockerfile
# PATCH (2026-08-16, incident follow-up): switched from a runtime bind-mount
# of searxng-settings.yml to a build-time COPY. The bind-mount approach
# (docker-compose.yml's original `volumes: - ./searxng-settings.yml:...`)
# hit a real production incident: on this container's very first creation,
# Docker found no file at that host path yet and silently created an empty
# DIRECTORY there instead -- "cp: '/etc/searxng/settings.yml' is a
# directory" / "is not a valid file, exiting" in the container's own boot
# log, crash-looping it. Recreating the container does NOT fix this, since
# Docker reuses the same (now permanently-a-directory) host bind-mount
# source path every time.
#
# Building the settings file into the image instead sidesteps that host-path
# problem entirely -- COPY operates on the git-cloned build context (a
# fully-checked-out snapshot at build time), not a live, possibly-racy bind
# mount, and matches the same "build:" pattern already used by every other
# custom service in this stack (sol-rpc-cache, peaq-facilitator,
# puppeteer-render, caddy).
FROM searxng/searxng:latest
COPY searxng-settings.yml /etc/searxng/settings.yml
