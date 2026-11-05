# MileWage server image (10 section 14, 03 section 3). Build context is the repository root:
#   docker build -f infra/docker/Dockerfile -t milewage-server:local .
# Debian slim, not Alpine: better-sqlite3 13.0.3 needs Node >= 22.22 (spike B findings).
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci && npm run build:server

# The web client, served by Caddy (the `caddy` target below).
FROM build AS web
RUN npm run build:web

# Caddy plus the built client. The server image stays the LAST stage, so a plain `docker build`
# (and the api service in compose) still produces the server.
FROM caddy:2.8.4-alpine AS caddy
COPY --from=web /src/apps/web/dist /srv/web

# Runtime dependencies: only the native module stays external to the bundle.
FROM node:22.22.0-bookworm-slim AS native
WORKDIR /rt
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/dist/native-package.json package.json
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22.22.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    MILEWAGE_PORT=3000 \
    MILEWAGE_DATA_DIR=/app/data \
    MILEWAGE_BACKUP_DIR=/app/backups \
    MILEWAGE_CONFIG_DIR=/app/config
COPY --from=native /rt/node_modules ./node_modules
COPY --from=build /src/dist/server.mjs ./server.mjs
COPY --from=build /src/dist/cli.mjs ./cli.mjs
COPY --from=build /src/dist/migrations ./migrations
COPY --from=build /src/dist/diagnostics-migrations ./diagnostics-migrations
# `docker compose exec api milewage-cli ...` (10 section 7, 14 section 11)
RUN printf '#!/bin/sh\nexec node /app/cli.mjs "$@"\n' > /usr/local/bin/milewage-cli \
  && chmod +x /usr/local/bin/milewage-cli
RUN mkdir -p /app/data /app/backups /app/config && chown -R node:node /app
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=96", "server.mjs"]
