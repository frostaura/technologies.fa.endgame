# syntax=docker/dockerfile:1
# The console. Build context is the repository root.
FROM node:26.13.1-alpine AS build
WORKDIR /app
COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/frontend/ ./
RUN npm run build

# Unprivileged nginx: runs as uid 101 and listens on 8080, never root.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY src/frontend/nginx.conf /etc/nginx/conf.d/default.conf
ARG BUILD_SHA=unknown
LABEL org.opencontainers.image.revision=$BUILD_SHA \
      org.opencontainers.image.source="https://github.com/frostaura/technologies.fa.endgame"
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
