FROM node:22-alpine

WORKDIR /app

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

# Build shared and Bot
RUN npm run build -w @star-atlas/shared && npm run build -w @star-atlas/bot

# Start Bot server (no exposed port, background service)
CMD ["npm", "run", "start", "-w", "@star-atlas/bot"]
