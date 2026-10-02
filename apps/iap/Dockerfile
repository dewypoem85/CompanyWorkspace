FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-alpine
ENV NODE_ENV=production PORT=4180
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY resources/pricing-matrix.csv ./resources/pricing-matrix.csv
RUN mkdir -p /app/data/review-assets && chown -R node:node /app/data
USER node
EXPOSE 4180
CMD ["node","dist/server/index.js"]
