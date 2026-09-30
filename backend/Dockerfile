# FlowXP API. Small, non-root, and it runs the migrations itself on start.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# postgresql-client provides pg_dump for scripts/backup.sh
RUN apk add --no-cache postgresql16-client tini

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 5100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5100/ready || exit 1

# tini forwards SIGTERM so the server can finish in-flight requests on a deploy
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
