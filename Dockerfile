FROM node:24-bookworm-slim AS build
WORKDIR /app
# Native dependencies can fall back to node-gyp when no prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 ASSET_DIRECTORY=/app/data/assets DATABASE_PATH=/app/data/workspace.sqlite
WORKDIR /app
COPY package*.json ./
# Reuse Linux dependencies compiled above; do not reinstall in the slim runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-server ./build-server
RUN node -e "const db = require('better-sqlite3')(':memory:'); db.prepare('SELECT 1').get(); db.close(); require('sharp');" \
    && mkdir -p /app/data/assets && chown -R node:node /app/data
USER node
EXPOSE 3001
CMD ["node","build-server/server/production/main.js","all"]
