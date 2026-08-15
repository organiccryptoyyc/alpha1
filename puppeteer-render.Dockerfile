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

COPY puppeteer-render.js ./

ENV PORT=3002
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "puppeteer-render.js"]
