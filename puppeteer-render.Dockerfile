FROM node:20-alpine

# System Chromium instead of puppeteer's own bundled download -- that
# bundled download has no prebuilt Alpine/musl binary. The extra packages
# below (nss/freetype/harfbuzz/ca-certificates/ttf-freefont) are what
# Chromium on Alpine needs beyond the base apk to actually render real pages
# instead of crashing or producing blank screenshots.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Renamed at copy time, same reason as peaq-facilitator-package.json -- this
# service has its own small dependency set (express + puppeteer-core) and
# shouldn't collide with or bloat the main app's package.json/node_modules.
COPY puppeteer-render-package.json package.json
RUN npm install --omit=dev

# BUG FIX (2026-09-05): this line originally read just
# `COPY puppeteer-render.js ./` -- correct until puppeteer-render.js gained
# a second local module (renderRequestGuard.js, the hard-timeout guard now
# wrapping /pdf, /screenshot, /ocr), at which point that file stopped being
# real: the build context (`context: .` in docker-compose.yml) can see
# renderRequestGuard.js fine, nothing in .dockerignore excludes it, but this
# Dockerfile never explicitly COPYed it in, so it was silently absent from
# every built image regardless. Node's own `import "./renderRequestGuard.js"`
# at the top of puppeteer-render.js then fails at container startup with an
# immediate MODULE_NOT_FOUND -- confirmed live, not guessed: two separate
# post-redeploy retests of GET /v1/render/pdf both 502'd fast (~1.3s, then
# ~2.1s minutes later on a clean retry, ruling out a redeploy-timing race),
# nowhere near the ~18-20s a genuine render hang or this project's own
# timeout values would take -- exactly the signature of the upstream
# container crash-looping (`restart: unless-stopped`) rather than anything
# actually hanging.
COPY puppeteer-render.js renderRequestGuard.js ./

ENV PORT=3002
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "puppeteer-render.js"]
