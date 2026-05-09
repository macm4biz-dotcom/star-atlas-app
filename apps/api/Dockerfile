FROM node:22-alpine

WORKDIR /app

# Native modules (e.g. usb) require node-gyp toolchain during npm ci.
RUN apk add --no-cache python3 make g++

# Copy workspace files
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install dependencies
RUN npm ci --production=false && npm cache clean --force

# Copy source code
COPY . .

# Build shared and API
RUN npm run build -w @star-atlas/shared && npm run build -w @star-atlas/api

# Expose port (Railway will override via PORT env var)
EXPOSE 4100

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 4100) + '/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start API server
CMD ["npm", "run", "start", "-w", "@star-atlas/api"]
