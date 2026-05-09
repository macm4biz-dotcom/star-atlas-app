FROM node:22-alpine

WORKDIR /app

# Native modules (e.g. usb) require node-gyp toolchain during npm ci.
ENV PYTHON=/usr/bin/python3
RUN apk add --no-cache python3 make g++ \
  linux-headers \
  && ln -sf /usr/bin/python3 /usr/bin/python

# Copy workspace files
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

# Keep only required workspaces in container install context.
RUN node -e "const fs=require('fs');const p='package.json';const pkg=JSON.parse(fs.readFileSync(p,'utf8'));pkg.workspaces=['apps/api','packages/shared'];fs.writeFileSync(p,JSON.stringify(pkg,null,2));"

# Install only API + shared dependencies to avoid unrelated native modules from other workspaces.
RUN npm ci --production=false --workspace=@star-atlas/shared --workspace=@star-atlas/api \
  --ignore-scripts \
  && npm cache clean --force

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
