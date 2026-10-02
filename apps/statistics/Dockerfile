FROM node:22-alpine AS build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY client ./client
COPY tsconfig.json vite.config.ts ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js app-server.js analytics-worker.js clickhouse-worker.js company-gateway.js ./
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public
COPY --from=build /build/public/dist ./public/dist

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3010

CMD ["node", "server.js"]
