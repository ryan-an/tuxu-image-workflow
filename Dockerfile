FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN sed -i 's@http://deb.debian.org@http://mirrors.tuna.tsinghua.edu.cn@g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm_config_nodedir=/usr/local npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 ASSET_DIRECTORY=/app/data/assets DATABASE_PATH=/app/data/workspace.sqlite
WORKDIR /app
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /app/data/assets && chown -R node:node /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-server ./build-server
USER node
EXPOSE 3001
CMD ["node","build-server/server/production/main.js","all"]
