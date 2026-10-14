# Game server image for Bloxity Legion.
# Listens on $PORT (Legion injects 2567), answers GET /health, runs as the
# unprivileged "node" user and drains on SIGTERM (see src/server.js).
FROM node:22-alpine

ENV NODE_ENV=production
# Only used without MONGODB_URI (Legion always provides one); /tmp is writable.
ENV DATA_DIR=/tmp/double-jump-escape

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

USER node
EXPOSE 2567
# Exec form: node is PID 1 and receives SIGTERM itself.
CMD ["node", "src/server.js"]
