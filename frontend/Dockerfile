# syntax=docker/dockerfile:1.6

ARG NODE_IMAGE=node:20-alpine
ARG NGINX_IMAGE=nginx:alpine

# ------------------------------------------------------------------------------
# Base Stage: Install Dependencies
# ------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# ------------------------------------------------------------------------------
# Development Stage
# ------------------------------------------------------------------------------
FROM base AS development
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ------------------------------------------------------------------------------
# Build Stage
# ------------------------------------------------------------------------------
FROM base AS build
COPY . .
RUN npm run build

# ------------------------------------------------------------------------------
# Runtime Stage
# ------------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
WORKDIR /usr/share/nginx/html

COPY --from=build /app/dist ./

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
