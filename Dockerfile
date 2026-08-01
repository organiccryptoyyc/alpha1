FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js dataSources.js x402Middleware.js ./

ENV PORT=4021
EXPOSE 4021

# Basic container-level health check so Portainer/Umbrel can tell if the
# process is actually serving, not just running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4021)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
