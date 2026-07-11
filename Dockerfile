FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV SHARE_DB_PATH=/data/shares.sqlite

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server/server.mjs"]
