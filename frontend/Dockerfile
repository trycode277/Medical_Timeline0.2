# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build the static bundle ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# Uses the lockfile when present (commit package-lock.json for reproducible builds)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# "/api" = same-origin via the nginx proxy. Use a full URL only if the API is on another origin.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---------- Stage 2: nginx (non-root, port 8080) ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Rendered into /etc/nginx/conf.d/default.conf at container start (envsubst)
ENV BACKEND_URL=http://backend:8000 \
    NGINX_MAX_BODY=600m
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
