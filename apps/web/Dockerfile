FROM node:22-alpine AS build

WORKDIR /app

# Copy workspace files
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build shared and Web
RUN npm run build -w @star-atlas/shared && npm run build -w web

FROM nginx:1.27-alpine

# Copy Nginx config
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy built web app from build stage
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Create a non-root user for security
RUN addgroup -g 101 -S nginx || true && adduser -S -D -H -u 101 -h /var/cache/nginx -s /sbin/nologin -G nginx -g nginx nginx || true

# Expose port (Railway uses default 3000 or 80 for web)
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
