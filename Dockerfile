FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production APP_MODE=live HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/regulars.sqlite
EXPOSE 3000
CMD ["node","apps/web/server.js"]
