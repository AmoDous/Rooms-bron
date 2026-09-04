# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci

FROM dependencies AS build
WORKDIR /app
COPY server ./server
COPY docs/database.sql ./docs/database.sql
COPY docs/migrations ./docs/migrations
RUN cd server && npm run build

FROM build AS tools
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
ENTRYPOINT ["dumb-init", "--"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/server/node_modules ./server/node_modules
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/package-lock.json ./server/package-lock.json
COPY --chown=node:node index.html ./index.html
COPY --chown=node:node assets ./assets
COPY --chown=node:node docs/database.sql ./docs/database.sql
COPY --chown=node:node docs/migrations ./docs/migrations
USER node
WORKDIR /app/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
