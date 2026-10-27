# Aegira — production image. Node 22 for the built-in node:sqlite driver.
FROM node:22-slim AS build
WORKDIR /app
COPY core/package*.json ./
RUN npm ci
COPY core/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Persist the SQLite DB on a mounted volume in production (see fly.toml).
ENV AEGIRA_DB=/data/aegira.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/api/main.js"]
