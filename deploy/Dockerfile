# The deployment bundle already contains compiled frontend and backend files.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 ASSET_DIRECTORY=/app/data/assets DATABASE_PATH=/app/data/workspace.sqlite
WORKDIR /app
COPY package*.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY dist ./dist
COPY build-server ./build-server
RUN node -e "const db = require('better-sqlite3')(':memory:'); db.prepare('SELECT 1').get(); db.close(); require('sharp');" \
    && mkdir -p /app/data/assets && chown -R node:node /app/data
USER node
EXPOSE 3001
CMD ["node","build-server/server/production/main.js","all"]
