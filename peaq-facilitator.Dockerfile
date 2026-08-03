FROM node:20-alpine

WORKDIR /app

# Renamed at copy time so this doesn't collide with the main app's
# package.json in the same repo -- this service has its own, smaller
# dependency set (see peaq-facilitator-package.json for why: just
# @x402/core, @x402/evm, and express, no need for the main app's Solana/
# caching/UpRock dependencies).
COPY peaq-facilitator-package.json package.json
RUN npm install --omit=dev

COPY peaq-facilitator.js ./

ENV PORT=3333
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "peaq-facilitator.js"]
