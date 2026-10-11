FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 ASSET_DIRECTORY=/app/data/assets DATABASE_PATH=/app/data/workspace.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data/assets && chown -R node:node /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-server ./build-server
USER node
EXPOSE 3001
CMD ["node","build-server/server/production/main.js","all"]
