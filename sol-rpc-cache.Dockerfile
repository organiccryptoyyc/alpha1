FROM node:20-alpine

# No dependencies to install - sol-rpc-cache.mjs only uses Node's built-in
# http module and global fetch. See that file for why this service exists
# (works around a blockhash-matching race condition in @x402/svm 2.20.0).
COPY sol-rpc-cache.mjs /app/sol-rpc-cache.mjs
WORKDIR /app

CMD ["node", "sol-rpc-cache.mjs"]
