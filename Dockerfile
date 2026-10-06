FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S tourvex && adduser -S tourvex -G tourvex
COPY --from=build --chown=tourvex:tourvex /app/node_modules ./node_modules
COPY --from=build --chown=tourvex:tourvex /app/dist ./dist
COPY --from=build --chown=tourvex:tourvex /app/content ./content
COPY --from=build --chown=tourvex:tourvex /app/package.json ./package.json
USER tourvex
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
